import crypto from "node:crypto";
import {
  OtpChannel,
  OtpDeliveryProvider,
  OtpDeliveryRequest,
  OtpDeliveryResult
} from "../domain/OtpDeliveryProvider.js";

/**
 * Test adapter. HANYA untuk automated test.
 *
 * Menyimpan pengiriman di memori agar test dapat mengambil kode tanpa
 * provider nyata. Ini BUKAN provider produksi dan tidak boleh dipasang di
 * environment mana pun: tidak ada jalur kode yang memilih kelas ini
 * berdasarkan NODE_ENV. Test harus menyuntikkannya secara eksplisit.
 */
export class RecordingOtpProvider implements OtpDeliveryProvider {
  readonly name = "recording-test-adapter";

  private readonly deliveries: OtpDeliveryRequest[] = [];

  supports(_channel: OtpChannel): boolean {
    return true;
  }

  async send(request: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
    this.deliveries.push({ ...request });
    return { providerReference: `test-${crypto.randomUUID()}` };
  }

  /** Pengiriman terakhir, atau undefined bila belum ada. */
  lastDelivery(): OtpDeliveryRequest | undefined {
    return this.deliveries[this.deliveries.length - 1];
  }

  /** Kode dari pengiriman terakhir. Melempar bila belum ada pengiriman. */
  lastCode(): string {
    const delivery = this.lastDelivery();
    if (!delivery) {
      throw new Error("belum ada OTP yang dikirim");
    }
    return delivery.code;
  }

  count(): number {
    return this.deliveries.length;
  }

  all(): readonly OtpDeliveryRequest[] {
    return this.deliveries;
  }

  reset(): void {
    this.deliveries.length = 0;
  }
}
