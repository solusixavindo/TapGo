import { Prisma, UserRole, WithdrawalStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
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
  constructor(private readonly walletRepository: WalletRepository) {}

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
  }) {
    if (input.amount.lt(50000)) {
      throw new AppError("Minimum withdrawal is Rp50.000", StatusCodes.BAD_REQUEST, "WITHDRAWAL_MINIMUM_NOT_MET");
    }
    return this.walletRepository.transaction((tx) => this.walletRepository.reserveWithdrawal(input, tx));
  }

  listWithdrawals(input: {
    userId?: string;
    status?: WithdrawalStatus;
    page: number;
    pageSize: number;
  }) {
    return this.walletRepository.listWithdrawals({
      ...input,
      pageSize: Math.min(input.pageSize, 100)
    });
  }

  approveWithdrawal(input: { withdrawalId: string; adminId: string; note?: string }) {
    return this.walletRepository.transaction((tx) => this.walletRepository.approveWithdrawal(input, tx));
  }

  rejectWithdrawal(input: { withdrawalId: string; adminId: string; note?: string }) {
    return this.walletRepository.transaction((tx) => this.walletRepository.rejectWithdrawal(input, tx));
  }

  markWithdrawalPaid(input: { withdrawalId: string; adminId: string; note?: string }) {
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
      const transfer = await this.walletRepository.transaction(async (tx) => {
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
      });
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
