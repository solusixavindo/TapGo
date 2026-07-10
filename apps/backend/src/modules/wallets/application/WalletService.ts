import { Prisma, WithdrawalStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { WalletRepository } from "../domain/WalletRepository.js";

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
}
