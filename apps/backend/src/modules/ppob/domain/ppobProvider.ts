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
      /// Harga modal yang ditagihkan provider (rupiah, mis. `price` Digiflazz).
      /// Dasar HPP PPOB pada laporan laba rugi; null/absen bila tidak dilaporkan.
      providerCost?: number | null;
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

/// Satu baris daftar harga provider (Stage R2.12 — sinkronisasi harga PPOB).
export interface PpobPriceListEntry {
  /// Kode produk provider (buyer_sku_code Digiflazz) — kunci pencocokan
  /// dengan providerSku/providerSkus produk kita.
  providerSku: string;
  /// Harga modal SAAT INI di sisi provider (rupiah).
  cost: number;
  /// false = provider sedang menutup penjualan produk ini (stok/gangguan).
  buyerProductStatus: boolean;
}

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
  /**
   * Daftar harga modal terkini provider. Opsional: hanya provider yang
   * mendukung sinkronisasi harga (Digiflazz) mengimplementasikannya —
   * PpobPriceSyncService melewati provider yang tidak mendukungnya.
   */
  fetchPriceList?(): Promise<PpobPriceListEntry[]>;
  /**
   * Pascabayar (BPJS, PDAM): cek tagihan. Opsional: hanya provider yang
   * mendukung pascabayar. Gagal = melempar [PpobBillInquiryError] dengan pesan
   * yang aman ditampilkan ke pelanggan.
   */
  inquireBill?(request: PpobBillInquiryRequest): Promise<PpobBillInquiryResult>;
  /**
   * Pascabayar: bayar tagihan yang sudah di-inquiry (ref_id yang SAMA dengan
   * inquiry). Hasil dipetakan seperti pembelian prabayar (SUCCESS/PROCESSING/FAILED);
   * jawaban tak diketahui (timeout) dilempar dan diperlakukan PROCESSING oleh service.
   */
  payBill?(request: PpobBillPayRequest): Promise<PpobPurchaseOutcome>;
  /**
   * Katalog produk pascabayar (daftar harga `pasca`). Dipakai sinkronisasi
   * katalog BPJS/PDAM; produk dibuat/diperbarui dari sini, bukan diketik manual.
   */
  fetchPostpaidCatalog?(): Promise<PpobPostpaidCatalogEntry[]>;
}

/** Kategori yang dibayar lewat alur pascabayar (cek tagihan lalu bayar). */
export const POSTPAID_CATEGORIES: ReadonlySet<PpobCategory> = new Set<PpobCategory>([
  "BPJS",
  "PDAM",
  "PLN_POSTPAID"
]);

export interface PpobBillInquiryRequest {
  /// Dipakai sebagai ref_id; pembayaran memakai ref_id yang sama.
  publicReference: string;
  providerSku: string;
  targetNumber: string;
}

export interface PpobBillInquiryResult {
  customerName: string;
  period: string | null;
  /// Tagihan murni tanpa admin (rupiah).
  billAmount: number;
  /// Biaya admin provider (rupiah).
  adminFee: number;
  /// Yang ditagihkan provider ke TapGo (selling_price Digiflazz).
  cost: number;
  /// Rincian ringkas untuk tampilan; hanya nilai skalar string/angka.
  detail: Record<string, string | number>;
}

export interface PpobBillPayRequest {
  publicReference: string;
  providerSku: string;
  targetNumber: string;
}

export interface PpobPostpaidCatalogEntry {
  providerSku: string;
  name: string;
  brand: string;
  adminFee: number;
  commission: number;
  active: boolean;
  description: string | null;
}

/// Cek tagihan ditolak/gagal; [userMessage] aman ditampilkan ke pelanggan.
export class PpobBillInquiryError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string
  ) {
    super(`Bill inquiry failed: ${code}`);
    this.name = "PpobBillInquiryError";
  }
}

/// Provider dimatikan lewat konfigurasi (PPOB_PROVIDER=disabled).
export class PpobProviderDisabledError extends Error {
  constructor() {
    super("PPOB provider is disabled by configuration");
    this.name = "PpobProviderDisabledError";
  }
}
