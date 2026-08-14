import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

/**
 * Abstraksi pengiriman OTP.
 *
 * TapGo belum memiliki provider SMS maupun email produksi: tidak ada
 * dependency pengiriman pesan apa pun di package.json, dan tidak ada
 * kredensial provider di konfigurasi. Karena itu implementasi default
 * SENGAJA gagal (lihat UnavailableOtpProvider).
 *
 * LARANGAN PERMANEN: jangan pernah membuat provider yang mengembalikan
 * sukses tanpa benar-benar mengirim, dan jangan menganggap console log
 * sebagai delivery. Keduanya membuat alur recovery tampak berfungsi
 * sementara pengguna tidak pernah menerima kode — kegagalan diam yang
 * jauh lebih berbahaya daripada penolakan terbuka.
 */

export type OtpChannel = "PHONE" | "EMAIL";

export type OtpDeliveryRequest = {
  channel: OtpChannel;
  /** Tujuan mentah. Hanya boleh dipakai provider, tidak boleh dicatat. */
  destination: string;
  /** Kode mentah. Hanya boleh dipakai provider, tidak boleh dicatat. */
  code: string;
  expiresAt: Date;
  purpose: "PASSWORD_RECOVERY" | "PHONE_VERIFICATION" | "EMAIL_VERIFICATION";
};

export type OtpDeliveryResult = {
  /**
   * Referensi milik provider untuk penelusuran. Tidak boleh memuat kode
   * maupun tujuan.
   */
  providerReference: string;
};

export interface OtpDeliveryProvider {
  readonly name: string;
  supports(channel: OtpChannel): boolean;
  send(request: OtpDeliveryRequest): Promise<OtpDeliveryResult>;
}

export const AUTH_RECOVERY_CHANNEL_UNAVAILABLE = "AUTH_RECOVERY_CHANNEL_UNAVAILABLE";

export function channelUnavailableError(): AppError {
  return new AppError(
    "Saluran pengiriman kode belum tersedia.",
    StatusCodes.SERVICE_UNAVAILABLE,
    AUTH_RECOVERY_CHANNEL_UNAVAILABLE
  );
}
