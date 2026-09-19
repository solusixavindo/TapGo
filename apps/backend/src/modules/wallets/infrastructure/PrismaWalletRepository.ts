import { randomBytes } from "node:crypto";
import { PaymentStatus, Prisma, PrismaClient, UserRole, WithdrawalStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { roleSatisfies } from "../../../core/security/roleHierarchy.js";
import { phoneLookupVariants } from "../../../core/security/phone.js";
import {
  BankAccountSnapshot,
  TransferRecipient,
  WalletRepository,
  WalletSnapshot,
  WalletTopUpOrderItem,
  WalletTransactionItem,
  WalletTransferItem,
  WithdrawalItem
} from "../domain/WalletRepository.js";

/**
 * Ambang default penarikan yang wajib disetujui SUPER_ADMIN_VIP. Controller
 * memasok nilai dari env; konstanta ini hanya cadangan fail-closed. Berkas ini
 * sengaja tidak mengimpor config/env agar tidak memaksa env dimuat lebih awal.
 */
const DEFAULT_WITHDRAWAL_VIP_THRESHOLD = 2_000_000;

/** Referensi publik: PREFIX- + 10 karakter alfabet aman (tanpa 0/O/1/I) — pola sama dengan PPOB. */
function generateReference(prefix: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let suffix = "";
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `${prefix}-${suffix}`;
}

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
    input: { withdrawalId: string; adminId: string; actorRole?: UserRole; vipThreshold?: number; note?: string },
    tx: Prisma.TransactionClient
  ): Promise<WithdrawalItem> {
    const withdrawal = await tx.withdrawal.findUnique({ where: { id: input.withdrawalId } });
    if (!withdrawal) {
      throw new AppError("Withdrawal not found", StatusCodes.NOT_FOUND, "WITHDRAWAL_NOT_FOUND");
    }

    if (withdrawal.status !== "PENDING") {
      throw new AppError("Only pending withdrawals can be approved", StatusCodes.CONFLICT, "WITHDRAWAL_INVALID_STATE");
    }

    // Nominal besar wajib disetujui pemilik (SUPER_ADMIN_VIP). Peran yang tidak
    // diketahui diperlakukan sebagai kurang berwenang (fail closed).
    if (
      withdrawal.amount.gte(input.vipThreshold ?? DEFAULT_WITHDRAWAL_VIP_THRESHOLD) &&
      !(input.actorRole && roleSatisfies(input.actorRole, "SUPER_ADMIN_VIP"))
    ) {
      throw new AppError(
        "Penarikan dengan nominal ini harus disetujui Super Admin VIP.",
        StatusCodes.FORBIDDEN,
        "WITHDRAWAL_VIP_REQUIRED"
      );
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

  // --- Transfer P2P (Stage R2.10) -------------------------------------

  async findActiveUserByPhone(phone: string): Promise<TransferRecipient | null> {
    const user = await this.prisma.user.findFirst({
      where: { phone: { in: phoneLookupVariants(phone) }, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, fullName: true, phone: true }
    });
    return user;
  }

  async findTransferByIdempotencyKey(fromUserId: string, idempotencyKey: string): Promise<WalletTransferItem | null> {
    return this.prisma.walletTransfer.findUnique({
      where: { fromUserId_idempotencyKey: { fromUserId, idempotencyKey } }
    });
  }

  async sumTodayTransferOut(walletId: string, tx: Prisma.TransactionClient): Promise<Prisma.Decimal> {
    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);
    const result = await tx.walletTransaction.aggregate({
      where: {
        walletId,
        type: "TRANSFER_OUT",
        createdAt: { gte: startOfDayUtc }
      },
      _sum: { amount: true }
    });
    // amount debit disimpan negatif; jumlahkan nilai absolutnya.
    return (result._sum.amount ?? new Prisma.Decimal(0)).abs();
  }

  async createTransfer(
    input: {
      fromUserId: string;
      toUserId: string;
      amount: Prisma.Decimal;
      note?: string;
      idempotencyKey: string;
    },
    tx: Prisma.TransactionClient
  ): Promise<WalletTransferItem> {
    const fromWallet = await this.getOrCreateWallet(input.fromUserId, tx);
    const toWallet = await this.getOrCreateWallet(input.toUserId, tx);

    const debited = await tx.wallet.updateMany({
      where: { id: fromWallet.id, cashBalance: { gte: input.amount } },
      data: {
        cashBalance: { decrement: input.amount },
        balance: { decrement: input.amount }
      }
    });
    if (debited.count !== 1) {
      throw new AppError("Insufficient wallet balance", StatusCodes.BAD_REQUEST, "INSUFFICIENT_BALANCE");
    }

    await tx.wallet.update({
      where: { id: toWallet.id },
      data: {
        cashBalance: { increment: input.amount },
        balance: { increment: input.amount }
      }
    });

    const transfer = await tx.walletTransfer.create({
      data: {
        publicReference: generateReference("TRF"),
        idempotencyKey: input.idempotencyKey,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amount: input.amount,
        ...(input.note !== undefined ? { note: input.note } : {})
      }
    });

    await tx.walletTransaction.create({
      data: {
        walletId: fromWallet.id,
        type: "TRANSFER_OUT",
        amount: input.amount.neg(),
        referenceType: "WALLET_TRANSFER",
        referenceId: transfer.id,
        metadata: { toUserId: input.toUserId, publicReference: transfer.publicReference }
      }
    });
    await tx.walletTransaction.create({
      data: {
        walletId: toWallet.id,
        type: "TRANSFER_IN",
        amount: input.amount,
        referenceType: "WALLET_TRANSFER",
        referenceId: transfer.id,
        metadata: { fromUserId: input.fromUserId, publicReference: transfer.publicReference }
      }
    });

    return transfer;
  }

  async listTransfers(input: { userId: string; page: number; pageSize: number }): Promise<WalletTransferItem[]> {
    return this.prisma.walletTransfer.findMany({
      where: { OR: [{ fromUserId: input.userId }, { toUserId: input.userId }] },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize
    });
  }

  // --- Top up via Midtrans/DOKU, kanal WEB saja (Stage R2.10) ---------

  async createTopUpOrder(input: { userId: string; amount: Prisma.Decimal }): Promise<WalletTopUpOrderItem> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reference = generateReference("TOPUP");
      const existing = await this.prisma.walletTopUpOrder.findUnique({ where: { reference } });
      if (existing) continue;
      return this.prisma.walletTopUpOrder.create({
        data: {
          userId: input.userId,
          reference,
          amount: input.amount,
          status: "PENDING"
        }
      });
    }
    throw new AppError("Failed to allocate a unique top-up reference", StatusCodes.INTERNAL_SERVER_ERROR, "WALLET_TOPUP_REFERENCE_EXHAUSTED");
  }

  async findTopUpOrderById(orderId: string): Promise<WalletTopUpOrderItem | null> {
    return this.prisma.walletTopUpOrder.findUnique({ where: { id: orderId } });
  }

  async findTopUpOrderByReference(reference: string): Promise<WalletTopUpOrderItem | null> {
    return this.prisma.walletTopUpOrder.findUnique({ where: { reference } });
  }

  async updateTopUpOrderPaymentMetadata(input: {
    orderId: string;
    method: string;
    provider: string;
    providerReference: string;
    metadata: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.walletTopUpOrder.updateMany({
      where: { id: input.orderId, status: "PENDING" },
      data: {
        method: input.method,
        provider: input.provider,
        providerReference: input.providerReference,
        metadata: input.metadata
      }
    });
  }

  async markTopUpOrderPaid(input: { orderId: string; providerReference: string; paymentType?: string }): Promise<WalletTopUpOrderItem | null> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.walletTopUpOrder.findUnique({ where: { id: input.orderId } });
      if (!order) {
        throw new AppError("Wallet top-up order not found", StatusCodes.NOT_FOUND, "WALLET_TOPUP_ORDER_NOT_FOUND");
      }

      // Idempotent: updateMany + count guard, pola sama dengan
      // MembershipOrderService.markPaymentSuccess — callback duplikat/replay
      // menemukan count===0 dan dianggap sudah selesai, bukan diproses ulang.
      const updated = await tx.walletTopUpOrder.updateMany({
        where: { id: input.orderId, status: "PENDING" },
        data: {
          status: "PAID",
          paidAt: new Date(),
          providerReference: input.providerReference,
          ...(input.paymentType
            ? {
                metadata: {
                  ...(order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata)
                    ? (order.metadata as Record<string, Prisma.InputJsonValue>)
                    : {}),
                  paymentType: input.paymentType
                }
              }
            : {})
        }
      });
      if (updated.count !== 1) {
        return null;
      }

      const wallet = await this.getOrCreateWallet(order.userId, tx);
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          cashBalance: { increment: order.amount },
          balance: { increment: order.amount }
        }
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "TOPUP",
          amount: order.amount,
          referenceType: "WALLET_TOPUP",
          referenceId: order.id,
          metadata: { reference: order.reference, providerReference: input.providerReference }
        }
      });

      return tx.walletTopUpOrder.findUniqueOrThrow({ where: { id: input.orderId } });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000
    });
  }

  async markTopUpOrderTerminal(input: { orderId: string; status: PaymentStatus; providerReference?: string }): Promise<void> {
    await this.prisma.walletTopUpOrder.updateMany({
      where: { id: input.orderId, status: "PENDING" },
      data: {
        status: input.status,
        ...(input.providerReference !== undefined ? { providerReference: input.providerReference } : {})
      }
    });
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
