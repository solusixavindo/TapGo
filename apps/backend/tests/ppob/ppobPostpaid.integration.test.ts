import { Prisma, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { apiRateLimiter, paymentRateLimiter } from "../../src/core/security/rateLimit.js";

/**
 * PPOB pascabayar (BPJS, PDAM) dengan adapter stub: cek tagihan lalu bayar.
 * Angka stub: tagihan 100.000, admin 2.500, biaya kita (selling_price) 101.350,
 * biaya layanan TapGo 1.000 -> total pelanggan 102.350.
 * Nomor sentinel: ...0000 tanpa tagihan, ...9999 bayar gagal, ...7777 bayar pending.
 */
const BPJS_OK = "1234567890123";
const BPJS_NO_BILL = "1234567890000";
const BPJS_PAY_FAIL = "1234567899999";
const BPJS_PAY_PENDING = "1234567897777";
const TOTAL = 102350;

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    apiRateLimiter.resetKey(key);
    paymentRateLimiter.resetKey(key);
  }
}

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;
let appServer: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

describe.skipIf(!runIntegration)("PPOB pascabayar — cek tagihan lalu bayar", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "ppob-postpaid-access-secret-00000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "ppob-postpaid-refresh-secret-0000000";
    process.env.PPOB_PROVIDER = "stub";
    process.env.PPOB_POSTPAID_SERVICE_FEE = "1000";

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
    await clean();
    await seed();
  });

  afterAll(async () => {
    await clean();
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  async function inquire(user: { id: string; role: UserRole }, sku: string, targetNumber: string) {
    return api("/api/v1/ppob/bills/inquiry", { method: "POST", token: tokenFor(user), body: { sku, targetNumber } });
  }
  async function pay(user: { id: string; role: UserRole }, reference: string, key: string, extra: Record<string, unknown> = {}) {
    return api("/api/v1/ppob/bills/pay", {
      method: "POST", token: tokenFor(user), idempotencyKey: key, body: { reference, ...extra }
    });
  }
  async function ppobBalance(userId: string) {
    return (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).ppobBalance.toFixed(2);
  }
  async function inquiryRef(user: { id: string; role: UserRole }, sku: string, target: string) {
    const res = await inquire(user, sku, target);
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { reference: string } }).data.reference;
  }

  it("daftar produk pascabayar: dapat dicari, hanya aktif; katalog prabayar tidak memuatnya", async () => {
    const user = await userWithBalance("500000");
    const pdam = (await (await api("/api/v1/ppob/bills/products?category=PDAM&q=stub", { token: tokenFor(user) })).json()) as { data: { items: any[] } };
    expect(pdam.data.items.map((i) => i.sku)).toEqual(["PSC_PDAMSTUB0001"]);
    expect(pdam.data.items[0]).not.toHaveProperty("providerSku");
    expect(pdam.data.items[0]).not.toHaveProperty("id");
    const bpjs = (await (await api("/api/v1/ppob/bills/products?category=BPJS", { token: tokenFor(user) })).json()) as { data: { items: any[] } };
    expect(bpjs.data.items.map((i) => i.sku)).toEqual(["PSC_BPJS00000001"]);
    expect((await api("/api/v1/ppob/bills/products?category=PULSA", { token: tokenFor(user) })).status).toBe(400);
    expect((await api("/api/v1/ppob/bills/products?category=BPJS")).status).toBe(401);

    const prepaid = (await (await api("/api/v1/ppob/products", { token: tokenFor(user) })).json()) as { data: any[] };
    expect(prepaid.data.map((p) => p.sku)).toEqual(["PULSA_TSEL_10"]);
    const catalog = (await (await api("/api/v1/ppob/catalog", { token: tokenFor(user) })).json()) as { data: { items: any[] } };
    expect(JSON.stringify(catalog)).not.toContain("PSC_");
  });

  it("cek tagihan: angka dihitung server (tagihan, biaya admin+layanan, total), tanpa debit dan tanpa transaksi", async () => {
    const user = await userWithBalance("500000");
    const res = await inquire(user, "PSC_BPJS00000001", BPJS_OK);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: any };
    expect(data).toMatchObject({
      customerName: "PELANGGAN STUB",
      period: "202610",
      billAmount: 100000,
      feeAmount: 2350,
      totalAmount: TOTAL,
      sufficient: true,
      wallet: { ppobBalance: 500000 }
    });
    expect(data.reference).toMatch(/^PPB-[A-Z2-9]{10}$/);
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(data.expiresInSeconds).toBeGreaterThan(0);
    expect(data.expiresInSeconds).toBeLessThanOrEqual(600);
    expect(await ppobBalance(user.id)).toBe("500000.00");
    expect(await prisma.ppobTransaction.count()).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(0);
    const stored = await prisma.ppobBillInquiry.findUniqueOrThrow({ where: { publicReference: data.reference } });
    expect(stored.providerCost.toFixed(2)).toBe("101350.00");
    expect(stored.serviceFee.toFixed(2)).toBe("1000.00");
    expect(stored.usedAt).toBeNull();
  });

  it("cek tagihan gagal (tanpa tagihan): 422 dengan pesan aman, tidak ada baris tersimpan; nomor tak valid 400", async () => {
    const user = await userWithBalance("500000");
    const none = await inquire(user, "PSC_BPJS00000001", BPJS_NO_BILL);
    expect(none.status).toBe(422);
    const body = (await none.json()) as { error?: { code?: string; message?: string } ; code?: string; message?: string };
    expect(JSON.stringify(body)).toContain("PPOB_BILL_INQUIRY_FAILED");
    expect(JSON.stringify(body)).toContain("belum tersedia");
    expect(await prisma.ppobBillInquiry.count()).toBe(0);
    expect((await inquire(user, "PSC_BPJS00000001", "123")).status).toBe(400);
    expect((await inquire(user, "PSC_TIDAKADA00001", BPJS_OK)).status).toBe(404);
    expect((await inquire(user, "PSC_INACTIVE0001", BPJS_OK)).status).toBe(404);
    expect((await inquire(user, "PULSA_TSEL_10", "085612345678")).status).toBe(404);
  });

  it("bayar sukses: debit total inquiry sekali, ledger, transaksi memakai referensi inquiry, HPP tercatat, inquiry terpakai", async () => {
    const user = await userWithBalance("500000");
    const ref = await inquiryRef(user, "PSC_BPJS00000001", BPJS_OK);
    // Klien mencoba menyelundupkan nominal: diabaikan, angka server yang berlaku.
    const res = await pay(user, ref, "pay-ok-1", { amount: 1, totalAmount: 1 });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: any };
    expect(data).toMatchObject({ id: ref, status: "SUCCESS", amount: TOTAL, targetNumber: BPJS_OK });
    for (const internal of ["userId", "productId", "provider", "idempotencyKey", "walletTransactionId"]) {
      expect(data).not.toHaveProperty(internal);
    }
    expect(await ppobBalance(user.id)).toBe("397650.00");
    const tx = await prisma.ppobTransaction.findUniqueOrThrow({ where: { publicReference: ref } });
    expect(tx.amount.toFixed(2)).toBe("100000.00");
    expect(tx.adminFee.toFixed(2)).toBe("2350.00");
    expect(tx.totalAmount.toFixed(2)).toBe("102350.00");
    expect(tx.providerCost?.toFixed(2)).toBe("101350.00");
    const ledger = await prisma.walletTransaction.findMany();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe("PPOB_PURCHASE");
    expect(ledger[0]!.amount.toFixed(2)).toBe("-102350.00");
    expect(ledger[0]!.referenceId).toBe(ref);
    expect((await prisma.ppobBillInquiry.findUniqueOrThrow({ where: { publicReference: ref } })).usedAt).not.toBeNull();
  });

  it("tidak bisa dibeli lewat jalur harga tetap: produk pascabayar ditolak 422 tanpa debit", async () => {
    const user = await userWithBalance("500000");
    for (const path of ["/api/v1/ppob/orders", "/api/v1/ppob/transactions"]) {
      const res = await api(path, {
        method: "POST", token: tokenFor(user), idempotencyKey: `fixed-${path}`,
        body: { sku: "PSC_BPJS00000001", targetNumber: BPJS_OK }
      });
      expect(res.status).toBe(422);
      expect(JSON.stringify(await res.json())).toContain("PPOB_USE_BILL_FLOW");
    }
    const inquiryRes = await api("/api/v1/ppob/orders/inquiry", {
      method: "POST", token: tokenFor(user), body: { sku: "PSC_BPJS00000001", targetNumber: BPJS_OK }
    });
    expect(inquiryRes.status).toBe(422);
    expect(await ppobBalance(user.id)).toBe("500000.00");
    expect(await prisma.ppobTransaction.count()).toBe(0);
  });

  it("satu inquiry hanya satu pembayaran: Idempotency-Key sama = replay, key lain = 409, saldo terdebit sekali", async () => {
    const user = await userWithBalance("500000");
    const ref = await inquiryRef(user, "PSC_BPJS00000001", BPJS_OK);
    expect((await pay(user, ref, "k1")).status).toBe(201);
    const replay = await pay(user, ref, "k1");
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { data: any }).data).toMatchObject({ id: ref, replayed: true });
    const second = await pay(user, ref, "k2");
    expect(second.status).toBe(409);
    expect(await ppobBalance(user.id)).toBe("397650.00");
    expect(await prisma.ppobTransaction.count()).toBe(1);
    expect(await prisma.walletTransaction.count()).toBe(1);
    // Key yang sama untuk inquiry lain = konflik, bukan pembelian kedua.
    const other = await inquiryRef(user, "PSC_PDAMSTUB0001", "5121400300");
    expect((await pay(user, other, "k1")).status).toBe(409);
    expect(await ppobBalance(user.id)).toBe("397650.00");
  });

  it("lima pembayaran serentak untuk satu inquiry: tepat satu berhasil, saldo terdebit sekali", async () => {
    const user = await userWithBalance("500000");
    const ref = await inquiryRef(user, "PSC_BPJS00000001", BPJS_OK);
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => pay(user, ref, `race-${i}`)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    // Yang kalah mendapat 409 (bukan 500) dan tidak ada yang lolos dua kali.
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    expect(await ppobBalance(user.id)).toBe("397650.00");
    expect(await prisma.ppobTransaction.count()).toBe(1);
    expect(await prisma.walletTransaction.count()).toBe(1);
  });

  it("inquiry milik orang lain: 404 dan tidak ada debit di akun mana pun", async () => {
    const owner = await userWithBalance("500000");
    const thief = await userWithBalance("500000");
    const ref = await inquiryRef(owner, "PSC_BPJS00000001", BPJS_OK);
    expect((await pay(thief, ref, "steal-1")).status).toBe(404);
    expect(await ppobBalance(owner.id)).toBe("500000.00");
    expect(await ppobBalance(thief.id)).toBe("500000.00");
    expect((await prisma.ppobBillInquiry.findUniqueOrThrow({ where: { publicReference: ref } })).usedAt).toBeNull();
  });

  it("inquiry kedaluwarsa ditolak 409 tanpa debit", async () => {
    const user = await userWithBalance("500000");
    const ref = await inquiryRef(user, "PSC_BPJS00000001", BPJS_OK);
    await prisma.ppobBillInquiry.update({ where: { publicReference: ref }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await pay(user, ref, "late-1");
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("PPOB_BILL_INQUIRY_UNUSABLE");
    expect(await ppobBalance(user.id)).toBe("500000.00");
    expect(await prisma.ppobTransaction.count()).toBe(0);
  });

  it("masa berlaku inquiry tidak melewati tengah malam WIB dan tidak lebih dari 10 menit", async () => {
    const user = await userWithBalance("500000");
    const ref = await inquiryRef(user, "PSC_BPJS00000001", BPJS_OK);
    const stored = await prisma.ppobBillInquiry.findUniqueOrThrow({ where: { publicReference: ref } });
    const ttl = stored.expiresAt.getTime() - stored.createdAt.getTime();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
  });

  it("saldo kurang: 400 INSUFFICIENT_PPOB_BALANCE, inquiry TIDAK terpakai sehingga bisa dibayar setelah isi saldo", async () => {
    const user = await userWithBalance("1000");
    const ref = await inquiryRef(user, "PSC_BPJS00000001", BPJS_OK);
    const res = await pay(user, ref, "poor-1");
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("INSUFFICIENT_PPOB_BALANCE");
    expect(await prisma.ppobTransaction.count()).toBe(0);
    expect((await prisma.ppobBillInquiry.findUniqueOrThrow({ where: { publicReference: ref } })).usedAt).toBeNull();
    await prisma.wallet.update({ where: { userId: user.id }, data: { ppobBalance: new Prisma.Decimal("200000") } });
    expect((await pay(user, ref, "poor-2")).status).toBe(201);
    expect(await ppobBalance(user.id)).toBe("97650.00");
  });

  it("bayar gagal di penyedia: refund penuh tepat sekali, status FAILED", async () => {
    const user = await userWithBalance("500000");
    const ref = await inquiryRef(user, "PSC_BPJS00000001", BPJS_PAY_FAIL);
    const res = await pay(user, ref, "fail-1");
    expect(res.status).toBe(201);
    expect(((await res.json()) as { data: any }).data.status).toBe("FAILED");
    expect(await ppobBalance(user.id)).toBe("500000.00");
    const ledger = await prisma.walletTransaction.findMany({ orderBy: { createdAt: "asc" } });
    expect(ledger.map((l) => l.type)).toEqual(["PPOB_PURCHASE", "PPOB_REFUND"]);
    expect(ledger[1]!.amount.toFixed(2)).toBe("102350.00");
    // Mengulang bayar tidak menggandakan refund maupun debit.
    expect((await pay(user, ref, "fail-1")).status).toBe(200);
    expect(await ppobBalance(user.id)).toBe("500000.00");
    expect(await prisma.walletTransaction.count()).toBe(2);
  });

  it("bayar pending di penyedia: saldo tetap terkunci (PROCESSING), tanpa refund dini", async () => {
    const user = await userWithBalance("500000");
    const ref = await inquiryRef(user, "PSC_BPJS00000001", BPJS_PAY_PENDING);
    const res = await pay(user, ref, "pending-1");
    expect(res.status).toBe(201);
    expect(((await res.json()) as { data: any }).data.status).toBe("PROCESSING");
    expect(await ppobBalance(user.id)).toBe("397650.00");
    expect(await prisma.walletTransaction.count()).toBe(1);
  });

  it("wajib Idempotency-Key dan referensi berbentuk sah", async () => {
    const user = await userWithBalance("500000");
    const ref = await inquiryRef(user, "PSC_BPJS00000001", BPJS_OK);
    const noKey = await api("/api/v1/ppob/bills/pay", { method: "POST", token: tokenFor(user), body: { reference: ref } });
    expect(noKey.status).toBe(400);
    expect((await pay(user, "PPB-bukan", "k")).status).toBe(400);
    expect((await pay(user, "PPB-A2B3C4D5E6", "k-unknown")).status).toBe(404);
    expect(await ppobBalance(user.id)).toBe("500000.00");
  });

  it("kategori pascabayar lain (HP pascabayar, multifinance) memakai alur dan aturan yang sama", async () => {
    const user = await userWithBalance("500000");
    for (const category of ["HP_POSTPAID", "MULTIFINANCE", "TELKOM", "INTERNET", "TV", "PBB", "GAS", "EMONEY", "BPJS_TK", "PLN_POSTPAID"]) {
      expect((await api(`/api/v1/ppob/bills/products?category=${category}`, { token: tokenFor(user) })).status).toBe(200);
    }
    const hp = await inquiryRef(user, "PSC_HPPASCA00001", "+6281234567890");
    expect((await pay(user, hp, "hp-1")).status).toBe(201);
    const mf = await inquiryRef(user, "PSC_MULTIFIN0001", "5171-712/AB345");
    expect((await pay(user, mf, "mf-1")).status).toBe(201);
    expect(await ppobBalance(user.id)).toBe("295300.00");
    expect((await prisma.ppobTransaction.findUniqueOrThrow({ where: { publicReference: hp } })).targetNumber).toBe("081234567890");
    // Nomor HP pascabayar harus nomor seluler; kontrak multifinance tidak boleh memuat markup.
    expect((await inquire(user, "PSC_HPPASCA00001", "12345")).status).toBe(400);
    expect((await inquire(user, "PSC_MULTIFIN0001", "<b>x</b>")).status).toBe(400);
  });

  it("PDAM: alur yang sama dengan nomor pelanggan 6-20 digit", async () => {
    const user = await userWithBalance("500000");
    const ref = await inquiryRef(user, "PSC_PDAMSTUB0001", "5121400300");
    expect((await pay(user, ref, "pdam-1")).status).toBe(201);
    expect(await ppobBalance(user.id)).toBe("397650.00");
    expect((await inquire(user, "PSC_PDAMSTUB0001", "12")).status).toBe(400);
  });
});

async function clean() {
  await prisma.ppobBillInquiry.deleteMany();
  await prisma.ppobTransaction.deleteMany();
  await prisma.ppobProduct.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
}

async function seed() {
  const rows = [
    { sku: "PULSA_TSEL_10", category: "PULSA" as const, brand: "Telkomsel", name: "Pulsa Telkomsel 10.000", price: "11500", isPostpaid: false, providerSku: null, isActive: true },
    { sku: "PSC_BPJS00000001", category: "BPJS" as const, brand: "BPJS KESEHATAN", name: "BPJS KESEHATAN", price: "0", isPostpaid: true, providerSku: "bpjs", isActive: true },
    { sku: "PSC_PDAMSTUB0001", category: "PDAM" as const, brand: "PDAM", name: "PDAM STUB KOTA", price: "0", isPostpaid: true, providerSku: "pdamstubkota", isActive: true },
    { sku: "PSC_HPPASCA00001", category: "HP_POSTPAID" as const, brand: "HP PASCABAYAR", name: "HALO", price: "0", isPostpaid: true, providerSku: "halo", isActive: true },
    { sku: "PSC_MULTIFIN0001", category: "MULTIFINANCE" as const, brand: "MULTIFINANCE", name: "BAF", price: "0", isPostpaid: true, providerSku: "baf", isActive: true },
    { sku: "PSC_INACTIVE0001", category: "BPJS" as const, brand: "BPJS KESEHATAN", name: "Nonaktif", price: "0", isPostpaid: true, providerSku: "bpjs2", isActive: false }
  ];
  for (const row of rows) {
    await prisma.ppobProduct.create({
      data: {
        sku: row.sku, category: row.category, brand: row.brand, name: row.name,
        price: new Prisma.Decimal(row.price), adminFee: new Prisma.Decimal("0"),
        isPostpaid: row.isPostpaid, providerSku: row.providerSku, isActive: row.isActive
      }
    });
  }
}

async function userWithBalance(amount: string) {
  sequence += 1;
  const user = await prisma.user.create({
    data: {
      fullName: `Bill User ${sequence}`,
      phone: `+6286${String(sequence).padStart(9, "0")}`,
      referralCode: `BILL${String(sequence).padStart(6, "0")}`,
      role: "USER"
    }
  });
  await prisma.wallet.create({
    data: {
      userId: user.id, balance: new Prisma.Decimal(0), cashBalance: new Prisma.Decimal(0),
      ppobBalance: new Prisma.Decimal(amount), currency: "IDR"
    }
  });
  return user;
}

async function api(
  path: string,
  options: { method?: string; token?: string; body?: unknown; idempotencyKey?: string } = {}
) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` });
}
