import { PpobCategory, PpobTransaction, Prisma } from "@prisma/client";
import { Request, Router } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma.js";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { paymentRateLimiter } from "../../../core/security/rateLimit.js";
import { PpobService } from "../application/PpobService.js";
import { PpobProviderGateway } from "../domain/ppobProvider.js";
import { PrismaPpobRepository } from "../infrastructure/PrismaPpobRepository.js";
import { DigiflazzPpobProvider } from "../infrastructure/DigiflazzPpobProvider.js";
import { DisabledPpobProvider } from "../infrastructure/DisabledPpobProvider.js";
import { StubPpobProvider } from "../infrastructure/StubPpobProvider.js";
import { normalizePpobTarget } from "../domain/targetValidation.js";
import {
  ppobBillInquirySchema,
  ppobBillPaySchema,
  ppobBillProductsQuerySchema,
  ppobHistoryQuerySchema,
  ppobProductsQuerySchema,
  ppobPurchaseSchema,
  ppobReferenceSchema
} from "./ppob.validators.js";

/**
 * Pemilihan adapter provider. Fail-closed: nilai selain "stub"/"digiflazz"
 * jatuh ke adapter disabled yang selalu membatalkan pembelian dengan refund
 * penuh — tidak ada konfigurasi salah yang bisa membuat saldo terdebit tanpa
 * pemenuhan. "digiflazz" tanpa kredensial melempar saat modul dimuat (boot
 * gagal cepat dan jelas, bukan kegagalan sunyi pada transaksi pertama).
 */
function resolvePpobProvider(): PpobProviderGateway {
  if (env.PPOB_PROVIDER === "stub") {
    return new StubPpobProvider();
  }
  if (env.PPOB_PROVIDER === "digiflazz") {
    return DigiflazzPpobProvider.fromEnv();
  }
  return new DisabledPpobProvider();
}

/**
 * Service dibuat lazily dan di-cache per nilai PPOB_PROVIDER.
 *
 * Kenapa lazy: env di-parse sekali saat modul dimuat, tetapi suite integration
 * (singleFork) menjalankan beberapa file test dalam satu proses dan tiap file
 * menset PPOB_PROVIDER berbeda ("stub" vs "digiflazz") SEBELUM mengimpor app.
 * Bila service dibuat saat modul dimuat, adapter yang menang adalah milik file
 * test yang lebih dulu mengimpor — race antar test. Dengan resolve per-request
 * (cache di-invalidate saat env berubah), tiap konfigurasi mendapat adapter
 * yang benar, dan produksi (env tidak berubah) tetap memakai satu instance.
 */
let cachedService: { provider: string; service: PpobService } | null = null;
function getService(): PpobService {
  const current = env.PPOB_PROVIDER;
  if (!cachedService || cachedService.provider !== current) {
    cachedService = {
      provider: current,
      service: new PpobService(new PrismaPpobRepository(prisma), resolvePpobProvider(), {
        postpaidServiceFee: env.PPOB_POSTPAID_SERVICE_FEE
      })
    };
  }
  return cachedService.service;
}

/** Rupiah disajikan sebagai number; nilai PPOB jauh di bawah batas aman. */
function money(value: Prisma.Decimal): number {
  return Number(value.toFixed(2));
}

// ---------------------------------------------------------------------------
// Kontrak klien Release 2 (Flutter): /catalog, /orders/inquiry, /orders.
//
// App customer R2 ditulis lebih dulu terhadap kontrak ini; ketidakcocokan
// kontrak inilah yang membuat PPOB 404 di HP Owner (audit 23 Agustus 2026).
// Route di bawah ADALAH kontrak kanonik klien; /products dan /transactions
// dipertahankan sebagai alias kompatibel untuk klien lama.
// ---------------------------------------------------------------------------

/** Label kolom target per kategori, sesuai yang dibaca model Flutter. */
const PPOB_TARGET_LABELS: Record<string, string> = {
  PULSA: "Nomor HP Tujuan",
  DATA: "Nomor HP Tujuan",
  EWALLET: "Nomor HP Dompet Digital",
  PLN_PREPAID: "Nomor Meter PLN",
  PLN_POSTPAID: "ID Pelanggan PLN",
  BPJS: "Nomor VA BPJS",
  PDAM: "ID Pelanggan PDAM",
  BPJS_TK: "Nomor Peserta BPJS Ketenagakerjaan",
  TELKOM: "Nomor Telepon (dengan kode area)",
  INTERNET: "Nomor Pelanggan Internet",
  TV: "Nomor Pelanggan TV",
  HP_POSTPAID: "Nomor HP Pascabayar",
  MULTIFINANCE: "Nomor Kontrak",
  PBB: "NOP (Nomor Objek Pajak)",
  GAS: "Nomor Pelanggan Gas",
  EMONEY: "Nomor E-Money"
};

const PPOB_CATEGORY_NAMES: Record<string, string> = {
  PULSA: "Pulsa",
  DATA: "Paket Data",
  PLN_PREPAID: "Token PLN",
  PLN_POSTPAID: "Tagihan PLN",
  BPJS: "BPJS",
  PDAM: "PDAM",
  BPJS_TK: "BPJS Ketenagakerjaan",
  TELKOM: "Telkom",
  INTERNET: "Internet",
  TV: "TV Kabel",
  HP_POSTPAID: "HP Pascabayar",
  MULTIFINANCE: "Angsuran",
  PBB: "PBB",
  GAS: "Gas",
  EMONEY: "E-Money",
  EWALLET: "E-Wallet"
};

interface CatalogProductRow {
  sku: string;
  category: string;
  brand: string;
  name: string;
  description: string | null;
  price: Prisma.Decimal;
  adminFee: Prisma.Decimal;
  providerSkus?: Prisma.JsonValue | null;
}

function serializeCatalogProduct(product: CatalogProductRow) {
  return {
    sku: product.sku,
    name: product.name,
    description: product.description,
    price: money(product.price),
    adminFee: money(product.adminFee),
    targetLabel: PPOB_TARGET_LABELS[product.category] ?? "Nomor Tujuan",
    brand: product.brand,
    // Pulsa/data: operator yang dapat dilayani (kosong = tidak dibatasi operator).
    supportedOperators:
      product.providerSkus && typeof product.providerSkus === "object" && !Array.isArray(product.providerSkus)
        ? Object.keys(product.providerSkus).sort()
        : []
  };
}

/**
 * Ringkasan daya beli untuk satu SKU tanpa membuat transaksi apa pun.
 * Semua angka dihitung server — klien menampilkan, tidak menghitung ulang.
 */
async function buildInquiryPayload(input: {
  userId: string;
  sku: string;
  targetNumber: string;
}) {
  const product = await getService().getProductForPurchase(input.sku);
  const targetNumber = normalizePpobTarget(product.category, input.targetNumber);
  // Tolak lebih awal (sebelum konfirmasi bayar) bila operator nomor tidak didukung produk ini.
  getService().resolveProviderSku(product, targetNumber);
  const wallet = await prisma.wallet.findUnique({
    where: { userId: input.userId },
    select: { balance: true, ppobBalance: true }
  });
  const ppobBalance = wallet?.ppobBalance ?? new Prisma.Decimal(0);
  const totalAmount = product.price.plus(product.adminFee);
  // Audit keamanan 30 September 2026 (M1): inquiry SEBELUMNYA menjanjikan
  // split pembayaran (ppobBalance dulu, sisanya dari saldo utama) yang tidak
  // pernah benar-benar terjadi — debit sungguhan (PrismaPpobRepository.
  // createPurchaseWithDebit) HANYA memotong ppobBalance, tidak pernah
  // menyentuh saldo utama sama sekali (lihat "pembelian sukses" di
  // ppob.integration.test.ts: wallet.balance tetap 0.00). ppobBalance adalah
  // ember terpisah yang TIDAK BOLEH tercampur dengan saldo utama — keputusan
  // produk yang tidak ditawar. Inquiry sekarang mencerminkan itu persis:
  // cukup hanya bila ppobBalance sendirian menutup total, dan tidak pernah
  // menjanjikan saldo utama ikut terpakai.
  const sufficient = ppobBalance.gte(totalAmount);
  const benefitAmount = sufficient ? totalAmount : new Prisma.Decimal(0);
  const balanceAmount = totalAmount.minus(benefitAmount);
  return {
    product: {
      ...serializeCatalogProduct(product),
      id: product.sku
    },
    targetNumber,
    payment: {
      amount: money(totalAmount),
      benefitAmount: money(benefitAmount),
      balanceAmount: money(balanceAmount),
      sufficient
    },
    wallet: {
      balance: money(wallet?.balance ?? new Prisma.Decimal(0)),
      ppobBalance: money(ppobBalance)
    }
  };
}

/** Transaksi -> bentuk PpobOrder yang dibaca model Flutter. */
function serializeOrder(tx: PpobTransaction, replayed = false) {
  // Audit keamanan 30 September 2026 (M1): sebelumnya dihitung dari adminFee
  // (kebetulan sering 0, sehingga balanceAmount kebetulan sering = totalAmount
  // — mengarang split yang tidak ada). Transaksi yang SUDAH terjadi selalu
  // didebit 100% dari ppobBalance (lihat catatan di buildInquiryPayload di
  // atas), jadi benefitAmount di sini SELALU totalAmount penuh.
  const benefitAmount = tx.totalAmount;
  return {
    id: tx.publicReference,
    status: tx.status,
    sku: tx.skuSnapshot,
    productName: tx.productNameSnapshot,
    categoryCode: tx.category,
    targetNumber: tx.targetNumber,
    amount: money(tx.totalAmount),
    benefitAmount: money(benefitAmount),
    balanceAmount: money(tx.totalAmount.minus(benefitAmount)),
    failureReason: tx.failureReason,
    providerRef: tx.providerReference,
    createdAt: tx.createdAt,
    completedAt: tx.completedAt,
    // Backend tidak punya status REFUNDED terpisah: kegagalan selalu disertai
    // refund penuh, jadi momen refund = finalisasi FAILED.
    refundedAt: tx.status === "FAILED" ? tx.completedAt : null,
    replayed
  };
}

function serializeTransaction(tx: PpobTransaction) {
  return {
    reference: tx.publicReference,
    sku: tx.skuSnapshot,
    productName: tx.productNameSnapshot,
    brand: tx.brandSnapshot,
    category: tx.category,
    targetNumber: tx.targetNumber,
    amount: money(tx.amount),
    adminFee: money(tx.adminFee),
    totalAmount: money(tx.totalAmount),
    status: tx.status,
    serialNumber: tx.serialNumber,
    failureCode: tx.failureCode,
    failureReason: tx.failureReason,
    completedAt: tx.completedAt,
    createdAt: tx.createdAt
  };
}

function idempotencyKeyOf(headerValue: unknown): string | undefined {
  if (typeof headerValue !== "string") return undefined;
  const trimmed = headerValue.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return undefined;
  return trimmed;
}

/**
 * Audit keamanan 30 September 2026 (H1): pembelian PPOB TANPA Idempotency-Key
 * sebelumnya diam-diam diterima (idempotencyKeyOf mengembalikan undefined,
 * lalu spread kondisional melewatkannya begitu saja ke purchase()) — retry
 * jaringan/tap ganda dari klien yang lupa mengirim header bisa mendebit
 * ppobBalance dua kali tanpa perlindungan apa pun. Wajibkan headernya DI SINI,
 * sebelum purchase() sempat dipanggil sama sekali; jangan mengubah unique
 * constraint atau logika P2002 di PpobService.purchase (itu tetap benar).
 */
function requireIdempotencyKey(req: Request): string {
  const key = idempotencyKeyOf(req.headers["idempotency-key"]);
  if (!key) {
    throw new AppError(
      "Header Idempotency-Key wajib disertakan untuk pembelian PPOB",
      StatusCodes.BAD_REQUEST,
      "PPOB_IDEMPOTENCY_REQUIRED"
    );
  }
  return key;
}

export const ppobRouter = Router();

ppobRouter.use(requireAuth);

// ---- Kontrak klien R2: /catalog ----
ppobRouter.get("/catalog", asyncHandler(async (_req, res) => {
  const products = await getService().listProducts();
  const byCategory = new Map<string, CatalogProductRow[]>();
  for (const product of products) {
    const list = byCategory.get(product.category) ?? [];
    list.push(product);
    byCategory.set(product.category, list);
  }
  const items = [...byCategory.entries()].map(([code, rows], index) => ({
    id: code,
    code,
    name: PPOB_CATEGORY_NAMES[code] ?? code,
    description: null,
    icon: null,
    sortOrder: index,
    // Urutan sudah dijamin repository (sortOrder, lalu harga).
    products: rows.map((row) => ({ id: row.sku, ...serializeCatalogProduct(row) }))
  }));
  res.json({ success: true, data: { items } });
}));

// ---- Kontrak klien R2: /orders/inquiry ----
ppobRouter.post(
  "/orders/inquiry",
  paymentRateLimiter,
  validateRequest(ppobPurchaseSchema),
  asyncHandler(async (req, res) => {
    const data = await buildInquiryPayload({
      userId: req.auth!.userId,
      sku: req.body.sku,
      targetNumber: req.body.targetNumber
    });
    res.json({ success: true, data });
  })
);

// ---- Pascabayar (BPJS, PDAM): daftar produk, cek tagihan, bayar ----
ppobRouter.get(
  "/bills/products",
  validateRequest(ppobBillProductsQuerySchema),
  asyncHandler(async (req, res) => {
    const products = await getService().listPostpaidProducts({
      category: req.query.category as PpobCategory,
      limit: Number(req.query.limit),
      ...(typeof req.query.q === "string" && req.query.q.length > 0 ? { query: req.query.q } : {})
    });
    res.json({
      success: true,
      data: {
        items: products.map((product) => ({
          sku: product.sku,
          name: product.name,
          brand: product.brand,
          category: product.category,
          targetLabel: PPOB_TARGET_LABELS[product.category] ?? "Nomor Pelanggan"
        }))
      }
    });
  })
);

ppobRouter.post(
  "/bills/inquiry",
  paymentRateLimiter,
  validateRequest(ppobBillInquirySchema),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const { inquiry, product } = await getService().inquireBill({
      userId,
      sku: req.body.sku,
      targetNumber: req.body.targetNumber
    });
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { ppobBalance: true }
    });
    const ppobBalance = wallet?.ppobBalance ?? new Prisma.Decimal(0);
    res.json({
      success: true,
      data: {
        reference: inquiry.publicReference,
        product: { sku: product.sku, name: product.name, brand: product.brand, category: product.category },
        targetNumber: inquiry.targetNumber,
        customerName: inquiry.customerName,
        period: inquiry.period,
        billAmount: money(inquiry.billAmount),
        // Admin penyedia + biaya layanan TapGo, digabung untuk pelanggan.
        feeAmount: money(inquiry.totalAmount.minus(inquiry.billAmount)),
        totalAmount: money(inquiry.totalAmount),
        detail: inquiry.detail,
        expiresAt: inquiry.expiresAt,
        // Sisa detik menurut jam SERVER: klien menghitung batasnya dari jam sendiri
        // sejak respons diterima, supaya HP berjam salah tidak salah menilai kedaluwarsa.
        expiresInSeconds: Math.max(0, Math.floor((inquiry.expiresAt.getTime() - Date.now()) / 1000)),
        wallet: { ppobBalance: money(ppobBalance) },
        sufficient: ppobBalance.gte(inquiry.totalAmount)
      }
    });
  })
);

ppobRouter.post(
  "/bills/pay",
  paymentRateLimiter,
  validateRequest(ppobBillPaySchema),
  asyncHandler(async (req, res) => {
    const idempotencyKey = requireIdempotencyKey(req);
    const { transaction, replayed } = await getService().payBill({
      userId: req.auth!.userId,
      inquiryReference: req.body.reference,
      idempotencyKey
    });
    res.status(replayed ? 200 : 201).json({
      success: true,
      data: serializeOrder(transaction, replayed)
    });
  })
);

// ---- Kontrak klien R2: /orders (buat + riwayat) ----
ppobRouter.post(
  "/orders",
  paymentRateLimiter,
  validateRequest(ppobPurchaseSchema),
  asyncHandler(async (req, res) => {
    const idempotencyKey = requireIdempotencyKey(req);
    const { transaction, replayed } = await getService().purchase({
      userId: req.auth!.userId,
      sku: req.body.sku,
      targetNumber: req.body.targetNumber,
      idempotencyKey
    });
    res.status(replayed ? 200 : 201).json({
      success: true,
      data: serializeOrder(transaction, replayed)
    });
  })
);

ppobRouter.get(
  "/orders",
  validateRequest(ppobHistoryQuerySchema),
  asyncHandler(async (req, res) => {
    const transactions = await getService().listMyTransactions(
      req.auth!.userId,
      Number(req.query.limit)
    );
    res.json({
      success: true,
      data: { items: transactions.map((tx) => serializeOrder(tx)) }
    });
  })
);

ppobRouter.get(
  "/orders/:reference",
  validateRequest(ppobReferenceSchema),
  asyncHandler(async (req, res) => {
    const transaction = await getService().getMyTransaction(
      req.auth!.userId,
      req.params.reference as string
    );
    res.json({ success: true, data: serializeOrder(transaction) });
  })
);

// ---- Alias kompatibel klien lama ----
ppobRouter.get(
  "/products",
  validateRequest(ppobProductsQuerySchema),
  asyncHandler(async (req, res) => {
    const category = req.query.category as
      | "PULSA" | "DATA" | "PLN_PREPAID" | "PLN_POSTPAID" | "BPJS" | "EWALLET"
      | undefined;
    const products = await getService().listProducts(category);
    res.json({
      success: true,
      data: products.map((product) => ({
        sku: product.sku,
        category: product.category,
        brand: product.brand,
        name: product.name,
        description: product.description,
        price: money(product.price),
        adminFee: money(product.adminFee)
      }))
    });
  })
);

ppobRouter.post(
  "/transactions",
  paymentRateLimiter,
  validateRequest(ppobPurchaseSchema),
  asyncHandler(async (req, res) => {
    const idempotencyKey = requireIdempotencyKey(req);
    const { transaction, replayed } = await getService().purchase({
      userId: req.auth!.userId,
      sku: req.body.sku,
      targetNumber: req.body.targetNumber,
      idempotencyKey
    });
    // Replay mengembalikan 200 (permintaan sudah pernah diproses), pembelian
    // baru 201 — klien dapat membedakan keduanya tanpa field tambahan.
    res.status(replayed ? 200 : 201).json({
      success: true,
      data: serializeTransaction(transaction)
    });
  })
);

ppobRouter.get(
  "/transactions",
  validateRequest(ppobHistoryQuerySchema),
  asyncHandler(async (req, res) => {
    const transactions = await getService().listMyTransactions(
      req.auth!.userId,
      Number(req.query.limit)
    );
    res.json({ success: true, data: transactions.map(serializeTransaction) });
  })
);

ppobRouter.get(
  "/transactions/:reference",
  validateRequest(ppobReferenceSchema),
  asyncHandler(async (req, res) => {
    const transaction = await getService().getMyTransaction(
      req.auth!.userId,
      String(req.params.reference)
    );
    res.json({ success: true, data: serializeTransaction(transaction) });
  })
);
