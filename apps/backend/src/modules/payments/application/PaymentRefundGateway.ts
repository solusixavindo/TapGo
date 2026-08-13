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

/**
 * Refund lewat Core API Midtrans: `POST /v2/{order_id}/refund`.
 *
 * Endpoint dan bentuk permintaannya BELUM diverifikasi terhadap sandbox yang
 * hidup — kredensial sandbox belum tersedia saat ini ditulis. Yang sudah
 * terbukti lewat test hanyalah perilaku di sekitarnya: kunci idempotensi
 * dikirim, kegagalan tidak membatalkan keputusan penolakan, dan status hanya
 * berubah setelah penyedia mengonfirmasi. Satu kali uji nyata ke sandbox masih
 * diperlukan sebelum dipakai menerima uang sungguhan.
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

    const response = await fetch(
      `${host}/v2/${encodeURIComponent(request.invoiceNumber)}/refund`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`
        },
        body: JSON.stringify({
          refund_key: request.refundKey,
          amount: Number(request.amount.toFixed(2)),
          reason: request.reason
        })
      }
    );

    const body = (await response.json().catch(() => ({}))) as {
      status_code?: string;
      status_message?: string;
      refund_key?: string;
      transaction_id?: string;
    };

    // Midtrans menjawab 200 untuk keberhasilan maupun sebagian penolakan, dan
    // membedakannya lewat status_code. Karena itu keduanya diperiksa.
    const accepted = response.ok && (body.status_code === "200" || body.status_code === "201");
    if (!accepted) {
      throw new AppError(
        body.status_message ?? "Penyedia pembayaran menolak permintaan pengembalian dana.",
        StatusCodes.BAD_GATEWAY,
        REFUND_PROVIDER_REJECTED
      );
    }

    return {
      provider: this.provider,
      providerReference: body.refund_key ?? body.transaction_id ?? request.refundKey,
      raw: body
    };
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
