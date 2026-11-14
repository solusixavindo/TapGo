import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl, walletService } from "../helpers/referralWalletHarness.js";

/**
 * Pembekuan penarikan dana per akun (keputusan pemilik 14 Nov 2026) dan larangan menyetujui/mencairkan penarikan sendiri.
 */
let server: Server | undefined;
let baseUrl = "";
let sign: (payload: { sub: string; role: UserRole; sessionId: string; channel?: "WEB" | "APP" | "ADMIN" }) => string;
let seq = 0;

async function user(role: UserRole, cash = 0): Promise<User> {
  seq += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  const u = await prisma.user.create({
    data: { fullName: `Beku ${role} ${seq}`, phone: `+62896${String(3000000 + seq)}`, referralCode: `FRZ${String(seq).padStart(6, "0")}`, role, membershipId: basic.id }
  });
  if (cash > 0) {
    await prisma.wallet.create({ data: { userId: u.id, balance: new Prisma.Decimal(cash), cashBalance: new Prisma.Decimal(cash), ppobBalance: new Prisma.Decimal(0), currency: "IDR" } });
  }
  return u;
}
const bank = { bankName: "BCA", accountNumber: "1234567890", accountHolderName: "Pemilik Uji" };
const request = (u: User, amount = 60000) => walletService.requestWithdrawal({ userId: u.id, amount: new Prisma.Decimal(amount), ...bank });
const freeze = (actor: User, target: User, body: Record<string, unknown>) =>
  fetch(`${baseUrl}/api/v1/admin/members/${target.id}/withdrawal-freeze`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${sign({ sub: actor.id, role: actor.role, sessionId: `s-${actor.id}`, channel: "ADMIN" })}` },
    body: JSON.stringify(body)
  });

describe.skipIf(!runIntegration)("Pembekuan penarikan dana", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) throw new Error("Need dedicated test DB");
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "withdrawal-freeze-access-secret-00000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "withdrawal-freeze-refresh-secret-0000";
    const [{ createApp }, tokenService] = await Promise.all([import("../../src/app.js"), import("../../src/core/security/tokenService.js")]);
    sign = tokenService.signAccessToken as typeof sign;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);
  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });
  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  it("hanya VIP yang dapat membekukan; alasan wajib; tercatat di audit; dapat dibuka kembali", async () => {
    const vip = await user("SUPER_ADMIN_VIP");
    const superAdmin = await user("SUPER_ADMIN");
    const target = await user("SUPER_ADMIN", 200000);
    expect((await freeze(superAdmin, target, { frozen: true, reason: "uji" })).status).toBe(403);
    expect((await freeze(vip, target, { frozen: true })).status).toBe(400);
    expect((await freeze(vip, target, { frozen: true, reason: "Transaksi tidak jelas 13 Nov" })).status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.withdrawalFrozenAt).not.toBeNull();
    expect(row.withdrawalFrozenBy).toBe(vip.id);
    expect(row.withdrawalFrozenReason).toBe("Transaksi tidak jelas 13 Nov");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "WITHDRAWAL_FREEZE_SET", entityId: target.id } });
    expect(audit.actorId).toBe(vip.id);

    expect((await freeze(vip, target, { frozen: false, reason: "Sudah diperiksa" })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).withdrawalFrozenAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "WITHDRAWAL_FREEZE_CLEARED", entityId: target.id } })).toBe(1);
  });

  it("akun beku tidak dapat mengajukan penarikan; saldo tidak berubah; setelah dibuka dapat mengajukan lagi", async () => {
    const vip = await user("SUPER_ADMIN_VIP");
    const target = await user("SUPER_ADMIN", 200000);
    await freeze(vip, target, { frozen: true, reason: "uji beku" });
    await expect(request(target)).rejects.toMatchObject({ code: "WITHDRAWAL_FROZEN" });
    expect(Number((await prisma.wallet.findUniqueOrThrow({ where: { userId: target.id } })).balance)).toBe(200000);
    expect(await prisma.withdrawal.count({ where: { userId: target.id } })).toBe(0);
    await freeze(vip, target, { frozen: false, reason: "dibuka" });
    await request(target);
    expect(await prisma.withdrawal.count({ where: { userId: target.id } })).toBe(1);
  });

  it("penarikan yang sudah diajukan sebelum dibekukan tidak dapat disetujui atau ditransfer; menolaknya (pengembalian saldo) tetap boleh", async () => {
    const vip = await user("SUPER_ADMIN_VIP");
    const approver = await user("SUPER_ADMIN");
    const target = await user("USER", 300000);
    const w1 = await request(target);
    const w2 = await request(target);
    await walletService.approveWithdrawal({ withdrawalId: w2.id, adminId: approver.id, actorRole: "SUPER_ADMIN" });
    await freeze(vip, target, { frozen: true, reason: "uji beku" });
    await expect(walletService.approveWithdrawal({ withdrawalId: w1.id, adminId: approver.id, actorRole: "SUPER_ADMIN" })).rejects.toMatchObject({ code: "WITHDRAWAL_FROZEN" });
    await expect(walletService.markWithdrawalPaid({ withdrawalId: w2.id, adminId: approver.id, actorRole: "SUPER_ADMIN" })).rejects.toMatchObject({ code: "WITHDRAWAL_FROZEN" });
    await walletService.rejectWithdrawal({ withdrawalId: w1.id, adminId: approver.id });
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: w1.id } })).status).toBe("REJECTED");
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: w2.id } })).status).toBe("APPROVED");
  });

  it("admin tidak boleh menyetujui atau mencairkan penarikan miliknya sendiri; admin lain boleh; VIP boleh", async () => {
    const other = await user("SUPER_ADMIN");
    const selfAdmin = await user("SUPER_ADMIN", 300000);
    const w = await request(selfAdmin);
    await expect(walletService.approveWithdrawal({ withdrawalId: w.id, adminId: selfAdmin.id, actorRole: "SUPER_ADMIN" })).rejects.toMatchObject({ code: "WITHDRAWAL_SELF_APPROVAL_FORBIDDEN" });
    await walletService.approveWithdrawal({ withdrawalId: w.id, adminId: other.id, actorRole: "SUPER_ADMIN" });
    await expect(walletService.markWithdrawalPaid({ withdrawalId: w.id, adminId: selfAdmin.id, actorRole: "SUPER_ADMIN" })).rejects.toMatchObject({ code: "WITHDRAWAL_SELF_APPROVAL_FORBIDDEN" });
    await walletService.markWithdrawalPaid({ withdrawalId: w.id, adminId: other.id, actorRole: "SUPER_ADMIN" });
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("PAID");

    const vip = await user("SUPER_ADMIN_VIP", 300000);
    const wv = await request(vip);
    await walletService.approveWithdrawal({ withdrawalId: wv.id, adminId: vip.id, actorRole: "SUPER_ADMIN_VIP" });
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: wv.id } })).status).toBe("APPROVED");
  });
});
