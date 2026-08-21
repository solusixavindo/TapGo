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
export type PpobProductRecord = PpobProductView & { id: string };

export type PpobTransactionRecord = PpobTransaction;

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
}
