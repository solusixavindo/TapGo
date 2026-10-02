import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Tujuan top up manual: Saldo TapGo (driver dan perjalanan, minimal Rp50.000)
 * dan Saldo PPOB (khusus pembelian PPOB, minimal Rp25.000).
 *
 * Yang dijaga: batas minimal masing-masing tujuan, saldo MANA yang dikredit
 * (PPOB hanya ppobBalance dan tidak menyentuh saldo yang bisa ditarik), kode
 * unik tidak kembar lintas tujuan, dan pesanan lama tanpa penanda tetap WALLET.
 */

type Channel = "WEB" | "APP" | "ADMIN";
type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string; channel?: Channel }) => string;
type Created = { id: string; target: string; transferAmount: number; baseAmount: number; uniqueCode: number };

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let seq = 0;

describe.skipIf(!runIntegration)("Top up manual: tujuan Saldo TapGo dan Saldo PPOB", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) throw new Error("Need dedicated test DB");
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "manual-topup-target-access-secret0";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "manual-topup-target-refresh-secret";
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
    backendEnv.MANUAL_TOPUP_MIN_AMOUNT = 50_000;
    backendEnv.MANUAL_TOPUP_PPOB_MIN_AMOUNT = 25_000;
  });

  afterAll(async () => {
    backendEnv.MANUAL_TOPUP_ENABLED = false;
    backendEnv.MANUAL_TOPUP_PPOB_MIN_AMOUNT = 25_000;
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  async function makeUser(role: UserRole = "USER"): Promise<User> {
    seq += 1;
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    return prisma.user.create({
      data: { fullName: `T${seq}`, phone: `+6282${String(seq).padStart(9, "0")}`, referralCode: `MTT${String(seq).padStart(6, "0")}`, membershipId: basic.id, role }
    });
  }
  const auth = (user: User, channel: Channel) => ({
    authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, sessionId: `s-${user.id}`, channel })}`,
    "content-type": "application/json"
  });
  const create = (user: User, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/v1/web/wallet/topup/manual`, { method: "POST", headers: auth(user, "WEB"), body: JSON.stringify(body) });
  const confirm = (admin: User, id: string) =>
    fetch(`${baseUrl}/api/v1/admin/manual-topups/${id}/confirm`, { method: "POST", headers: auth(admin, "ADMIN") });
  async function createOk(user: User, body: Record<string, unknown>): Promise<Created> {
    const res = await create(user, body);
    expect(res.status).toBe(201);
    return ((await res.json()) as { data: Created }).data;
  }

  it("Saldo TapGo (driver): minimal Rp50.000 tidak berubah; tanpa tujuan dibaca WALLET", async () => {
    const user = await makeUser();
    expect((await create(user, { amount: 49_999 })).status).toBe(400);
    expect((await create(user, { amount: 49_999, target: "WALLET" })).status).toBe(400);

    const implicit = await createOk(user, { amount: 50_000 });
    expect(implicit.target).toBe("WALLET");
    expect(implicit.baseAmount).toBe(50_000);
    expect((await createOk(user, { amount: 50_000, target: "WALLET" })).target).toBe("WALLET");
  });

  it("Saldo PPOB: Rp25.000 diterima, Rp24.999 ditolak, pesan galat menyebut Saldo PPOB", async () => {
    const user = await makeUser();
    const tooLow = await create(user, { amount: 24_999, target: "PPOB" });
    expect(tooLow.status).toBe(400);
    expect(((await tooLow.json()) as { message?: string }).message).toContain("Saldo PPOB");

    const ok = await createOk(user, { amount: 25_000, target: "PPOB" });
    expect(ok).toMatchObject({ target: "PPOB", baseAmount: 25_000 });
    expect(ok.transferAmount).toBe(25_000 + ok.uniqueCode);
  });

  it("batas minimal PPOB dapat diatur lewat env dan tidak memengaruhi Saldo TapGo", async () => {
    const user = await makeUser();
    backendEnv.MANUAL_TOPUP_PPOB_MIN_AMOUNT = 30_000;
    expect((await create(user, { amount: 25_000, target: "PPOB" })).status).toBe(400);
    expect((await create(user, { amount: 30_000, target: "PPOB" })).status).toBe(201);
    // Saldo TapGo tetap memakai batasnya sendiri.
    expect((await create(user, { amount: 30_000, target: "WALLET" })).status).toBe(400);
  });

  it("tujuan di luar WALLET/PPOB ditolak 400", async () => {
    const user = await makeUser();
    expect((await create(user, { amount: 100_000, target: "WITHDRAW" })).status).toBe(400);
    expect((await create(user, { amount: 100_000, target: "" })).status).toBe(400);
  });

  it("konfirmasi PPOB: HANYA ppobBalance bertambah (sebesar nominal transfer), tidak ada saldo yang bisa ditarik", async () => {
    const user = await makeUser();
    const admin = await makeUser("SUPER_ADMIN");
    const order = await createOk(user, { amount: 25_000, target: "PPOB" });

    expect((await confirm(admin, order.id)).status).toBe(200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toNumber()).toBe(order.transferAmount);
    expect(wallet.balance.toNumber()).toBe(0);
    expect(wallet.cashBalance.toNumber()).toBe(0);

    const ledger = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id, type: "TOPUP" } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount.toNumber()).toBe(order.transferAmount);
    expect(ledger[0]!.metadata).toMatchObject({ target: "PPOB" });
  });

  it("konfirmasi PPOB dua kali: tidak mengkredit ganda", async () => {
    const user = await makeUser();
    const admin = await makeUser("SUPER_ADMIN");
    const order = await createOk(user, { amount: 25_000, target: "PPOB" });

    expect((await confirm(admin, order.id)).status).toBe(200);
    expect((await confirm(admin, order.id)).status).toBe(200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toNumber()).toBe(order.transferAmount);
    expect(await prisma.walletTransaction.count({ where: { walletId: wallet.id, type: "TOPUP" } })).toBe(1);
  });

  it("konfirmasi Saldo TapGo: balance dan cashBalance bertambah, ppobBalance tidak tersentuh (regresi)", async () => {
    const user = await makeUser();
    const admin = await makeUser("SUPER_ADMIN");
    const order = await createOk(user, { amount: 50_000, target: "WALLET" });

    expect((await confirm(admin, order.id)).status).toBe(200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.balance.toNumber()).toBe(order.transferAmount);
    expect(wallet.cashBalance.toNumber()).toBe(order.transferAmount);
    expect(wallet.ppobBalance.toNumber()).toBe(0);
    const ledger = await prisma.walletTransaction.findFirstOrThrow({ where: { walletId: wallet.id, type: "TOPUP" } });
    expect(ledger.metadata).toMatchObject({ target: "WALLET" });
  });

  it("pesanan lama tanpa penanda tujuan dikredit ke Saldo TapGo seperti semula", async () => {
    const user = await makeUser();
    const admin = await makeUser("SUPER_ADMIN");
    const legacy = await prisma.walletTopUpOrder.create({
      data: {
        userId: user.id,
        reference: "MTOP-LAMA-1",
        amount: 100_123,
        status: "PENDING",
        method: "BANK_TRANSFER",
        provider: "MANUAL_BANK",
        metadata: { baseAmount: 100_000, uniqueCode: 123 },
        expiresAt: new Date(Date.now() + 3600_000)
      }
    });
    expect((await confirm(admin, legacy.id)).status).toBe(200);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.balance.toNumber()).toBe(100_123);
    expect(wallet.ppobBalance.toNumber()).toBe(0);
  });

  it("nominal transfer tidak pernah kembar lintas tujuan walau nominal dasarnya sama", async () => {
    const amounts = new Set<number>();
    for (let index = 0; index < 4; index += 1) {
      const user = await makeUser();
      amounts.add((await createOk(user, { amount: 50_000, target: "WALLET" })).transferAmount);
      amounts.add((await createOk(user, { amount: 50_000, target: "PPOB" })).transferAmount);
    }
    expect(amounts.size).toBe(8);
  });

  it("daftar admin menampilkan tujuan tiap pesanan", async () => {
    const user = await makeUser();
    const admin = await makeUser("SUPER_ADMIN");
    const wallet = await createOk(user, { amount: 50_000, target: "WALLET" });
    const ppob = await createOk(user, { amount: 25_000, target: "PPOB" });

    const res = await fetch(`${baseUrl}/api/v1/admin/manual-topups?status=PENDING`, { headers: auth(admin, "ADMIN") });
    expect(res.status).toBe(200);
    const rows = ((await res.json()) as { data: Array<{ id: string; target: string }> }).data;
    expect(rows.find((row) => row.id === wallet.id)?.target).toBe("WALLET");
    expect(rows.find((row) => row.id === ppob.id)?.target).toBe("PPOB");
  });

  it("detail pesanan untuk pemilik memuat tujuan; kanal APP tetap ditolak", async () => {
    const user = await makeUser();
    const order = await createOk(user, { amount: 25_000, target: "PPOB" });
    const res = await fetch(`${baseUrl}/api/v1/web/wallet/topup/manual/${order.id}`, { headers: auth(user, "WEB") });
    expect(((await res.json()) as { data: { target: string } }).data.target).toBe("PPOB");

    const app = await fetch(`${baseUrl}/api/v1/web/wallet/topup/manual`, {
      method: "POST",
      headers: auth(user, "APP"),
      body: JSON.stringify({ amount: 25_000, target: "PPOB" })
    });
    expect(app.status).toBe(403);
  });
});
