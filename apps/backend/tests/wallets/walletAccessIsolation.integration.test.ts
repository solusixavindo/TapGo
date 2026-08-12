import { Prisma, User, UserRole } from "@prisma/client";
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
 * Authorization dan isolasi antar-akun untuk permukaan wallet.
 *
 * Withdrawal state machine sudah dijaga withdrawal.integration.test.ts. Yang
 * belum dijaga — dan justru paling berbahaya bila salah — adalah siapa yang
 * boleh membaca dompet siapa. Modul wallets memiliki 14 endpoint; sebelum
 * berkas ini, nol di antaranya diuji untuk kebocoran lintas akun.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let originalCashOutGate: string | undefined;

/** Menyalakan pencairan saldo hanya untuk test yang memang memerlukannya. */
function setCashOutEnabled(enabled: boolean) {
  backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = enabled;
}

/** Seluruh endpoint wallet milik pengguna beserta metodenya. */
const OWNER_ENDPOINTS: ReadonlyArray<{ method: string; path: string }> = [
  { method: "GET", path: "/api/v1/wallet" },
  { method: "GET", path: "/api/v1/wallet/transactions" },
  { method: "GET", path: "/api/v1/wallet/bank-account" },
  { method: "GET", path: "/api/v1/wallet/withdrawals" },
  { method: "GET", path: "/api/v1/wallet/withdraws" }
];

describe.skipIf(!runIntegration)("Wallet access isolation", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error(
        "TAPGO_TEST_DATABASE_URL must point to a dedicated test database."
      );
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-wallet-isolation";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ??
      "test-refresh-secret-for-wallet-isolation";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";

    originalCashOutGate = process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    backendEnv = envModule.env;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    // Default sengaja OFF: itulah konfigurasi rilis Google Play.
    setCashOutEnabled(false);
  });

  afterAll(async () => {
    if (backendEnv) {
      backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED =
        originalCashOutGate?.trim().toLowerCase() === "true";
    }
    if (originalCashOutGate == null) {
      delete process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
    } else {
      process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = originalCashOutGate;
    }
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("menolak seluruh endpoint wallet tanpa token", async () => {
    for (const endpoint of OWNER_ENDPOINTS) {
      const response = await fetch(`${baseUrl}${endpoint.path}`, {
        method: endpoint.method
      });
      expect(
        response.status,
        `${endpoint.method} ${endpoint.path} harus menolak permintaan tanpa token`
      ).toBe(401);
    }
  });

  it("menolak token dengan tanda tangan tidak sah", async () => {
    const user = await createWalletUser("WISO0001", "USER", "50000.00");
    const valid = tokenFor(user);
    // Satu karakter payload diubah: tanda tangan menjadi tidak sah.
    const tampered = `${valid.slice(0, valid.length - 4)}AAAA`;

    for (const endpoint of OWNER_ENDPOINTS) {
      const response = await fetch(`${baseUrl}${endpoint.path}`, {
        method: endpoint.method,
        headers: { authorization: `Bearer ${tampered}` }
      });
      expect(
        response.status,
        `${endpoint.method} ${endpoint.path} harus menolak token palsu`
      ).toBe(401);
    }
  });

  it("hanya mengembalikan saldo milik pemanggil", async () => {
    const alice = await createWalletUser("WISOALC1", "USER", "125000.00");
    const bob = await createWalletUser("WISOBOB1", "USER", "999000.00");

    const aliceView = await readJson("/api/v1/wallet", alice);
    const bobView = await readJson("/api/v1/wallet", bob);

    expect(balanceOf(aliceView)).toBe("125000");
    expect(balanceOf(bobView)).toBe("999000");
    // Saldo Bob tidak boleh terlihat dari respons Alice dalam bentuk apa pun.
    expect(JSON.stringify(aliceView)).not.toContain("999000");
    expect(JSON.stringify(aliceView)).not.toContain(bob.id);
  });

  it("hanya mengembalikan transaksi milik pemanggil", async () => {
    const alice = await createWalletUser("WISOALC2", "USER", "100000.00");
    const bob = await createWalletUser("WISOBOB2", "USER", "100000.00");
    await addTransaction(alice.id, "11111.00", "TRX-ALICE-ONLY");
    await addTransaction(bob.id, "22222.00", "TRX-BOB-ONLY");

    const aliceBody = JSON.stringify(await readJson("/api/v1/wallet/transactions", alice));
    const bobBody = JSON.stringify(await readJson("/api/v1/wallet/transactions", bob));

    expect(aliceBody).toContain("TRX-ALICE-ONLY");
    expect(aliceBody).not.toContain("TRX-BOB-ONLY");
    expect(bobBody).toContain("TRX-BOB-ONLY");
    expect(bobBody).not.toContain("TRX-ALICE-ONLY");
  });

  it("hanya mengembalikan rekening bank milik pemanggil", async () => {
    const alice = await createWalletUser("WISOALC3", "USER", "0.00");
    const bob = await createWalletUser("WISOBOB3", "USER", "0.00");
    await setBankAccount(alice.id, "1234567890", "Alice Pemilik");
    await setBankAccount(bob.id, "9876543210", "Bob Pemilik");

    const aliceBody = JSON.stringify(await readJson("/api/v1/wallet/bank-account", alice));

    expect(aliceBody).not.toContain("9876543210");
    expect(aliceBody).not.toContain("Bob Pemilik");
  });

  it("hanya mengembalikan riwayat penarikan milik pemanggil", async () => {
    const alice = await createWalletUser("WISOALC4", "USER", "500000.00");
    const bob = await createWalletUser("WISOBOB4", "USER", "500000.00");
    await setBankAccount(alice.id, "1234567890", "Alice Pemilik");
    await setBankAccount(bob.id, "9876543210", "Bob Pemilik");
    setCashOutEnabled(true);

    const aliceWithdrawal = await requestWithdrawal(alice, 100000);
    const bobWithdrawal = await requestWithdrawal(bob, 200000);
    // Prasyarat: keduanya memang berhasil membuat penarikan.
    expect(aliceWithdrawal.status).toBe(201);
    expect(bobWithdrawal.status).toBe(201);

    const aliceBody = JSON.stringify(await readJson("/api/v1/wallet/withdrawals", alice));
    expect(aliceBody).toContain("100000");
    expect(aliceBody).not.toContain("200000");
    expect(aliceBody).not.toContain(bob.id);
  });

  it("menolak pembaruan rekening bank yang tidak valid tanpa menyentuh data lama", async () => {
    const user = await createWalletUser("WISO0002", "USER", "0.00");
    await setBankAccount(user.id, "1234567890", "Pemilik Sah");
    setCashOutEnabled(true);

    const invalidPayloads: ReadonlyArray<Record<string, unknown>> = [
      {},
      { bankName: "", accountNumber: "1234567890", accountHolderName: "Pemilik Sah" },
      { bankName: "BCA", accountNumber: "", accountHolderName: "Pemilik Sah" },
      { bankName: "BCA", accountNumber: "1234567890", accountHolderName: "" }
    ];

    for (const payload of invalidPayloads) {
      const response = await fetch(`${baseUrl}/api/v1/wallet/bank-account`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${tokenFor(user)}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      expect(
        response.status,
        `payload tidak valid harus ditolak: ${JSON.stringify(payload)}`
      ).toBeGreaterThanOrEqual(400);
    }

    // Data lama tetap utuh setelah semua penolakan.
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { bankAccount: true }
    });
    const account = stored.bankAccount as Record<string, unknown> | null;
    expect(account?.accountNumber).toBe("1234567890");
    expect(account?.accountHolderName).toBe("Pemilik Sah");
  });

  it("tidak pernah membocorkan nomor rekening penuh pengguna lain lewat penarikan", async () => {
    const alice = await createWalletUser("WISO0003", "USER", "300000.00");
    const bob = await createWalletUser("WISO0004", "USER", "300000.00");
    await setBankAccount(alice.id, "1234567890", "Alice Pemilik");
    await setBankAccount(bob.id, "5555666677", "Bob Pemilik");
    setCashOutEnabled(true);
    await requestWithdrawal(bob, 150000);

    // Endpoint milik pengguna maupun daftar penarikan tidak boleh memuat
    // nomor rekening pengguna lain.
    for (const path of [
      "/api/v1/wallet",
      "/api/v1/wallet/transactions",
      "/api/v1/wallet/bank-account",
      "/api/v1/wallet/withdrawals"
    ]) {
      const body = JSON.stringify(await readJson(path, alice));
      expect(body, `${path} tidak boleh memuat rekening pengguna lain`).not.toContain(
        "5555666677"
      );
    }
  });

  it("menutup pencairan saldo pada konfigurasi rilis Google Play", async () => {
    const user = await createWalletUser("WISO0007", "USER", "500000.00");
    await setBankAccount(user.id, "1234567890", "Pemilik Sah");
    // Gate default OFF — inilah konfigurasi yang diunggah ke Play Store.

    const withdrawal = await requestWithdrawal(user, 100000);
    expect(withdrawal.status).toBe(403);
    const withdrawalBody = (await withdrawal.json()) as { code?: string };
    expect(withdrawalBody.code).toBe("CASH_OUT_DISABLED_FOR_PLAY");

    const bankUpdate = await fetch(`${baseUrl}/api/v1/wallet/bank-account`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${tokenFor(user)}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        bankName: "BCA",
        accountNumber: "1234567890",
        accountHolderName: "Pemilik Sah"
      })
    });
    expect(bankUpdate.status).toBe(403);

    // Saldo tidak tersentuh oleh permintaan yang ditolak.
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: user.id }
    });
    expect(wallet.balance.toString()).toBe("500000");
    expect(await prisma.withdrawal.count({ where: { userId: user.id } })).toBe(0);
  });

  it("menolak pengguna biasa mengakses permukaan wallet admin", async () => {
    const user = await createWalletUser("WISO0005", "USER", "0.00");
    const target = await createWalletUser("WISO0006", "USER", "777000.00");

    for (const path of [
      "/api/v1/admin/wallets",
      "/api/v1/admin/withdrawals",
      `/api/v1/admin/users/${target.id}/wallet`
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { authorization: `Bearer ${tokenFor(user)}` }
      });
      // 403 persis: cek "bukan 2xx" tidak dapat membedakan penolakan role
      // dari kegagalan lain.
      expect(response.status, `${path} harus tertutup untuk role USER`).toBe(403);
    }
  });
});

function tokenFor(user: User): string {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`
  });
}

async function readJson(path: string, user: User): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${tokenFor(user)}` }
  });
  expect(response.status, `${path} harus dapat dibaca pemiliknya`).toBe(200);
  return response.json();
}

/** Mengambil saldo tanpa bergantung pada bentuk pembungkus respons. */
function balanceOf(body: unknown): string {
  const found = findBalance(body);
  expect(found, "respons wallet harus memuat saldo").not.toBeNull();
  return String(found).replace(/\.0+$/, "");
}

function findBalance(node: unknown): unknown {
  if (node === null || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  if (record.balance !== undefined && typeof record.balance !== "object") {
    return record.balance;
  }
  for (const value of Object.values(record)) {
    const nested = findBalance(value);
    if (nested !== null) return nested;
  }
  return null;
}

async function requestWithdrawal(user: User, amount: number) {
  return fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokenFor(user)}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      amount,
      bankName: "BCA",
      accountNumber: bankAccountNumberFor(user),
      accountHolderName: user.fullName
    })
  });
}

/** Nomor rekening deterministik per pengguna agar kebocoran mudah dilacak. */
function bankAccountNumberFor(user: User): string {
  return user.referralCode.includes("BOB") ? "5555666677" : "1234567890";
}

async function createWalletUser(
  referralCode: string,
  role: UserRole,
  walletBalance: string
): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({
    where: { tier: "BASIC" }
  });
  const user = await prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.padStart(9, "0")}`,
      referralCode,
      role,
      membershipId: basic.id
    }
  });
  await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: new Prisma.Decimal(walletBalance),
      cashBalance: new Prisma.Decimal(walletBalance),
      ppobBalance: new Prisma.Decimal(0),
      currency: "IDR"
    }
  });
  return user;
}

async function addTransaction(
  userId: string,
  amount: string,
  reference: string
): Promise<void> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      amount: new Prisma.Decimal(amount),
      type: "COMMISSION",
      referenceType: "TEST",
      referenceId: reference
    }
  });
}

async function setBankAccount(
  userId: string,
  accountNumber: string,
  accountHolderName: string
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { bankAccount: { bankName: "BCA", accountNumber, accountHolderName } }
  });
}
