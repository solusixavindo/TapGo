import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

type Channel = "WEB" | "APP" | "ADMIN";
type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string; channel?: Channel }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let seq = 0;

describe.skipIf(!runIntegration)("Top up manual transfer bank", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) throw new Error("Need dedicated test DB");
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "manual-topup-access-secret-0000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "manual-topup-refresh-secret-000";
    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    signAccessToken = tokenService.signAccessToken as SignAccessToken;
    backendEnv = envModule.env;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    backendEnv.MANUAL_TOPUP_ENABLED = true;
    backendEnv.MANUAL_TOPUP_BANK_NAME = "BRI";
    backendEnv.MANUAL_TOPUP_ACCOUNT_NUMBER = "0000000000";
    backendEnv.MANUAL_TOPUP_ACCOUNT_HOLDER = "PT UJI";
  });

  afterAll(async () => {
    backendEnv.MANUAL_TOPUP_ENABLED = false;
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  async function makeUser(role: UserRole = "USER"): Promise<User> {
    seq += 1;
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    return prisma.user.create({
      data: { fullName: `U${seq}`, phone: `+6281${String(seq).padStart(9, "0")}`, referralCode: `MTU${String(seq).padStart(6, "0")}`, membershipId: basic.id, role }
    });
  }
  const auth = (user: User, channel: Channel) => ({
    authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, sessionId: `s-${user.id}`, channel })}`,
    "content-type": "application/json"
  });
  const create = (user: User, amount: number, channel: Channel = "WEB") =>
    fetch(`${baseUrl}/api/v1/web/wallet/topup/manual`, { method: "POST", headers: auth(user, channel), body: JSON.stringify({ amount }) });
  const confirm = (admin: User, id: string, channel: Channel = "ADMIN") =>
    fetch(`${baseUrl}/api/v1/admin/manual-topups/${id}/confirm`, { method: "POST", headers: auth(admin, channel) });

  it("membuat pesanan dengan kode unik dan rekening tujuan; saldo belum berubah", async () => {
    const user = await makeUser();
    const res = await create(user, 100_000);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { transferAmount: number; uniqueCode: number; baseAmount: number; bank: { bankName: string } } };
    expect(data.baseAmount).toBe(100_000);
    expect(data.uniqueCode).toBeGreaterThanOrEqual(1);
    expect(data.uniqueCode).toBeLessThanOrEqual(999);
    expect(data.transferAmount).toBe(100_000 + data.uniqueCode);
    expect(data.bank.bankName).toBe("BRI");
    expect(await prisma.wallet.count({ where: { userId: user.id } })).toBe(0);
  });

  it("flag mati, token APP, nominal di luar batas, dan rekening belum diatur ditolak", async () => {
    const user = await makeUser();
    expect((await create(user, 100_000, "APP")).status).toBe(403);
    expect((await create(user, 10_000)).status).toBe(400);
    expect((await create(user, 99_000_000)).status).toBe(400);
    backendEnv.MANUAL_TOPUP_ACCOUNT_NUMBER = undefined;
    expect((await create(user, 100_000)).status).toBe(503);
    backendEnv.MANUAL_TOPUP_ACCOUNT_NUMBER = "0000000000";
    backendEnv.MANUAL_TOPUP_ENABLED = false;
    expect((await create(user, 100_000)).status).toBe(403);
  });

  it("kode unik tidak bentrok antar pesanan terbuka dan maksimal 3 pesanan terbuka per pengguna", async () => {
    const codes = new Set<number>();
    for (let i = 0; i < 6; i += 1) {
      const u = await makeUser();
      const { data } = (await (await create(u, 100_000)).json()) as { data: { uniqueCode: number } };
      codes.add(data.uniqueCode);
    }
    expect(codes.size).toBe(6);
    const heavy = await makeUser();
    for (let i = 0; i < 3; i += 1) expect((await create(heavy, 100_000)).status).toBe(201);
    expect((await create(heavy, 100_000)).status).toBe(429);
  });

  it("Super Admin mengonfirmasi: saldo bertambah tepat nominal transfer, sekali saja, dengan ledger dan audit", async () => {
    const user = await makeUser();
    const admin = await makeUser("SUPER_ADMIN");
    const { data } = (await (await create(user, 200_000)).json()) as { data: { id: string; transferAmount: number } };
    const first = await confirm(admin, data.id);
    expect(first.status).toBe(200);
    const second = await confirm(admin, data.id);
    expect(second.status).toBe(200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.balance.toNumber()).toBe(data.transferAmount);
    expect(await prisma.walletTransaction.count({ where: { walletId: wallet.id, type: "TOPUP" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "MANUAL_TOPUP_CONFIRMED", entityId: data.id } })).toBeGreaterThanOrEqual(1);
  });

  it("ADMIN biasa, member, dan token APP tidak dapat mengonfirmasi", async () => {
    const user = await makeUser();
    const operator = await makeUser("ADMIN");
    const { data } = (await (await create(user, 100_000)).json()) as { data: { id: string } };
    expect((await confirm(operator, data.id)).status).toBe(403);
    expect((await confirm(user, data.id, "WEB")).status).toBeGreaterThanOrEqual(401);
    expect((await confirm(user, data.id, "APP")).status).toBeGreaterThanOrEqual(401);
    expect(await prisma.wallet.count({ where: { userId: user.id } })).toBe(0);
  });

  it("tolak menutup pesanan tanpa mengubah saldo; pesanan tertutup tidak bisa dikonfirmasi; tidak bisa dibayar lewat gateway", async () => {
    const user = await makeUser();
    const admin = await makeUser("SUPER_ADMIN");
    const { data } = (await (await create(user, 100_000)).json()) as { data: { id: string } };
    const pay = await fetch(`${baseUrl}/api/v1/web/wallet/topup/orders/${data.id}/pay`, { method: "POST", headers: auth(user, "WEB") });
    expect([403, 409]).toContain(pay.status);
    const rej = await fetch(`${baseUrl}/api/v1/admin/manual-topups/${data.id}/reject`, { method: "POST", headers: auth(admin, "ADMIN"), body: JSON.stringify({ reason: "Tidak ada transfer" }) });
    expect(rej.status).toBe(200);
    expect((await confirm(admin, data.id)).status).toBe(409);
    expect(await prisma.wallet.count({ where: { userId: user.id } })).toBe(0);
  });

  it("transfer terlambat: pesanan kedaluwarsa tetap bisa dikonfirmasi bila nominalnya tidak ambigu", async () => {
    const user = await makeUser();
    const admin = await makeUser("SUPER_ADMIN");
    const { data } = (await (await create(user, 100_000)).json()) as { data: { id: string; transferAmount: number } };
    await prisma.walletTopUpOrder.update({ where: { id: data.id }, data: { expiresAt: new Date(Date.now() - 3600_000) } });
    expect((await confirm(admin, data.id)).status).toBe(200);
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } })).balance.toNumber()).toBe(data.transferAmount);
  });
});
