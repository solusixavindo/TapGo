import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/core/security/passwordHasher.js";
import {
  cleanDatabase,
  decimalString,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

const TEST_PASSWORD = "Transfer-Pass-123";

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let originalTransferEnabledEnv: string | undefined;

describe.skipIf(!runIntegration)("Wallet Transfer API", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-transfer-api";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-transfer-api";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";
    originalTransferEnabledEnv = process.env.WALLET_TRANSFER_ENABLED;
    process.env.WALLET_TRANSFER_ENABLED = "true";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    backendEnv = envModule.env;
    backendEnv.WALLET_TRANSFER_ENABLED = true;
    signAccessToken = tokenService.signAccessToken;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    if (backendEnv) {
      backendEnv.WALLET_TRANSFER_ENABLED =
        originalTransferEnabledEnv?.trim().toLowerCase() === "true";
    }
    if (originalTransferEnabledEnv == null) {
      delete process.env.WALLET_TRANSFER_ENABLED;
    } else {
      process.env.WALLET_TRANSFER_ENABLED = originalTransferEnabledEnv;
    }
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("moves balance from sender to recipient exactly once", async () => {
    const sender = await createUser("TFSEND01", "USER", "500000.00");
    const recipient = await createUser("TFRECV01", "USER", "0.00");

    const response = await transfer(sender, recipient.phone, 100000, "transfer-key-1");
    const body = (await response.json()) as { data: { id: string }; replayed: boolean };

    expect(response.status).toBe(201);
    expect(body.replayed).toBe(false);
    await expectWallet(sender.id, "400000.00");
    await expectWallet(recipient.id, "100000.00");
    await expectLedgerCount(sender.id, "TRANSFER_OUT", 1);
    await expectLedgerCount(recipient.id, "TRANSFER_IN", 1);
  });

  it("blocks insufficient balance without moving anything", async () => {
    const sender = await createUser("TFSEND02", "USER", "50000.00");
    const recipient = await createUser("TFRECV02", "USER", "0.00");

    const response = await transfer(sender, recipient.phone, 100000, "transfer-key-2");

    expect(response.status).toBe(400);
    await expectWallet(sender.id, "50000.00");
    await expectWallet(recipient.id, "0.00");
  });

  it("requires the sender's password and moves nothing when it is wrong or missing", async () => {
    const sender = await createUser("TFPASS01", "USER", "500000.00");
    const recipient = await createUser("TFPASS02", "USER", "0.00");

    const wrong = await transfer(sender, recipient.phone, 100000, "transfer-pass-1", "salah-password");
    const wrongBody = (await wrong.json()) as { code?: string };
    const missing = await transfer(sender, recipient.phone, 100000, "transfer-pass-2", null);

    expect(wrong.status).toBe(403);
    expect(wrongBody.code).toBe("TRANSFER_PASSWORD_INVALID");
    expect(missing.status).toBe(400);
    await expectWallet(sender.id, "500000.00");
    await expectWallet(recipient.id, "0.00");
    await expectLedgerCount(sender.id, "TRANSFER_OUT", 0);
  });

  it("lets a sender with only top-up balance transfer it, and the recipient cannot withdraw it", async () => {
    const sender = await createUser("TFTOP001", "USER", "0.00", "300000.00");
    const recipient = await createUser("TFTOP002", "USER", "0.00");

    const response = await transfer(sender, recipient.phone, 100000, "transfer-topup-1");

    expect(response.status).toBe(201);
    await expectWallet(sender.id, "200000.00", "0.00");
    await expectWallet(recipient.id, "100000.00", "0.00");
  });

  it("spends the top-up part first and passes the withdrawable part on as withdrawable", async () => {
    const sender = await createUser("TFMIX001", "USER", "200000.00", "50000.00");
    const recipient = await createUser("TFMIX002", "USER", "0.00");

    const response = await transfer(sender, recipient.phone, 120000, "transfer-mix-1");

    expect(response.status).toBe(201);
    // 50.000 dari top up + 70.000 dari bagian yang bisa ditarik.
    await expectWallet(sender.id, "130000.00", "130000.00");
    await expectWallet(recipient.id, "120000.00", "70000.00");
    const outRow = await prisma.walletTransaction.findFirstOrThrow({
      where: { type: "TRANSFER_OUT", wallet: { userId: sender.id } }
    });
    expect(outRow.metadata).toMatchObject({ fromTopUp: "50000", fromWithdrawable: "70000" });
  });

  it("never lets two parallel transfers spend the same balance", async () => {
    const sender = await createUser("TFRACE01", "USER", "0.00", "150000.00");
    const recipient = await createUser("TFRACE02", "USER", "0.00");

    const results = await Promise.all([
      transfer(sender, recipient.phone, 100000, "transfer-race-a"),
      transfer(sender, recipient.phone, 100000, "transfer-race-b")
    ]);
    const statuses = results.map((r) => r.status).sort();

    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sender.id } });
    expect(decimalString(wallet.balance)).toBe("50000.00");
  });

  it("rejects transfer to self", async () => {
    const sender = await createUser("TFSEND03", "USER", "500000.00");

    const response = await transfer(sender, sender.phone, 100000, "transfer-key-3");

    expect(response.status).toBe(400);
    await expectWallet(sender.id, "500000.00");
  });

  it("rejects transfer to a phone that does not resolve to any account", async () => {
    const sender = await createUser("TFSEND04", "USER", "500000.00");

    const response = await transfer(sender, "+6289900000000", 100000, "transfer-key-4");

    expect(response.status).toBe(404);
    await expectWallet(sender.id, "500000.00");
  });

  it("replays the same result on a retried request with the same idempotency key, without double-debiting", async () => {
    const sender = await createUser("TFSEND05", "USER", "500000.00");
    const recipient = await createUser("TFRECV05", "USER", "0.00");

    const first = await transfer(sender, recipient.phone, 100000, "transfer-key-5");
    const second = await transfer(sender, recipient.phone, 100000, "transfer-key-5");
    const firstBody = (await first.json()) as { data: { id: string }; replayed: boolean };
    const secondBody = (await second.json()) as { data: { id: string }; replayed: boolean };

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(firstBody.replayed).toBe(false);
    expect(secondBody.replayed).toBe(true);
    expect(secondBody.data.id).toBe(firstBody.data.id);
    await expectWallet(sender.id, "400000.00");
    await expectWallet(recipient.id, "100000.00");
    await expectLedgerCount(sender.id, "TRANSFER_OUT", 1);
  });

  it("rejects reusing an idempotency key for a different payload", async () => {
    const sender = await createUser("TFSEND06", "USER", "500000.00");
    const recipientA = await createUser("TFRECV06", "USER", "0.00");
    const recipientB = await createUser("TFRECV07", "USER", "0.00");

    const first = await transfer(sender, recipientA.phone, 100000, "transfer-key-6");
    const second = await transfer(sender, recipientB.phone, 100000, "transfer-key-6");

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    await expectWallet(sender.id, "400000.00");
  });

  it("enforces the minimum transfer amount", async () => {
    const sender = await createUser("TFSEND08", "USER", "500000.00");
    const recipient = await createUser("TFRECV08", "USER", "0.00");

    const response = await transfer(sender, recipient.phone, 1000, "transfer-key-8");

    expect(response.status).toBe(400);
  });

  it("enforces the per-transaction maximum", async () => {
    const sender = await createUser("TFSEND09", "USER", "50000000.00");
    const recipient = await createUser("TFRECV09", "USER", "0.00");

    const response = await transfer(sender, recipient.phone, 3000000, "transfer-key-9");

    expect(response.status).toBe(400);
    await expectWallet(sender.id, "50000000.00");
  });

  it("enforces the daily cumulative transfer limit across multiple transfers", async () => {
    const sender = await createUser("TFSEND10", "USER", "50000000.00");
    const recipient = await createUser("TFRECV10", "USER", "0.00");

    const first = await transfer(sender, recipient.phone, 2000000, "transfer-key-10a");
    const second = await transfer(sender, recipient.phone, 2000000, "transfer-key-10b");
    const third = await transfer(sender, recipient.phone, 2000000, "transfer-key-10c");

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(400);
    await expectWallet(sender.id, "46000000.00");
  });
});

function transfer(
  sender: User,
  recipientPhone: string,
  amount: number,
  idempotencyKey: string,
  password: string | null = TEST_PASSWORD
) {
  return api("/api/v1/wallet/transfer", {
    method: "POST",
    token: tokenFor(sender),
    body: { recipientPhone, amount, idempotencyKey, ...(password !== null ? { password } : {}) }
  });
}

async function createUser(
  referralCode: string,
  role: UserRole,
  walletBalance: string,
  topUpPart = "0.00"
): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  const user = await prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.padStart(9, "0")}`,
      referralCode,
      role,
      membershipId: basic.id,
      passwordHash: await hashPassword(TEST_PASSWORD)
    }
  });

  // `walletBalance` = bagian yang bisa ditarik; `topUpPart` = saldo hasil top up (tidak bisa ditarik).
  await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: new Prisma.Decimal(walletBalance).plus(topUpPart),
      cashBalance: new Prisma.Decimal(walletBalance),
      ppobBalance: new Prisma.Decimal(0),
      currency: "IDR"
    }
  });

  return user;
}

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`
  });
}

async function api(path: string, options: {
  method?: string;
  token?: string;
  body?: unknown;
} = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
}

async function expectWallet(userId: string, expectedBalance: string, expectedCash = expectedBalance) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  expect(decimalString(wallet.balance)).toBe(expectedBalance);
  expect(decimalString(wallet.cashBalance)).toBe(expectedCash);
}

async function expectLedgerCount(userId: string, type: "TRANSFER_OUT" | "TRANSFER_IN", count: number) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const transactions = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id, type }
  });
  expect(transactions).toHaveLength(count);
}
