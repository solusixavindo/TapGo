import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import {
  MANUAL_BANK_PROVIDER,
  openManualTransferAmounts,
  pickFreeUniqueCode,
} from "../../payments/application/manualTransferAmounts.js";
import { membershipPurchaseEnabled } from "./purchaseChannel.js";
import { MembershipOrderService } from "./MembershipOrderService.js";

type TransferMeta = {
  baseAmount?: number;
  uniqueCode?: number;
  transferAmount?: number;
  expiresAt?: string;
  reference?: string;
};

/**
 * Pembayaran membership lewat transfer bank manual (kanal WEB).
 *
 * Dipakai selama gateway (Midtrans/DOKU) belum aktif. Alurnya meniru top up
 * manual: member mendapat nominal dengan kode unik (mis. Rp3.000.347) dan
 * rekening perusahaan, lalu Super Admin mencocokkan mutasi bank dan
 * mengonfirmasi. Konfirmasi memakai ulang markPaymentSuccess — transaksi
 * Serializable, invoice PENDING->PAID bersyarat — jadi konfirmasi ganda tidak
 * menggandakan apa pun, dan order kanal WEB tetap berhenti di PAID sampai
 * dokumen KYC diverifikasi admin (activateVerifiedOrder). Membership, benefit
 * PPOB, bonus sponsor, dan bonus level TIDAK berjalan saat uang dikonfirmasi.
 *
 * Nominal kode unik tidak mengubah harga: MembershipPayment.amount dan
 * Invoice.amount tetap sebesar harga paket. Nominal transfer (harga + kode)
 * hanya ada di metadata sebagai alat pencocokan mutasi bank.
 */
export class ManualMembershipTransferService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly orderService: MembershipOrderService = new MembershipOrderService(prisma),
  ) {}

  /** Apakah opsi ini boleh ditawarkan ke member sekarang (tanpa melempar). */
  isAvailable(): boolean {
    return (
      env.MANUAL_MEMBERSHIP_TRANSFER_ENABLED &&
      membershipPurchaseEnabled("WEB") &&
      Boolean(env.MANUAL_TOPUP_BANK_NAME && env.MANUAL_TOPUP_ACCOUNT_NUMBER && env.MANUAL_TOPUP_ACCOUNT_HOLDER)
    );
  }

  private assertEnabled() {
    if (!env.MANUAL_MEMBERSHIP_TRANSFER_ENABLED || !membershipPurchaseEnabled("WEB")) {
      throw new AppError(
        "Pembayaran membership lewat transfer bank belum tersedia.",
        StatusCodes.FORBIDDEN,
        "MEMBERSHIP_MANUAL_TRANSFER_DISABLED",
      );
    }
  }

  private bankDetails() {
    if (!env.MANUAL_TOPUP_BANK_NAME || !env.MANUAL_TOPUP_ACCOUNT_NUMBER || !env.MANUAL_TOPUP_ACCOUNT_HOLDER) {
      throw new AppError(
        "Rekening tujuan transfer belum dikonfigurasi.",
        StatusCodes.SERVICE_UNAVAILABLE,
        "MEMBERSHIP_MANUAL_TRANSFER_NOT_CONFIGURED",
      );
    }
    return {
      bankName: env.MANUAL_TOPUP_BANK_NAME,
      accountNumber: env.MANUAL_TOPUP_ACCOUNT_NUMBER,
      accountHolder: env.MANUAL_TOPUP_ACCOUNT_HOLDER,
    };
  }

  private metaOf(payment: { metadata: Prisma.JsonValue | null }): TransferMeta {
    return (payment.metadata ?? {}) as TransferMeta;
  }

  private view(
    order: { id: string; status: string; membership: { name: string }; invoice: { number: string } | null },
    payment: { metadata: Prisma.JsonValue | null },
  ) {
    const meta = this.metaOf(payment);
    const expiresAt = meta.expiresAt ? new Date(meta.expiresAt) : null;
    return {
      orderId: order.id,
      invoiceNumber: order.invoice?.number ?? "",
      packageName: order.membership.name,
      status: order.status,
      baseAmount: meta.baseAmount ?? null,
      uniqueCode: meta.uniqueCode ?? null,
      transferAmount: meta.transferAmount ?? null,
      expiresAt: meta.expiresAt ?? null,
      expired: order.status === "PENDING" && expiresAt !== null && expiresAt.getTime() < Date.now(),
      bank: this.bankDetails(),
    };
  }

  private orderInclude() {
    return {
      membership: { select: { name: true } },
      invoice: true,
      payments: { orderBy: { createdAt: "desc" as const }, take: 1 },
    } satisfies Prisma.MembershipOrderInclude;
  }

  /**
   * Member memilih transfer manual untuk order miliknya. Idempoten: memanggil
   * lagi selama kode unik masih berlaku mengembalikan petunjuk yang SAMA;
   * setelah kedaluwarsa, panggilan baru menerbitkan kode baru.
   */
  async start(input: { userId: string; orderId: string }) {
    this.assertEnabled();
    this.bankDetails();
    const now = new Date();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const order = await tx.membershipOrder.findFirst({
          where: { id: input.orderId, userId: input.userId },
          include: this.orderInclude(),
        });
        if (!order) {
          throw new AppError("Pengajuan membership tidak ditemukan", StatusCodes.NOT_FOUND, "MEMBERSHIP_ORDER_NOT_FOUND");
        }
        if (order.channel !== "WEB") {
          throw new AppError(
            "Transfer manual hanya untuk pengajuan dari web.",
            StatusCodes.CONFLICT,
            "MEMBERSHIP_MANUAL_TRANSFER_CHANNEL",
          );
        }
        if (order.status !== "PENDING" || !order.invoice || order.invoice.status !== "PENDING") {
          throw new AppError(
            "Pengajuan ini sudah tidak menunggu pembayaran.",
            StatusCodes.CONFLICT,
            "MEMBERSHIP_ORDER_NOT_PENDING",
          );
        }

        let payment = order.payments[0];
        if (!payment) {
          payment = await tx.membershipPayment.create({
            data: {
              orderId: order.id,
              invoiceId: order.invoice.id,
              userId: order.userId,
              amount: order.totalAmount,
              status: "PENDING",
              method: "BANK_TRANSFER",
            },
          });
        }
        if (payment.status !== "PENDING") {
          throw new AppError(
            "Pembayaran untuk pengajuan ini sudah diproses.",
            StatusCodes.CONFLICT,
            "MEMBERSHIP_ORDER_NOT_PENDING",
          );
        }
        // Pembayaran online sudah dimulai: dua jalur sekaligus berisiko member
        // membayar dua kali untuk satu pengajuan.
        if (payment.provider && payment.provider !== MANUAL_BANK_PROVIDER) {
          throw new AppError(
            "Pembayaran online sudah dimulai untuk pengajuan ini. Selesaikan atau tunggu kedaluwarsa dulu.",
            StatusCodes.CONFLICT,
            "MEMBERSHIP_PAYMENT_ALREADY_STARTED",
          );
        }

        const current = this.metaOf(payment);
        if (
          payment.provider === MANUAL_BANK_PROVIDER &&
          current.expiresAt &&
          new Date(current.expiresAt).getTime() > now.getTime()
        ) {
          return { order, payment };
        }

        const baseAmount = order.totalAmount.toNumber();
        const taken = await openManualTransferAmounts(tx, now);
        const uniqueCode = pickFreeUniqueCode(baseAmount, taken);
        if (uniqueCode === null) {
          throw new AppError(
            "Sistem sedang padat. Coba lagi beberapa menit lagi.",
            StatusCodes.SERVICE_UNAVAILABLE,
            "MEMBERSHIP_MANUAL_TRANSFER_NO_CODE",
          );
        }
        const metadata: TransferMeta = {
          baseAmount,
          uniqueCode,
          transferAmount: baseAmount + uniqueCode,
          expiresAt: new Date(now.getTime() + env.MANUAL_TOPUP_EXPIRY_HOURS * 3600_000).toISOString(),
          reference: order.invoice.number,
        };
        const updated = await tx.membershipPayment.update({
          where: { id: payment.id },
          data: {
            method: "BANK_TRANSFER",
            provider: MANUAL_BANK_PROVIDER,
            metadata: metadata as Prisma.InputJsonValue,
          },
        });
        return { order, payment: updated };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.view(result.order, result.payment);
  }

  /** Petunjuk transfer milik member sendiri; 404 bila bukan miliknya / bukan transfer manual. */
  async getForUser(input: { userId: string; orderId: string }) {
    this.assertEnabled();
    const order = await this.prisma.membershipOrder.findFirst({
      where: { id: input.orderId, userId: input.userId },
      include: this.orderInclude(),
    });
    const payment = order?.payments[0];
    if (!order || !payment || payment.provider !== MANUAL_BANK_PROVIDER) {
      throw new AppError(
        "Petunjuk transfer tidak ditemukan",
        StatusCodes.NOT_FOUND,
        "MEMBERSHIP_MANUAL_TRANSFER_NOT_FOUND",
      );
    }
    return this.view(order, payment);
  }

  /**
   * Super Admin mengonfirmasi transfer sebesar nominal unik sudah masuk.
   * Idempoten: konfirmasi ulang mengembalikan status sekarang tanpa efek baru.
   * Sengaja TIDAK digerbangi flag fitur: uang yang sudah terlanjur masuk tetap
   * harus bisa dikonfirmasi walau opsi ini sudah dimatikan untuk member baru.
   */
  async confirm(input: { orderId: string; actorId: string; actorRole: UserRole }) {
    const order = await this.prisma.membershipOrder.findUnique({
      where: { id: input.orderId },
      include: this.orderInclude(),
    });
    if (!order) {
      throw new AppError("Pengajuan membership tidak ditemukan", StatusCodes.NOT_FOUND, "MEMBERSHIP_ORDER_NOT_FOUND");
    }
    const payment = order.payments[0];
    if (!payment || payment.provider !== MANUAL_BANK_PROVIDER) {
      throw new AppError(
        "Pengajuan ini tidak memakai transfer manual. Gunakan konfirmasi pembayaran biasa.",
        StatusCodes.CONFLICT,
        "MEMBERSHIP_MANUAL_TRANSFER_NOT_FOUND",
      );
    }
    if (order.status === "PAID") {
      return { orderId: order.id, status: "PAID" as const, alreadyConfirmed: true };
    }
    if (order.status !== "PENDING") {
      throw new AppError(
        "Pengajuan ini sudah ditutup dan tidak bisa dikonfirmasi.",
        StatusCodes.CONFLICT,
        "MEMBERSHIP_MANUAL_TRANSFER_NOT_PENDING",
      );
    }

    const meta = this.metaOf(payment);
    const expired = meta.expiresAt ? new Date(meta.expiresAt).getTime() < Date.now() : false;
    if (expired && typeof meta.transferAmount === "number") {
      // Transfer terlambat tetap sah, tetapi hanya bila nominal uniknya tidak
      // sedang dipakai pesanan terbuka lain (top up maupun membership);
      // kalau tidak, tidak bisa dipastikan siapa pengirimnya.
      const open = await openManualTransferAmounts(this.prisma, new Date());
      if (open.has(meta.transferAmount)) {
        throw new AppError(
          "Nominal ini sedang dipakai pesanan transfer lain (top up atau membership) yang masih berlaku. Periksa mutasi bank secara manual.",
          StatusCodes.CONFLICT,
          "MEMBERSHIP_MANUAL_TRANSFER_AMBIGUOUS",
        );
      }
    }

    try {
      await this.orderService.markPaymentSuccess({
        userId: input.actorId,
        role: input.actorRole,
        orderId: order.id,
        paymentReference: `MANUAL:${input.actorId}`,
      });
    } catch (error) {
      // Dua konfirmasi serentak: yang kalah menemukan invoice sudah lunas, atau
      // terkena konflik tulis Serializable (P2034). Untuk yang kedua, status
      // dibaca ulang: hanya bila pesanan memang sudah PAID ia dianggap konfirmasi
      // ganda; selain itu errornya diteruskan apa adanya.
      if (error instanceof AppError && error.code === "MEMBERSHIP_INVOICE_ALREADY_FINALIZED") {
        return { orderId: order.id, status: "PAID" as const, alreadyConfirmed: true };
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        const current = await this.prisma.membershipOrder.findUnique({ where: { id: order.id }, select: { status: true } });
        if (current?.status === "PAID") {
          return { orderId: order.id, status: "PAID" as const, alreadyConfirmed: true };
        }
      }
      throw error;
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED",
        entityType: "MEMBERSHIP_ORDER",
        entityId: order.id,
        metadata: {
          targetUserId: order.userId,
          invoiceNumber: order.invoice?.number ?? null,
          baseAmount: meta.baseAmount ?? null,
          uniqueCode: meta.uniqueCode ?? null,
          transferAmount: meta.transferAmount ?? null,
          confirmedAfterExpiry: expired,
        },
      },
    });
    return { orderId: order.id, status: "PAID" as const, alreadyConfirmed: false };
  }
}
