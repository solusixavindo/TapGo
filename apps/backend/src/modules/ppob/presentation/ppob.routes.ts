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

const service = new PpobService(new PrismaPpobRepository(prisma), resolvePpobProvider());

/** Rupiah disajikan sebagai number; nilai PPOB jauh di bawah batas aman. */
function money(value: Prisma.Decimal): number {
  return Number(value.toFixed(2));
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

ppobRouter.get(
  "/products",
  validateRequest(ppobProductsQuerySchema),
  asyncHandler(async (req, res) => {
    const category = req.query.category as
      | "PULSA" | "DATA" | "PLN_PREPAID" | "PLN_POSTPAID" | "BPJS" | "EWALLET"
      | undefined;
    const products = await service.listProducts(category);
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
    const { transaction, replayed } = await service.purchase({
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
    const transactions = await service.listMyTransactions(
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
    const transaction = await service.getMyTransaction(
      req.auth!.userId,
      String(req.params.reference)
    );
    res.json({ success: true, data: serializeTransaction(transaction) });
  })
);
