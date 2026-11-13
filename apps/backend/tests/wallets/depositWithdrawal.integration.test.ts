import { Prisma, User } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl,
  walletService,
} from "../helpers/referralWalletHarness.js";

/**
 * Penarikan DEPOSIT pribadi (Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir 4, keputusan Owner 12-14 Nov 2026):
 * seluruh deposit yang belum terpakai boleh ditarik, biaya tetap Rp2.000, minimal Rp50.000, setelah mengendap 24 jam,
 * disetujui admin. Bonus terkunci dan saldo yang dapat ditarik TIDAK pernah ikut terambil lewat jalur ini.
 */
const PASSWORD = "Rahasia-Uji-123";
const DAY_MS = 24 * 60 * 60 * 1000;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: (payload: { sub: string; role: User["role"]; sessionId: string; channel?: "WEB" | "APP" | "ADMIN" }) => string;
let backendEnv: typeof import("../../src/config/env.js").env;
let phoneSeq = 0;

describe.skipIf(!runIntegration)("Penarikan deposit pribadi", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-deposit-withdrawal";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-deposit-withdrawal";
    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js"),
    ]);
    signAccessToken = tokenService.signAccessToken as typeof signAccessToken;
    backendEnv = envModule.env;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    backendEnv.WALLET_CASH_OUT_WEB_ENABLED = true;
    backendEnv.BONUS_LOCK_ENABLED = true;
    backendEnv.DEPOSIT_WITHDRAWAL_FEE = 2000;
    backendEnv.DEPOSIT_WITHDRAWAL_MIN = 50000;
    backendEnv.DEPOSIT_HOLD_HOURS = 24;
  });

  afterAll(async () => {
    backendEnv.WALLET_CASH_OUT_WEB_ENABLED = false;
    backendEnv.BONUS_LOCK_ENABLED = false;
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const state = async (userId: string) => {
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    return { balance: Number(w.balance), cash: Number(w.cashBalance), locked: Number(w.lockedBonusBalance), deposit: Number(w.depositBalance) };
  };

  it("menarik seluruh deposit: biaya Rp2.000 dipotong, dicatat sumber DEPOSIT, kantong lain tidak tersentuh", async () => {
    const user = await createUser({ balance: 200000, cash: 40000, locked: 20000, deposit: 100000, topUpAgeMs: 2 * DAY_MS });
    const res = await withdraw(user, { amount: 100000, source: "DEPOSIT", password: PASSWORD });
    expect(res.status).toBe(201);

    expect(await state(user.id)).toEqual({ balance: 100000, cash: 40000, locked: 20000, deposit: 0 });
    const withdrawal = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });
    expect(withdrawal.source).toBe("DEPOSIT");
    expect(withdrawal.status).toBe("PENDING");
    expect(Number(withdrawal.amount)).toBe(100000);
    expect(Number(withdrawal.fee)).toBe(2000);
    expect(Number(withdrawal.finalAmount)).toBe(98000);
  });

  it("bonus terkunci dan saldo yang dapat ditarik tidak bisa diambil lewat jalur deposit", async () => {
    const user = await createUser({ balance: 100000, cash: 50000, locked: 20000, deposit: 30000, topUpAgeMs: 2 * DAY_MS });
    // 50.000 hanya tersedia bila terkunci/tarik ikut diambil; deposit hanya 30.000.
    const res = await withdraw(user, { amount: 50000, source: "DEPOSIT", password: PASSWORD });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("INSUFFICIENT_BALANCE");
    expect(await state(user.id)).toEqual({ balance: 100000, cash: 50000, locked: 20000, deposit: 30000 });
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it("top up kurang dari 24 jam lalu: ditolak dengan jam tersedianya, tidak ada yang berubah", async () => {
    const user = await createUser({ balance: 100000, cash: 0, locked: 0, deposit: 100000, topUpAgeMs: 60 * 60 * 1000 });
    const res = await withdraw(user, { amount: 100000, source: "DEPOSIT", password: PASSWORD });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string; message?: string };
    expect(body.code).toBe("DEPOSIT_WITHDRAWAL_HOLD");
    expect(body.message).toMatch(/24 jam/);
    expect(body.message).toMatch(/WIB/);
    expect(await state(user.id)).toEqual({ balance: 100000, cash: 0, locked: 0, deposit: 100000 });
  });

  it("pesanan tunai berjalan (komisi ditahan) mengunci deposit driver", async () => {
    const user = await createUser({ balance: 100000, cash: 0, locked: 0, deposit: 100000, topUpAgeMs: 2 * DAY_MS });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "PAYMENT",
        amount: new Prisma.Decimal(-720),
        referenceType: "RIDE_COMMISSION_FEE",
        referenceId: "ride-aktif-1",
        metadata: { status: "HELD", fee: "720" },
      },
    });
    const res = await withdraw(user, { amount: 100000, source: "DEPOSIT", password: PASSWORD });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe("DEPOSIT_WITHDRAWAL_CASH_RIDE_ACTIVE");
    expect(await state(user.id)).toEqual({ balance: 100000, cash: 0, locked: 0, deposit: 100000 });

    // Setelah komisi difinalkan/dilepas, deposit bisa ditarik.
    await prisma.walletTransaction.updateMany({ where: { walletId: wallet.id, referenceType: "RIDE_COMMISSION_FEE" }, data: { metadata: { status: "FINALIZED" } } });
    expect((await withdraw(user, { amount: 100000, source: "DEPOSIT", password: PASSWORD })).status).toBe(201);
  });

  it("fitur mati: penarikan deposit ditolak dan saldo tidak berubah", async () => {
    backendEnv.BONUS_LOCK_ENABLED = false;
    const user = await createUser({ balance: 100000, cash: 0, locked: 0, deposit: 100000, topUpAgeMs: 2 * DAY_MS });
    const res = await withdraw(user, { amount: 100000, source: "DEPOSIT", password: PASSWORD });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("DEPOSIT_WITHDRAWAL_DISABLED");
    expect(await state(user.id)).toEqual({ balance: 100000, cash: 0, locked: 0, deposit: 100000 });
  });

  it("jumlah tidak melebihi biaya, minimal Rp50.000 (skema) dan password wajib", async () => {
    const user = await createUser({ balance: 100000, cash: 0, locked: 0, deposit: 100000, topUpAgeMs: 2 * DAY_MS });
    expect((await withdraw(user, { amount: 40000, source: "DEPOSIT", password: PASSWORD })).status).toBe(400);
    expect((await withdraw(user, { amount: 100000, source: "DEPOSIT", password: "salah-salah-1" })).status).toBe(403);
    backendEnv.DEPOSIT_WITHDRAWAL_FEE = 60000;
    const tooCheap = await withdraw(user, { amount: 50000, source: "DEPOSIT", password: PASSWORD });
    expect(tooCheap.status).toBe(400);
    expect(((await tooCheap.json()) as { code?: string }).code).toBe("DEPOSIT_WITHDRAWAL_AMOUNT_INVALID");
    expect(await state(user.id)).toEqual({ balance: 100000, cash: 0, locked: 0, deposit: 100000 });
  });

  it("ditolak admin: dana kembali ke DEPOSIT (bukan ke saldo yang dapat ditarik), tepat sekali", async () => {
    const user = await createUser({ balance: 150000, cash: 50000, locked: 0, deposit: 100000, topUpAgeMs: 2 * DAY_MS });
    expect((await withdraw(user, { amount: 100000, source: "DEPOSIT", password: PASSWORD })).status).toBe(201);
    const withdrawal = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });
    const admin = await createPlainUser("SUPER_ADMIN");

    await walletService.rejectWithdrawal({ withdrawalId: withdrawal.id, adminId: admin.id, note: "uji" });
    expect(await state(user.id)).toEqual({ balance: 150000, cash: 50000, locked: 0, deposit: 100000 });
    await expect(walletService.rejectWithdrawal({ withdrawalId: withdrawal.id, adminId: admin.id })).rejects.toThrow();
    expect(await state(user.id)).toEqual({ balance: 150000, cash: 50000, locked: 0, deposit: 100000 });
  });

  it("penarikan biasa (saldo yang dapat ditarik) tetap bekerja dan tidak menyentuh deposit", async () => {
    const user = await createUser({ balance: 150000, cash: 50000, locked: 0, deposit: 100000, topUpAgeMs: 2 * DAY_MS });
    expect((await withdraw(user, { amount: 50000, password: PASSWORD })).status).toBe(201);
    expect(await state(user.id)).toEqual({ balance: 100000, cash: 0, locked: 0, deposit: 100000 });
    const withdrawal = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });
    expect(withdrawal.source).toBe("CASH");
    expect(Number(withdrawal.fee)).toBe(0);
  });
});

function headers(user: User) {
  return {
    authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}`, channel: "WEB" })}`,
    "content-type": "application/json",
  };
}

function withdraw(user: User, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/v1/web/wallet/withdrawals`, { method: "POST", headers: headers(user), body: JSON.stringify(body) });
}

async function createPlainUser(role: User["role"]): Promise<User> {
  phoneSeq += 1;
  const code = `DWA${String(phoneSeq).padStart(5, "0")}`;
  return prisma.user.create({ data: { fullName: `Admin ${code}`, phone: `+6286${String(phoneSeq).padStart(9, "0")}`, referralCode: code, role } });
}

async function createUser(input: { balance: number; cash: number; locked: number; deposit: number; topUpAgeMs: number }): Promise<User> {
  const { hashPassword } = await import("../../src/core/security/passwordHasher.js");
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  phoneSeq += 1;
  const code = `DWD${String(phoneSeq).padStart(5, "0")}`;
  const user = await prisma.user.create({
    data: {
      fullName: `Mitra ${code}`,
      phone: `+6285${String(phoneSeq).padStart(9, "0")}`,
      referralCode: code,
      role: "USER",
      membershipId: basic.id,
      passwordHash: await hashPassword(PASSWORD),
      bankAccount: { bankName: "BCA", accountNumber: "1234567890", accountHolderName: "Pemilik Sah", updatedAt: new Date(Date.now() - 3 * DAY_MS).toISOString() },
    },
  });
  const wallet = await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: new Prisma.Decimal(input.balance),
      cashBalance: new Prisma.Decimal(input.cash),
      lockedBonusBalance: new Prisma.Decimal(input.locked),
      depositBalance: new Prisma.Decimal(input.deposit),
      ppobBalance: new Prisma.Decimal(0),
      currency: "IDR",
    },
  });
  // Top up terakhir (menentukan masa tunggu); dibuat lewat createdAt eksplisit.
  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "TOPUP",
      amount: new Prisma.Decimal(input.deposit),
      referenceType: "WALLET_TOPUP",
      referenceId: `topup-${code}`,
      metadata: { target: "WALLET" },
      createdAt: new Date(Date.now() - input.topUpAgeMs),
    },
  });
  return user;
}
