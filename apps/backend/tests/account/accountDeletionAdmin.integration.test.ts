import { UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/core/security/passwordHasher.js";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * Pemrosesan permintaan hapus akun (temuan audit 30 Okt 2026: hanya ada daftar, tidak ada cara memproses).
 *
 * Yang dijaga: hanya VIP yang boleh; tindakan menuntut kalimat konfirmasi DAN password; akun dengan kewajiban terbuka
 * (saldo, penarikan, pesanan) tidak pernah dihapus; data pribadi benar-benar hilang sedangkan riwayat uang tetap ada;
 * hasilnya tidak dapat diulang.
 */

const VIP_PASSWORD = "PasswordPemilik#2026";
let server: Server | undefined;
let baseUrl = "";
let sequence = 0;
let signAccessToken: (payload: { sub: string; role: UserRole; sessionId: string }) => string;

async function createUser(role: UserRole, extra: Record<string, unknown> = {}) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Hapus ${role} ${sequence}`,
      phone: `08124560${String(1000 + sequence)}`,
      email: `hapus${sequence}@example.test`,
      referralCode: `DEL${String(sequence).padStart(6, "0")}`,
      role,
      status: "ACTIVE",
      passwordHash: await hashPassword(VIP_PASSWORD),
      ...extra
    }
  });
}

const tokenOf = (user: { id: string; role: UserRole }) =>
  signAccessToken({ sub: user.id, role: user.role, sessionId: `s-${user.id}` });

async function call(path: string, token: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(`${baseUrl}/api/v1/admin/delete-requests${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const json = (await response.json().catch(() => ({}))) as { code?: string; data?: any; message?: string };
  return { status: response.status, code: json.code, data: json.data, message: json.message };
}

/** Anggota lengkap dengan data pribadi di semua tempat yang dijanjikan halaman hapus-akun. */
async function createMemberWithPersonalData() {
  const member = await createUser("DRIVER", { avatarUrl: "https://example.test/a.png", bankAccount: { bank: "BCA", number: "123" } });
  const wallet = await prisma.wallet.create({ data: { userId: member.id } });
  await prisma.walletTransaction.create({
    data: { walletId: wallet.id, type: "TOPUP", amount: "100000.00", referenceType: "TEST", referenceId: "TOPUP-1" }
  });
  await prisma.withdrawal.create({
    data: { walletId: wallet.id, userId: member.id, amount: "100000.00", status: "PAID", bankAccount: { bank: "BCA" }, accountNumber: "123" }
  });
  await prisma.session.create({
    data: { userId: member.id, refreshTokenHash: `h-${member.id}`, expiresAt: new Date(Date.now() + 86_400_000) }
  });
  await prisma.pushToken.create({ data: { userId: member.id, platform: "android", token: `tok-${member.id}` } });
  await prisma.userAvatar.create({ data: { userId: member.id, bytes: Buffer.from("png"), contentType: "image/png" } });
  await prisma.memberIdentity.create({ data: { userId: member.id, publicCode: `PUB${sequence}ABCDE` } });
  await prisma.supportTicket.create({ data: { userId: member.id, reference: `TKT-${sequence}`, subject: "Bantuan" } });
  await prisma.contactMessage.create({
    data: { userId: member.id, name: "Nama Asli", contact: "08123", category: "UMUM", message: "pesan pribadi" }
  });
  const driver = await prisma.driver.create({
    data: {
      userId: member.id,
      fullName: "Nama Asli",
      address: "Jl. Pribadi 1",
      emergencyContactName: "Kontak",
      emergencyContactPhone: "0811",
      licenseNumber: `SIM-${sequence}`,
      vehiclePlate: "B 1234 XY",
      currentLat: "-6.2",
      currentLng: "106.8"
    }
  });
  await prisma.driverDocument.create({
    data: { driverId: driver.id, type: "SIM", cipherText: Buffer.from("rahasia"), cipherIv: Buffer.from("iv"), cipherTag: Buffer.from("tag"), keyVersion: 1 }
  });
  const membership = await prisma.membership.findFirstOrThrow();
  const order = await prisma.membershipOrder.create({
    data: { userId: member.id, membershipId: membership.id, totalAmount: "500000.00", packageSnapshot: {}, status: "PAID" }
  });
  await prisma.membershipDocument.create({
    data: { orderId: order.id, userId: member.id, type: "KTP", status: "APPROVED", cipherText: Buffer.from("ktp"), cipherIv: Buffer.from("iv"), cipherTag: Buffer.from("tag"), keyVersion: 1 }
  });
  const request = await prisma.accountDeletionRequest.create({ data: { userId: member.id, reason: "Tidak dipakai lagi" } });
  return { member, wallet, request };
}

describe.skipIf(!runIntegration)("Pemrosesan permintaan hapus akun oleh VIP", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-account-deletion";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-account-deletion";
    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.adminRateLimiter.resetKey(key);
      limiters.apiRateLimiter.resetKey(key);
    }
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("hanya VIP: ADMIN dan SUPER_ADMIN ditolak di pratinjau, tolak, dan selesaikan", async () => {
    const { request } = await createMemberWithPersonalData();
    for (const role of ["ADMIN", "SUPER_ADMIN"] as UserRole[]) {
      const actor = await createUser(role);
      const token = tokenOf(actor);
      expect((await call(`/${request.id}/preview`, token)).status).toBe(403);
      expect((await call(`/${request.id}/reject`, token, { reason: "tidak boleh" })).status).toBe(403);
      expect((await call(`/${request.id}/complete`, token, { confirm: "HAPUS AKUN", password: VIP_PASSWORD })).status).toBe(403);
    }
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
  });

  it("pratinjau menampilkan halangan: saldo, penarikan, dan pesanan yang belum selesai", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const { member, wallet, request } = await createMemberWithPersonalData();
    await prisma.wallet.update({ where: { id: wallet.id }, data: { cashBalance: "5000.00" } });
    await prisma.withdrawal.create({
      data: { walletId: wallet.id, userId: member.id, amount: "1000.00", status: "PENDING", bankAccount: { bank: "BCA" } }
    });
    await prisma.membershipDocument.updateMany({ where: { userId: member.id }, data: { status: "PENDING" } });

    const preview = await call(`/${request.id}/preview`, tokenOf(vip));
    expect(preview.status).toBe(200);
    expect(preview.data.canComplete).toBe(false);
    expect(preview.data.blockers.map((b: { code: string }) => b.code).sort()).toEqual(
      ["BALANCE_REMAINING", "MEMBERSHIP_ORDER_OPEN", "WITHDRAWAL_OPEN"].sort()
    );
  });

  it("akun dengan kewajiban terbuka tidak dihapus dan tidak berubah sedikit pun", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const { member, wallet, request } = await createMemberWithPersonalData();
    await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: "2500.00" } });

    const result = await call(`/${request.id}/complete`, tokenOf(vip), { confirm: "HAPUS AKUN", password: VIP_PASSWORD });
    expect(result.status).toBe(409);
    expect(result.code).toBe("ACCOUNT_DELETION_BLOCKED");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.email).toBe(member.email);
    expect(await prisma.pushToken.count({ where: { userId: member.id } })).toBe(1);
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING");
  });

  it("konfirmasi salah ditolak (400) dan password salah ditolak (403) tanpa mengubah apa pun", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const { member, request } = await createMemberWithPersonalData();
    await prisma.membershipDocument.updateMany({ where: { userId: member.id }, data: { status: "APPROVED" } });
    expect((await call(`/${request.id}/complete`, tokenOf(vip), { confirm: "hapus", password: VIP_PASSWORD })).status).toBe(400);
    expect((await call(`/${request.id}/complete`, tokenOf(vip), { confirm: "HAPUS AKUN", password: "salah-salah-1234" })).status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).status).toBe("ACTIVE");
  });

  it("penyelesaian menganonimkan data pribadi, mengosongkan dokumen, dan mempertahankan riwayat uang", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const { member, wallet, request } = await createMemberWithPersonalData();

    const result = await call(`/${request.id}/complete`, tokenOf(vip), { confirm: "hapus akun", password: VIP_PASSWORD });
    expect(result.status).toBe(200);
    expect(result.data.status).toBe("COMPLETED");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(user.status).toBe("DELETED");
    expect(user.fullName).toBe("Akun Dihapus");
    expect(user.email).toBeNull();
    expect(user.phone).toBe(`deleted-${member.id.slice(0, 8)}`);
    expect(user.passwordHash).toBeNull();
    expect(user.avatarUrl).toBeNull();
    expect(user.bankAccount).toBeNull();
    expect(user.authVersion).toBeGreaterThan(member.authVersion);

    for (const [name, count] of [
      ["sesi", await prisma.session.count({ where: { userId: member.id } })],
      ["token push", await prisma.pushToken.count({ where: { userId: member.id } })],
      ["avatar", await prisma.userAvatar.count({ where: { userId: member.id } })],
      ["identitas", await prisma.memberIdentity.count({ where: { userId: member.id } })],
      ["tiket", await prisma.supportTicket.count({ where: { userId: member.id } })],
      ["pesan kontak", await prisma.contactMessage.count({ where: { userId: member.id } })]
    ] as const) {
      expect(count, name).toBe(0);
    }

    const driver = await prisma.driver.findUniqueOrThrow({ where: { userId: member.id } });
    expect([driver.fullName, driver.address, driver.emergencyContactName, driver.emergencyContactPhone, driver.licenseNumber, driver.vehiclePlate]).toEqual([null, null, null, null, null, null]);
    expect(driver.currentLat).toBeNull();
    const driverDoc = await prisma.driverDocument.findFirstOrThrow({ where: { driverId: driver.id } });
    expect(driverDoc.cipherText).toBeNull();
    expect(driverDoc.purgedAt).not.toBeNull();
    const memberDoc = await prisma.membershipDocument.findFirstOrThrow({ where: { userId: member.id } });
    expect(memberDoc.cipherText).toBeNull();
    expect(memberDoc.purgedAt).not.toBeNull();

    // Yang tetap disimpan: buku besar, withdrawal, pesanan.
    expect(await prisma.walletTransaction.count({ where: { walletId: wallet.id } })).toBe(1);
    expect(await prisma.withdrawal.count({ where: { userId: member.id } })).toBe(1);
    expect(await prisma.membershipOrder.count({ where: { userId: member.id } })).toBe(1);

    const closed = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(closed.status).toBe("COMPLETED");
    expect(closed.completedAt).not.toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "ACCOUNT_DELETION_COMPLETED", entityId: request.id } });
    expect(audit.actorId).toBe(vip.id);
    expect(JSON.stringify(audit.metadata)).not.toContain("Nama Asli");

    // Tidak dapat diulang, dan akun tidak dapat masuk lagi.
    const again = await call(`/${request.id}/complete`, tokenOf(vip), { confirm: "HAPUS AKUN", password: VIP_PASSWORD });
    expect(again.status).toBe(409);
    const login = await fetch(`${baseUrl}/api/v1/web/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: member.phone, password: VIP_PASSWORD })
    });
    expect(login.status).toBe(401);
  });

  it("penolakan menutup permintaan dengan alasan, tanpa menyentuh data akun", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const { member, request } = await createMemberWithPersonalData();
    expect((await call(`/${request.id}/reject`, tokenOf(vip), { reason: "x" })).status).toBe(400);
    const rejected = await call(`/${request.id}/reject`, tokenOf(vip), { reason: "Identitas peminta tidak cocok" });
    expect(rejected.status).toBe(200);
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("REJECTED");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).status).toBe("ACTIVE");
    expect(await prisma.auditLog.count({ where: { action: "ACCOUNT_DELETION_REJECTED", entityId: request.id } })).toBe(1);
    expect((await call(`/${request.id}/reject`, tokenOf(vip), { reason: "ulang" })).status).toBe(409);
  });

  it("akun admin tidak dapat dihapus lewat jalur ini", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const admin = await createUser("ADMIN");
    const request = await prisma.accountDeletionRequest.create({ data: { userId: admin.id } });
    const result = await call(`/${request.id}/complete`, tokenOf(vip), { confirm: "HAPUS AKUN", password: VIP_PASSWORD });
    expect(result.status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).status).toBe("ACTIVE");
  });
});
