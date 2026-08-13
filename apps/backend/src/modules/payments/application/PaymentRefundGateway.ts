import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";

/**
 * Antarmuka pengembalian dana ke penyedia pembayaran.
 *
 * Dipisahkan dari service membership supaya penggantian penyedia — dan repo ini
 * sudah berpindah sekali dari Midtrans ke DOKU lalu kembali — tidak menyentuh
 * logika keputusan refund sama sekali.
 *
 * `refundKey` WAJIB deterministik per order. Inilah yang mencegah pengembalian
 * ganda ketika penyedia sudah menerima permintaan tetapi pencatatan di sisi
 * kita gagal: percobaan ulang membawa kunci yang sama, dan penyedia
 * mengembalikan hasil yang sama alih-alih mengirim uang dua kali.
 */
export type RefundRequest = {
  /** Nomor invoice; inilah order_id di sisi penyedia. */
  invoiceNumber: string;
  amount: Prisma.Decimal;
  reason: string;
  refundKey: string;
};

export type RefundResult = {
  /** Nomor rujukan refund dari penyedia, untuk rekonsiliasi. */
  providerReference: string;
  provider: string;
  raw: unknown;
};

export interface PaymentRefundGateway {
  readonly provider: string;
  refund(request: RefundRequest): Promise<RefundResult>;
}

export const REFUND_PROVIDER_NOT_CONFIGURED = "REFUND_PROVIDER_NOT_CONFIGURED";
export const REFUND_PROVIDER_REJECTED = "REFUND_PROVIDER_REJECTED";

/** Status yang berarti dana sudah terbalik. Percobaan ulang harus berhasil. */
const ALREADY_REVERSED = new Set(["refund", "partial_refund", "cancel", "expire"]);

/** Belum settle: Midtrans menuntut cancel, dan menolak refund. */
const SAME_DAY_CANCEL = new Set(["capture", "pending", "authorize"]);

/**
 * Pembalikan dana lewat Core API Midtrans.
 *
 * Midtrans memakai DUA operasi berbeda, dan yang benar ditentukan oleh status
 * transaksi saat itu — bukan oleh pilihan kita:
 *
 *   settlement            -> POST /v2/{order_id}/refund
 *   capture / pending     -> POST /v2/{order_id}/cancel   (pembatalan hari sama)
 *
 * Memakai yang keliru dijawab "Transaction status cannot be updated" dan
 * uangnya tidak bergerak. Keduanya sudah diverifikasi terhadap sandbox yang
 * hidup: transaksi kartu berstatus capture berhasil dibalik lewat cancel.
 *
 * Status yang sudah final — refund, partial_refund, cancel, expire —
 * diperlakukan sebagai BERHASIL, bukan galat. Inilah yang membuat percobaan
 * ulang aman ketika penyedia sudah membalik dana tetapi pencatatan di sisi kita
 * gagal.
 *
 * Catatan hasil uji nyata yang perlu diketahui operasional: bank transfer (VA)
 * DITOLAK Midtrans untuk refund lewat API, dan refund atas saldo yang sudah
 * settle menuntut saldo merchant mencukupi.
 */
export class MidtransRefundGateway implements PaymentRefundGateway {
  readonly provider = "MIDTRANS";

  async refund(request: RefundRequest): Promise<RefundResult> {
    const serverKey = env.MIDTRANS_SERVER_KEY;
    if (!serverKey) {
      throw new AppError(
        "Pengembalian dana belum dapat diproses: penyedia pembayaran belum dikonfigurasi.",
        StatusCodes.SERVICE_UNAVAILABLE,
        REFUND_PROVIDER_NOT_CONFIGURED
      );
    }

    const host = env.MIDTRANS_IS_PRODUCTION
      ? "https://api.midtrans.com"
      : "https://api.sandbox.midtrans.com";
    const auth = `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`;
    const orderPath = encodeURIComponent(request.invoiceNumber);

    const status = await this.read(`${host}/v2/${orderPath}/status`, auth);
    const transactionStatus = String(status.transaction_status ?? "");

    // Sudah terbalik sebelumnya: perlakukan sebagai berhasil supaya percobaan
    // ulang setelah kegagalan pencatatan tidak berubah menjadi galat.
    if (ALREADY_REVERSED.has(transactionStatus)) {
      return {
        provider: this.provider,
        providerReference: String(status.refund_key ?? status.transaction_id ?? request.refundKey),
        raw: status
      };
    }

    const useCancel = SAME_DAY_CANCEL.has(transactionStatus);
    const body = await this.write(
      `${host}/v2/${orderPath}/${useCancel ? "cancel" : "refund"}`,
      auth,
      useCancel
        ? undefined
        : {
            refund_key: request.refundKey,
            amount: Number(request.amount.toFixed(2)),
            reason: request.reason
          }
    );

    if (body.status_code !== "200" && body.status_code !== "201") {
      throw new AppError(
        String(
          body.status_message ??
            "Penyedia pembayaran menolak permintaan pengembalian dana."
        ),
        StatusCodes.BAD_GATEWAY,
        REFUND_PROVIDER_REJECTED
      );
    }

    return {
      provider: this.provider,
      providerReference: String(
        body.refund_key ?? body.transaction_id ?? request.refundKey
      ),
      raw: body
    };
  }

  private async read(url: string, auth: string) {
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: auth }
    });
    return (await response.json().catch(() => ({}))) as Record<string, unknown>;
  }

  private async write(url: string, auth: string, payload?: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: auth
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    });
    return (await response.json().catch(() => ({}))) as Record<string, unknown>;
  }
}

/**
 * DOKU belum memiliki jalur refund di repo ini, dan akun sandbox-nya sedang
 * ditangguhkan sehingga alamat endpoint-nya tidak dapat diverifikasi. Menebak
 * alamat lalu menyebutnya siap adalah cara termudah kehilangan uang secara
 * diam-diam, jadi gerbang ini menolak dengan jujur sampai dapat dipastikan.
 */
export class DokuRefundGateway implements PaymentRefundGateway {
  readonly provider = "DOKU";

  async refund(): Promise<RefundResult> {
    throw new AppError(
      "Pengembalian dana lewat DOKU belum tersedia.",
      StatusCodes.SERVICE_UNAVAILABLE,
      REFUND_PROVIDER_NOT_CONFIGURED
    );
  }
}

/** Penyedia aktif mengikuti flag yang sama dengan jalur pembayaran. */
export function resolveRefundGateway(): PaymentRefundGateway {
  return env.DOKU_ENABLED ? new DokuRefundGateway() : new MidtransRefundGateway();
}
