import { PpobCategory } from "@prisma/client";

/**
 * Port menuju penyedia PPOB (Stage R2.7).
 *
 * Provider nyata (Digiflazz dsb.) sengaja BELUM ada — itu ruang lingkup R2.8.
 * Kontrak ini dibekukan lebih dulu supaya R2.8 tinggal menambah adapter baru
 * tanpa menyentuh service, repository, maupun alur kompensasi refund.
 */

export interface PpobPurchaseRequest {
  /// Referensi publik transaksi kita — dipakai provider sebagai kunci dedup.
  publicReference: string;
  sku: string;
  category: PpobCategory;
  targetNumber: string;
  amount: string;
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
}

/// Provider dimatikan lewat konfigurasi (PPOB_PROVIDER=disabled).
export class PpobProviderDisabledError extends Error {
  constructor() {
    super("PPOB provider is disabled by configuration");
    this.name = "PpobProviderDisabledError";
  }
}
