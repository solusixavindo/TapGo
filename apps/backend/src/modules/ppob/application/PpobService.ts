import { randomBytes } from "node:crypto";
import { PpobCategory, PpobTransaction, Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { logger } from "../../../core/logger/logger.js";
import { PpobRepository, PpobTransactionRecord } from "../domain/PpobRepository.js";
import { PpobProviderDisabledError, PpobProviderGateway } from "../domain/ppobProvider.js";
import { normalizePpobTarget } from "../domain/targetValidation.js";

/** Referensi publik PPOB: PPB- + 10 karakter alfabet aman (tanpa 0/O/1/I). */
function generatePpobReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let suffix = "";
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `PPB-${suffix}`;
}

/**
 * Kunci advisory lock Postgres untuk worker rekonsiliasi. Angka arbitrer
 * dalam namespace int4 — jangan dipakai modul lain.
 */
const PPOB_RECONCILE_LOCK_KEY = 727008;

export class PpobService {
  constructor(
    private readonly repository: PpobRepository,
    private readonly provider: PpobProviderGateway
  ) {}

  listProducts(category?: PpobCategory) {
    return this.repository.listActiveProducts(category);
  }

  async getProductForPurchase(sku: string) {
    const product = await this.repository.findActiveProductBySku(sku);
    if (!product) {
      throw new AppError(
        "Produk PPOB tidak ditemukan atau sedang tidak aktif",
        StatusCodes.NOT_FOUND,
        "PPOB_PRODUCT_NOT_FOUND"
      );
    }
    return product;
  }

  /**
   * Alur pembelian:
   * 1. Idempotency replay — key yang sama dengan payload sama mengembalikan
   *    transaksi lama; payload berbeda ditolak 409.
   * 2. Validasi produk + normalisasi target.
   * 3. Debit ppobBalance + catat PENDING + ledger dalam SATU transaksi DB.
   * 4. Panggil provider SETELAH commit; hasil akhir difinalkan lewat
   *    finalizePurchase. Kegagalan provider apa pun mengembalikan saldo penuh.
   *
   * Uang tidak pernah hilang tanpa jejak: bila proses mati antara langkah 3
   * dan 4, transaksi tertinggal PENDING dan dapat direkonsiliasi — tidak ada
   * status yang mengklaim sukses tanpa bukti provider.
   */
  async purchase(input: {
    userId: string;
    sku: string;
    targetNumber: string;
    idempotencyKey?: string;
  }): Promise<{ transaction: PpobTransactionRecord; replayed: boolean }> {
    const product = await this.getProductForPurchase(input.sku);
    const targetNumber = normalizePpobTarget(product.category, input.targetNumber);

    // Idempotency diperiksa terhadap payload TERNORMALISASI: "0856…" dan
    // "+62856…" adalah pembelian yang sama dan harus mengenai key yang sama.
    // Key sama + payload sama -> transaksi lama dikembalikan; key sama +
    // payload berbeda -> 409, bukan pembelian kedua diam-diam.
    if (input.idempotencyKey) {
      const existing = await this.repository.findByIdempotencyKey(
        input.userId,
        input.idempotencyKey
      );
      if (existing) {
        if (existing.skuSnapshot !== input.sku || existing.targetNumber !== targetNumber) {
          throw new AppError(
            "Idempotency-Key sudah dipakai untuk permintaan yang berbeda",
            StatusCodes.CONFLICT,
            "PPOB_IDEMPOTENCY_CONFLICT"
          );
        }
        return { transaction: existing, replayed: true };
      }
    }

    const totalAmount = product.price.plus(product.adminFee);

    let pending: PpobTransaction;
    try {
      pending = await this.repository.transaction((tx) =>
        this.repository.createPurchaseWithDebit(
          {
            userId: input.userId,
            product,
            publicReference: generatePpobReference(),
            targetNumber,
            totalAmount,
            provider: this.provider.name,
            ...(input.idempotencyKey !== undefined
              ? { idempotencyKey: input.idempotencyKey }
              : {})
          },
          tx
        )
      );
    } catch (error) {
      // Dua permintaan ber-Idempotency-Key sama dapat lolos pemeriksaan di
      // atas secara bersamaan; unique constraint (userId, idempotencyKey)
      // memastikan hanya satu yang men-debit. Yang kalah mengambil transaksi
      // pemenang — BUKAN men-debit kedua kalinya.
      if (
        input.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const winner = await this.repository.findByIdempotencyKey(
          input.userId,
          input.idempotencyKey
        );
        if (winner) {
          return { transaction: winner, replayed: true };
        }
      }
      throw error;
    }

    return {
      transaction: await this.dispatchToProvider(
        pending,
        product.providerSku ?? product.sku
      ),
      replayed: false
    };
  }

  /**
   * Memanggil provider dan memfinalkan hasilnya. Dipisah dari purchase()
   * supaya langkah pasca-commit ini juga dapat dipakai ulang oleh worker
   * rekonsiliasi pada R2.8 tanpa menduplikasi alur.
   */
  private async dispatchToProvider(
    pending: PpobTransaction,
    providerSku: string
  ): Promise<PpobTransaction> {
    let outcome;
    try {
      outcome = await this.provider.purchase({
        publicReference: pending.publicReference,
        providerSku,
        sku: pending.skuSnapshot,
        category: pending.category,
        targetNumber: pending.targetNumber,
        amount: pending.totalAmount.toFixed(2)
      });
    } catch (error) {
      if (error instanceof PpobProviderDisabledError) {
        // Saldo sudah terdebit — kembalikan dulu, baru laporkan 503.
        await this.repository.transaction((tx) =>
          this.repository.finalizePurchase(
            {
              transactionId: pending.id,
              outcome: {
                kind: "FAILED",
                providerReference: null,
                failureCode: "PROVIDER_DISABLED",
                failureReason: "Penyedia PPOB sedang dinonaktifkan"
              }
            },
            tx
          )
        );
        throw new AppError(
          "Layanan PPOB sedang tidak tersedia",
          StatusCodes.SERVICE_UNAVAILABLE,
          "PPOB_PROVIDER_DISABLED"
        );
      }
      logger.error(
        { err: error, reference: pending.publicReference },
        "PPOB provider call failed; deferring finalization to reconciliation"
      );
      // PENTING — jangan refund saat status provider TIDAK DIKETAHUI
      // (timeout/jaringan putus/status asing): provider bisa saja SUDAH
      // sukses memotong dan mengirim pulsa, sehingga refund seketika
      // membocorkan saldo (barang terkirim + uang kembali). Perlakukan
      // sebagai PROCESSING: saldo tetap terkunci, finalisasi diserahkan ke
      // webhook Digiflazz / worker rekonsiliasi (ref_id cegah potong ganda
      // saat di-inquiry ulang). Refund hanya pada jawaban FAILED eksplisit.
      // providerReference memakai publicReference sebagai jejak sementara
      // agar webhook tak lagi "deferred" (route butuh jejak provider).
      outcome = {
        kind: "PROCESSING" as const,
        providerReference: pending.publicReference
      };
    }

    return this.repository.transaction((tx) =>
      this.repository.finalizePurchase({ transactionId: pending.id, outcome }, tx)
    );
  }

  /**
   * Finalisasi dari notifikasi provider (Stage R2.8).
   *
   * Keaslian payload sudah diverifikasi lapisan route (HMAC). Metode ini
   * idempoten by construction: transaksi final (SUCCESS/FAILED) dijawab apa
   * adanya, transaksi PENDING tanpa jejak provider ditolak lunak (webhook
   * "create" yang mendahului jawaban API), dan seluruh kompensasi refund
   * diwarisi dari finalizePurchase — tidak akan pernah terjadi dua kali.
   */
  async finalizeFromProviderNotification(input: {
    publicReference: string;
    outcome:
      | { kind: "SUCCESS"; providerReference: string; serialNumber: string | null }
      | {
          kind: "FAILED";
          providerReference: string | null;
          failureCode: string;
          failureReason: string;
        };
  }): Promise<{ state: "finalized" | "already-final" | "deferred" | "ignored" }> {
    const transaction = await this.repository.findByPublicReference(input.publicReference);
    if (!transaction) {
      // Referensi tak dikenal: jawab ignored (route tetap 200 agar provider
      // tidak retry selamanya — bisa jadi transaksi sistem lain yang berbagi
      // webhook URL yang sama).
      return { state: "ignored" };
    }
    if (transaction.status === "SUCCESS" || transaction.status === "FAILED") {
      return { state: "already-final" };
    }
    if (transaction.status === "PENDING" && !transaction.providerReference) {
      // Jawaban API belum selesai ditulis (webhook "create" tiba lebih dulu).
      // Provider akan mengirim event "update" / retry; men-finalkan sekarang
      // berisiko menimpa outcome otoritatif dari jawaban API.
      return { state: "deferred" };
    }
    await this.repository.transaction((tx) =>
      this.repository.finalizePurchase(
        { transactionId: transaction.id, outcome: input.outcome },
        tx
      )
    );
    return { state: "finalized" };
  }

  /**
   * Satu siklus rekonsiliasi (Stage R2.8).
   *
   * 1. Eskalasi PENDING basi (tanpa jawaban provider) menjadi PROCESSING.
   * 2. Cek status tiap transaksi non-final ke provider, finalkan hasilnya.
   *
   * Aman dijalankan banyak instance: pg advisory lock memastikan hanya satu
   * siklus berjalan pada satu waktu; finalizePurchase tetap idempoten bila
   * webhook dan worker menyentuh transaksi yang sama.
   */
  async reconcileOpenTransactions(options?: {
    olderThanMinutes?: number;
    batchSize?: number;
    lockKey?: number;
  }): Promise<{ skipped: boolean; escalated: number; finalized: number; errors: number }> {
    if (!this.provider.checkStatus) {
      return { skipped: true, escalated: 0, finalized: 0, errors: 0 };
    }
    const olderThanMinutes = options?.olderThanMinutes ?? 5;
    const batchSize = options?.batchSize ?? 50;
    const lockKey = options?.lockKey ?? PPOB_RECONCILE_LOCK_KEY;
    const olderThan = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    const lockHeld = await this.repository.transaction((tx) =>
      this.repository.tryAcquireReconcileLock(lockKey, tx)
    );
    if (!lockHeld) {
      return { skipped: true, escalated: 0, finalized: 0, errors: 0 };
    }

    const escalated = await this.repository.transaction((tx) =>
      this.repository.escalateStalePending(
        {
          olderThan,
          provider: this.provider.name,
          providerReference: `reconcile:${this.provider.name}`,
          limit: batchSize
        },
        tx
      )
    );

    const open = await this.repository.listOpenTransactions(olderThan, batchSize);
    let finalized = 0;
    let errors = 0;
    for (const item of open) {
      if (item.provider !== this.provider.name) {
        continue;
      }
      try {
        const outcome = await this.provider.checkStatus({
          publicReference: item.publicReference,
          providerSku: item.providerSku,
          sku: item.skuSnapshot,
          category: item.category,
          targetNumber: item.targetNumber
        });
        if (outcome.kind === "PROCESSING") {
          continue;
        }
        await this.repository.transaction((tx) =>
          this.repository.finalizePurchase({ transactionId: item.id, outcome }, tx)
        );
        finalized += 1;
      } catch (error) {
        // Kegagalan inquiry TIDAK pernah mengubah status — siklus berikutnya
        // mencoba lagi. Hanya jawaban FAILED eksplisit yang memicu refund.
        errors += 1;
        logger.warn(
          { err: error, reference: item.publicReference },
          "PPOB reconciliation inquiry failed"
        );
      }
    }
    return { skipped: false, escalated, finalized, errors };
  }

  listMyTransactions(userId: string, limit: number) {
    return this.repository.listUserTransactions(userId, Math.min(limit, 50));
  }

  async getMyTransaction(userId: string, publicReference: string) {
    const transaction = await this.repository.findUserTransactionByReference(
      userId,
      publicReference
    );
    if (!transaction) {
      // 404 — bukan 403 — supaya keberadaan referensi orang lain tidak bocor.
      throw new AppError(
        "Transaksi PPOB tidak ditemukan",
        StatusCodes.NOT_FOUND,
        "PPOB_TRANSACTION_NOT_FOUND"
      );
    }
    return transaction;
  }
}
