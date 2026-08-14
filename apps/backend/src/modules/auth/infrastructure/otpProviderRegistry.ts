import {
  OtpChannel,
  OtpDeliveryProvider,
  OtpDeliveryRequest,
  OtpDeliveryResult
} from "../domain/OtpDeliveryProvider.js";
import { UnavailableOtpProvider } from "./UnavailableOtpProvider.js";

/**
 * Titik tunggal penentuan provider OTP.
 *
 * Delegate default adalah UnavailableOtpProvider, dan itulah yang berlaku di
 * SELURUH environment termasuk production — tidak ada percabangan berdasarkan
 * NODE_ENV di sini. Satu-satunya cara mengganti delegate adalah pemanggilan
 * eksplisit `setOtpDeliveryProvider`, yang dipakai automated test dan
 * nantinya oleh pemasangan provider sungguhan setelah Owner memutuskan vendor.
 *
 * Objek ini sendiri yang dipegang service, sehingga penggantian delegate
 * langsung berlaku tanpa perlu membangun ulang route.
 */
class SwappableOtpProvider implements OtpDeliveryProvider {
  private delegate: OtpDeliveryProvider = new UnavailableOtpProvider();

  get name(): string {
    return this.delegate.name;
  }

  supports(channel: OtpChannel): boolean {
    return this.delegate.supports(channel);
  }

  send(request: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
    return this.delegate.send(request);
  }

  setDelegate(provider: OtpDeliveryProvider): void {
    this.delegate = provider;
  }

  resetDelegate(): void {
    this.delegate = new UnavailableOtpProvider();
  }
}

export const otpDeliveryProvider = new SwappableOtpProvider();

/** Mengganti provider aktif. Dipakai test dan pemasangan provider nyata. */
export function setOtpDeliveryProvider(provider: OtpDeliveryProvider): void {
  otpDeliveryProvider.setDelegate(provider);
}

/** Mengembalikan ke UnavailableOtpProvider yang fail-closed. */
export function resetOtpDeliveryProvider(): void {
  otpDeliveryProvider.resetDelegate();
}
