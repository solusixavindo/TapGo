import { MembershipOrderChannel, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MembershipDocumentService } from "../../src/modules/memberships/application/MembershipDocumentService.js";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * Verifikasi dokumen KYC oleh admin (Stage R2.6 jalur A, poin 5).
 *
 * Pembelian dari web sekarang berhenti pada status PAID. Endpoint di berkas ini
 * adalah satu-satunya jalan agar order tersebut berubah menjadi membership
 * aktif, sehingga endpoint ini memegang kunci pembayaran bonus sponsor dan
 * bonus level. Karena itu yang diuji bukan hanya jalur berhasilnya, tetapi juga
 * siapa yang boleh memanggilnya dan keadaan apa saja yang harus ditolak.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

const VERIFY_PATH = (orderId: string) =>
  `/api/v1/admin/member-requests/${orderId}/verify-documents`;
const CORRECTION_PATH = (orderId: string) =>
  `/api/v1/admin/member-requests/${orderId}/request-correction`;
const REJECT_PATH = (orderId: string) =>
  `/api/v1/admin/member-requests/${orderId}/reject-documents`;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let service: MembershipOrderService;
let userSequence = 0;

describe.skipIf(!runIntegration)("Admin membership document verification", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-web-verification";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-web-verification";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    service = new MembershipOrderService(prisma);

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("menolak verifikasi tanpa token", async () => {
    const order = await createPaidWebOrder();
    const response = await verify(order.id);

    expect(response.status).toBe(401);
    await expectNotActivated(order.id);
  });

  it("menolak verifikasi oleh role USER", async () => {
    const order = await createPaidWebOrder();
    const outsider = await createUser("VERIFYUSR", "USER");
    const response = await verify(order.id, outsider);

    expect(response.status).toBe(403);
    await expectNotActivated(order.id);
  });

  it("mengaktifkan membership saat ADMIN memverifikasi order web yang sudah lunas", async () => {
    const order = await createPaidWebOrder();
    const admin = await createUser("VERIFYADM", "ADMIN");

    await expectNotActivated(order.id);

    const response = await verify(order.id, admin);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("PAID");

    const userMembership = await prisma.userMembership.findUniqueOrThrow({
      where: { orderId: order.id }
    });
    expect(userMembership.status).toBe("ACTIVE");
  });

  it("menandai dokumen KTP dan selfie menjadi APPROVED", async () => {
    const order = await createPaidWebOrder({ withDocuments: true });
    const admin = await createUser("VERIFYDOC", "ADMIN");

    expect(await documentStatuses(order.id)).toEqual(["PENDING", "PENDING"]);

    const response = await verify(order.id, admin);
    expect(response.status).toBe(200);
    expect(await documentStatuses(order.id)).toEqual(["APPROVED", "APPROVED"]);
  });

  it("mencatat jejak audit berisi admin yang memverifikasi", async () => {
    const order = await createPaidWebOrder();
    const admin = await createUser("VERIFYAUD", "ADMIN");

    const response = await verify(order.id, admin);
    expect(response.status).toBe(200);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "MEMBERSHIP_DOCUMENTS_VERIFIED", entityId: order.id }
    });
    expect(audit.actorId).toBe(admin.id);
    expect(audit.entityType).toBe("MEMBERSHIP_ORDER");
    expect((audit.metadata as Record<string, unknown>).channel).toBe("WEB");
  });

  it("menolak verifikasi order web yang belum lunas", async () => {
    const order = await createWebOrder();
    const admin = await createUser("VERIFYUNP", "ADMIN");

    const response = await verify(order.id, admin);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("MEMBERSHIP_ORDER_NOT_PAID");
    await expectNotActivated(order.id);
  });

  it("menolak verifikasi kedua atas order yang sama", async () => {
    const order = await createPaidWebOrder();
    const admin = await createUser("VERIFYTWC", "ADMIN");

    expect((await verify(order.id, admin)).status).toBe(200);

    const second = await verify(order.id, admin);
    expect(second.status).toBe(409);
    expect(await codeOf(second)).toBe("MEMBERSHIP_ALREADY_ACTIVATED");

    // Bonus tidak boleh terbayar dua kali.
    expect(
      await prisma.commission.count({
        where: { triggerType: "MEMBERSHIP_ORDER", triggerId: order.id }
      })
    ).toBe(1);
  });

  it("menolak verifikasi order kanal APP yang memang aktif saat bayar", async () => {
    const order = await createPaidWebOrder({ channel: "APP" });
    const admin = await createUser("VERIFYAPP", "ADMIN");

    const response = await verify(order.id, admin);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("MEMBERSHIP_VERIFICATION_NOT_REQUIRED");
  });

  it("menjawab 404 untuk order yang tidak ada", async () => {
    const admin = await createUser("VERIFY404", "ADMIN");
    const response = await verify("00000000-0000-4000-8000-000000000000", admin);

    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe("MEMBERSHIP_ORDER_NOT_FOUND");
  });

  it("menolak penolakan dokumen oleh role USER", async () => {
    const order = await createPaidWebOrder();
    const outsider = await createUser("REJECTUSR", "USER");

    const response = await reject(order.id, outsider);
    expect(response.status).toBe(403);

    const stored = await prisma.membershipOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe("PAID");
  });

  it("membatalkan order dan mencatat refund penuh saat ADMIN menolak dokumen", async () => {
    const order = await createPaidWebOrder({ withDocuments: true });
    const admin = await createUser("REJECTADM", "ADMIN");

    const response = await reject(order.id, admin, "KTP buram dan nama tidak cocok");
    expect(response.status).toBe(200);

    const stored = await prisma.membershipOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe("CANCELLED");
    expect(await documentStatuses(order.id)).toEqual(["REJECTED", "REJECTED"]);

    const rejection = (stored.registrationData as Record<string, unknown>)
      .documentRejection as Record<string, unknown>;
    expect(rejection.rejectedBy).toBe(admin.id);
    expect(rejection.reason).toBe("KTP buram dan nama tidak cocok");

    // Refund harus penuh: sama persis dengan nilai order Silver.
    const refund = rejection.refund as Record<string, unknown>;
    expect(refund.amount).toBe("500000.00");
    expect(refund.status).toBe("PENDING");
  });

  it("menyalin permintaan refund ke invoice dan payment tanpa mengklaim dana sudah kembali", async () => {
    const order = await createPaidWebOrder();
    const admin = await createUser("REJECTINV", "ADMIN");

    expect((await reject(order.id, admin)).status).toBe(200);

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId: order.id } });
    const payment = await prisma.membershipPayment.findFirstOrThrow({ where: { orderId: order.id } });

    for (const record of [invoice, payment]) {
      const refund = (record.metadata as Record<string, unknown>).refund as Record<string, unknown>;
      expect(refund.amount).toBe("500000.00");
      expect(refund.status).toBe("PENDING");
    }

    // Uangnya belum benar-benar dikembalikan, jadi statusnya belum boleh
    // REFUNDED. Eksekusi ke penyedia pembayaran menyusul di tahap berikutnya.
    expect(invoice.status).toBe("PAID");
    expect(payment.status).toBe("PAID");
  });

  it("tidak membayar satu pun bonus setelah dokumen ditolak", async () => {
    const order = await createPaidWebOrder();
    const admin = await createUser("REJECTBON", "ADMIN");

    expect((await reject(order.id, admin)).status).toBe(200);

    await expectNotActivated(order.id);
    const sponsorWallet = await prisma.wallet.findUnique({ where: { userId: order.sponsorId } });
    expect(sponsorWallet?.cashBalance.toFixed(2) ?? "0.00").toBe("0.00");
  });

  it("mencatat jejak audit penolakan berisi nilai refund", async () => {
    const order = await createPaidWebOrder();
    const admin = await createUser("REJECTAUD", "ADMIN");

    expect((await reject(order.id, admin, "dokumen tidak terbaca")).status).toBe(200);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "MEMBERSHIP_DOCUMENTS_REJECTED", entityId: order.id }
    });
    const metadata = audit.metadata as Record<string, unknown>;
    expect(audit.actorId).toBe(admin.id);
    expect(metadata.refundAmount).toBe("500000.00");
    expect(metadata.reason).toBe("dokumen tidak terbaca");
  });

  it("menolak pembatalan order yang sudah terlanjur aktif", async () => {
    const order = await createPaidWebOrder();
    const admin = await createUser("REJECTACT", "ADMIN");
    expect((await verify(order.id, admin)).status).toBe(200);

    // Membalik order yang sudah aktif berarti menarik kembali bonus upline yang
    // sudah terbayar. Alur pembalikan itu sengaja belum ada, jadi harus ditolak.
    const response = await reject(order.id, admin);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("MEMBERSHIP_ALREADY_ACTIVATED");

    const stored = await prisma.membershipOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe("PAID");
  });

  it("menutup jalan verifikasi setelah dokumen ditolak", async () => {
    const order = await createPaidWebOrder();
    const admin = await createUser("REJECTSEQ", "ADMIN");
    expect((await reject(order.id, admin)).status).toBe(200);

    const response = await verify(order.id, admin);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("MEMBERSHIP_ORDER_NOT_PAID");
    await expectNotActivated(order.id);
  });

  it("menolak penolakan dokumen pada order kanal APP", async () => {
    const order = await createPaidWebOrder({ channel: "APP" });
    const admin = await createUser("REJECTAPP", "ADMIN");

    const response = await reject(order.id, admin);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("MEMBERSHIP_VERIFICATION_NOT_REQUIRED");
  });

  describe("meminta perbaikan dokumen", () => {
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("perbaikan")]);
    let previousSecret: string | undefined;
    beforeAll(async () => {
      const { env } = await import("../../src/config/env.js");
      previousSecret = env.MEMBERSHIP_DOCUMENT_SECRET;
      env.MEMBERSHIP_DOCUMENT_SECRET = "kunci-uji-dokumen-tapgo-minimal-32-karakter";
    });
    afterAll(async () => {
      const { env } = await import("../../src/config/env.js");
      env.MEMBERSHIP_DOCUMENT_SECRET = previousSecret as string;
    });

    it("ADMIN meminta perbaikan: order tetap lunas tanpa refund, catatan tersimpan, audit dan dokumen ditandai", async () => {
      const order = await createPaidWebOrder({ withDocuments: true });
      const admin = await createUser("CORRADM", "ADMIN");

      const response = await post(CORRECTION_PATH(order.id), admin, { reason: "Foto KTP buram, mohon unggah ulang" });
      expect(response.status).toBe(200);

      const stored = await prisma.membershipOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(stored.status).toBe("PAID");
      const data = stored.registrationData as { documentCorrection?: { reason: string; resubmittedAt: string | null; count: number }; documentRejection?: unknown };
      expect(data.documentCorrection).toMatchObject({ reason: "Foto KTP buram, mohon unggah ulang", resubmittedAt: null, count: 1 });
      expect(data.documentRejection).toBeUndefined();
      expect(await documentStatuses(order.id)).toEqual(["REJECTED", "REJECTED"]);
      expect(await prisma.auditLog.count({ where: { action: "MEMBERSHIP_CORRECTION_REQUESTED", entityId: order.id } })).toBe(1);
      await expectNotActivated(order.id);
    });

    it("catatan wajib; USER dan tanpa token ditolak; order APP tidak punya keputusan dokumen", async () => {
      const order = await createPaidWebOrder({ withDocuments: true });
      const admin = await createUser("CORRREQ", "ADMIN");
      const outsider = await createUser("CORRUSR", "USER");

      expect((await post(CORRECTION_PATH(order.id), admin, {})).status).toBe(400);
      expect((await post(CORRECTION_PATH(order.id), admin, { reason: "ab" })).status).toBe(400);
      expect((await post(CORRECTION_PATH(order.id), outsider, { reason: "Tolong perbaiki" })).status).toBe(403);
      expect((await post(CORRECTION_PATH(order.id), undefined, { reason: "Tolong perbaiki" })).status).toBe(401);

      const appOrder = await createPaidWebOrder({ channel: "APP" });
      const response = await post(CORRECTION_PATH(appOrder.id), admin, { reason: "Tolong perbaiki" });
      expect(response.status).toBe(409);
      expect(await codeOf(response)).toBe("MEMBERSHIP_VERIFICATION_NOT_REQUIRED");
    });

    it("pemohon mengunggah ulang: penanda resubmittedAt terisi, dokumen kembali PENDING, lalu admin dapat memverifikasi", async () => {
      const order = await createPaidWebOrder({ withDocuments: true });
      const admin = await createUser("CORRFLOW", "ADMIN");
      expect((await post(CORRECTION_PATH(order.id), admin, { reason: "Selfie gelap" })).status).toBe(200);

      const documents = new MembershipDocumentService(prisma);
      await documents.upload({ userId: order.buyerId, orderId: order.id, type: "SELFIE", contentType: "image/png", bytes: PNG });

      const stored = await prisma.membershipOrder.findUniqueOrThrow({ where: { id: order.id } });
      const correction = (stored.registrationData as { documentCorrection: { resubmittedAt: string | null } }).documentCorrection;
      expect(correction.resubmittedAt).not.toBeNull();
      const statuses = await prisma.membershipDocument.findMany({ where: { orderId: order.id }, orderBy: { type: "asc" }, select: { type: true, status: true } });
      expect(statuses.find((d) => d.type === "SELFIE")?.status).toBe("PENDING");

      expect((await verify(order.id, admin)).status).toBe(200);
      expect(await prisma.userMembership.findUnique({ where: { orderId: order.id } })).not.toBeNull();
    });

    it("permintaan perbaikan kedua menaikkan hitungan dan mengosongkan penanda unggah ulang", async () => {
      const order = await createPaidWebOrder({ withDocuments: true });
      const admin = await createUser("CORRTWO", "ADMIN");
      await post(CORRECTION_PATH(order.id), admin, { reason: "Pertama" });
      await new MembershipDocumentService(prisma).upload({ userId: order.buyerId, orderId: order.id, type: "KTP", contentType: "image/png", bytes: PNG });
      await post(CORRECTION_PATH(order.id), admin, { reason: "Kedua, masih buram" });
      const stored = await prisma.membershipOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect((stored.registrationData as { documentCorrection: unknown }).documentCorrection).toMatchObject({ reason: "Kedua, masih buram", count: 2, resubmittedAt: null });
    });
  });
});

async function createWebOrder(options: { channel?: MembershipOrderChannel; withDocuments?: boolean } = {}) {
  const sponsor = await createUser("VERSPONSOR", "USER");
  await activateSilver(sponsor.id);
  const buyer = await createUser("VERBUYER", "USER");
  await prisma.referral.create({ data: { sponsorId: sponsor.id, userId: buyer.id } });

  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  const order = await service.createOrder({
    userId: buyer.id,
    packageId: silver.id,
    channel: options.channel ?? "WEB"
  });

  if (options.withDocuments) {
    for (const type of ["KTP", "SELFIE"] as const) {
      await prisma.membershipDocument.create({
        data: { orderId: order.id, userId: buyer.id, type, localPath: `/dev/null/${type}` }
      });
    }
  }

  return { id: order.id, buyerId: buyer.id, sponsorId: sponsor.id };
}

async function createPaidWebOrder(options: { channel?: MembershipOrderChannel; withDocuments?: boolean } = {}) {
  const order = await createWebOrder(options);
  // Mensimulasikan callback penyedia pembayaran: uang masuk, order lunas.
  await service.markPaymentSuccess({
    userId: order.buyerId,
    role: "USER",
    orderId: order.id,
    paymentReference: `verify-test-${order.id}`
  });
  return order;
}

async function expectNotActivated(orderId: string) {
  expect(await prisma.userMembership.findUnique({ where: { orderId } })).toBeNull();
  expect(
    await prisma.commission.count({
      where: { triggerType: "MEMBERSHIP_ORDER", triggerId: orderId }
    })
  ).toBe(0);
}

async function documentStatuses(orderId: string) {
  const documents = await prisma.membershipDocument.findMany({
    where: { orderId },
    orderBy: { type: "asc" }
  });
  return documents.map((document) => document.status);
}

async function codeOf(response: Response) {
  const body = (await response.json()) as { code?: string };
  return body.code;
}

async function verify(orderId: string, user?: User) {
  return post(VERIFY_PATH(orderId), user);
}

async function reject(orderId: string, user?: User, reason?: string) {
  return post(REJECT_PATH(orderId), user, reason === undefined ? {} : { reason });
}

async function post(path: string, user?: User, body: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(user ? { authorization: `Bearer ${tokenFor(user)}` } : {})
    },
    body: JSON.stringify(body)
  });
}

function tokenFor(user: User) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` });
}

async function createUser(label: string, role: UserRole): Promise<User> {
  userSequence += 1;
  const referralCode = `${label}${userSequence}`.slice(0, 24);
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${String(userSequence).padStart(9, "0")}`,
      referralCode,
      role,
      membershipId: basic.id
    }
  });
}

async function activateSilver(userId: string) {
  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  await prisma.userMembership.create({
    data: { userId, membershipId: silver.id, status: "ACTIVE", activeAt: new Date() }
  });
  await prisma.user.update({ where: { id: userId }, data: { membershipId: silver.id } });
}
