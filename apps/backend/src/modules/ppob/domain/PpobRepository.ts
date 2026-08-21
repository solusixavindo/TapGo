import { PpobCategory, PpobTransaction, Prisma } from "@prisma/client";

export type PpobProductView = {
  sku: string;
  category: PpobCategory;
  brand: string;
  name: string;
  description: string | null;
  price: Prisma.Decimal;
  adminFee: Prisma.Decimal;
};

/// Produk lengkap dengan id internal — hanya dipakai di dalam service.
export type PpobProductRecord = PpobProductView & {
  id: string;
  /// Kode produk di sisi provider; null berarti sku internal dipakai apa adanya.
  providerSku: string | null;
};

export type PpobTransactionRecord = PpobTransaction;

/// Transaksi non-final yang menunggu kepastian provider (Stage R2.8).
export type PpobOpenTransaction = {
  id: string;
  publicReference: string;
  userId: string;
  skuSnapshot: string;
  category: PpobCategory;
  targetNumber: string;
  provider: string;
  providerSku: string;
};

export interface PpobRepository {
  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;

  listActiveProducts(category?: PpobCategory): Promise<PpobProductView[]>;

  findActiveProductBySku(
    sku: string,
    tx?: Prisma.TransactionClient
  ): Promise<PpobProductRecord | null>;

  findByIdempotencyKey(userId: string, key: string): Promise<PpobTransactionRecord | null>;

  /**
   * Debit ppobBalance dan catat transaksi PENDING + ledger PPOB_PURCHASE dalam
   * satu transaksi serializable. Gagal dengan INSUFFICIENT_PPOB_BALANCE bila
   * saldo tidak mencukupi — tanpa ada baris transaksi yang tersisa.
   */
  createPurchaseWithDebit(
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
  ): Promise<PpobTransactionRecord>;

  /**
   * Tandai hasil akhir provider. Untuk FAILED, saldo dikembalikan penuh lewat
   * ledger PPOB_REFUND. Transisi dijaga updateMany bersyarat status sehingga
   * pemanggilan ganda (retry provider, webhook ganda di R2.8) tidak pernah
   * mengembalikan saldo dua kali.
   */
  finalizePurchase(
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
  ): Promise<PpobTransactionRecord>;

  listUserTransactions(userId: string, limit: number): Promise<PpobTransactionRecord[]>;

  findUserTransactionByReference(
    userId: string,
    publicReference: string
  ): Promise<PpobTransactionRecord | null>;

  /// Pencarian untuk webhook: transaksi berdasar referensi publik (tanpa user).
  findByPublicReference(publicReference: string): Promise<PpobTransactionRecord | null>;

  /// Transaksi non-final yang lebih tua dari ambang, untuk worker rekonsiliasi.
  listOpenTransactions(olderThan: Date, limit: number): Promise<PpobOpenTransaction[]>;

  /**
   * Eskalasi PENDING → PROCESSING untuk transaksi yang sudah terlalu lama
   * menunggu tanpa jawaban provider apa pun (mis. proses mati sebelum dispatch,
   * atau timeout di tengah). Mengembalikan jumlah yang dieskalasi.
   */
  escalateStalePending(
    input: {
      olderThan: Date;
      provider: string;
      providerReference: string;
      limit: number;
    },
    tx: Prisma.TransactionClient
  ): Promise<number>;

  /**
   * Kunci rekonsiliasi antar-instance lewat pg_advisory_xact_lock. Mengembalikan
   * false bila instance lain sedang memegang kunci — aman tanpa Redis.
   */
  tryAcquireReconcileLock(key: number, tx: Prisma.TransactionClient): Promise<boolean>;
}
