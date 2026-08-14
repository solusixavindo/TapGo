import { Prisma, User, UserRole } from "@prisma/client";
import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import {
  PaymentRefundGateway,
  RefundRequest,
  RefundResult
} from "../../src/modules/payments/application/PaymentRefundGateway.js";
import { AppError } from "../../src/core/errors/AppError.js";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * Eksekusi pengembalian dana.
 *
 * Gerbang penyedia di-stub: test TIDAK boleh menyentuh jaringan, dan sama
 * sekali tidak boleh menyentuh uang. Yang diuji di sini justru bagian yang
 * paling mudah salah dan paling mahal bila salah:
 *
 * 1. Status hanya berubah SETELAH penyedia mengonfirmasi. Kalau berubah lebih
 *    dulu, kegagalan penyedia meninggalkan pembukuan yang berbohong.
 * 2. Kegagalan penyedia tidak membatalkan keputusan penolakan dokumen, dan
 *    percobaan dapat diulang.
 * 3. Kunci idempotensi deterministik, sehingga percobaan ulang tidak dapat
 *    mengirim uang dua kali.
 * 4. Tidak ada jalan mengembalikan dana dua kali.
 */

let orders: MembershipOrderService;
let RefundService: typeof import("../../src/modules/memberships/application/MembershipRefundService.js");
let sequence = 0;

/** Penyedia palsu. Mencatat permintaan, dan dapat disuruh gagal. */
class FakeGateway implements PaymentRefundGateway {
  readonly provider = "FAKE";
  readonly requests: RefundRequest[] = [];
  failWith: AppError | null = null;

  async refund(request: RefundRequest): Promise<RefundResult> {
    this.requests.push(request);
    if (this.failWith) {
      throw this.failWith;
    }
    return {
      provider: this.provider,
      providerReference: `FAKE-REF-${this.requests.length}`,
      raw: { ok: true }
    };
  }
}

describe.skipIf(!runIntegration)("Membership refund execution", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-membership-refund-flow";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-membership-refund-flow";

    orders = new MembershipOrderService(prisma);
    RefundService = await import(
      "../../src/modules/memberships/application/MembershipRefundService.js"
    );
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it("mengembalikan dana penuh dan menandai invoice serta payment REFUNDED", async () => {
    const scenario = await rejectedOrder();
    const gateway = new FakeGateway();
    const service = new RefundService.MembershipRefundService(prisma, gateway);

    const result = await service.executeRefund({
      orderId: scenario.orderId,
      adminId: scenario.admin.id
    });

    expect(result.status).toBe("REFUNDED");
    expect(result.amount).toBe("500000.00");
    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]!.amount.toFixed(2)).toBe("500000.00");

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { orderId: scenario.orderId }
    });
    const payment = await prisma.membershipPayment.findFirstOrThrow({
      where: { orderId: scenario.orderId }
    });
    expect(invoice.status).toBe("REFUNDED");
    expect(payment.status).toBe("REFUNDED");
    expect(payment.providerReference).toBe("FAKE-REF-1");

    const stored = await prisma.membershipOrder.findUniqueOrThrow({
      where: { id: scenario.orderId }
    });
    const refund = (stored.registrationData as Record<string, any>).documentRejection.refund;
    expect(refund.status).toBe("REFUNDED");
    expect(refund.providerReference).toBe("FAKE-REF-1");
    expect(refund.executedBy).toBe(scenario.admin.id);
  });

  it("memakai kunci idempotensi yang sama pada percobaan ulang", async () => {
    const scenario = await rejectedOrder();
    const gateway = new FakeGateway();
    const service = new RefundService.MembershipRefundService(prisma, gateway);

    gateway.failWith = new AppError("penyedia sedang gangguan", 502, "REFUND_PROVIDER_REJECTED");
    await expect(
      service.executeRefund({ orderId: scenario.orderId, adminId: scenario.admin.id })
    ).rejects.toMatchObject({ code: "REFUND_PROVIDER_REJECTED" });

    gateway.failWith = null;
    await service.executeRefund({ orderId: scenario.orderId, adminId: scenario.admin.id });

    // Inilah yang mencegah uang terkirim dua kali ketika penyedia sudah
    // menerima permintaan tetapi pencatatan kita gagal.
    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests[0]!.refundKey).toBe(gateway.requests[1]!.refundKey);
    expect(gateway.requests[0]!.refundKey).toBe(
      RefundService.refundKeyFor(scenario.orderId)
    );
    // Kunci tidak boleh mengandung waktu atau nilai acak.
    expect(gateway.requests[0]!.refundKey).not.toMatch(/\d{13}/);
  });

  it("tidak mengubah status apa pun ketika penyedia menolak", async () => {
    const scenario = await rejectedOrder();
    const gateway = new FakeGateway();
    gateway.failWith = new AppError("ditolak", 502, "REFUND_PROVIDER_REJECTED");
    const service = new RefundService.MembershipRefundService(prisma, gateway);

    await expect(
      service.executeRefund({ orderId: scenario.orderId, adminId: scenario.admin.id })
    ).rejects.toMatchObject({ code: "REFUND_PROVIDER_REJECTED" });

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { orderId: scenario.orderId }
    });
    const payment = await prisma.membershipPayment.findFirstOrThrow({
      where: { orderId: scenario.orderId }
    });
    const stored = await prisma.membershipOrder.findUniqueOrThrow({
      where: { id: scenario.orderId }
    });
    const refund = (stored.registrationData as Record<string, any>).documentRejection.refund;

    // Pembukuan tidak boleh mengklaim uang sudah kembali padahal belum.
    expect(invoice.status).toBe("PAID");
    expect(payment.status).toBe("PAID");
    expect(refund.status).toBe("PENDING");
    // Keputusan penolakan dokumen tetap berdiri.
    expect(stored.status).toBe("CANCELLED");
  });

  it("mencatat percobaan yang gagal agar dapat ditelusuri", async () => {
    const scenario = await rejectedOrder();
    const gateway = new FakeGateway();
    gateway.failWith = new AppError("ditolak", 502, "REFUND_PROVIDER_REJECTED");
    const service = new RefundService.MembershipRefundService(prisma, gateway);

    await expect(
      service.executeRefund({ orderId: scenario.orderId, adminId: scenario.admin.id })
    ).rejects.toThrow();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "MEMBERSHIP_REFUND_FAILED", entityId: scenario.orderId }
    });
    expect(audit.actorId).toBe(scenario.admin.id);
    expect((audit.metadata as Record<string, unknown>).errorCode).toBe(
      "REFUND_PROVIDER_REJECTED"
    );
  });

  it("menolak pengembalian dana kedua atas pengajuan yang sama", async () => {
    const scenario = await rejectedOrder();
    const gateway = new FakeGateway();
    const service = new RefundService.MembershipRefundService(prisma, gateway);

    await service.executeRefund({ orderId: scenario.orderId, adminId: scenario.admin.id });

    await expect(
      service.executeRefund({ orderId: scenario.orderId, adminId: scenario.admin.id })
    ).rejects.toMatchObject({ code: "MEMBERSHIP_REFUND_ALREADY_COMPLETED" });

    // Penyedia tidak boleh dipanggil untuk kedua kalinya.
    expect(gateway.requests).toHaveLength(1);
  });

  it("menolak pengajuan yang dokumennya belum ditolak", async () => {
    const scenario = await paidOrder();
    const gateway = new FakeGateway();
    const service = new RefundService.MembershipRefundService(prisma, gateway);

    await expect(
      service.executeRefund({ orderId: scenario.orderId, adminId: scenario.admin.id })
    ).rejects.toMatchObject({ code: "MEMBERSHIP_REFUND_ORDER_NOT_REJECTED" });
    expect(gateway.requests).toHaveLength(0);
  });

  it("mencatat jejak audit keberhasilan beserta nilainya", async () => {
    const scenario = await rejectedOrder();
    const service = new RefundService.MembershipRefundService(prisma, new FakeGateway());

    await service.executeRefund({ orderId: scenario.orderId, adminId: scenario.admin.id });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "MEMBERSHIP_REFUND_COMPLETED", entityId: scenario.orderId }
    });
    const metadata = audit.metadata as Record<string, unknown>;
    expect(audit.actorId).toBe(scenario.admin.id);
    expect(metadata.amount).toBe("500000.00");
    expect(metadata.provider).toBe("FAKE");
    expect(metadata.providerReference).toBe("FAKE-REF-1");
  });

  it("menolak order yang tidak ada", async () => {
    const admin = await createUser("REFADMX", "ADMIN");
    const service = new RefundService.MembershipRefundService(prisma, new FakeGateway());

    await expect(
      service.executeRefund({
        orderId: "00000000-0000-4000-8000-000000000000",
        adminId: admin.id
      })
    ).rejects.toMatchObject({ code: "MEMBERSHIP_ORDER_NOT_FOUND" });
  });
});

type Scenario = { orderId: string; admin: User; buyer: User };

async function paidOrder(): Promise<Scenario> {
  const buyer = await createUser("REFBUYER", "USER");
  const admin = await createUser("REFADMIN", "ADMIN");
  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  const order = await orders.createOrder({
    userId: buyer.id,
    packageId: silver.id,
    channel: "WEB"
  });
  await orders.markPaymentSuccess({
    userId: buyer.id,
    role: "USER",
    orderId: order.id,
    paymentReference: `refund-test-${order.id}`
  });
  return { orderId: order.id, admin, buyer };
}

async function rejectedOrder(): Promise<Scenario> {
  const scenario = await paidOrder();
  await orders.rejectOrderDocuments({
    orderId: scenario.orderId,
    adminId: scenario.admin.id,
    reason: "KTP tidak terbaca"
  });
  return scenario;
}

async function createUser(label: string, role: UserRole): Promise<User> {
  sequence += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${label}`,
      phone: `+6285${String(sequence).padStart(8, "0")}`,
      referralCode: `${label}${sequence}`.slice(0, 24),
      role,
      status: "ACTIVE",
      membershipId: basic.id
    }
  });
}

export type { Prisma };
