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

    return { transaction: await this.dispatchToProvider(pending), replayed: false };
  }

  /**
   * Memanggil provider dan memfinalkan hasilnya. Dipisah dari purchase()
   * supaya langkah pasca-commit ini juga dapat dipakai ulang oleh worker
   * rekonsiliasi pada R2.8 tanpa menduplikasi alur.
   */
  private async dispatchToProvider(pending: PpobTransaction): Promise<PpobTransaction> {
    let outcome;
    try {
      outcome = await this.provider.purchase({
        publicReference: pending.publicReference,
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
        "PPOB provider call failed; refunding"
      );
      outcome = {
        kind: "FAILED" as const,
        providerReference: null,
        failureCode: "PROVIDER_ERROR",
        failureReason: "Penyedia PPOB gagal memproses permintaan"
      };
    }

    return this.repository.transaction((tx) =>
      this.repository.finalizePurchase({ transactionId: pending.id, outcome }, tx)
    );
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
