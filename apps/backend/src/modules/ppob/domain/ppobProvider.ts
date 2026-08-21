import { PpobCategory } from "@prisma/client";

/**
 * Port menuju penyedia PPOB (Stage R2.7).
 *
 * Provider nyata (Digiflazz dsb.) sengaja BELUM ada — itu ruang lingkup R2.8.
 * Kontrak ini dibekukan lebih dulu supaya R2.8 tinggal menambah adapter baru
 * tanpa menyentuh service, repository, maupun alur kompensasi refund.
 */

export interface PpobPurchaseRequest {
  /// Referensi publik transaksi kita — dipakai provider sebagai kunci dedup
  /// (ref_id Digiflazz): permintaan ulang dengan ref_id yang sama tidak
  /// memotong saldo provider dua kali.
  publicReference: string;
  /// Kode produk di sisi provider (providerSku produk, fallback ke sku).
  providerSku: string;
  sku: string;
  category: PpobCategory;
  targetNumber: string;
  amount: string;
}

/// Permintaan cek status untuk transaksi PENDING/PROCESSING (Stage R2.8).
export interface PpobStatusInquiry {
  publicReference: string;
  providerSku: string;
  sku: string;
  category: PpobCategory;
  targetNumber: string;
}

export type PpobPurchaseOutcome =
  | {
      kind: "SUCCESS";
      providerReference: string;
      /// Token PLN / serial number. null bila produk tidak mengeluarkannya.
      serialNumber: string | null;
    }
  | {
      kind: "PROCESSING";
      providerReference: string;
    }
  | {
      kind: "FAILED";
      providerReference: string | null;
      failureCode: string;
      failureReason: string;
    };

export interface PpobProviderGateway {
  /// Nama adapter, dicatat pada transaksi untuk audit. "stub" hari ini.
  readonly name: string;
  purchase(request: PpobPurchaseRequest): Promise<PpobPurchaseOutcome>;
  /**
   * Cek status transaksi non-final. Opsional: adapter yang tidak mendukung
   * (stub/disabled) tidak perlu mengimplementasikannya — worker rekonsiliasi
   * melewati provider tanpa inquiry.
   */
  checkStatus?(inquiry: PpobStatusInquiry): Promise<PpobPurchaseOutcome>;
}

/// Provider dimatikan lewat konfigurasi (PPOB_PROVIDER=disabled).
export class PpobProviderDisabledError extends Error {
  constructor() {
    super("PPOB provider is disabled by configuration");
    this.name = "PpobProviderDisabledError";
  }
}
