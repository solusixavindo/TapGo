import {
  PpobProviderGateway,
  PpobPurchaseOutcome,
  PpobPurchaseRequest
} from "../domain/ppobProvider.js";

/**
 * Nomor tujuan sentinel yang memaksa kegagalan pada adapter stub.
 *
 * Mengikuti tradisi kartu uji sandbox payment gateway (Midtrans/DOKU): jalur
 * kegagalan dan kompensasi refund HARUS dapat diuji end-to-end lewat HTTP
 * tanpa memalsukan provider. Angka "00" tidak pernah muncul sebagai akhiran
 * nomor tujuan nyata yang lolos validasi secara tidak sengaja dipilih tester
 * tanpa membaca kontrak ini.
 */
export const STUB_FAILURE_TARGET_SUFFIX = "0000";

/**
 * Adapter provider deterministik untuk Stage R2.7.
 *
 * BUKAN integrasi provider nyata — itu ruang lingkup R2.8. Adapter ini
 * membuktikan seluruh alur foundation (debit, ledger, idempotency, refund,
 * serial/token) bekerja end-to-end, dan akan digantikan adapter Digiflazz dsb.
 * tanpa mengubah service. Seluruh outputnya sintetis dan ditandai "STUB".
 */
export class StubPpobProvider implements PpobProviderGateway {
  readonly name = "stub";

  purchase(request: PpobPurchaseRequest): Promise<PpobPurchaseOutcome> {
    const providerReference = `STUB-${request.publicReference}`;

    if (request.targetNumber.endsWith(STUB_FAILURE_TARGET_SUFFIX)) {
      return Promise.resolve({
        kind: "FAILED",
        providerReference,
        failureCode: "STUB_FORCED_FAILURE",
        failureReason: "Kegagalan sintetis untuk menguji jalur refund"
      });
    }

    // Token/serial sintetis yang stabil per transaksi — klien dan UAT dapat
    // memverifikasi nilai yang sama muncul kembali pada replay idempotency.
    return Promise.resolve({
      kind: "SUCCESS",
      providerReference,
      serialNumber: `STUB-SN-${request.publicReference.slice(4)}`
    });
  }
}
