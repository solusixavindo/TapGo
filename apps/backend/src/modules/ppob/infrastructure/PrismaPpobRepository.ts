import { PpobCategory, Prisma, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import {
  PpobBillInquiryRecord,
  PpobOpenTransaction,
  PpobPostpaidCatalogUpsert,
  PpobPriceSyncCandidate,
  PpobPriceSyncUpdate,
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
  providerSku: true,
  providerSkus: true,
  isPostpaid: true
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
        // Katalog prabayar: produk pascabayar dibeli lewat cek tagihan.
        isPostpaid: false,
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

  findActiveProductById(id: string): Promise<PpobProductRecord | null> {
    return this.prisma.ppobProduct.findFirst({
      where: { id, isActive: true },
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
      providerSku: string;
      idempotencyKey?: string;
      billInquiry?: PpobBillInquiryRecord;
    },
    tx: Prisma.TransactionClient
  ): Promise<PpobTransactionRecord> {
    // Pascabayar: klaim inquiry SEBELUM debit, di transaksi yang sama. Satu
    // statement bersyarat (milik user ini, belum dipakai, belum kedaluwarsa):
    // dua pembayaran bersamaan untuk inquiry yang sama hanya satu yang lolos,
    // dan kegagalan klaim membatalkan seluruh transaksi tanpa debit.
    if (input.billInquiry) {
      const claimed = await tx.ppobBillInquiry.updateMany({
        where: {
          id: input.billInquiry.id,
          userId: input.userId,
          usedAt: null,
          expiresAt: { gt: new Date() }
        },
        data: { usedAt: new Date() }
      });
      if (claimed.count !== 1) {
        throw new AppError(
          "Tagihan sudah kedaluwarsa atau sudah dipakai. Cek tagihan lagi.",
          StatusCodes.CONFLICT,
          "PPOB_BILL_INQUIRY_UNUSABLE"
        );
      }
    }

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
        // Pascabayar: tagihan murni, dan sisanya (admin penyedia + biaya layanan)
        // sebagai adminFee; prabayar memakai harga produk.
        amount: input.billInquiry
          ? input.billInquiry.billAmount
          : input.product.price,
        adminFee: input.billInquiry
          ? input.billInquiry.totalAmount.minus(input.billInquiry.billAmount)
          : input.product.adminFee,
        totalAmount: input.totalAmount,
        status: "PENDING",
        provider: input.provider,
        providerSku: input.providerSku,
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
        | { kind: "SUCCESS"; providerReference: string; serialNumber: string | null; providerCost?: number | null }
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
          ...(outcome.providerCost != null ? { providerCost: new Prisma.Decimal(outcome.providerCost) } : {}),
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
        providerSku: true,
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
      providerSku: row.providerSku ?? row.product.providerSku ?? row.skuSnapshot
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

  listProductsForPriceSync(): Promise<PpobPriceSyncCandidate[]> {
    return this.prisma.ppobProduct.findMany({
      where: {
        // Pascabayar punya katalog sendiri (syncPostpaidCatalog); mencocokkannya
        // dengan daftar harga prabayar akan menonaktifkannya.
        isPostpaid: false,
        OR: [{ providerSku: { not: null } }, { providerSkus: { not: Prisma.JsonNull } }]
      },
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        price: true,
        isActive: true,
        providerSku: true,
        providerSkus: true
      }
    });
  }

  async applyPriceSyncUpdates(
    updates: PpobPriceSyncUpdate[],
    syncedAt: Date
  ): Promise<{ updated: number }> {
    if (updates.length === 0) {
      return { updated: 0 };
    }
    await this.prisma.$transaction(
      updates.map((update) =>
        this.prisma.ppobProduct.update({
          where: { id: update.id },
          data: {
            price: update.price,
            isActive: update.isActive,
            priceSyncedAt: syncedAt,
            ...(update.providerSkus !== undefined ? { providerSkus: update.providerSkus } : {})
          }
        })
      )
    );
    return { updated: updates.length };
  }

  listActivePostpaidProducts(input: {
    category: PpobCategory;
    query?: string;
    limit: number;
  }): Promise<PpobProductView[]> {
    const query = input.query?.trim();
    return this.prisma.ppobProduct.findMany({
      where: {
        isActive: true,
        isPostpaid: true,
        category: input.category,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { brand: { contains: query, mode: "insensitive" } }
              ]
            }
          : {})
      },
      select: PRODUCT_SELECT,
      orderBy: [{ name: "asc" }],
      take: input.limit
    });
  }

  createBillInquiry(
    input: Omit<PpobBillInquiryRecord, "id" | "usedAt">
  ): Promise<PpobBillInquiryRecord> {
    const { detail, ...rest } = input;
    return this.prisma.ppobBillInquiry.create({
      data: { ...rest, detail: detail === null ? Prisma.JsonNull : (detail as Prisma.InputJsonValue) }
    });
  }

  findBillInquiry(userId: string, publicReference: string): Promise<PpobBillInquiryRecord | null> {
    return this.prisma.ppobBillInquiry.findFirst({ where: { userId, publicReference } });
  }

  async syncPostpaidCatalog(
    entries: PpobPostpaidCatalogUpsert[],
    syncedAt: Date
  ): Promise<{ created: number; updated: number; deactivated: number }> {
    let created = 0;
    let updated = 0;
    let deactivated = 0;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.ppobProduct.findMany({
        where: { isPostpaid: true },
        select: { id: true, sku: true, providerSku: true, isActive: true }
      });
      const bySku = new Map(existing.map((row) => [row.sku, row]));
      const seen = new Set<string>();
      for (const entry of entries) {
        seen.add(entry.sku);
        const data = {
          category: entry.category,
          brand: entry.brand.slice(0, 40),
          name: entry.name.slice(0, 120),
          description: entry.description ? entry.description.slice(0, 240) : null,
          providerSku: entry.providerSku.slice(0, 60),
          // Harga tidak bermakna untuk pascabayar; tagihan dari cek tagihan.
          price: 0,
          adminFee: entry.adminFee,
          isActive: entry.isActive,
          isPostpaid: true,
          priceSyncedAt: syncedAt
        };
        const current = bySku.get(entry.sku);
        if (!current) {
          await tx.ppobProduct.create({ data: { sku: entry.sku, ...data } });
          created += 1;
        } else {
          await tx.ppobProduct.update({ where: { id: current.id }, data });
          updated += 1;
        }
      }
      for (const row of existing) {
        if (!seen.has(row.sku) && row.isActive) {
          await tx.ppobProduct.update({ where: { id: row.id }, data: { isActive: false, priceSyncedAt: syncedAt } });
          deactivated += 1;
        }
      }
    });
    return { created, updated, deactivated };
  }
}
