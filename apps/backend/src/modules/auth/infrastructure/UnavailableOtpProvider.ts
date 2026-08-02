import {
  OtpChannel,
  OtpDeliveryProvider,
  OtpDeliveryRequest,
  OtpDeliveryResult,
  channelUnavailableError
} from "../domain/OtpDeliveryProvider.js";

/**
 * Provider default untuk seluruh environment, termasuk production.
 *
 * TapGo belum memiliki provider SMS/email yang nyata. Provider ini menolak
 * setiap pengiriman dengan AUTH_RECOVERY_CHANNEL_UNAVAILABLE (503), sehingga
 * kegagalan bersifat terbuka dan jujur: pengguna diberi tahu saluran belum
 * tersedia, bukan diberi janji palsu bahwa kode sudah dikirim.
 *
 * Ganti kelas ini hanya dengan integrasi provider sungguhan setelah Owner
 * memutuskan vendor, biaya, kredensial, dan sender identity.
 */
export class UnavailableOtpProvider implements OtpDeliveryProvider {
  readonly name = "unavailable";

  supports(_channel: OtpChannel): boolean {
    return false;
  }

  async send(_request: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
    throw channelUnavailableError();
  }
}
