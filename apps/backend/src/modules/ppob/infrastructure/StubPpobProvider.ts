import {
  PpobBillInquiryError,
  PpobBillInquiryRequest,
  PpobBillInquiryResult,
  PpobBillPayRequest,
  PpobPostpaidCatalogEntry,
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
/** Pascabayar stub: nomor berakhiran ini tidak punya tagihan (inquiry gagal). */
export const STUB_NO_BILL_SUFFIX = "0000";
/** Pascabayar stub: inquiry sukses tetapi pembayaran GAGAL (menguji refund). */
export const STUB_PAY_FAILURE_SUFFIX = "9999";
/** Pascabayar stub: inquiry sukses, pembayaran PENDING (menguji rekonsiliasi). */
export const STUB_PAY_PENDING_SUFFIX = "7777";

export class StubPpobProvider implements PpobProviderGateway {
  readonly name = "stub";

  inquireBill(request: PpobBillInquiryRequest): Promise<PpobBillInquiryResult> {
    if (request.targetNumber.endsWith(STUB_NO_BILL_SUFFIX)) {
      return Promise.reject(
        new PpobBillInquiryError(
          "STUB_NO_BILL",
          "Tagihan belum tersedia atau sudah dibayar untuk periode ini."
        )
      );
    }
    // Tagihan 100.000 + admin 2.500; komisi 1.150 membuat biaya kita 101.350.
    return Promise.resolve({
      customerName: "PELANGGAN STUB",
      period: "202610",
      billAmount: 100000,
      adminFee: 2500,
      cost: 101350,
      detail: { jumlah_peserta: 2 }
    });
  }

  payBill(request: PpobBillPayRequest): Promise<PpobPurchaseOutcome> {
    const providerReference = `STUB-${request.publicReference}`;
    if (request.targetNumber.endsWith(STUB_PAY_FAILURE_SUFFIX)) {
      return Promise.resolve({
        kind: "FAILED",
        providerReference,
        failureCode: "STUB_FORCED_FAILURE",
        failureReason: "Kegagalan sintetis untuk menguji jalur refund"
      });
    }
    if (request.targetNumber.endsWith(STUB_PAY_PENDING_SUFFIX)) {
      return Promise.resolve({ kind: "PROCESSING", providerReference });
    }
    return Promise.resolve({
      kind: "SUCCESS",
      providerReference,
      serialNumber: null,
      providerCost: 101350
    });
  }

  fetchPostpaidCatalog(): Promise<PpobPostpaidCatalogEntry[]> {
    return Promise.resolve([
      { providerSku: "bpjs", name: "BPJS KESEHATAN", brand: "BPJS KESEHATAN", adminFee: 2500, commission: 1150, active: true, description: null },
      { providerSku: "pdamstubkota", name: "PDAM STUB KOTA", brand: "PDAM", adminFee: 2000, commission: 550, active: true, description: "Stub" }
    ]);
  }

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
