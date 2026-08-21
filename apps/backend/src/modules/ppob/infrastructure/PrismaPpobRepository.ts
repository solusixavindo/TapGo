import { PpobCategory, Prisma, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import {
  PpobOpenTransaction,
  PpobProductRecord,
  PpobProductView,
  PpobRepository,
  PpobTransactionRecord
} from "../domain/PpobRepository.js";

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  category: true,
  brand: true,
  name: true,
  description: true,
  price: true,
  adminFee: true,
  providerSku: true
} satisfies Prisma.PpobProductSelect;

export class PrismaPpobRepository implements PpobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(handler, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000
    });
  }

  listActiveProducts(category?: PpobCategory): Promise<PpobProductView[]> {
    return this.prisma.ppobProduct.findMany({
      where: {
        isActive: true,
        ...(category !== undefined ? { category } : {})
      },
      select: PRODUCT_SELECT,
      orderBy: [{ sortOrder: "asc" }, { price: "asc" }]
    });
  }

  findActiveProductBySku(
    sku: string,
    tx: Prisma.TransactionClient | PrismaClient = this.prisma
  ): Promise<PpobProductRecord | null> {
    return tx.ppobProduct.findFirst({
      where: { sku, isActive: true },
      select: PRODUCT_SELECT
    });
  }

  findByIdempotencyKey(userId: string, key: string): Promise<PpobTransactionRecord | null> {
    return this.prisma.ppobTransaction.findFirst({
      where: { userId, idempotencyKey: key }
    });
  }

  async createPurchaseWithDebit(
    input: {
      userId: string;
      product: PpobProductRecord;
      publicReference: string;
      targetNumber: string;
      totalAmount: Prisma.Decimal;
      provider: string;
      idempotencyKey?: string;
    },
    tx: Prisma.TransactionClient
  ): Promise<PpobTransactionRecord> {
    // Debit bersyarat dalam SATU statement: baris wallet hanya berubah bila
    // saldo mencukupi. Dua pembelian bersamaan tidak bisa membuat saldo negatif
    // karena klausa where dievaluasi di bawah row lock.
    const debited = await tx.wallet.updateMany({
      where: {
        userId: input.userId,
        ppobBalance: { gte: input.totalAmount }
      },
      data: {
        ppobBalance: { decrement: input.totalAmount }
      }
    });

    if (debited.count !== 1) {
      throw new AppError(
        "Saldo PPOB tidak mencukupi",
        StatusCodes.BAD_REQUEST,
        "INSUFFICIENT_PPOB_BALANCE"
      );
    }

    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { userId: input.userId },
      select: { id: true }
    });

    const ledger = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "PPOB_PURCHASE",
        amount: input.totalAmount.neg(),
        referenceType: "PPOB_PURCHASE",
        referenceId: input.publicReference,
        metadata: {
          sku: input.product.sku,
          category: input.product.category
        }
      }
    });

    return tx.ppobTransaction.create({
      data: {
        publicReference: input.publicReference,
        userId: input.userId,
        productId: input.product.id,
        skuSnapshot: input.product.sku,
        productNameSnapshot: input.product.name,
        brandSnapshot: input.product.brand,
        category: input.product.category,
        targetNumber: input.targetNumber,
        amount: input.product.price,
        adminFee: input.product.adminFee,
        totalAmount: input.totalAmount,
        status: "PENDING",
        provider: input.provider,
        walletTransactionId: ledger.id,
        ...(input.idempotencyKey !== undefined
          ? { idempotencyKey: input.idempotencyKey }
          : {})
      }
    });
  }

  async finalizePurchase(
    input: {
      transactionId: string;
      outcome:
        | { kind: "SUCCESS"; providerReference: string; serialNumber: string | null }
        | { kind: "PROCESSING"; providerReference: string }
        | {
            kind: "FAILED";
            providerReference: string | null;
            failureCode: string;
            failureReason: string;
          };
    },
    tx: Prisma.TransactionClient
  ): Promise<PpobTransactionRecord> {
    const { outcome } = input;

    if (outcome.kind === "SUCCESS") {
      await tx.ppobTransaction.updateMany({
        where: { id: input.transactionId, status: { in: ["PENDING", "PROCESSING"] } },
        data: {
          status: "SUCCESS",
          providerReference: outcome.providerReference,
          serialNumber: outcome.serialNumber,
          completedAt: new Date()
        }
      });
      return tx.ppobTransaction.findUniqueOrThrow({ where: { id: input.transactionId } });
    }

    if (outcome.kind === "PROCESSING") {
      await tx.ppobTransaction.updateMany({
        where: { id: input.transactionId, status: "PENDING" },
        data: { status: "PROCESSING", providerReference: outcome.providerReference }
      });
      return tx.ppobTransaction.findUniqueOrThrow({ where: { id: input.transactionId } });
    }

    // FAILED: refund penuh. Penjaga ganda: (1) transisi hanya dari status
    // non-final, (2) ledger PPOB_REFUND untuk transaksi ini dicek dulu —
    // sehingga retry provider maupun webhook ganda (R2.8) tidak pernah
    // mengembalikan saldo dua kali.
    const claimed = await tx.ppobTransaction.updateMany({
      where: { id: input.transactionId, status: { in: ["PENDING", "PROCESSING"] } },
      data: {
        status: "FAILED",
        providerReference: outcome.providerReference,
        failureCode: outcome.failureCode,
        failureReason: outcome.failureReason,
        completedAt: new Date()
      }
    });

    const current = await tx.ppobTransaction.findUniqueOrThrow({
      where: { id: input.transactionId }
    });

    if (claimed.count !== 1) {
      // Sudah difinalkan pihak lain — baca ulang, jangan refund ulang.
      return current;
    }

    const existingRefund = await tx.walletTransaction.findFirst({
      where: {
        type: "PPOB_REFUND",
        referenceType: "PPOB_REFUND",
        referenceId: current.publicReference
      },
      select: { id: true }
    });

    if (existingRefund) {
      return current;
    }

    const wallet = await tx.wallet.findUniqueOrThrow({
      where: { userId: current.userId },
      select: { id: true }
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { ppobBalance: { increment: current.totalAmount } }
    });

    const refundLedger = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "PPOB_REFUND",
        amount: current.totalAmount,
        referenceType: "PPOB_REFUND",
        referenceId: current.publicReference,
        metadata: {
          sku: current.skuSnapshot,
          failureCode: outcome.failureCode
        }
      }
    });

    return tx.ppobTransaction.update({
      where: { id: current.id },
      data: { refundTransactionId: refundLedger.id }
    });
  }

  listUserTransactions(userId: string, limit: number): Promise<PpobTransactionRecord[]> {
    return this.prisma.ppobTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit
    });
  }

  findUserTransactionByReference(
    userId: string,
    publicReference: string
  ): Promise<PpobTransactionRecord | null> {
    return this.prisma.ppobTransaction.findFirst({
      where: { userId, publicReference }
    });
  }

  findByPublicReference(publicReference: string): Promise<PpobTransactionRecord | null> {
    return this.prisma.ppobTransaction.findUnique({
      where: { publicReference }
    });
  }

  async listOpenTransactions(olderThan: Date, limit: number): Promise<PpobOpenTransaction[]> {
    const rows = await this.prisma.ppobTransaction.findMany({
      where: {
        status: { in: ["PENDING", "PROCESSING"] },
        createdAt: { lt: olderThan }
      },
      select: {
        id: true,
        publicReference: true,
        userId: true,
        skuSnapshot: true,
        category: true,
        targetNumber: true,
        provider: true,
        product: { select: { providerSku: true } }
      },
      orderBy: { createdAt: "asc" },
      take: limit
    });
    return rows.map((row) => ({
      id: row.id,
      publicReference: row.publicReference,
      userId: row.userId,
      skuSnapshot: row.skuSnapshot,
      category: row.category,
      targetNumber: row.targetNumber,
      provider: row.provider,
      providerSku: row.product.providerSku ?? row.skuSnapshot
    }));
  }

  async escalateStalePending(
    input: {
      olderThan: Date;
      provider: string;
      providerReference: string;
      limit: number;
    },
    tx: Prisma.TransactionClient
  ): Promise<number> {
    // Ambil kandidat dulu supaya `take` dapat diterapkan; updateMany tidak
    // mendukung LIMIT. Klausa status pada update tetap dijaga agar finalisasi
    // yang menyelip di antara findMany dan updateMany tidak ditimpa.
    const candidates = await tx.ppobTransaction.findMany({
      where: {
        status: "PENDING",
        provider: input.provider,
        createdAt: { lt: input.olderThan }
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: input.limit
    });
    if (candidates.length === 0) {
      return 0;
    }
    const updated = await tx.ppobTransaction.updateMany({
      where: {
        id: { in: candidates.map((row) => row.id) },
        status: "PENDING"
      },
      data: {
        status: "PROCESSING",
        providerReference: input.providerReference
      }
    });
    return updated.count;
  }

  async tryAcquireReconcileLock(
    key: number,
    tx: Prisma.TransactionClient
  ): Promise<boolean> {
    // pg_advisory_xact_lock lepas otomatis saat transaksi berakhir — tidak ada
    // kunci yang tertinggal bila proses mati, dan tidak bergantung pada Redis.
    const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${key}) AS acquired
    `;
    return rows[0]?.acquired === true;
  }
}
