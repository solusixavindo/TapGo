import { createHash, timingSafeEqual } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

/**
 * Verifikasi signature notifikasi Midtrans, dipakai bersama oleh pembelian
 * membership dan top up wallet (Stage R2.10) supaya penambahan konsumen baru
 * tidak dapat lupa memeriksanya — pola yang sama dengan authoritativeAmount.ts.
 *
 * FAIL-CLOSED, tanpa memandang NODE_ENV. Lihat riwayat lengkap keputusan ini
 * di MidtransPaymentService (tempat fungsi ini semula tinggal sebagai method
 * privat sebelum diekstrak).
 */
export function verifyMidtransSignature(payload: {
  order_id: string;
  status_code?: string;
  gross_amount?: string;
  signature_key?: string;
}, serverKey: string | undefined): void {
  if (!serverKey) {
    throw new AppError(
      "Midtrans server key is not configured",
      StatusCodes.SERVICE_UNAVAILABLE,
      "MIDTRANS_SERVER_KEY_REQUIRED",
    );
  }

  if (!payload.signature_key) {
    throw new AppError(
      "Midtrans signature is required",
      StatusCodes.UNAUTHORIZED,
      "MIDTRANS_SIGNATURE_REQUIRED",
    );
  }

  const requiredParts = payload.order_id && payload.status_code && payload.gross_amount;
  if (!requiredParts) {
    throw new AppError(
      "Midtrans signature payload is incomplete",
      StatusCodes.BAD_REQUEST,
      "MIDTRANS_SIGNATURE_INCOMPLETE",
    );
  }

  const expected = createHash("sha512")
    .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(payload.signature_key, "utf8");

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new AppError(
      "Midtrans signature is invalid",
      StatusCodes.UNAUTHORIZED,
      "MIDTRANS_SIGNATURE_INVALID",
    );
  }
}
