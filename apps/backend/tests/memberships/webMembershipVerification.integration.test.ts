import { MembershipOrderChannel, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  return fetch(`${baseUrl}${VERIFY_PATH(orderId)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(user ? { authorization: `Bearer ${tokenFor(user)}` } : {})
    },
    body: "{}"
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
