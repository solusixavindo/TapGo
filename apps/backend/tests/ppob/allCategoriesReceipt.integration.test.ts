import { Prisma, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { apiRateLimiter, paymentRateLimiter } from "../../src/core/security/rateLimit.js";

/**
 * Semua produk kategori Digital (prabayar) dan Tagihan (pascabayar) sampai BUKTI TRANSAKSI,
 * melawan provider Digiflazz NYATA (kode adaptor produksi) yang dijawab stub berformat
 * dokumentasi resmi (periode di `periode` dan `desc.detail[]`, `sn` pada semua pembayaran).
 *
 * Dibuat setelah kasus token PLN Juhri (9 Okt 2026): memastikan tiap kategori mengembalikan
 * nomor token/referensi, dan tiap tagihan membawa nama pelanggan, periode, dan rincian angka
 * pada bukti pembayarannya (cek tagihan -> bayar -> detail -> riwayat).
 */

const USERNAME = "tapgo_test_user";
const API_KEY = "tapgo_test_api_key";

type Row = {
  category: string;
  sku: string;
  providerSku: string;
  brand: string;
  name: string;
  target: string; // contoh nomor tujuan yang masuk akal untuk kategori itu
  sn: string; // nomor serial/token yang dijawab provider
};

const PREPAID: Row[] = [
  { category: "PULSA", sku: "PULSA_TSEL_10", providerSku: "tsel10", brand: "Telkomsel", name: "Pulsa Telkomsel 10.000", target: "081355503217", sn: "0123456789012345" },
  { category: "DATA", sku: "DATA_TSEL_5GB", providerSku: "tseldata5", brand: "Telkomsel", name: "Paket Data 5GB", target: "081355503217", sn: "DATA-5GB-7788" },
  { category: "PLN_PREPAID", sku: "PLN_TOKEN_20", providerSku: "pln20", brand: "PLN", name: "Token PLN 20.000", target: "561100520563", sn: "1061-9332-9912-1453-6226/SAAMAH/R1/450/46,8KWH" },
  { category: "EWALLET", sku: "DANA_20", providerSku: "dana20", brand: "DANA", name: "DANA 20.000", target: "083803888668", sn: "DANA-REF-20261009-001" }
];

const POSTPAID: Row[] = [
  { category: "BPJS", sku: "PSC_BPJS_KES", providerSku: "bpjs", brand: "BPJS KESEHATAN", name: "BPJS Kesehatan", target: "8801234560001", sn: "BPJS-0001234567" },
  { category: "BPJS", sku: "PSC_BPJS_VA16", providerSku: "bpjsva", brand: "BPJS KESEHATAN", name: "BPJS Kesehatan (VA)", target: "8888801234560001", sn: "BPJS-VA-0001234567" },
  { category: "PDAM", sku: "PSC_PDAM_LEBAK", providerSku: "pdamlebak", brand: "PDAM", name: "PDAM Tirta Multatuli Kabupaten Lebak", target: "1013226", sn: "PDAM-2026-10-7788" },
  { category: "PLN_POSTPAID", sku: "PSC_PLN_PASCA", providerSku: "plnpasca", brand: "PLN PASCABAYAR", name: "PLN Pascabayar", target: "530000000003", sn: "PLNPASCA/ABCD1234EFGH5678" },
  { category: "BPJS_TK", sku: "PSC_BPJS_TK", providerSku: "bpjstk", brand: "BPJS KETENAGAKERJAAN", name: "BPJS Ketenagakerjaan Penerima Upah", target: "12345678901", sn: "BPJSTK-2026-5521" },
  { category: "TELKOM", sku: "PSC_TELKOM", providerSku: "telkom", brand: "TELKOM", name: "Telkom", target: "02112345678", sn: "TELKOM-REF-9911" },
  { category: "INTERNET", sku: "PSC_INTERNET", providerSku: "indihome", brand: "INTERNET PASCABAYAR", name: "IndiHome", target: "121234567890", sn: "INDIHOME-REF-4412" },
  { category: "TV", sku: "PSC_TV", providerSku: "tvkabel", brand: "TV PASCABAYAR", name: "TV Kabel", target: "1234567890", sn: "TV-REF-3301" },
  { category: "HP_POSTPAID", sku: "PSC_HP_PASCA", providerSku: "halo", brand: "HP PASCABAYAR", name: "HP Pascabayar", target: "081355503217", sn: "HALO-REF-7720" },
  { category: "MULTIFINANCE", sku: "PSC_ANGSURAN", providerSku: "baf", brand: "MULTIFINANCE", name: "Angsuran BAF", target: "A123/456-789", sn: "BAF-REF-5566" },
  { category: "PBB", sku: "PSC_PBB", providerSku: "pbbkab", brand: "PBB", name: "PBB Kabupaten", target: "329801092375999991", sn: "PBB-NTPN-8800" },
  { category: "GAS", sku: "PSC_GAS", providerSku: "pgn", brand: "GAS NEGARA", name: "PGN Gas", target: "0123456789", sn: "PGN-REF-1200" },
  { category: "EMONEY", sku: "PSC_EMONEY", providerSku: "emoney", brand: "E-MONEY", name: "E-Money", target: "082100000001", sn: "EMONEY-REF-3030" }
];

const ALL = [...PREPAID, ...POSTPAID];
const bySku = new Map(ALL.map((row) => [row.providerSku, row]));

let appServer: Server | undefined;
let stub: Server | undefined;
let baseUrl = "";
let signAccessToken: (p: { sub: string; role: UserRole; sessionId: string }) => string;
let sequence = 0;

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    apiRateLimiter.resetKey(key);
    paymentRateLimiter.resetKey(key);
  }
}

describe.skipIf(!runIntegration)("Semua kategori Digital dan Tagihan sampai bukti transaksi", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    stub = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}") as Record<string, string>;
        const row = bySku.get(body.buyer_sku_code ?? "");
        res.writeHead(200, { "content-type": "application/json" });
        if (!row) {
          res.end(JSON.stringify({ data: { status: "Gagal", rc: "40", message: "SKU tidak dikenal" } }));
          return;
        }
        const base = { ref_id: body.ref_id, customer_no: body.customer_no, buyer_sku_code: body.buyer_sku_code, buyer_last_saldo: 999000 };
        if (body.commands === "inq-pasca") {
          res.end(JSON.stringify({ data: {
            ...base, customer_name: "BUDI SANTOSO", admin: 2500, message: "Transaksi Sukses", status: "Sukses", rc: "00",
            periode: "202610", price: 102500, selling_price: 101350,
            desc: { lembar_tagihan: 1, alamat: "JL. MERDEKA 1", detail: [{ periode: "202610", nilai_tagihan: "100000", denda: "0" }] }
          } }));
          return;
        }
        if (body.commands === "pay-pasca") {
          res.end(JSON.stringify({ data: {
            ...base, customer_name: "BUDI SANTOSO", admin: 2500, message: "Transaksi Sukses", status: "Sukses", rc: "00",
            sn: row.sn, periode: "202610", price: 102500, selling_price: 101350, desc: { lembar_tagihan: 1 }
          } }));
          return;
        }
        res.end(JSON.stringify({ data: { ...base, message: "Transaksi Sukses", status: "Sukses", rc: "00", sn: row.sn, price: 20500 } }));
      });
    });
    await new Promise<void>((resolve) => stub!.listen(0, "127.0.0.1", resolve));
    const port = (stub.address() as AddressInfo).port;

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "ppob-allcat-access-secret-0000000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "ppob-allcat-refresh-secret-000000000";
    process.env.PPOB_PROVIDER = "digiflazz";
    process.env.DIGIFLAZZ_USERNAME = USERNAME;
    process.env.DIGIFLAZZ_API_KEY = API_KEY;
    process.env.DIGIFLAZZ_BASE_URL = `http://127.0.0.1:${port}/v1`;
    const { env } = await import("../../src/config/env.js");
    Object.assign(env, {
      PPOB_PROVIDER: "digiflazz",
      DIGIFLAZZ_USERNAME: USERNAME,
      DIGIFLAZZ_API_KEY: API_KEY,
      DIGIFLAZZ_BASE_URL: `http://127.0.0.1:${port}/v1`,
      DIGIFLAZZ_TESTING: false,
      PPOB_POSTPAID_SERVICE_FEE: 1000
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

  afterAll(async () => {
    const { env } = await import("../../src/config/env.js");
    Object.assign(env, {
      PPOB_PROVIDER: "disabled",
      DIGIFLAZZ_USERNAME: undefined,
      DIGIFLAZZ_API_KEY: undefined,
      DIGIFLAZZ_BASE_URL: undefined
    });
    for (const server of [appServer, stub]) {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    }
  });

  beforeEach(async () => {
    resetRateLimits();
    await cleanDatabase();
    for (const row of PREPAID) {
      await prisma.ppobProduct.create({
        data: { sku: row.sku, category: row.category as any, brand: row.brand, name: row.name, price: new Prisma.Decimal("20500"), providerSku: row.providerSku }
      });
    }
    for (const row of POSTPAID) {
      await prisma.ppobProduct.create({
        data: { sku: row.sku, category: row.category as any, brand: row.brand, name: row.name, price: new Prisma.Decimal(0), adminFee: new Prisma.Decimal(2500), providerSku: row.providerSku, isPostpaid: true }
      });
    }
  });

  async function user() {
    sequence += 1;
    const created = await prisma.user.create({
      data: { fullName: `Uji Kategori ${sequence}`, phone: `0813555${String(10000 + sequence)}`, referralCode: `ALC${String(sequence).padStart(6, "0")}`, role: "USER" }
    });
    await prisma.wallet.create({
      data: { userId: created.id, balance: new Prisma.Decimal(0), cashBalance: new Prisma.Decimal(0), ppobBalance: new Prisma.Decimal(1000000), currency: "IDR" }
    });
    return created;
  }

  async function call(path: string, token: string, init: { method?: string; body?: unknown; key?: string } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.key ? { "idempotency-key": init.key } : {})
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {})
    });
    return { status: response.status, json: (await response.json()) as any };
  }

  for (const row of PREPAID) {
    it(`Digital · ${row.category} (${row.name}): beli -> SUCCESS dengan nomor ${row.category === "PLN_PREPAID" ? "token" : "referensi"}, tercatat di detail dan riwayat`, async () => {
      const u = await user();
      const token = signAccessToken({ sub: u.id, role: "USER", sessionId: `s-${u.id}` });
      const bought = await call("/api/v1/ppob/orders", token, { method: "POST", key: `k-${row.sku}`, body: { sku: row.sku, targetNumber: row.target } });
      expect(bought.status).toBe(201);
      expect(bought.json.data.status).toBe("SUCCESS");
      expect(bought.json.data.serialNumber).toBe(row.sn.slice(0, 120));
      expect(bought.json.data.bill).toBeNull();
      expect(bought.json.data.id).toMatch(/^PPB-/);
      expect(bought.json.data.completedAt).toBeTruthy();

      const detail = await call(`/api/v1/ppob/orders/${bought.json.data.id}`, token);
      expect(detail.json.data.serialNumber).toBe(row.sn.slice(0, 120));
      const history = await call("/api/v1/ppob/orders", token);
      const entry = history.json.data.items.find((o: any) => o.id === bought.json.data.id);
      expect(entry.serialNumber).toBe(row.sn.slice(0, 120));
    });
  }

  for (const row of POSTPAID) {
    it(`Tagihan · ${row.category} (${row.name}, ${row.target.length} karakter): cek tagihan -> bayar -> bukti berisi nama, periode, rincian, dan nomor referensi`, async () => {
      const u = await user();
      const token = signAccessToken({ sub: u.id, role: "USER", sessionId: `s-${u.id}` });
      const inquiry = await call("/api/v1/ppob/bills/inquiry", token, { method: "POST", body: { sku: row.sku, targetNumber: row.target } });
      expect(inquiry.status, JSON.stringify(inquiry.json)).toBe(200);
      expect(inquiry.json.data).toMatchObject({ customerName: "BUDI SANTOSO", period: "202610", billAmount: 100000, totalAmount: 102350 });

      const paid = await call("/api/v1/ppob/bills/pay", token, { method: "POST", key: `pay-${row.sku}`, body: { reference: inquiry.json.data.reference } });
      expect(paid.status, JSON.stringify(paid.json)).toBe(201);
      const order = paid.json.data;
      expect(order.status).toBe("SUCCESS");
      expect(order.serialNumber).toBe(row.sn);
      expect(order.id).toBe(inquiry.json.data.reference);
      expect(order.bill).toEqual({ customerName: "BUDI SANTOSO", period: "202610", billAmount: 100000, feeAmount: 2350, totalAmount: 102350 });
      expect(order.completedAt).toBeTruthy();

      const detail = await call(`/api/v1/ppob/orders/${order.id}`, token);
      expect(detail.json.data.bill.customerName).toBe("BUDI SANTOSO");
      expect(detail.json.data.serialNumber).toBe(row.sn);
      const history = await call("/api/v1/ppob/orders", token);
      const entry = history.json.data.items.find((o: any) => o.id === order.id);
      expect(entry.bill.period).toBe("202610");
      expect(entry.serialNumber).toBe(row.sn);
    });
  }

  it("bukti tagihan hanya terlihat oleh pemiliknya (pengguna lain tidak melihat nama pelanggan)", async () => {
    const owner = await user();
    const stranger = await user();
    const ownerToken = signAccessToken({ sub: owner.id, role: "USER", sessionId: `s-${owner.id}` });
    const strangerToken = signAccessToken({ sub: stranger.id, role: "USER", sessionId: `s-${stranger.id}` });
    const inquiry = await call("/api/v1/ppob/bills/inquiry", ownerToken, { method: "POST", body: { sku: "PSC_BPJS_KES", targetNumber: "8801234560001" } });
    const paid = await call("/api/v1/ppob/bills/pay", ownerToken, { method: "POST", key: "pay-owner", body: { reference: inquiry.json.data.reference } });
    expect(paid.status).toBe(201);
    expect((await call(`/api/v1/ppob/orders/${paid.json.data.id}`, strangerToken)).status).toBe(404);
    const strangerHistory = await call("/api/v1/ppob/orders", strangerToken);
    expect(JSON.stringify(strangerHistory.json)).not.toContain("BUDI SANTOSO");
  });

  it("nomor tujuan yang jelas salah ditolak sebelum uang bergerak (BPJS terlalu pendek/panjang, PBB pendek)", async () => {
    const u = await user();
    const token = signAccessToken({ sub: u.id, role: "USER", sessionId: `s-${u.id}` });
    for (const [sku, target] of [["PSC_BPJS_KES", "12345"], ["PSC_BPJS_KES", "12345678901234567"], ["PSC_PBB", "12345"]]) {
      const res = await call("/api/v1/ppob/bills/inquiry", token, { method: "POST", body: { sku, targetNumber: target } });
      expect(res.status).toBe(400);
    }
    expect(await prisma.ppobBillInquiry.count()).toBe(0);
  });
});
