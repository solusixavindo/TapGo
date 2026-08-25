import { PpobTransaction, Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { env } from "../../../config/env.js";
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
      service: new PpobService(new PrismaPpobRepository(prisma), resolvePpobProvider())
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
  BPJS: "Nomor VA BPJS"
};

const PPOB_CATEGORY_NAMES: Record<string, string> = {
  PULSA: "Pulsa",
  DATA: "Paket Data",
  PLN_PREPAID: "Token PLN",
  PLN_POSTPAID: "Tagihan PLN",
  BPJS: "BPJS",
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
}

function serializeCatalogProduct(product: CatalogProductRow) {
  return {
    sku: product.sku,
    name: product.name,
    description: product.description,
    price: money(product.price),
    adminFee: money(product.adminFee),
    targetLabel: PPOB_TARGET_LABELS[product.category] ?? "Nomor Tujuan",
    brand: product.brand
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
  const wallet = await prisma.wallet.findUnique({
    where: { userId: input.userId },
    select: { balance: true, ppobBalance: true }
  });
  const ppobBalance = wallet?.ppobBalance ?? new Prisma.Decimal(0);
  const totalAmount = product.price.plus(product.adminFee);
  // Split pembayaran: saldo PPOB (manfaat membership) dipakai lebih dulu,
  // sisanya dari saldo utama. Ini aturan server; klien hanya menampilkan.
  const benefitAmount = Prisma.Decimal.min(ppobBalance, totalAmount);
  const balanceAmount = totalAmount.minus(benefitAmount);
  const sufficient = (wallet?.balance ?? new Prisma.Decimal(0)).gte(balanceAmount);
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
  const benefitAmount = Prisma.Decimal.min(tx.adminFee, tx.totalAmount);
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

// ---- Kontrak klien R2: /orders (buat + riwayat) ----
ppobRouter.post(
  "/orders",
  paymentRateLimiter,
  validateRequest(ppobPurchaseSchema),
  asyncHandler(async (req, res) => {
    const { transaction, replayed } = await getService().purchase({
      userId: req.auth!.userId,
      sku: req.body.sku,
      targetNumber: req.body.targetNumber,
      ...(idempotencyKeyOf(req.headers["idempotency-key"])
        ? { idempotencyKey: idempotencyKeyOf(req.headers["idempotency-key"])! }
        : {})
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
    const { transaction, replayed } = await getService().purchase({
      userId: req.auth!.userId,
      sku: req.body.sku,
      targetNumber: req.body.targetNumber,
      ...(idempotencyKeyOf(req.headers["idempotency-key"])
        ? { idempotencyKey: idempotencyKeyOf(req.headers["idempotency-key"])! }
        : {})
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
