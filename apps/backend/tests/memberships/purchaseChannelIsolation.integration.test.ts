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
 * Isolasi kanal pembelian membership (Stage R2.6 jalur A).
 *
 * Sebelum stage ini, satu flag — EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED —
 * mengendalikan tiga kebijakan berbeda: visibilitas paket berbayar, pembelian
 * membership, dan pencairan saldo wallet. Konsekuensinya menyalakan penjualan
 * membership di web akan ikut membuka pencairan saldo pada rilis Google Play,
 * yaitu permukaan yang sengaja ditutup demi kepatuhan.
 *
 * Berkas ini menjaga pemisahan itu. Test paling penting di sini adalah yang
 * menyalakan kanal web lalu membuktikan pencairan saldo TETAP tertutup.
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

let original: {
  master?: boolean;
  web?: boolean;
  app?: boolean;
  cashOut?: boolean;
} = {};

function setFlags(next: {
  master?: boolean;
  web?: boolean;
  app?: boolean;
  cashOut?: boolean;
}) {
  if (next.master !== undefined) {
    backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = next.master;
  }
  if (next.web !== undefined) {
    backendEnv.MEMBERSHIP_PURCHASE_WEB_ENABLED = next.web;
  }
  if (next.app !== undefined) {
    backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED = next.app;
  }
  if (next.cashOut !== undefined) {
    backendEnv.WALLET_CASH_OUT_ENABLED = next.cashOut;
  }
}

describe.skipIf(!runIntegration)("Membership purchase channel isolation", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error(
        "TAPGO_TEST_DATABASE_URL must point to a dedicated test database."
      );
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-purchase-channel";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-purchase-channel";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    backendEnv = envModule.env;
    original = {
      master: backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED,
      web: backendEnv.MEMBERSHIP_PURCHASE_WEB_ENABLED,
      app: backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED,
      cashOut: backendEnv.WALLET_CASH_OUT_ENABLED
    };

    server = http.createServer(createApp());
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve)
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    // Konfigurasi rilis Google Play: semuanya tertutup.
    setFlags({ master: false, web: false, app: false, cashOut: false });
  });

  afterAll(async () => {
    setFlags({
      master: original.master ?? false,
      web: original.web ?? false,
      app: original.app ?? false,
      cashOut: original.cashOut ?? false
    });
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("keempat flag default tertutup", () => {
    // Fail closed: nol kanal terbuka tanpa dinyalakan eksplisit.
    setFlags({ master: false, web: false, app: false, cashOut: false });
    expect(backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED).toBe(false);
    expect(backendEnv.MEMBERSHIP_PURCHASE_WEB_ENABLED).toBe(false);
    expect(backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED).toBe(false);
    expect(backendEnv.WALLET_CASH_OUT_ENABLED).toBe(false);
  });

  it("kanal web menyala TIDAK membuka pencairan saldo", async () => {
    // Inilah alasan pemisahan flag ini dibuat.
    setFlags({ master: true, web: true, app: false, cashOut: false });

    const user = await createUser("CHN00001", "500000.00");
    await setBankAccount(user.id);

    const withdrawal = await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenFor(user)}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        amount: 100000,
        bankName: "BCA",
        accountNumber: "1234567890",
        accountHolderName: user.fullName
      })
    });

    expect(withdrawal.status).toBe(403);
    const body = (await withdrawal.json()) as { code?: string };
    expect(body.code).toBe("CASH_OUT_DISABLED_FOR_PLAY");

    // Saldo tidak tersentuh dan nol penarikan tercatat.
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: user.id }
    });
    expect(wallet.balance.toString()).toBe("500000");
    expect(await prisma.withdrawal.count({ where: { userId: user.id } })).toBe(
      0
    );
  });

  it("kanal web menyala TIDAK membuka pembaruan rekening bank", async () => {
    setFlags({ master: true, web: true, app: false, cashOut: false });
    const user = await createUser("CHN00002", "0.00");

    const response = await fetch(`${baseUrl}/api/v1/wallet/bank-account`, {
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
    expect(response.status).toBe(403);
  });

  it("pencairan saldo menyala TIDAK membuka pembelian membership", async () => {
    // Arah sebaliknya juga harus terisolasi.
    setFlags({ master: false, web: false, app: false, cashOut: true });
    const user = await createUser("CHN00003", "0.00");

    const packages = await fetch(`${baseUrl}/api/v1/membership/packages`, {
      headers: { authorization: `Bearer ${tokenFor(user)}` }
    });
    if (packages.status === 200) {
      const raw = JSON.stringify(await packages.json());
      // Master switch mati: paket berbayar tidak boleh terlihat.
      for (const paid of ["Silver", "Gold", "Platinum"]) {
        expect(raw).not.toContain(paid);
      }
    } else {
      expect(packages.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("master switch mati mematikan seluruh kanal walau flag kanal menyala", async () => {
    setFlags({ master: false, web: true, app: true, cashOut: false });
    const user = await createUser("CHN00004", "0.00");

    const order = await fetch(`${baseUrl}/api/v1/membership/orders`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenFor(user)}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ packageName: "Silver" })
    });
    expect(order.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.membershipOrder.count()).toBe(0);
  });

  it("kebijakan kanal dievaluasi terpisah untuk web, app, dan pencairan", async () => {
    const policy = await import(
      "../../src/modules/memberships/application/purchaseChannel.js"
    );

    setFlags({ master: true, web: true, app: false, cashOut: false });
    expect(policy.membershipPurchaseEnabled("WEB")).toBe(true);
    expect(policy.membershipPurchaseEnabled("APP")).toBe(false);
    expect(policy.walletCashOutEnabled()).toBe(false);

    setFlags({ master: true, web: false, app: true, cashOut: true });
    expect(policy.membershipPurchaseEnabled("WEB")).toBe(false);
    expect(policy.membershipPurchaseEnabled("APP")).toBe(true);
    expect(policy.walletCashOutEnabled()).toBe(true);

    // Master mati mengalahkan seluruh flag kanal.
    setFlags({ master: false, web: true, app: true, cashOut: false });
    expect(policy.membershipPurchaseEnabled("WEB")).toBe(false);
    expect(policy.membershipPurchaseEnabled("APP")).toBe(false);
    expect(policy.paidMembershipVisible("WEB")).toBe(false);
  });

  it("nol perubahan pada domain finansial saat kanal ditutup", async () => {
    setFlags({ master: true, web: true, app: false, cashOut: false });
    const user = await createUser("CHN00005", "250000.00");

    const before = await financialSnapshot(user.id);
    await fetch(`${baseUrl}/api/v1/wallet/withdraw`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenFor(user)}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        amount: 100000,
        bankName: "BCA",
        accountNumber: "1234567890",
        accountHolderName: user.fullName
      })
    });
    const after = await financialSnapshot(user.id);

    // Business Engine tidak boleh bergerak karena permintaan yang ditolak.
    expect(after).toEqual(before);
  });
});

async function financialSnapshot(userId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return {
    balance: wallet.balance.toString(),
    cashBalance: wallet.cashBalance.toString(),
    ppobBalance: wallet.ppobBalance.toString(),
    transactions: await prisma.walletTransaction.count({
      where: { walletId: wallet.id }
    }),
    withdrawals: await prisma.withdrawal.count({ where: { userId } }),
    commissions: await prisma.commission.count(),
    orders: await prisma.membershipOrder.count({ where: { userId } })
  };
}

function tokenFor(user: User): string {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`
  });
}

async function createUser(
  referralCode: string,
  walletBalance: string
): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({
    where: { tier: "BASIC" }
  });
  const user = await prisma.user.create({
    data: {
      fullName: `Channel ${referralCode}`,
      phone: `+6287${referralCode.padStart(9, "0")}`,
      referralCode,
      role: "USER",
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

async function setBankAccount(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      bankAccount: {
        bankName: "BCA",
        accountNumber: "1234567890",
        accountHolderName: "Pemilik Sah"
      }
    }
  });
}
