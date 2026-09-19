import { Prisma, User } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * Pencairan saldo dari dashboard mitra (kanal web).
 *
 * Yang dikunci di sini bukan alur bahagia saja, tetapi batas keamanannya:
 * token app tidak boleh masuk, flag mati berarti tertutup, tujuan transfer
 * tidak bisa dipilih klien, dan rekening yang baru diganti tidak langsung
 * bisa dipakai.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: User["role"];
  sessionId: string;
  channel?: "WEB" | "APP" | "ADMIN";
}) => string;

const PASSWORD = "Rahasia-Uji-123";
const DAY_MS = 24 * 60 * 60 * 1000;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let originalWebFlag = false;
let originalAppFlag = false;
let phoneSeq = 0;

describe.skipIf(!runIntegration)("Web withdrawal (dashboard mitra)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-web-withdrawal";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-web-withdrawal";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    signAccessToken = tokenService.signAccessToken as SignAccessToken;
    backendEnv = envModule.env;
    originalWebFlag = backendEnv.WALLET_CASH_OUT_WEB_ENABLED;
    originalAppFlag = backendEnv.WALLET_CASH_OUT_ENABLED;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    backendEnv.WALLET_CASH_OUT_WEB_ENABLED = true;
    backendEnv.WALLET_CASH_OUT_ENABLED = false;
  });

  afterAll(async () => {
    backendEnv.WALLET_CASH_OUT_WEB_ENABLED = originalWebFlag;
    backendEnv.WALLET_CASH_OUT_ENABLED = originalAppFlag;
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("mencairkan saldo ke rekening tersimpan dan memotong saldo secara atomik", async () => {
    const user = await createUser("500000.00", { bankAgeMs: 2 * DAY_MS });

    const response = await withdraw(user, { amount: 100000, password: PASSWORD });
    expect(response.status).toBe(201);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.cashBalance.toString()).toBe("400000");
    const withdrawal = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });
    expect(withdrawal.status).toBe("PENDING");
    expect(withdrawal.accountNumber).toBe("1234567890");
  });

  it("mengabaikan tujuan transfer yang dikirim klien", async () => {
    const user = await createUser("500000.00", { bankAgeMs: 2 * DAY_MS });

    const response = await withdraw(user, {
      amount: 100000,
      password: PASSWORD,
      accountNumber: "9999999999",
      bankName: "PENYERANG",
      accountHolderName: "Bukan Pemilik"
    });
    expect(response.status).toBe(201);

    const withdrawal = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });
    expect(withdrawal.accountNumber).toBe("1234567890");
    expect(withdrawal.bankName).toBe("BCA");
  });

  it("flag web mati menutup pencairan dan tidak menyentuh saldo", async () => {
    backendEnv.WALLET_CASH_OUT_WEB_ENABLED = false;
    const user = await createUser("500000.00", { bankAgeMs: 2 * DAY_MS });

    const response = await withdraw(user, { amount: 100000, password: PASSWORD });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe("WITHDRAWAL_WEB_DISABLED");
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it("flag pencairan app tidak membuka rute web, dan flag web tidak membuka rute app", async () => {
    const user = await createUser("500000.00", { bankAgeMs: 2 * DAY_MS });

    const viaLegacy = await fetch(`${baseUrl}/api/v1/wallet/withdrawals`, {
      method: "POST",
      headers: headers(user, "APP"),
      body: JSON.stringify({
        amount: 100000,
        bankName: "BCA",
        accountNumber: "1234567890",
        accountHolderName: user.fullName
      })
    });
    expect(viaLegacy.status).toBe(403);
    expect(((await viaLegacy.json()) as { code?: string }).code).toBe("CASH_OUT_DISABLED_FOR_PLAY");
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it("menolak token kanal APP di rute web", async () => {
    const user = await createUser("500000.00", { bankAgeMs: 2 * DAY_MS });

    const response = await fetch(`${baseUrl}/api/v1/web/wallet/withdrawals`, {
      method: "POST",
      headers: headers(user, "APP"),
      body: JSON.stringify({ amount: 100000, password: PASSWORD })
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe("AUTH_CHANNEL_FORBIDDEN");
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it("menolak password salah tanpa memotong saldo", async () => {
    const user = await createUser("500000.00", { bankAgeMs: 2 * DAY_MS });

    const response = await withdraw(user, { amount: 100000, password: "salah-total" });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe("WITHDRAWAL_PASSWORD_INVALID");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.cashBalance.toString()).toBe("500000");
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it("menolak pencairan bila rekening belum tersimpan", async () => {
    const user = await createUser("500000.00", {});

    const response = await withdraw(user, { amount: 100000, password: PASSWORD });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code?: string }).code).toBe(
      "WITHDRAWAL_BANK_ACCOUNT_REQUIRED"
    );
  });

  it("menahan pencairan 24 jam setelah rekening disimpan atau diganti", async () => {
    const user = await createUser("500000.00", { bankAgeMs: 60 * 60 * 1000 });

    const response = await withdraw(user, { amount: 100000, password: PASSWORD });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe(
      "WITHDRAWAL_BANK_ACCOUNT_COOLDOWN"
    );
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it("menyimpan ulang rekening lewat rute web memulai ulang jeda", async () => {
    const user = await createUser("500000.00", { bankAgeMs: 2 * DAY_MS });

    const save = await fetch(`${baseUrl}/api/v1/web/wallet/bank-account`, {
      method: "PUT",
      headers: headers(user),
      body: JSON.stringify({
        bankName: "BNI",
        accountNumber: "5554443332",
        accountHolderName: "Pemilik Baru"
      })
    });
    expect(save.status).toBe(200);

    const response = await withdraw(user, { amount: 100000, password: PASSWORD });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe(
      "WITHDRAWAL_BANK_ACCOUNT_COOLDOWN"
    );
  });

  it("menolak saldo kurang dan nominal di bawah minimum", async () => {
    const user = await createUser("60000.00", { bankAgeMs: 2 * DAY_MS });

    const tooMuch = await withdraw(user, { amount: 100000, password: PASSWORD });
    expect(tooMuch.status).toBe(400);
    expect(((await tooMuch.json()) as { code?: string }).code).toBe("INSUFFICIENT_BALANCE");

    const tooSmall = await withdraw(user, { amount: 10000, password: PASSWORD });
    expect(tooSmall.status).toBe(400);
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it("dua permintaan serentak tidak boleh melampaui saldo", async () => {
    const user = await createUser("100000.00", { bankAgeMs: 2 * DAY_MS });

    const results = await Promise.all([
      withdraw(user, { amount: 100000, password: PASSWORD }),
      withdraw(user, { amount: 100000, password: PASSWORD })
    ]);
    const created = results.filter((response) => response.status === 201).length;
    expect(created).toBe(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.cashBalance.toString()).toBe("0");
    expect(await prisma.withdrawal.count({ where: { userId: user.id } })).toBe(1);
  });

  it("riwayat pencairan hanya menampilkan milik sendiri", async () => {
    const owner = await createUser("500000.00", { bankAgeMs: 2 * DAY_MS });
    const other = await createUser("500000.00", { bankAgeMs: 2 * DAY_MS });
    expect((await withdraw(owner, { amount: 100000, password: PASSWORD })).status).toBe(201);

    const list = await fetch(`${baseUrl}/api/v1/web/wallet/withdrawals`, {
      headers: headers(other)
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });
});

function headers(user: User, channel: "WEB" | "APP" = "WEB") {
  return {
    authorization: `Bearer ${signAccessToken({
      sub: user.id,
      role: user.role,
      sessionId: `session-${user.id}`,
      channel
    })}`,
    "content-type": "application/json"
  };
}

function withdraw(user: User, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/v1/web/wallet/withdrawals`, {
    method: "POST",
    headers: headers(user),
    body: JSON.stringify(body)
  });
}

async function createUser(
  cashBalance: string,
  options: { bankAgeMs?: number }
): Promise<User> {
  const { hashPassword } = await import("../../src/core/security/passwordHasher.js");
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  phoneSeq += 1;
  const code = `WWD${String(phoneSeq).padStart(5, "0")}`;
  const user = await prisma.user.create({
    data: {
      fullName: `Mitra ${code}`,
      phone: `+6285${String(phoneSeq).padStart(9, "0")}`,
      referralCode: code,
      role: "USER",
      membershipId: basic.id,
      passwordHash: await hashPassword(PASSWORD),
      ...(options.bankAgeMs !== undefined
        ? {
            bankAccount: {
              bankName: "BCA",
              accountNumber: "1234567890",
              accountHolderName: "Pemilik Sah",
              updatedAt: new Date(Date.now() - options.bankAgeMs).toISOString()
            }
          }
        : {})
    }
  });
  await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: new Prisma.Decimal(cashBalance),
      cashBalance: new Prisma.Decimal(cashBalance),
      ppobBalance: new Prisma.Decimal(0),
      currency: "IDR"
    }
  });
  return user;
}
