import { PpobCategory, PpobTransaction, Prisma } from "@prisma/client";

export type PpobProductView = {
  sku: string;
  category: PpobCategory;
  brand: string;
  name: string;
  description: string | null;
  price: Prisma.Decimal;
  adminFee: Prisma.Decimal;
  /// Kode provider per operator (pulsa/data); dipakai klien hanya untuk daftar operator.
  providerSkus?: Prisma.JsonValue | null;
  /// Produk pascabayar: dibeli lewat cek tagihan, bukan harga tetap.
  isPostpaid?: boolean;
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

/// Hasil cek tagihan yang disimpan (angka dari server, sekali pakai).
export type PpobBillInquiryRecord = {
  id: string;
  publicReference: string;
  userId: string;
  productId: string;
  targetNumber: string;
  customerName: string;
  period: string | null;
  billAmount: Prisma.Decimal;
  providerAdmin: Prisma.Decimal;
  providerCost: Prisma.Decimal;
  serviceFee: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  detail: Prisma.JsonValue | null;
  expiresAt: Date;
  usedAt: Date | null;
};

/// Satu produk pascabayar yang dibuat/diperbarui dari katalog provider.
export type PpobPostpaidCatalogUpsert = {
  sku: string;
  category: PpobCategory;
  brand: string;
  name: string;
  description: string | null;
  providerSku: string;
  adminFee: number;
  isActive: boolean;
};

export interface PpobRepository {
  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;

  listActiveProducts(category?: PpobCategory): Promise<PpobProductView[]>;

  findActiveProductBySku(
    sku: string,
    tx?: Prisma.TransactionClient
  ): Promise<PpobProductRecord | null>;

  /// Produk aktif menurut id internal (dipakai alur pascabayar dari hasil cek tagihan).
  findActiveProductById(id: string): Promise<PpobProductRecord | null>;

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
      /// Kode produk provider yang sudah dipilih untuk transaksi ini.
      providerSku: string;
      idempotencyKey?: string;
      /**
       * Pascabayar: transaksi dibuat dari hasil cek tagihan. Inquiry diklaim
       * (sekali pakai, belum kedaluwarsa, milik user ini) DI DALAM transaksi
       * yang sama dengan debit; angka transaksi diambil dari inquiry, bukan
       * dari harga produk.
       */
      billInquiry?: PpobBillInquiryRecord;
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

  /**
   * Produk yang DIKELOLA sinkronisasi harga (Stage R2.12): punya providerSku
   * tunggal atau providerSkus (multi-operator). Produk tanpa keduanya (mis.
   * BPJS/PDAM yang belum diaktifkan Digiflazz untuk akun ini) TIDAK ikut —
   * status aktif/nonaktifnya adalah keputusan produk, bukan keputusan harga.
   * Menyertakan produk NONAKTIF sekalipun: bila Digiflazz mengaktifkan lagi
   * suatu kode, siklus berikutnya harus bisa menghidupkannya kembali.
   */
  listProductsForPriceSync(): Promise<PpobPriceSyncCandidate[]>;

  /// Produk pascabayar aktif; [query] mencari pada nama/brand (tanpa huruf besar-kecil).
  listActivePostpaidProducts(input: {
    category: PpobCategory;
    query?: string;
    limit: number;
  }): Promise<PpobProductView[]>;

  createBillInquiry(
    input: Omit<PpobBillInquiryRecord, "id" | "usedAt">
  ): Promise<PpobBillInquiryRecord>;

  findBillInquiry(userId: string, publicReference: string): Promise<PpobBillInquiryRecord | null>;

  /**
   * Membuat/memperbarui produk pascabayar dari katalog provider dan
   * menonaktifkan produk pascabayar yang tidak ada lagi di katalog. Kategori
   * lain dan produk prabayar tidak disentuh.
   */
  syncPostpaidCatalog(
    entries: PpobPostpaidCatalogUpsert[],
    syncedAt: Date
  ): Promise<{ created: number; updated: number; deactivated: number }>;

  /**
   * Menerapkan hasil satu siklus sinkronisasi harga dalam satu transaksi.
   * Setiap baris HANYA menulis kolom yang relevan (price/providerSkus/
   * isActive/priceSyncedAt) — sku, brand, nama, dan kategori produk tidak
   * pernah disentuh oleh sinkronisasi harga.
   */
  applyPriceSyncUpdates(
    updates: PpobPriceSyncUpdate[],
    syncedAt: Date
  ): Promise<{ updated: number }>;
}

/// Satu produk yang dipertimbangkan pada siklus sinkronisasi harga.
export type PpobPriceSyncCandidate = {
  id: string;
  sku: string;
  name: string;
  category: PpobCategory;
  price: Prisma.Decimal;
  isActive: boolean;
  providerSku: string | null;
  /// Record<kunci operator, kode provider> — hanya untuk produk multi-operator.
  providerSkus: Prisma.JsonValue | null;
};

/// Perubahan yang ditulis untuk satu produk pada satu siklus sinkronisasi.
export type PpobPriceSyncUpdate = {
  id: string;
  price: number;
  isActive: boolean;
  /// Hanya diisi untuk produk multi-operator (mengganti providerSkus produk
  /// dengan hanya operator yang lolos band harga siklus ini).
  providerSkus?: Record<string, string>;
};
