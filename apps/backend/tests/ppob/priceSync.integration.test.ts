import { Prisma, UserRole } from "@prisma/client";
import { createHash } from "node:crypto";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { apiRateLimiter, paymentRateLimiter, adminRateLimiter } from "../../src/core/security/rateLimit.js";

/**
 * Stage R2.12 — sinkronisasi harga PPOB dengan Digiflazz (keputusan Owner,
 * 20 Sep 2026): harga jual = modal Digiflazz + markup Rp500–Rp1.000.
 *
 * Stub server lokal berperilaku seperti /v1/price-list Digiflazz (POST,
 * sign = md5(username+apiKey+"pricelist")). Rekayasa harga sendiri
 * (selectPricingBand/ppobSellingPriceFor) sudah diuji tuntas di
 * tests/finance/ppobPricing.test.ts, dan perilaku layanan (apa yang
 * dilewati/dinonaktifkan) di tests/ppob/ppobPriceSyncService.test.ts.
 * Berkas ini mengunci jalur NYATA: sign HTTP yang benar, bentuk JSON
 * Digiflazz, penerapan ke database sungguhan, dan endpoint admin.
 */

const DIGIFLAZZ_USERNAME = "tapgo_pricesync_user";
const DIGIFLAZZ_API_KEY = "tapgo_pricesync_api_key";

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let appServer: Server | undefined;
let stubServer: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let seq = 0;

/** Baris daftar harga "prepaid" yang dijawab stub — bisa diubah per test. */
let prepaidRows: Array<{ buyer_sku_code: string; price: number; buyer_product_status?: boolean }> = [];
let pascaAvailable = false;

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    apiRateLimiter.resetKey(key);
    paymentRateLimiter.resetKey(key);
    adminRateLimiter.resetKey(key);
  }
}

describe.skipIf(!runIntegration)("Stage R2.12 — sinkronisasi harga PPOB (Digiflazz nyata)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    stubServer = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/price-list") {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk.toString()));
      req.on("end", () => {
        const parsed = JSON.parse(body) as { cmd?: string; username?: string; sign?: string };
        const expectedSign = createHash("md5")
          .update(`${DIGIFLAZZ_USERNAME}${DIGIFLAZZ_API_KEY}pricelist`)
          .digest("hex");
        if (parsed.sign !== expectedSign || parsed.username !== DIGIFLAZZ_USERNAME) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: { rc: "01", message: "Signature Anda salah" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        if (parsed.cmd === "prepaid") {
          res.end(JSON.stringify({ data: prepaidRows }));
        } else if (parsed.cmd === "pasca" && pascaAvailable) {
          res.end(JSON.stringify({ data: [] }));
        } else {
          res.end(JSON.stringify({ data: { rc: "01", message: "Cmd tidak dikenal untuk akun ini" } }));
        }
      });
    });
    await new Promise<void>((resolve) => stubServer!.listen(0, "127.0.0.1", resolve));
    const stubAddress = stubServer.address() as AddressInfo;

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "pricesync-access-secret-0000000000000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "pricesync-refresh-secret-000000000000000";

    const { env } = await import("../../src/config/env.js");
    Object.assign(env, {
      PPOB_PROVIDER: "digiflazz",
      DIGIFLAZZ_USERNAME,
      DIGIFLAZZ_API_KEY,
      DIGIFLAZZ_BASE_URL: `http://127.0.0.1:${stubAddress.port}/v1`,
      DIGIFLAZZ_TESTING: true
    });

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;

    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    resetRateLimits();
    pascaAvailable = false;
    // Baris PpobTransaction lebih dulu (RESTRICT FK) — mungkin ada sisa dari
    // berkas test lain yang berbagi database yang sama.
    await prisma.ppobTransaction.deleteMany();
    await prisma.ppobProduct.deleteMany();
  });

  afterAll(async () => {
    const { env } = await import("../../src/config/env.js");
    Object.assign(env, {
      PPOB_PROVIDER: "disabled",
      DIGIFLAZZ_USERNAME: undefined,
      DIGIFLAZZ_API_KEY: undefined,
      DIGIFLAZZ_BASE_URL: undefined
    });
    await prisma.ppobTransaction.deleteMany();
    await prisma.ppobProduct.deleteMany();
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      if (!stubServer) return resolve();
      stubServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  // --- fetchPriceList langsung ke stub (sign, cmd, toleransi pasca) --------

  it("fetchPriceList: sign benar, hanya baris harga>0 dengan buyer_sku_code yang dibawa", async () => {
    prepaidRows = [
      { buyer_sku_code: "s5", price: 5405, buyer_product_status: true },
      { buyer_sku_code: "zero", price: 0 }, // dibuang: harga 0
      { price: 999 } as unknown as { buyer_sku_code: string; price: number } // dibuang: tanpa kode
    ];
    const { DigiflazzPpobProvider } = await import(
      "../../src/modules/ppob/infrastructure/DigiflazzPpobProvider.js"
    );
    const provider = DigiflazzPpobProvider.fromEnv();
    const rows = await provider.fetchPriceList!();
    expect(rows).toEqual([{ providerSku: "s5", cost: 5405, buyerProductStatus: true }]);
  });

  it("fetchPriceList: pascabayar belum tersedia untuk akun ini TIDAK menggagalkan pengambilan prepaid", async () => {
    prepaidRows = [{ buyer_sku_code: "pln100", price: 101_095, buyer_product_status: true }];
    pascaAvailable = false; // stub menjawab rc error untuk cmd=pasca
    const { DigiflazzPpobProvider } = await import(
      "../../src/modules/ppob/infrastructure/DigiflazzPpobProvider.js"
    );
    const provider = DigiflazzPpobProvider.fromEnv();
    const rows = await provider.fetchPriceList!();
    expect(rows).toEqual([{ providerSku: "pln100", cost: 101_095, buyerProductStatus: true }]);
  });

  it("sign salah (kredensial berbeda) membuat seluruh pengambilan gagal (dilempar, bukan diam-diam kosong)", async () => {
    const { DigiflazzPpobProvider } = await import(
      "../../src/modules/ppob/infrastructure/DigiflazzPpobProvider.js"
    );
    const provider = new (DigiflazzPpobProvider as unknown as new (config: {
      username: string;
      apiKey: string;
      baseUrl: string;
      testing: boolean;
    }) => InstanceType<typeof DigiflazzPpobProvider>)({
      username: DIGIFLAZZ_USERNAME,
      apiKey: "kunci-salah",
      baseUrl: `${(await import("../../src/config/env.js")).env.DIGIFLAZZ_BASE_URL}`,
      testing: true
    });
    await expect(provider.fetchPriceList!()).rejects.toThrow();
  });

  // --- Siklus penuh terhadap database sungguhan ----------------------------

  it("siklus penuh: harga produk kode-tunggal naik mengikuti modal Digiflazz, tersimpan di DB", async () => {
    await prisma.ppobProduct.create({
      data: {
        sku: "PLN_100K_SYNC",
        category: "PLN_PREPAID",
        brand: "PLN",
        name: "Token PLN 100.000",
        price: new Prisma.Decimal("101500"),
        providerSku: "pln100"
      }
    });
    prepaidRows = [{ buyer_sku_code: "pln100", price: 101_600, buyer_product_status: true }];

    const [{ PpobPriceSyncService }, { PrismaPpobRepository }, { DigiflazzPpobProvider }] =
      await Promise.all([
        import("../../src/modules/ppob/application/PpobPriceSyncService.js"),
        import("../../src/modules/ppob/infrastructure/PrismaPpobRepository.js"),
        import("../../src/modules/ppob/infrastructure/DigiflazzPpobProvider.js")
      ]);
    const service = new PpobPriceSyncService(new PrismaPpobRepository(prisma), DigiflazzPpobProvider.fromEnv());
    const result = await service.runSyncCycle({ lockKey: 900001 });

    expect(result).toMatchObject({ skipped: false, considered: 1, updated: 1, errors: 0 });
    const stored = await prisma.ppobProduct.findUniqueOrThrow({ where: { sku: "PLN_100K_SYNC" } });
    expect(stored.price.toFixed(2)).toBe("102500.00"); // 101600 + 900 (dibulatkan ke Rp500)
    expect(stored.priceSyncedAt).not.toBeNull();
  });

  it("siklus penuh: produk multi-operator kehilangan satu operator dari daftar harga -> dikeluarkan dari providerSkus", async () => {
    await prisma.ppobProduct.create({
      data: {
        sku: "PULSA_5K_SYNC",
        category: "PULSA",
        brand: "Multi-operator",
        name: "Pulsa 5.000",
        price: new Prisma.Decimal("6500"),
        providerSkus: { telkomsel: "s5-sync", axis: "ax5-sync", tri: "t5-sync", xl: "x5-sync" }
      }
    });
    // axis TIDAK muncul lagi di daftar harga (mis. Digiflazz menghentikannya).
    // Sisa tiga: telkomsel jauh lebih murah dari tri/xl (pola nyata Digiflazz
    // sesi ini) — band memilih tri+xl dan mengeluarkan telkomsel sendiri,
    // persis kasus yang sudah dikunci di tests/finance/ppobPricing.test.ts.
    prepaidRows = [
      { buyer_sku_code: "s5-sync", price: 5405, buyer_product_status: true },
      { buyer_sku_code: "t5-sync", price: 5820, buyer_product_status: true },
      { buyer_sku_code: "x5-sync", price: 5862, buyer_product_status: true }
    ];

    const [{ PpobPriceSyncService }, { PrismaPpobRepository }, { DigiflazzPpobProvider }] =
      await Promise.all([
        import("../../src/modules/ppob/application/PpobPriceSyncService.js"),
        import("../../src/modules/ppob/infrastructure/PrismaPpobRepository.js"),
        import("../../src/modules/ppob/infrastructure/DigiflazzPpobProvider.js")
      ]);
    const service = new PpobPriceSyncService(new PrismaPpobRepository(prisma), DigiflazzPpobProvider.fromEnv());
    await service.runSyncCycle({ lockKey: 900002 });

    const stored = await prisma.ppobProduct.findUniqueOrThrow({ where: { sku: "PULSA_5K_SYNC" } });
    expect(stored.providerSkus).toEqual({ tri: "t5-sync", xl: "x5-sync" });
    expect(stored.price.toFixed(2)).toBe("6500.00");
  });

  it("produk tanpa providerSku/providerSkus (mis. BPJS belum aktif) tidak pernah disentuh siklus", async () => {
    await prisma.ppobProduct.create({
      data: {
        sku: "BPJS_UNMANAGED",
        category: "BPJS",
        brand: "BPJS Kesehatan",
        name: "Iuran BPJS",
        price: new Prisma.Decimal("42000"),
        isActive: false
      }
    });
    prepaidRows = [];
    const [{ PpobPriceSyncService }, { PrismaPpobRepository }, { DigiflazzPpobProvider }] =
      await Promise.all([
        import("../../src/modules/ppob/application/PpobPriceSyncService.js"),
        import("../../src/modules/ppob/infrastructure/PrismaPpobRepository.js"),
        import("../../src/modules/ppob/infrastructure/DigiflazzPpobProvider.js")
      ]);
    const service = new PpobPriceSyncService(new PrismaPpobRepository(prisma), DigiflazzPpobProvider.fromEnv());
    const result = await service.runSyncCycle({ lockKey: 900003 });
    expect(result.considered).toBe(0);
    const stored = await prisma.ppobProduct.findUniqueOrThrow({ where: { sku: "BPJS_UNMANAGED" } });
    expect(stored.price.toFixed(2)).toBe("42000.00");
    expect(stored.priceSyncedAt).toBeNull();
  });

  // --- Endpoint admin -------------------------------------------------------

  it("POST /admin/ppob/sync-prices: ADMIN dan SUPER_ADMIN ditolak, hanya SUPER_ADMIN_VIP", async () => {
    for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
      const user = await createUser(role);
      const res = await api("/api/v1/admin/ppob/sync-prices", "POST", tokenFor(user));
      expect(res.status, role).toBe(403);
    }
  });

  it("POST /admin/ppob/sync-prices: SUPER_ADMIN_VIP memicu siklus nyata dan mengembalikan ringkasannya", async () => {
    await prisma.ppobProduct.create({
      data: {
        sku: "PLN_100K_ADMIN",
        category: "PLN_PREPAID",
        brand: "PLN",
        name: "Token PLN 100.000",
        price: new Prisma.Decimal("101500"),
        providerSku: "pln100-admin"
      }
    });
    prepaidRows = [{ buyer_sku_code: "pln100-admin", price: 101_600, buyer_product_status: true }];

    const vip = await createUser("SUPER_ADMIN_VIP");
    const res = await api("/api/v1/admin/ppob/sync-prices", "POST", tokenFor(vip));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { considered: number; updated: number } };
    expect(body.data.considered).toBe(1);
    expect(body.data.updated).toBe(1);
    const stored = await prisma.ppobProduct.findUniqueOrThrow({ where: { sku: "PLN_100K_ADMIN" } });
    expect(stored.price.toFixed(2)).toBe("102500.00");
  });

  it("POST /admin/ppob/sync-prices: PPOB_PROVIDER bukan digiflazz -> 503, bukan 500", async () => {
    const { env } = await import("../../src/config/env.js");
    const previous = env.PPOB_PROVIDER;
    Object.assign(env, { PPOB_PROVIDER: "stub" });
    try {
      const vip = await createUser("SUPER_ADMIN_VIP");
      const res = await api("/api/v1/admin/ppob/sync-prices", "POST", tokenFor(vip));
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code?: string }).code).toBe("PPOB_PRICE_SYNC_UNAVAILABLE");
    } finally {
      Object.assign(env, { PPOB_PROVIDER: previous });
    }
  });
});

// --- Helpers -------------------------------------------------------------------

function api(path: string, method: string, token: string) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` }
  });
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` });
}

async function createUser(role: UserRole) {
  seq += 1;
  return prisma.user.create({
    data: {
      fullName: `PriceSync ${role} ${seq}`,
      phone: `+6287${String(seq).padStart(9, "0")}`,
      referralCode: `PSY${String(seq).padStart(7, "0")}`,
      role
    }
  });
}
