import { Prisma, PrismaClient } from "@prisma/client";
import { randomInt } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { lazyPushNotifier } from "../../notifications/application/pushServiceFactory.js";
import { accountPushMessages, pushQuietly } from "../../notifications/application/accountNotifications.js";
import type { PushNotifier } from "../../notifications/application/rideNotifications.js";
import { PrismaWalletRepository } from "../infrastructure/PrismaWalletRepository.js";

export const MANUAL_TOPUP_PROVIDER = "MANUAL_BANK";
const MAX_OPEN_ORDERS_PER_USER = 3;

/**
 * Top up saldo lewat transfer bank manual. Pengguna membuat pesanan di web,
 * mendapat nominal dengan kode unik (mis. Rp100.347) dan rekening perusahaan;
 * Super Admin mencocokkan mutasi bank lalu mengonfirmasi. Semua pembukuan saldo
 * memakai ulang markTopUpOrderPaid (transaksi Serializable, PENDING->PAID
 * bersyarat, ledger TOPUP) sehingga konfirmasi ganda tidak menambah saldo dua kali.
 */
export class ManualTopUpService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly walletRepository = new PrismaWalletRepository(prisma),
    private readonly push: PushNotifier = lazyPushNotifier,
  ) {}

  private assertEnabled() {
    if (!env.MANUAL_TOPUP_ENABLED) {
      throw new AppError("Top up manual belum tersedia.", StatusCodes.FORBIDDEN, "MANUAL_TOPUP_DISABLED");
    }
  }

  private bankDetails() {
    if (!env.MANUAL_TOPUP_BANK_NAME || !env.MANUAL_TOPUP_ACCOUNT_NUMBER || !env.MANUAL_TOPUP_ACCOUNT_HOLDER) {
      throw new AppError("Rekening tujuan top up belum dikonfigurasi.", StatusCodes.SERVICE_UNAVAILABLE, "MANUAL_TOPUP_NOT_CONFIGURED");
    }
    return {
      bankName: env.MANUAL_TOPUP_BANK_NAME,
      accountNumber: env.MANUAL_TOPUP_ACCOUNT_NUMBER,
      accountHolder: env.MANUAL_TOPUP_ACCOUNT_HOLDER,
    };
  }

  private view(order: { id: string; reference: string; status: string; amount: Prisma.Decimal; expiresAt: Date | null; createdAt: Date; metadata: Prisma.JsonValue | null }) {
    const meta = (order.metadata ?? {}) as { baseAmount?: number; uniqueCode?: number };
    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      transferAmount: order.amount.toNumber(),
      baseAmount: meta.baseAmount ?? null,
      uniqueCode: meta.uniqueCode ?? null,
      expiresAt: order.expiresAt,
      createdAt: order.createdAt,
      bank: this.bankDetails(),
    };
  }

  /** Nominal transfer = jumlah top up + kode unik 1..999, unik di antara pesanan terbuka. */
  async createOrder(input: { userId: string; amount: number }) {
    this.assertEnabled();
    const bank = this.bankDetails();
    void bank;
    if (!Number.isInteger(input.amount) || input.amount < env.MANUAL_TOPUP_MIN_AMOUNT || input.amount > env.MANUAL_TOPUP_MAX_AMOUNT) {
      throw new AppError(
        `Nominal top up harus antara Rp${env.MANUAL_TOPUP_MIN_AMOUNT.toLocaleString("id-ID")} dan Rp${env.MANUAL_TOPUP_MAX_AMOUNT.toLocaleString("id-ID")}.`,
        StatusCodes.BAD_REQUEST,
        "MANUAL_TOPUP_AMOUNT_INVALID",
      );
    }
    const now = new Date();
    const order = await this.prisma.$transaction(
      async (tx) => {
        const open = await tx.walletTopUpOrder.count({
          where: { userId: input.userId, provider: MANUAL_TOPUP_PROVIDER, status: "PENDING", expiresAt: { gt: now } },
        });
        if (open >= MAX_OPEN_ORDERS_PER_USER) {
          throw new AppError(
            "Anda masih memiliki beberapa top up yang belum dibayar. Selesaikan atau tunggu kedaluwarsa dulu.",
            StatusCodes.TOO_MANY_REQUESTS,
            "MANUAL_TOPUP_TOO_MANY_OPEN",
          );
        }
        const taken = await tx.walletTopUpOrder.findMany({
          where: {
            provider: MANUAL_TOPUP_PROVIDER,
            status: "PENDING",
            expiresAt: { gt: now },
            amount: { gte: input.amount + 1, lte: input.amount + 999 },
          },
          select: { amount: true },
        });
        const used = new Set(taken.map((t) => t.amount.toNumber() - input.amount));
        const free: number[] = [];
        for (let code = 1; code <= 999; code += 1) if (!used.has(code)) free.push(code);
        if (free.length === 0) {
          throw new AppError("Sistem sedang padat. Coba lagi beberapa menit lagi.", StatusCodes.SERVICE_UNAVAILABLE, "MANUAL_TOPUP_NO_CODE");
        }
        const uniqueCode = free[randomInt(free.length)]!;
        const reference = `MTOP-${Date.now().toString(36).toUpperCase()}${randomInt(1000, 9999)}`;
        return tx.walletTopUpOrder.create({
          data: {
            userId: input.userId,
            reference,
            amount: new Prisma.Decimal(input.amount + uniqueCode),
            status: "PENDING",
            method: "BANK_TRANSFER",
            provider: MANUAL_TOPUP_PROVIDER,
            metadata: { baseAmount: input.amount, uniqueCode },
            expiresAt: new Date(now.getTime() + env.MANUAL_TOPUP_EXPIRY_HOURS * 3600_000),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.view(order);
  }

  async getOrderForUser(input: { userId: string; orderId: string }) {
    const order = await this.prisma.walletTopUpOrder.findFirst({
      where: { id: input.orderId, userId: input.userId, provider: MANUAL_TOPUP_PROVIDER },
    });
    if (!order) throw new AppError("Top up tidak ditemukan", StatusCodes.NOT_FOUND, "MANUAL_TOPUP_NOT_FOUND");
    return this.view(order);
  }

  async listPendingForAdmin(status: "PENDING" | "PAID" | "CANCELLED" = "PENDING") {
    const rows = await this.prisma.walletTopUpOrder.findMany({
      where: { provider: MANUAL_TOPUP_PROVIDER, status },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { fullName: true, phone: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      transferAmount: r.amount.toNumber(),
      baseAmount: ((r.metadata ?? {}) as { baseAmount?: number }).baseAmount ?? null,
      memberName: r.user.fullName,
      memberPhone: r.user.phone,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      expired: r.status === "PENDING" && r.expiresAt !== null && r.expiresAt.getTime() < Date.now(),
      paidAt: r.paidAt,
    }));
  }

  /**
   * Super Admin mengonfirmasi bahwa transfer sebesar nominal unik sudah masuk.
   * Idempoten: konfirmasi ulang mengembalikan status sekarang tanpa menambah saldo.
   */
  async confirm(input: { orderId: string; actorId: string }) {
    const order = await this.prisma.walletTopUpOrder.findFirst({
      where: { id: input.orderId, provider: MANUAL_TOPUP_PROVIDER },
    });
    if (!order) throw new AppError("Top up tidak ditemukan", StatusCodes.NOT_FOUND, "MANUAL_TOPUP_NOT_FOUND");
    if (order.status === "PAID") return { id: order.id, status: "PAID" as const, alreadyConfirmed: true };
    if (order.status !== "PENDING") {
      throw new AppError("Top up ini sudah ditutup dan tidak bisa dikonfirmasi.", StatusCodes.CONFLICT, "MANUAL_TOPUP_NOT_PENDING");
    }
    if (order.expiresAt && order.expiresAt.getTime() < Date.now()) {
      // Transfer terlambat tetap sah, tetapi hanya bila nominal uniknya tidak
      // sedang dipakai pesanan terbuka lain (kalau tidak, tidak bisa dipastikan siapa pengirimnya).
      const clash = await this.prisma.walletTopUpOrder.count({
        where: {
          provider: MANUAL_TOPUP_PROVIDER,
          status: "PENDING",
          amount: order.amount,
          id: { not: order.id },
          expiresAt: { gt: new Date() },
        },
      });
      if (clash > 0) {
        throw new AppError(
          "Nominal ini sedang dipakai top up lain yang masih berlaku. Periksa mutasi bank secara manual.",
          StatusCodes.CONFLICT,
          "MANUAL_TOPUP_AMOUNT_AMBIGUOUS",
        );
      }
    }
    const paid = await this.walletRepository.markTopUpOrderPaid({
      orderId: order.id,
      providerReference: `MANUAL:${input.actorId}`,
      paymentType: "bank_transfer",
    });
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "MANUAL_TOPUP_CONFIRMED",
        entityType: "WALLET_TOPUP_ORDER",
        entityId: order.id,
        metadata: { reference: order.reference, amount: order.amount.toString(), userId: order.userId, applied: paid !== null },
      },
    });
    if (paid) pushQuietly(this.push, paid.userId, accountPushMessages.topUpSuccess, { type: "wallet_topup" });
    return { id: order.id, status: "PAID" as const, alreadyConfirmed: paid === null };
  }

  /** Menutup top up yang tidak pernah dibayar / salah; tidak mengubah saldo. */
  async reject(input: { orderId: string; actorId: string; reason?: string }) {
    const closed = await this.prisma.walletTopUpOrder.updateMany({
      where: { id: input.orderId, provider: MANUAL_TOPUP_PROVIDER, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (closed.count !== 1) {
      throw new AppError("Top up tidak ditemukan atau sudah diproses.", StatusCodes.CONFLICT, "MANUAL_TOPUP_NOT_PENDING");
    }
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "MANUAL_TOPUP_REJECTED",
        entityType: "WALLET_TOPUP_ORDER",
        entityId: input.orderId,
        metadata: { reason: input.reason ?? null },
      },
    });
    return { id: input.orderId, status: "CANCELLED" as const };
  }
}
