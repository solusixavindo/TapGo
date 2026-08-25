import nodemailer, { Transporter } from "nodemailer";
import {
  OtpChannel,
  OtpDeliveryProvider,
  OtpDeliveryRequest,
  OtpDeliveryResult
} from "../domain/OtpDeliveryProvider.js";

export type SmtpOtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
};

/**
 * Provider OTP lewat email SMTP (keputusan Owner G3).
 *
 * Hanya mendukung kanal EMAIL: recovery/verifikasi lewat nomor HP tetap
 * dijawab tidak-tersedia sampai Owner memutuskan gateway SMS/WhatsApp.
 *
 * Aturan keamanan yang diwarisi dari kontrak domain:
 * - Kode dan tujuan TIDAK PERNAH dicatat ke log, termasuk saat gagal.
 * - Kegagalan SMTP dilempar apa adanya; lapisan service yang memutuskan
 *   apakah kegagalan diteruskan (503) atau ditelan demi anti-enumerasi.
 */
export class SmtpOtpProvider implements OtpDeliveryProvider {
  readonly name = "smtp-email";

  constructor(
    private readonly transporter: Transporter,
    private readonly fromAddress: string
  ) {}

  supports(channel: OtpChannel): boolean {
    return channel === "EMAIL";
  }

  async send(request: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
    const minutes = Math.max(
      1,
      Math.round((request.expiresAt.getTime() - Date.now()) / 60000)
    );
    const subject =
      request.purpose === "PASSWORD_RECOVERY"
        ? "Kode Pemulihan Akun TapGo"
        : "Kode Verifikasi TapGo";
    const info = await this.transporter.sendMail({
      from: this.fromAddress,
      to: request.destination,
      subject,
      text: [
        `Kode ${subject.toLowerCase()} Anda: ${request.code}`,
        "",
        `Kode berlaku ${minutes} menit. Jangan bagikan kode ini kepada siapa pun,`,
        "termasuk pihak yang mengaku dari TapGo.",
        "",
        "Bila Anda tidak meminta kode ini, abaikan email ini."
      ].join("\n")
    });
    // messageId milik server SMTP — aman dipakai sebagai jejak tanpa membocorkan
    // kode maupun tujuan.
    return { providerReference: info.messageId ?? "smtp-sent" };
  }

  /**
   * Membangun provider dari konfigurasi eksplisit. Pembacaan environment ada
   * di server.ts — modul ini sengaja bebas env agar dapat diuji tanpa secret.
   */
  static fromConfig(config: SmtpOtpConfig): SmtpOtpProvider {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user
        ? { auth: { user: config.user, pass: config.pass ?? "" } }
        : {})
    });
    return new SmtpOtpProvider(transporter, config.from);
  }
}