import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  decimalString,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let originalExternalPaymentGateEnv: string | undefined;

describe.skipIf(!runIntegration)("Withdrawal API", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-withdrawal-api";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-withdrawal-api";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";
    originalExternalPaymentGateEnv =
      process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
    process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = "true";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    backendEnv = envModule.env;
    backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = true;
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
      backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED =
        originalExternalPaymentGateEnv?.trim().toLowerCase() === "true";
    }
    if (originalExternalPaymentGateEnv == null) {
      delete process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
    } else {
      process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED =
        originalExternalPaymentGateEnv;
    }
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("creates a pending withdrawal and reserves wallet balance", async () => {
    const user = await createUser("WDUSER01", "USER", "150000.00");

    const response = await createWithdrawal(user, 100000);
    const body = await response.json() as { data: { status: string; amount: string; bankName: string } };

    expect(response.status).toBe(201);
    expect(body.data.status).toBe("PENDING");
    expect(body.data.bankName).toBe("BCA");
    await expectWallet(user.id, "50000.00");
    await expectWalletTransaction(user.id, "WITHDRAWAL_REQUEST", 1);
  });

  it("blocks insufficient balance", async () => {
    const user = await createUser("WDUSER02", "USER", "75000.00");

    const response = await createWithdrawal(user, 100000);

    expect(response.status).toBe(400);
    await expectWallet(user.id, "75000.00");
  });

  it("approves withdrawal without deducting wallet twice", async () => {
    const user = await createUser("WDUSER03", "USER", "150000.00");
    const admin = await createUser("WDADMIN3", "ADMIN", "0.00");
    const withdrawal = await createdWithdrawalId(user, 100000);

    const response = await adminAction(admin, withdrawal, "approve");

    expect(response.status).toBe(200);
    await expectWithdrawalStatus(withdrawal, "APPROVED");
    await expectWallet(user.id, "50000.00");
  });

  it("rejects withdrawal and refunds balance once", async () => {
    const user = await createUser("WDUSER04", "USER", "150000.00");
    const admin = await createUser("WDADMIN4", "ADMIN", "0.00");
    const withdrawal = await createdWithdrawalId(user, 100000);

    const response = await adminAction(admin, withdrawal, "reject");
    const duplicate = await adminAction(admin, withdrawal, "reject");

    expect(response.status).toBe(200);
    expect(duplicate.status).toBe(409);
    await expectWithdrawalStatus(withdrawal, "REJECTED");
    await expectWallet(user.id, "150000.00");
    await expectWalletTransaction(user.id, "WITHDRAWAL_REFUND", 1);
  });

  it("marks approved withdrawal as paid", async () => {
    const user = await createUser("WDUSER05", "USER", "150000.00");
    const admin = await createUser("WDADMIN5", "SUPER_ADMIN", "0.00");
    const withdrawal = await createdWithdrawalId(user, 100000);
    await adminAction(admin, withdrawal, "approve");

    const response = await adminAction(admin, withdrawal, "paid");

    expect(response.status).toBe(200);
    await expectWithdrawalStatus(withdrawal, "PAID");
  });

  it("blocks double approve and paid before approve", async () => {
    const user = await createUser("WDUSER06", "USER", "150000.00");
    const admin = await createUser("WDADMIN6", "SUPER_ADMIN", "0.00");
    const withdrawal = await createdWithdrawalId(user, 100000);

    const paidBeforeApprove = await adminAction(admin, withdrawal, "paid");
    const approve = await adminAction(admin, withdrawal, "approve");
    const doubleApprove = await adminAction(admin, withdrawal, "approve");

    expect(paidBeforeApprove.status).toBe(409);
    expect(approve.status).toBe(200);
    expect(doubleApprove.status).toBe(409);
  });
});

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

async function createUser(referralCode: string, role: UserRole, walletBalance: string): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
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

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`
  });
}

function createWithdrawal(user: User, amount: number) {
  return api("/api/v1/wallet/withdrawals", {
    method: "POST",
    token: tokenFor(user),
    body: {
      amount,
      bankName: "BCA",
      accountNumber: "1234567890",
      accountHolderName: user.fullName
    }
  });
}

async function createdWithdrawalId(user: User, amount: number) {
  const response = await createWithdrawal(user, amount);
  const body = await response.json() as { data: { id: string } };
  expect(response.status).toBe(201);
  return body.data.id;
}

function adminAction(admin: User, withdrawalId: string, action: "approve" | "reject" | "paid") {
  return api(`/api/v1/admin/withdrawals/${withdrawalId}/${action}`, {
    method: "POST",
    token: tokenFor(admin),
    body: {}
  });
}

async function expectWallet(userId: string, expectedBalance: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  expect(decimalString(wallet.balance)).toBe(expectedBalance);
  expect(decimalString(wallet.cashBalance)).toBe(expectedBalance);
}

async function expectWalletTransaction(userId: string, type: "WITHDRAWAL_REQUEST" | "WITHDRAWAL_REFUND", count: number) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const transactions = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id, type }
  });
  expect(transactions).toHaveLength(count);
}

async function expectWithdrawalStatus(withdrawalId: string, status: "PENDING" | "APPROVED" | "REJECTED" | "PAID") {
  const withdrawal = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
  expect(withdrawal.status).toBe(status);
}
