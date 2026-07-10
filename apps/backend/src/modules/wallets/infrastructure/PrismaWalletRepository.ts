import { Prisma, PrismaClient, WithdrawalStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import {
  BankAccountSnapshot,
  WalletRepository,
  WalletSnapshot,
  WalletTransactionItem,
  WithdrawalItem
} from "../domain/WalletRepository.js";

export class PrismaWalletRepository implements WalletRepository {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(handler, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000
    });
  }

  async getOrCreateWallet(userId: string, tx: Prisma.TransactionClient = this.prisma): Promise<WalletSnapshot> {
    return tx.wallet.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        balance: new Prisma.Decimal(0),
        cashBalance: new Prisma.Decimal(0),
        ppobBalance: new Prisma.Decimal(0),
        currency: "IDR"
      }
    });
  }

  async getWalletByUserId(userId: string): Promise<WalletSnapshot> {
    return this.getOrCreateWallet(userId);
  }

  async getTransactions(userId: string, page: number, pageSize: number): Promise<WalletTransactionItem[]> {
    const wallet = await this.getOrCreateWallet(userId);

    return this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      select: {
        id: true,
        type: true,
        amount: true,
        referenceType: true,
        referenceId: true,
        metadata: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    });
  }

  async getBankAccount(userId: string): Promise<BankAccountSnapshot> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { bankAccount: true }
    });
    const account = user?.bankAccount;
    if (!account || typeof account !== "object" || Array.isArray(account)) {
      return null;
    }
    const data = account as Record<string, unknown>;
    return {
      bankName: String(data.bankName ?? ""),
      ...(typeof data.bankCode === "string" ? { bankCode: data.bankCode } : {}),
      accountNumber: String(data.accountNumber ?? ""),
      accountHolderName: String(data.accountHolderName ?? ""),
      ...(typeof data.updatedAt === "string" ? { updatedAt: data.updatedAt } : {})
    };
  }

  async updateBankAccount(input: {
    userId: string;
    bankName: string;
    bankCode?: string;
    accountNumber: string;
    accountHolderName: string;
  }): Promise<NonNullable<BankAccountSnapshot>> {
    const bankAccount = {
      bankName: input.bankName,
      ...(input.bankCode !== undefined ? { bankCode: input.bankCode } : {}),
      accountNumber: input.accountNumber,
      accountHolderName: input.accountHolderName,
      updatedAt: new Date().toISOString()
    };
    await this.prisma.user.update({
      where: { id: input.userId },
      data: { bankAccount }
    });
    return bankAccount;
  }

  async reserveWithdrawal(
    input: {
      userId: string;
      amount: Prisma.Decimal;
      bankName: string;
      bankCode?: string;
      accountNumber: string;
      accountHolderName: string;
      fee?: Prisma.Decimal;
      notes?: string;
    },
    tx: Prisma.TransactionClient
  ): Promise<WithdrawalItem> {
    const fee = input.fee ?? new Prisma.Decimal(0);
    const finalAmount = input.amount.minus(fee);
    if (finalAmount.lte(0)) {
      throw new AppError("Withdrawal final amount must be positive", StatusCodes.BAD_REQUEST, "WITHDRAWAL_FINAL_AMOUNT_INVALID");
    }

    const wallet = await this.getOrCreateWallet(input.userId, tx);
    const reserved = await tx.wallet.updateMany({
      where: {
        id: wallet.id,
        cashBalance: { gte: input.amount }
      },
      data: {
        cashBalance: {
          decrement: input.amount
        },
        balance: {
          decrement: input.amount
        }
      }
    });

    if (reserved.count !== 1) {
      throw new AppError("Insufficient wallet balance", StatusCodes.BAD_REQUEST, "INSUFFICIENT_BALANCE");
    }

    const withdrawal = await tx.withdrawal.create({
      data: {
        walletId: wallet.id,
        userId: input.userId,
        amount: input.amount,
        fee,
        finalAmount,
        bankName: input.bankName,
        accountNumber: input.accountNumber,
        accountHolderName: input.accountHolderName,
        bankAccount: {
          bankName: input.bankName,
          ...(input.bankCode !== undefined ? { bankCode: input.bankCode } : {}),
          accountNumber: input.accountNumber,
          accountHolderName: input.accountHolderName
        },
        ...(input.notes !== undefined ? { notes: input.notes, note: input.notes } : {})
      }
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "WITHDRAWAL_REQUEST",
        amount: input.amount.neg(),
        referenceType: "WITHDRAWAL_REQUEST",
        referenceId: withdrawal.id,
        metadata: {
          status: withdrawal.status,
          reserved: true
        }
      }
    });

    return withdrawal;
  }

  async listWithdrawals(input: {
    userId?: string;
    status?: WithdrawalStatus;
    page: number;
    pageSize: number;
  }): Promise<WithdrawalItem[]> {
    return this.prisma.withdrawal.findMany({
      where: {
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.status ? { status: input.status } : {})
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            membership: true
          }
        }
      },
      orderBy: { requestedAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize
    });
  }

  async getWithdrawal(withdrawalId: string): Promise<WithdrawalItem | null> {
    return this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  }

  async approveWithdrawal(
    input: { withdrawalId: string; adminId: string; note?: string },
    tx: Prisma.TransactionClient
  ): Promise<WithdrawalItem> {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: input.withdrawalId } });
    if (!withdrawal) {
      throw new AppError("Withdrawal not found", StatusCodes.NOT_FOUND, "WITHDRAWAL_NOT_FOUND");
    }

    if (withdrawal.status !== "PENDING") {
      throw new AppError("Only pending withdrawals can be approved", StatusCodes.CONFLICT, "WITHDRAWAL_INVALID_STATE");
    }

    const approvedAt = new Date();
    const updated = await tx.withdrawal.update({
      where: { id: input.withdrawalId },
      data: {
        status: "APPROVED",
        approvedBy: input.adminId,
        approvedAt,
        reviewedBy: input.adminId,
        reviewedAt: approvedAt,
        ...(input.note !== undefined ? { note: input.note, notes: input.note } : {})
      }
    });

    await this.logAdminAction(tx, input.adminId, "WITHDRAWAL_APPROVED", updated.id, {
      amount: updated.amount.toString(),
      userId: updated.userId
    });

    return updated;
  }

  async rejectWithdrawal(
    input: { withdrawalId: string; adminId: string; note?: string },
    tx: Prisma.TransactionClient
  ): Promise<WithdrawalItem> {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: input.withdrawalId } });
    if (!withdrawal) {
      throw new AppError("Withdrawal not found", StatusCodes.NOT_FOUND, "WITHDRAWAL_NOT_FOUND");
    }

    if (withdrawal.status !== "PENDING") {
      throw new AppError("Only pending withdrawals can be rejected", StatusCodes.CONFLICT, "WITHDRAWAL_INVALID_STATE");
    }

    const existingRefund = await tx.walletTransaction.findFirst({
      where: {
        walletId: withdrawal.walletId,
        type: "WITHDRAWAL_REFUND",
        referenceType: "WITHDRAWAL_REJECTED",
        referenceId: withdrawal.id
      },
      select: { id: true }
    });

    if (existingRefund) {
      throw new AppError("Withdrawal refund has already been posted", StatusCodes.CONFLICT, "WITHDRAWAL_REFUND_ALREADY_POSTED");
    }

    const rejectedAt = new Date();
    const updated = await tx.withdrawal.update({
      where: { id: input.withdrawalId },
      data: {
        status: "REJECTED",
        rejectedBy: input.adminId,
        rejectedAt,
        reviewedBy: input.adminId,
        reviewedAt: rejectedAt,
        ...(input.note !== undefined ? { note: input.note, notes: input.note } : {})
      }
    });

    await tx.wallet.update({
      where: { id: withdrawal.walletId },
      data: {
        cashBalance: {
          increment: withdrawal.amount
        },
        balance: {
          increment: withdrawal.amount
        }
      }
    });

    await tx.walletTransaction.create({
      data: {
        walletId: withdrawal.walletId,
        type: "WITHDRAWAL_REFUND",
        amount: withdrawal.amount,
        referenceType: "WITHDRAWAL_REJECTED",
        referenceId: withdrawal.id,
        metadata: {
          status: updated.status,
          adminId: input.adminId,
          note: input.note
        }
      }
    });

    await this.logAdminAction(tx, input.adminId, "WITHDRAWAL_REJECTED", updated.id, {
      amount: updated.amount.toString(),
      userId: updated.userId
    });

    return updated;
  }

  async markWithdrawalPaid(
    input: { withdrawalId: string; adminId: string; note?: string },
    tx: Prisma.TransactionClient
  ): Promise<WithdrawalItem> {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: input.withdrawalId } });
    if (!withdrawal) {
      throw new AppError("Withdrawal not found", StatusCodes.NOT_FOUND, "WITHDRAWAL_NOT_FOUND");
    }

    if (withdrawal.status !== "APPROVED") {
      throw new AppError("Only approved withdrawals can be marked as paid", StatusCodes.CONFLICT, "WITHDRAWAL_INVALID_STATE");
    }

    const updated = await tx.withdrawal.update({
      where: { id: input.withdrawalId },
      data: {
        status: "PAID",
        reviewedBy: input.adminId,
        reviewedAt: withdrawal.reviewedAt ?? new Date(),
        paidAt: new Date(),
        note: input.note ?? withdrawal.note,
        notes: input.note ?? withdrawal.notes
      }
    });

    await tx.walletTransaction.create({
      data: {
        walletId: withdrawal.walletId,
        type: "ADJUSTMENT",
        amount: new Prisma.Decimal(0),
        referenceType: "WITHDRAWAL_PAID",
        referenceId: withdrawal.id,
        metadata: {
          status: updated.status,
          adminId: input.adminId,
          note: input.note
        }
      }
    });

    await this.logAdminAction(tx, input.adminId, "WITHDRAWAL_PAID", updated.id, {
      amount: updated.amount.toString(),
      userId: updated.userId
    });

    return updated;
  }

  private async logAdminAction(
    tx: Prisma.TransactionClient,
    adminId: string,
    action: string,
    withdrawalId: string,
    metadata: Prisma.InputJsonValue
  ) {
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action,
        entityType: "withdrawal",
        entityId: withdrawalId,
        metadata
      }
    });
  }
}
