import { Prisma, UserRole, WithdrawalStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { lazyPushNotifier } from "../../notifications/application/pushServiceFactory.js";
import { accountPushMessages, pushQuietly } from "../../notifications/application/accountNotifications.js";
import type { PushNotifier } from "../../notifications/application/rideNotifications.js";
import { WalletRepository } from "../domain/WalletRepository.js";

/**
 * Batas transfer P2P TapGoPay (Stage R2.10).
 *
 * Nilai default yang wajar untuk mengurangi risiko penyalahgunaan/pencucian
 * lewat transfer beruntun — BUKAN keputusan yang sudah dikonfirmasi Owner.
 * Sesuaikan angkanya di sini bila kebijakan bisnisnya berbeda.
 */
const MIN_TRANSFER_AMOUNT = new Prisma.Decimal(10_000);
const MAX_TRANSFER_PER_TRANSACTION = new Prisma.Decimal(2_000_000);
const MAX_TRANSFER_PER_DAY = new Prisma.Decimal(5_000_000);

export class WalletService {
  constructor(
    private readonly walletRepository: WalletRepository,
    private readonly push: PushNotifier = lazyPushNotifier
  ) {}

  /**
   * Dompet beserta rincian kantong dan aturan penarikan deposit untuk tampilan. Kolom lama tidak berubah; klien lama
   * mengabaikan field baru. `availableAt` hanya terisi bila masa tunggu deposit masih berjalan.
   */
  async getWalletSummary(userId: string) {
    const wallet = await this.walletRepository.getWalletByUserId(userId);
    const { env } = await import("../../../config/env.js");
    const other = wallet.balance
      .minus(wallet.cashBalance)
      .minus(wallet.lockedBonusBalance)
      .minus(wallet.depositBalance);
    let availableAt: string | null = null;
    if (env.BONUS_LOCK_ENABLED && env.DEPOSIT_HOLD_HOURS > 0 && wallet.depositBalance.gt(0)) {
      const lastTopUp = await this.walletRepository.getLastTopUpAt(userId);
      if (lastTopUp) {
        const releaseAt = lastTopUp.getTime() + env.DEPOSIT_HOLD_HOURS * 3600_000;
        if (releaseAt > Date.now()) availableAt = new Date(releaseAt).toISOString();
      }
    }
    return {
      ...wallet,
      breakdown: {
        withdrawable: wallet.cashBalance.toString(),
        lockedBonus: wallet.lockedBonusBalance.toString(),
        deposit: wallet.depositBalance.toString(),
        other: (other.lt(0) ? new Prisma.Decimal(0) : other).toString()
      },
      depositWithdrawal: {
        enabled: env.BONUS_LOCK_ENABLED,
        fee: env.DEPOSIT_WITHDRAWAL_FEE,
        minimum: env.DEPOSIT_WITHDRAWAL_MIN,
        holdHours: env.DEPOSIT_HOLD_HOURS,
        availableAt
      },
      lockPercent: env.BONUS_LOCK_ENABLED ? env.BONUS_LOCK_PERCENT : 0
    };
  }

  getWallet(userId: string) {
    return this.walletRepository.getWalletByUserId(userId);
  }

  getTransactions(userId: string, page: number, pageSize: number) {
    return this.walletRepository.getTransactions(userId, page, Math.min(pageSize, 100));
  }

  getBankAccount(userId: string) {
    return this.walletRepository.getBankAccount(userId);
  }

  updateBankAccount(input: {
    userId: string;
    bankName: string;
    bankCode?: string;
    accountNumber: string;
    accountHolderName: string;
  }) {
    return this.walletRepository.updateBankAccount(input);
  }

  requestWithdrawal(input: {
    userId: string;
    amount: Prisma.Decimal;
    bankName: string;
    bankCode?: string;
    accountNumber: string;
    accountHolderName: string;
    notes?: string;
    /** Bawaan CASH. DEPOSIT hanya untuk kanal web dan hanya bila BONUS_LOCK_ENABLED. */
    source?: "CASH" | "DEPOSIT";
  }) {
    if (input.amount.lt(50000)) {
      throw new AppError("Minimum withdrawal is Rp50.000", StatusCodes.BAD_REQUEST, "WITHDRAWAL_MINIMUM_NOT_MET");
    }
    return this.walletRepository.transaction(async (tx) => {
      if (input.source !== "DEPOSIT") {
        return this.walletRepository.reserveWithdrawal(input, tx);
      }
      // Berkas ini sengaja tidak mengimpor config/env di tingkat modul (lihat komentar di atas): dimuat malas.
      const { env } = await import("../../../config/env.js");
      if (!env.BONUS_LOCK_ENABLED) {
        throw new AppError("Penarikan deposit belum tersedia.", StatusCodes.FORBIDDEN, "DEPOSIT_WITHDRAWAL_DISABLED");
      }
      if (input.amount.lt(env.DEPOSIT_WITHDRAWAL_MIN)) {
        throw new AppError(
          `Minimal penarikan deposit Rp${env.DEPOSIT_WITHDRAWAL_MIN.toLocaleString("id-ID")}.`,
          StatusCodes.BAD_REQUEST,
          "DEPOSIT_WITHDRAWAL_MINIMUM_NOT_MET"
        );
      }
      const fee = new Prisma.Decimal(env.DEPOSIT_WITHDRAWAL_FEE);
      if (input.amount.lte(fee)) {
        throw new AppError("Jumlah harus lebih besar dari biaya penarikan.", StatusCodes.BAD_REQUEST, "DEPOSIT_WITHDRAWAL_AMOUNT_INVALID");
      }
      return this.walletRepository.reserveWithdrawal({ ...input, fee, source: "DEPOSIT" }, tx);
    });
  }

  listWithdrawals(input: {
    userId?: string;
    status?: WithdrawalStatus;
    dateFrom?: Date;
    dateTo?: Date;
    page: number;
    pageSize: number;
  }) {
    return this.walletRepository.listWithdrawals({
      ...input,
      pageSize: Math.min(input.pageSize, 100)
    });
  }

  approveWithdrawal(input: { withdrawalId: string; adminId: string; actorRole?: UserRole; vipThreshold?: number; note?: string }) {
    return this.walletRepository.transaction((tx) => this.walletRepository.approveWithdrawal(input, tx));
  }

  rejectWithdrawal(input: { withdrawalId: string; adminId: string; note?: string }) {
    return this.walletRepository.transaction((tx) => this.walletRepository.rejectWithdrawal(input, tx));
  }

  markWithdrawalPaid(input: { withdrawalId: string; adminId: string; actorRole?: UserRole; note?: string }) {
    return this.walletRepository.transaction((tx) => this.walletRepository.markWithdrawalPaid(input, tx));
  }

  getWithdrawal(withdrawalId: string) {
    return this.walletRepository.getWithdrawal(withdrawalId);
  }

  // --- Transfer P2P (Stage R2.10) -------------------------------------

  async transfer(input: {
    fromUserId: string;
    recipientPhone: string;
    amount: Prisma.Decimal;
    note?: string;
    idempotencyKey: string;
  }) {
    if (input.amount.lt(MIN_TRANSFER_AMOUNT)) {
      throw new AppError(
        `Minimum transfer is Rp${MIN_TRANSFER_AMOUNT.toString()}`,
        StatusCodes.BAD_REQUEST,
        "TRANSFER_MINIMUM_NOT_MET"
      );
    }
    if (input.amount.gt(MAX_TRANSFER_PER_TRANSACTION)) {
      throw new AppError(
        `Maximum transfer per transaction is Rp${MAX_TRANSFER_PER_TRANSACTION.toString()}`,
        StatusCodes.BAD_REQUEST,
        "TRANSFER_MAX_PER_TRANSACTION_EXCEEDED"
      );
    }

    const recipient = await this.walletRepository.findActiveUserByPhone(input.recipientPhone);
    if (!recipient) {
      throw new AppError("Recipient account not found", StatusCodes.NOT_FOUND, "TRANSFER_RECIPIENT_NOT_FOUND");
    }
    if (recipient.id === input.fromUserId) {
      throw new AppError("Cannot transfer to your own account", StatusCodes.BAD_REQUEST, "TRANSFER_SELF_NOT_ALLOWED");
    }

    // Idempotency diperiksa terhadap payload TERNORMALISASI (recipient yang
    // sama + nominal yang sama = replay; salah satunya beda = 409). Pola
    // sama dengan PpobService.purchase.
    const existing = await this.walletRepository.findTransferByIdempotencyKey(
      input.fromUserId,
      input.idempotencyKey
    );
    if (existing) {
      if (existing.toUserId !== recipient.id || !existing.amount.equals(input.amount)) {
        throw new AppError(
          "Idempotency key already used for a different transfer",
          StatusCodes.CONFLICT,
          "TRANSFER_IDEMPOTENCY_CONFLICT"
        );
      }
      return { transfer: existing, replayed: true };
    }

    try {
      const transfer = await this.withSerializationRetry(() => this.walletRepository.transaction(async (tx) => {
        const fromWallet = await this.walletRepository.getOrCreateWallet(input.fromUserId, tx);
        const todaySum = await this.walletRepository.sumTodayTransferOut(fromWallet.id, tx);
        if (todaySum.plus(input.amount).gt(MAX_TRANSFER_PER_DAY)) {
          throw new AppError(
            `Daily transfer limit of Rp${MAX_TRANSFER_PER_DAY.toString()} exceeded`,
            StatusCodes.BAD_REQUEST,
            "TRANSFER_DAILY_LIMIT_EXCEEDED"
          );
        }
        return this.walletRepository.createTransfer(
          {
            fromUserId: input.fromUserId,
            toUserId: recipient.id,
            amount: input.amount,
            ...(input.note !== undefined ? { note: input.note } : {}),
            idempotencyKey: input.idempotencyKey
          },
          tx
        );
      }));
      // Setelah commit; replay idempoten tidak sampai sini, jadi tidak menggandakan.
      pushQuietly(this.push, recipient.id, accountPushMessages.transferReceived, { type: "wallet_transfer" });
      return { transfer, replayed: false };
    } catch (error) {
      // Dua permintaan ber-Idempotency-Key sama dapat lolos pre-check di atas
      // secara konkuren; unique constraint (fromUserId, idempotencyKey)
      // memastikan hanya satu yang men-debit. Yang kalah mengambil transfer
      // pemenang, BUKAN men-debit kedua kalinya.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const winner = await this.walletRepository.findTransferByIdempotencyKey(
          input.fromUserId,
          input.idempotencyKey
        );
        if (winner) {
          return { transfer: winner, replayed: true };
        }
      }
      throw error;
    }
  }

  /**
   * Transaksi Serializable yang bertabrakan dengan transfer lain dari akun yang sama (P2034) diulang beberapa kali.
   * Yang kalah bertemu saldo terbaru dan dijawab dengan benar (mis. saldo kurang), bukan 500. Bila tetap bertabrakan
   * jawabannya 409 yang jelas; tidak ada saldo yang pernah bergerak pada percobaan yang gagal.
   */
  private async withSerializationRetry<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2037");
        if (!conflict) throw error;
        if (attempt >= 3) {
          throw new AppError("Saldo sedang berubah, coba lagi.", StatusCodes.CONFLICT, "TRANSFER_BALANCE_BUSY");
        }
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
      }
    }
  }

  listTransfers(input: { userId: string; page: number; pageSize: number }) {
    return this.walletRepository.listTransfers({
      ...input,
      pageSize: Math.min(input.pageSize, 100)
    });
  }

  // --- Top up via Midtrans/DOKU, kanal WEB saja (Stage R2.10) ---------

  createTopUpOrder(input: { userId: string; amount: Prisma.Decimal }) {
    return this.walletRepository.createTopUpOrder(input);
  }

  async getTopUpOrder(input: { userId: string; role: UserRole; orderId: string }) {
    const order = await this.walletRepository.findTopUpOrderById(input.orderId);
    if (!order) {
      throw new AppError("Wallet top-up order not found", StatusCodes.NOT_FOUND, "WALLET_TOPUP_ORDER_NOT_FOUND");
    }
    if (order.userId !== input.userId) {
      throw new AppError("You are not allowed to view this top-up order", StatusCodes.FORBIDDEN, "WALLET_TOPUP_ORDER_FORBIDDEN");
    }
    return order;
  }
}
