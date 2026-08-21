import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  seedPpobCatalog,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * Stage R2.7 — permukaan HTTP modul PPOB end-to-end (database nyata, app
 * nyata, tanpa mock). Yang dijaga di sini adalah kontrak transport: status
 * code, bentuk respons, isolasi antar-akun, dan fail-closed provider.
 *
 * Logika settlement provider (SUCCESS/FAILED/refund) tidak dapat dicapai via
 * HTTP pada stage ini karena gateway fail-closed; ia diuji di
 * ppobOrderService.unit.test.ts lewat port boundary yang memang dirancang
 * untuk ditukar pada Stage R2.8.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;

async function createPpobUser(
  referralCode: string,
  balance: string,
  ppobBalance: string
): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({
    where: { tier: "BASIC" }
  });
  const user = await prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.padStart(9, "0")}`,
      referralCode,
      role: "USER",
      membershipId: basic.id
    }
  });
  await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: new Prisma.Decimal(balance),
      cashBalance: new Prisma.Decimal(balance),
      ppobBalance: new Prisma.Decimal(ppobBalance),
      currency: "IDR"
    }
  });
  return user;
}

function tokenFor(user: User): string {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`
  });
}

async function callApi(
  method: string,
  path: string,
  user?: User,
  body?: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(user ? { authorization: `Bearer ${tokenFor(user)}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe.skipIf(!runIntegration)("PPOB HTTP surface (Stage R2.7)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error(
        "TAPGO_TEST_DATABASE_URL must point to a dedicated test database."
      );
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-ppob-surface";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ??
      "test-refresh-secret-for-ppob-surface";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;

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
    await seedPpobCatalog();
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("menolak seluruh endpoint PPOB tanpa token", async () => {
    const endpoints: Array<{ method: string; path: string }> = [
      { method: "GET", path: "/api/v1/ppob/catalog" },
      { method: "GET", path: "/api/v1/ppob/orders" },
      { method: "POST", path: "/api/v1/ppob/orders/inquiry" },
      { method: "POST", path: "/api/v1/ppob/orders" }
    ];
    for (const endpoint of endpoints) {
      const { status } = await callApi(endpoint.method, endpoint.path);
      expect(status, `${endpoint.method} ${endpoint.path} harus menolak tanpa token`).toBe(401);
    }
  });

  it("mengembalikan katalog berisi kategori dan produk aktif saja", async () => {
    const user = await createPpobUser("PPOBCAT01", "500000.00", "100000.00");
    const { status, json } = await callApi("GET", "/api/v1/ppob/catalog", user);

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const categories = json.data as Array<{
      code: string;
      name: string;
      products: Array<{ sku: string; price: string }>;
    }>;
    expect(categories.length).toBeGreaterThanOrEqual(1);
    const pulsa = categories.find((category) => category.code === "PULSA");
    expect(pulsa).toBeDefined();
    const skus = pulsa!.products.map((product) => product.sku);
    expect(skus).toContain("PULSA_10K");
    // Produk nonaktif tidak boleh bocor ke katalog customer.
    expect(skus).not.toContain("PULSA_100K_INACTIVE");
  });

  it("inquiry menghitung total dan rincian saldo gabungan", async () => {
    const user = await createPpobUser("PPOBINQ01", "500000.00", "5000.00");
    const { status, json } = await callApi("POST", "/api/v1/ppob/orders/inquiry", user, {
      sku: "PULSA_10K",
      targetNumber: "081234567890"
    });

    expect(status).toBe(200);
    const data = json.data as {
      amount: string;
      payment: { benefitAmount: string; balanceAmount: string; sufficient: boolean };
      wallet: { balance: string; ppobBalance: string };
    };
    expect(Number(data.amount)).toBe(11500);
    // Benefit Rp5.000 habis lebih dulu, sisanya dari saldo utama.
    expect(Number(data.payment.benefitAmount)).toBe(5000);
    expect(Number(data.payment.balanceAmount)).toBe(6500);
    expect(data.payment.sufficient).toBe(true);
    expect(Number(data.wallet.balance)).toBe(500000);
  });

  it("inquiry menandai saldo tidak cukup tanpa melempar error", async () => {
    const user = await createPpobUser("PPOBINQ02", "1000.00", "0.00");
    const { status, json } = await callApi("POST", "/api/v1/ppob/orders/inquiry", user, {
      sku: "PULSA_10K",
      targetNumber: "081234567890"
    });

    expect(status).toBe(200);
    const data = json.data as { payment: { sufficient: boolean } };
    expect(data.payment.sufficient).toBe(false);
  });

  it("inquiry menolak nomor tujuan yang tidak cocok pola produk", async () => {
    const user = await createPpobUser("PPOBINQ03", "500000.00", "0.00");
    // "12345" lolos sanitasi zod tetapi tidak memenuhi pola PULSA (10-15 digit).
    const { status, json } = await callApi("POST", "/api/v1/ppob/orders/inquiry", user, {
      sku: "PULSA_10K",
      targetNumber: "12345"
    });

    expect(status).toBe(400);
    expect(json.code).toBe("PPOB_TARGET_INVALID");
  });

  it("inquiry menolak SKU yang tidak dikenal dan produk nonaktif", async () => {
    const user = await createPpobUser("PPOBINQ04", "500000.00", "0.00");

    const unknown = await callApi("POST", "/api/v1/ppob/orders/inquiry", user, {
      sku: "TIDAK_ADA",
      targetNumber: "081234567890"
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe("PPOB_PRODUCT_NOT_FOUND");

    const inactive = await callApi("POST", "/api/v1/ppob/orders/inquiry", user, {
      sku: "PULSA_100K_INACTIVE",
      targetNumber: "081234567890"
    });
    expect(inactive.status).toBe(400);
    expect(inactive.json.code).toBe("PPOB_PRODUCT_INACTIVE");
  });

  it("create order fail-closed: 503, tanpa record order, saldo tidak tersentuh", async () => {
    const user = await createPpobUser("PPOBCRT01", "500000.00", "100000.00");
    const { status, json } = await callApi("POST", "/api/v1/ppob/orders", user, {
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "ppob-test-key-0001"
    });

    expect(status).toBe(503);
    expect(json.code).toBe("PPOB_PROVIDER_UNAVAILABLE");

    const orders = await prisma.ppobOrder.findMany({ where: { userId: user.id } });
    expect(orders).toHaveLength(0);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.balance.toString()).toBe("500000");
    expect(wallet.ppobBalance.toString()).toBe("100000");

    const ledger = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id }
    });
    expect(ledger).toHaveLength(0);
  });

  it("retry dengan idempotency key yang sama juga fail-closed tanpa duplikasi", async () => {
    const user = await createPpobUser("PPOBCRT02", "500000.00", "0.00");
    const payload = {
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "ppob-test-key-0002"
    };
    const first = await callApi("POST", "/api/v1/ppob/orders", user, payload);
    const second = await callApi("POST", "/api/v1/ppob/orders", user, payload);

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    const orders = await prisma.ppobOrder.findMany({ where: { userId: user.id } });
    expect(orders).toHaveLength(0);
  });

  it("riwayat order kosong mengembalikan array kosong", async () => {
    const user = await createPpobUser("PPOBHIS01", "500000.00", "0.00");
    const { status, json } = await callApi("GET", "/api/v1/ppob/orders", user);

    expect(status).toBe(200);
    expect(json.data).toEqual([]);
  });

  it("detail order milik akun lain dijawab 404 (anti-enumerasi)", async () => {
    const alice = await createPpobUser("PPOBOWN01", "500000.00", "0.00");
    const bob = await createPpobUser("PPOBOWN02", "500000.00", "0.00");

    const product = await prisma.ppobProduct.findUniqueOrThrow({ where: { sku: "PULSA_10K" } });
    const order = await prisma.ppobOrder.create({
      data: {
        userId: alice.id,
        productId: product.id,
        targetNumber: "081234567890",
        amount: new Prisma.Decimal(11500),
        benefitAmount: new Prisma.Decimal(0),
        balanceAmount: new Prisma.Decimal(11500),
        status: "SUCCESS",
        idempotencyKey: "ppob-seeded-order-1"
      }
    });

    const asBob = await callApi("GET", `/api/v1/ppob/orders/${order.id}`, bob);
    expect(asBob.status).toBe(404);
    expect(asBob.json.code).toBe("PPOB_ORDER_NOT_FOUND");

    const asAlice = await callApi("GET", `/api/v1/ppob/orders/${order.id}`, alice);
    expect(asAlice.status).toBe(200);
    const detail = asAlice.json.data as { sku: string; status: string; amount: string };
    expect(detail.sku).toBe("PULSA_10K");
    expect(detail.status).toBe("SUCCESS");
    expect(Number(detail.amount)).toBe(11500);

    // Dan order Alice muncul di riwayat Alice, bukan di riwayat Bob.
    const aliceHistory = await callApi("GET", "/api/v1/ppob/orders", alice);
    expect((aliceHistory.json.data as unknown[]).length).toBe(1);
    const bobHistory = await callApi("GET", "/api/v1/ppob/orders", bob);
    expect(bobHistory.json.data).toEqual([]);
  });

  it("validasi input menolak target berisi huruf dan idempotency key pendek", async () => {
    const user = await createPpobUser("PPOBVAL01", "500000.00", "0.00");

    const badTarget = await callApi("POST", "/api/v1/ppob/orders", user, {
      sku: "PULSA_10K",
      targetNumber: "08ABC",
      idempotencyKey: "ppob-test-key-0003"
    });
    expect(badTarget.status).toBe(400);
    expect(badTarget.json.code).toBe("VALIDATION_ERROR");

    const badKey = await callApi("POST", "/api/v1/ppob/orders", user, {
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "abc"
    });
    expect(badKey.status).toBe(400);
    expect(badKey.json.code).toBe("VALIDATION_ERROR");

    const orders = await prisma.ppobOrder.findMany({ where: { userId: user.id } });
    expect(orders).toHaveLength(0);
  });
});
