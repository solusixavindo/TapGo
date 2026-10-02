import { Prisma, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import {
  PaymentRefundGateway,
  resolveRefundGateway
} from "../../payments/application/PaymentRefundGateway.js";
import { MANUAL_BANK_PROVIDER } from "../../payments/application/manualTransferAmounts.js";

/**
 * Eksekusi pengembalian dana atas pengajuan yang dokumennya ditolak.
 *
 * KEPUTUSAN dan EKSEKUSI sengaja dipisah. `rejectOrderDocuments` mencatat bahwa
 * dana wajib kembali; berkas ini yang benar-benar memindahkannya. Alasannya:
 * penyedia pembayaran bisa sedang tidak dapat dihubungi, dan kegagalan itu
 * tidak boleh membatalkan keputusan admin yang sudah sah. Keputusan tetap
 * tercatat, eksekusinya dapat diulang.
 *
 * Urutan operasinya menentukan keselamatan uang:
 *
 *   1. Periksa keadaan, pastikan memang ada refund tertunda.
 *   2. Panggil penyedia dengan kunci idempotensi yang DETERMINISTIK per order.
 *   3. Baru setelah penyedia mengonfirmasi, ubah status di database.
 *
 * Bila langkah 3 gagal setelah langkah 2 berhasil — uang sudah kembali tetapi
 * catatan kita belum berubah — percobaan ulang mengirim kunci yang sama, dan
 * penyedia mengembalikan hasil yang sama alih-alih mengirim uang dua kali.
 * Karena itu kunci idempotensi tidak boleh mengandung waktu atau angka acak.
 */

export const REFUND_NOT_PENDING = "MEMBERSHIP_REFUND_NOT_PENDING";
export const REFUND_ALREADY_DONE = "MEMBERSHIP_REFUND_ALREADY_COMPLETED";
export const REFUND_ORDER_NOT_REJECTED = "MEMBERSHIP_REFUND_ORDER_NOT_REJECTED";
/** Pembayaran transfer manual: dana tidak pernah lewat penyedia, jadi tidak ada refund via gateway. */
export const REFUND_MANUAL_REQUIRED = "MEMBERSHIP_REFUND_MANUAL_REQUIRED";
/** Konfirmasi refund manual hanya untuk pembayaran transfer manual. */
export const REFUND_MANUAL_NOT_APPLICABLE = "MEMBERSHIP_REFUND_MANUAL_NOT_APPLICABLE";

export const REFUND_ACTIONS = {
  completed: "MEMBERSHIP_REFUND_COMPLETED",
  failed: "MEMBERSHIP_REFUND_FAILED"
} as const;

/** Deterministik per order. Jangan pernah menyertakan waktu atau nilai acak. */
export function refundKeyFor(orderId: string) {
  return `tapgo-refund-${orderId}`;
}

export class MembershipRefundService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: PaymentRefundGateway = resolveRefundGateway()
  ) {}

  /**
   * Memuat pesanan dan memastikan ada refund yang tertunda beserta pembayaran
   * lunas yang akan dibalik. Dipakai bersama oleh refund via gateway dan
   * pencatatan refund manual, supaya syaratnya tidak bisa berbeda.
   */
  private async loadPendingRefund(orderId: string) {
    const order = await this.prisma.membershipOrder.findUnique({
      where: { id: orderId },
      include: {
        invoice: true,
        payments: { orderBy: { createdAt: "desc" } }
      }
    });

    if (!order) {
      throw new AppError(
        "Membership order not found",
        StatusCodes.NOT_FOUND,
        "MEMBERSHIP_ORDER_NOT_FOUND"
      );
    }

    const rejection = this.asObject(
      this.asObject(order.registrationData).documentRejection
    );
    const refund = this.asObject(rejection.refund);

    if (order.status !== "CANCELLED" || Object.keys(rejection).length === 0) {
      throw new AppError(
        "Pengembalian dana hanya berlaku untuk pengajuan yang dokumennya ditolak.",
        StatusCodes.CONFLICT,
        REFUND_ORDER_NOT_REJECTED
      );
    }
    if (refund.status === "REFUNDED") {
      throw new AppError(
        "Dana untuk pengajuan ini sudah dikembalikan.",
        StatusCodes.CONFLICT,
        REFUND_ALREADY_DONE
      );
    }
    if (refund.status !== "PENDING") {
      throw new AppError(
        "Tidak ada pengembalian dana yang tertunda untuk pengajuan ini.",
        StatusCodes.CONFLICT,
        REFUND_NOT_PENDING
      );
    }

    const payment = order.payments.find((item) => item.status === "PAID");
    if (!order.invoice || !payment) {
      throw new AppError(
        "Tidak ada pembayaran lunas yang dapat dikembalikan.",
        StatusCodes.CONFLICT,
        REFUND_NOT_PENDING
      );
    }

    return { order, invoice: order.invoice, payment, rejection, refund };
  }

  async executeRefund(input: { orderId: string; adminId: string }) {
    const { order, invoice, payment, rejection, refund } = await this.loadPendingRefund(input.orderId);

    // Uang transfer manual tidak pernah lewat penyedia, jadi gateway tidak
    // boleh dipanggil (invoice ini tidak dikenal di sana). Dana dikembalikan
    // lewat transfer bank, lalu dicatat dengan confirmManualRefund.
    if (payment.provider === MANUAL_BANK_PROVIDER) {
      throw new AppError(
        "Pembayaran ini transfer bank manual. Kembalikan dana lewat transfer bank dari rekening perusahaan, lalu catat dengan konfirmasi pengembalian dana manual.",
        StatusCodes.CONFLICT,
        REFUND_MANUAL_REQUIRED
      );
    }

    // --- Langkah 2: penyedia lebih dulu, database menyusul ------------------
    let result;
    try {
      result = await this.gateway.refund({
        invoiceNumber: invoice.number,
        amount: order.totalAmount,
        reason: this.optionalString(rejection.reason) ?? "Dokumen identitas tidak dapat diverifikasi",
        refundKey: refundKeyFor(order.id)
      });
    } catch (error) {
      const failure = error instanceof AppError ? error : null;
      // Kegagalan dicatat tetapi TIDAK membatalkan penolakan dokumen. Statusnya
      // tetap PENDING supaya admin dapat mencoba lagi.
      await this.recordAttempt(order.id, {
        adminId: input.adminId,
        outcome: "FAILED",
        errorCode: failure?.code ?? "REFUND_UNEXPECTED_ERROR"
      });
      throw error;
    }

    // --- Langkah 3: catat, dengan penjaga bersyarat -------------------------
    return this.settle({
      order,
      invoice,
      payment,
      rejection,
      refund,
      adminId: input.adminId,
      provider: result.provider,
      providerReference: result.providerReference,
      extra: {}
    });
  }

  /**
   * Super Admin mencatat bahwa dana SUDAH dikembalikan lewat transfer bank
   * dari rekening perusahaan, untuk pembayaran transfer manual. Tidak ada
   * penyedia yang dipanggil: sistem hanya membukukan apa yang sudah dilakukan
   * manusia, sehingga `bankReference` (nomor referensi transfer balik) wajib
   * ada sebagai jejak yang dapat dicocokkan dengan mutasi bank.
   */
  async confirmManualRefund(input: { orderId: string; adminId: string; bankReference: string }) {
    const bankReference = this.optionalString(input.bankReference);
    if (!bankReference) {
      throw new AppError(
        "Nomor referensi transfer pengembalian dana wajib diisi.",
        StatusCodes.BAD_REQUEST,
        "MEMBERSHIP_REFUND_BANK_REFERENCE_REQUIRED"
      );
    }
    const { order, invoice, payment, rejection, refund } = await this.loadPendingRefund(input.orderId);

    if (payment.provider !== MANUAL_BANK_PROVIDER) {
      throw new AppError(
        "Pengembalian dana manual hanya untuk pembayaran transfer bank manual. Gunakan pengembalian dana lewat penyedia pembayaran.",
        StatusCodes.CONFLICT,
        REFUND_MANUAL_NOT_APPLICABLE
      );
    }

    return this.settle({
      order,
      invoice,
      payment,
      rejection,
      refund,
      adminId: input.adminId,
      provider: MANUAL_BANK_PROVIDER,
      providerReference: `MANUAL:${input.adminId}`,
      extra: { bankReference }
    });
  }

  /** Pembukuan akhir yang sama untuk kedua jalur; bersyarat agar tidak bisa ganda. */
  private async settle(input: {
    order: { id: string; userId: string; totalAmount: Prisma.Decimal; registrationData: Prisma.JsonValue | null };
    invoice: { id: string; number: string; metadata: Prisma.JsonValue | null };
    payment: { id: string; metadata: Prisma.JsonValue | null };
    rejection: Record<string, unknown>;
    refund: Record<string, unknown>;
    adminId: string;
    provider: string;
    providerReference: string;
    extra: Record<string, unknown>;
  }) {
    const { order, invoice, payment, rejection, refund } = input;
    const now = new Date();
    const settled = {
      ...refund,
      status: "REFUNDED",
      provider: input.provider,
      providerReference: input.providerReference,
      ...input.extra,
      executedBy: input.adminId,
      executedAt: now.toISOString()
    };

    await this.prisma.$transaction(async (tx) => {
      // Bersyarat: hanya baris yang masih PAID yang berubah. Dua admin yang
      // menekan bersamaan tidak dapat sama-sama menang.
      const paymentUpdate = await tx.membershipPayment.updateMany({
        where: { id: payment.id, status: "PAID" },
        data: {
          status: "REFUNDED",
          providerReference: input.providerReference,
          metadata: { ...(this.asObject(payment.metadata)), refund: settled }
        }
      });
      if (paymentUpdate.count !== 1) {
        throw new AppError(
          "Dana untuk pengajuan ini sudah dikembalikan.",
          StatusCodes.CONFLICT,
          REFUND_ALREADY_DONE
        );
      }

      await tx.invoice.updateMany({
        where: { id: invoice.id, status: "PAID" },
        data: {
          status: "REFUNDED",
          metadata: { ...(this.asObject(invoice.metadata)), refund: settled }
        }
      });

      await tx.membershipOrder.update({
        where: { id: order.id },
        data: {
          registrationData: {
            ...(this.asObject(order.registrationData)),
            documentRejection: { ...rejection, refund: settled }
          }
        }
      });

      await tx.auditLog.create({
        data: {
          actorId: input.adminId,
          action: REFUND_ACTIONS.completed,
          entityType: "MEMBERSHIP_ORDER",
          entityId: order.id,
          metadata: {
            targetUserId: order.userId,
            invoiceNumber: invoice.number,
            amount: order.totalAmount.toFixed(2),
            provider: input.provider,
            providerReference: input.providerReference,
            ...input.extra
          }
        }
      });
    });

    return {
      orderId: order.id,
      amount: order.totalAmount.toFixed(2),
      provider: input.provider,
      providerReference: input.providerReference,
      status: "REFUNDED" as const
    };
  }

  /**
   * Jejak percobaan yang gagal, ditulis lewat koneksi tersendiri supaya tidak
   * ikut hilang bersama apa pun yang dibatalkan di atasnya.
   */
  private async recordAttempt(
    orderId: string,
    detail: { adminId: string; outcome: string; errorCode: string }
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorId: detail.adminId,
        action: REFUND_ACTIONS.failed,
        entityType: "MEMBERSHIP_ORDER",
        entityId: orderId,
        metadata: { outcome: detail.outcome, errorCode: detail.errorCode }
      }
    });
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private optionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }
}

export type { Prisma };
