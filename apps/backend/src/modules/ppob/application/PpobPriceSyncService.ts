import { createHash } from "node:crypto";
import { PpobCategory } from "@prisma/client";
import { logger } from "../../../core/logger/logger.js";
import { ppobSellingPriceFor, selectPricingBand } from "../../../core/finance/ppobPricing.js";
import {
  PpobPostpaidCatalogUpsert,
  PpobPriceSyncCandidate,
  PpobPriceSyncUpdate,
  PpobRepository
} from "../domain/PpobRepository.js";
import { PpobPriceListEntry, PpobProviderGateway } from "../domain/ppobProvider.js";

/**
 * Kunci advisory lock Postgres khusus sinkronisasi harga PPOB. Angka arbitrer
 * dalam namespace int4, berbeda dari PPOB_RECONCILE_LOCK_KEY — jangan dipakai
 * modul lain.
 */
const PPOB_PRICE_SYNC_LOCK_KEY = 727009;
/** Kunci terpisah untuk sinkronisasi katalog pascabayar. */
const PPOB_POSTPAID_CATALOG_LOCK_KEY = 727010;

/**
 * Kategori pascabayar yang dibuka di aplikasi. Keputusan Owner 6 Okt 2026:
 * BPJS, PDAM dulu, lalu semua yang diminta (PLN pascabayar, BPJS Ketenagakerjaan,
 * Telkom, internet, TV kabel, HP pascabayar, multifinance, PBB, gas, e-money).
 * Produk pascabayar di luar daftar ini TIDAK dibuat; brand-nya dilaporkan di hasil
 * sinkronisasi supaya Owner dapat memilih yang berikutnya.
 */
const ENABLED_POSTPAID_CATEGORIES: ReadonlySet<PpobCategory> = new Set<PpobCategory>([
  "BPJS",
  "PDAM",
  "PLN_POSTPAID",
  "BPJS_TK",
  "TELKOM",
  "INTERNET",
  "TV",
  "HP_POSTPAID",
  "MULTIFINANCE",
  "PBB",
  "GAS",
  "EMONEY"
]);

/**
 * Menentukan kategori produk pascabayar dari brand/nama katalog Digiflazz; null =
 * tidak dikenali (dilaporkan, tidak dibuat). Urutan penting: yang lebih spesifik
 * lebih dulu (mis. "BPJS KETENAGAKERJAAN" sebelum "BPJS").
 */
export function classifyPostpaidEntry(entry: { brand: string; name: string }): PpobCategory | null {
  const text = `${entry.brand} ${entry.name}`.toUpperCase();
  const has = (...words: string[]) => words.some((word) => text.includes(word));
  if (has("PDAM")) return "PDAM";
  if (has("BPJS") && has("KETENAGAKERJAAN", "BPJSTK", "BPJS TK")) return "BPJS_TK";
  if (has("BPJS")) return "BPJS";
  if (has("PLN") && has("PASCA", "POSTPAID") && !has("NONTAGLIS", "PREPAID", "PRABAYAR")) return "PLN_POSTPAID";
  if (has("MULTIFINANCE", "MULTI FINANCE")) return "MULTIFINANCE";
  if (has("PBB")) return "PBB";
  if (has("PGN", "PERTAGAS", "GAS NEGARA", "GAS PASCA")) return "GAS";
  if (has("E-MONEY", "EMONEY", "E MONEY")) return "EMONEY";
  if (has("HP PASCA", "HALO", "XL PASCA", "INDOSAT PASCA", "SMARTFREN PASCA", "TRI PASCA", "TELKOMSEL PASCA", "BYU PASCA")) {
    return "HP_POSTPAID";
  }
  if (has("INDIHOME", "INTERNET", "BIZNET", "MYREPUBLIC", "ASTINET")) return "INTERNET";
  if (has("TV KABEL", "TV PASCA", "TV BERLANGGANAN", "TRANSVISION", "KVISION", "ORANGE TV")) return "TV";
  if (has("TELKOM", "TELEPON", "TELEPHONE")) return "TELKOM";
  return null;
}

/** SKU internal buram dan stabil untuk produk pascabayar (lolos regex klien). */
export function postpaidSkuFor(providerSku: string): string {
  return `PSC_${createHash("sha1").update(providerSku).digest("hex").slice(0, 12).toUpperCase()}`;
}

export type PpobPostpaidCatalogSyncResult = {
  skipped: boolean;
  created: number;
  updated: number;
  deactivated: number;
  /// Brand pascabayar di Digiflazz yang belum dibuka di aplikasi, dengan jumlah produk.
  ignoredBrands: Record<string, number>;
  errors: number;
};

export type PpobPriceSyncResult = {
  skipped: boolean;
  /// Produk yang dipertimbangkan pada siklus ini (dikelola sinkronisasi harga).
  considered: number;
  /// Produk yang harganya/rute operatornya berubah dan ditulis ke database.
  updated: number;
  /// Produk yang baru dinonaktifkan (kode providernya hilang/ditutup Digiflazz).
  deactivated: number;
  /// Produk yang baru diaktifkan kembali (Digiflazz membuka lagi kodenya).
  reactivated: number;
  errors: number;
};

const EMPTY_RESULT: PpobPriceSyncResult = {
  skipped: true,
  considered: 0,
  updated: 0,
  deactivated: 0,
  reactivated: 0,
  errors: 0
};

/**
 * Sinkronisasi harga jual PPOB dengan harga modal Digiflazz (keputusan Owner,
 * 20 Sep 2026): harga jual = modal + markup, markup dijaga di [Rp500, Rp1.000]
 * lewat core/finance/ppobPricing.ts. Berjalan berkala (server.ts) DAN dapat
 * dipicu manual oleh SUPER_ADMIN_VIP (lihat admin-console).
 *
 * Fail-closed dan aman diulang: satu kegagalan jaringan membatalkan seluruh
 * siklus TANPA mengubah satu pun harga (tidak ada tulisan sebagian) — harga
 * lama tetap berlaku sampai siklus berikutnya berhasil. Produk yang TIDAK
 * dikelola sinkronisasi (tanpa providerSku/providerSkus — mis. BPJS/PDAM yang
 * belum diaktifkan Digiflazz) tidak pernah disentuh.
 */
export class PpobPriceSyncService {
  constructor(
    private readonly repository: PpobRepository,
    private readonly provider: PpobProviderGateway
  ) {}

  async runSyncCycle(options?: { lockKey?: number }): Promise<PpobPriceSyncResult> {
    if (!this.provider.fetchPriceList) {
      return EMPTY_RESULT;
    }
    const lockKey = options?.lockKey ?? PPOB_PRICE_SYNC_LOCK_KEY;
    const lockHeld = await this.repository.transaction((tx) =>
      this.repository.tryAcquireReconcileLock(lockKey, tx)
    );
    if (!lockHeld) {
      return EMPTY_RESULT;
    }

    // Kegagalan mengambil daftar harga membatalkan SELURUH siklus — tidak ada
    // update sebagian dari data provider yang cuma separuh terambil.
    let priceList: PpobPriceListEntry[];
    try {
      priceList = await this.provider.fetchPriceList();
    } catch (error) {
      logger.warn({ err: error }, "PPOB price sync: gagal mengambil daftar harga Digiflazz");
      return { ...EMPTY_RESULT, skipped: false, errors: 1 };
    }

    const costBySku = new Map<string, { cost: number; active: boolean }>();
    for (const entry of priceList) {
      costBySku.set(entry.providerSku, { cost: entry.cost, active: entry.buyerProductStatus });
    }

    const candidates = await this.repository.listProductsForPriceSync();
    const updates: PpobPriceSyncUpdate[] = [];
    let deactivated = 0;
    let reactivated = 0;
    let errors = 0;

    for (const candidate of candidates) {
      try {
        const computed = this.computeForCandidate(candidate, costBySku);
        if (computed === null) {
          errors += 1;
          continue;
        }
        if (candidate.isActive && !computed.isActive) deactivated += 1;
        if (!candidate.isActive && computed.isActive) reactivated += 1;

        const priceChanged = computed.price !== Number(candidate.price);
        const activeChanged = computed.isActive !== candidate.isActive;
        const skusChanged =
          computed.providerSkus !== undefined &&
          JSON.stringify(sortedEntries(computed.providerSkus)) !==
            JSON.stringify(sortedEntries(asRecord(candidate.providerSkus)));

        if (priceChanged || activeChanged || skusChanged) {
          updates.push({
            id: candidate.id,
            price: computed.price,
            isActive: computed.isActive,
            ...(computed.providerSkus !== undefined ? { providerSkus: computed.providerSkus } : {})
          });
        }
      } catch (error) {
        errors += 1;
        logger.warn(
          { err: error, sku: candidate.sku },
          "PPOB price sync: gagal menghitung harga satu produk, dilewati"
        );
      }
    }

    const syncedAt = new Date();
    const { updated } = await this.repository.applyPriceSyncUpdates(updates, syncedAt);

    return { skipped: false, considered: candidates.length, updated, deactivated, reactivated, errors };
  }

  /**
   * Membuat/memperbarui katalog BPJS dan PDAM dari daftar harga pascabayar
   * Digiflazz. Gagal mengambil daftar = tidak mengubah apa pun. Produk yang
   * tidak ada lagi/ditutup dinonaktifkan; kategori lain tidak dibuat.
   */
  async runPostpaidCatalogSync(): Promise<PpobPostpaidCatalogSyncResult> {
    const empty = { skipped: true, created: 0, updated: 0, deactivated: 0, ignoredBrands: {}, errors: 0 };
    if (!this.provider.fetchPostpaidCatalog) return empty;
    const lockHeld = await this.repository.transaction((tx) =>
      this.repository.tryAcquireReconcileLock(PPOB_POSTPAID_CATALOG_LOCK_KEY, tx)
    );
    if (!lockHeld) return empty;

    let catalog;
    try {
      catalog = await this.provider.fetchPostpaidCatalog();
    } catch (error) {
      logger.warn({ err: error }, "PPOB postpaid catalog sync: gagal mengambil daftar harga pascabayar");
      return { ...empty, skipped: false, errors: 1 };
    }

    const upserts: PpobPostpaidCatalogUpsert[] = [];
    const ignoredBrands: Record<string, number> = {};
    for (const entry of catalog) {
      const category = classifyPostpaidEntry(entry);
      if (!category || !ENABLED_POSTPAID_CATEGORIES.has(category)) {
        const key = entry.brand || entry.name;
        ignoredBrands[key] = (ignoredBrands[key] ?? 0) + 1;
        continue;
      }
      upserts.push({
        sku: postpaidSkuFor(entry.providerSku),
        category,
        brand: entry.brand || category,
        name: entry.name,
        description: entry.description,
        providerSku: entry.providerSku,
        adminFee: entry.adminFee,
        isActive: entry.active
      });
    }
    // Katalog kosong (mis. akun belum berlangganan pascabayar) TIDAK boleh
    // menonaktifkan produk yang sudah ada; itu kemungkinan gangguan, bukan keputusan.
    if (upserts.length === 0) {
      return { ...empty, skipped: false, ignoredBrands };
    }
    const counts = await this.repository.syncPostpaidCatalog(upserts, new Date());
    return { skipped: false, ...counts, ignoredBrands, errors: 0 };
  }

  private computeForCandidate(
    candidate: PpobPriceSyncCandidate,
    costBySku: Map<string, { cost: number; active: boolean }>
  ): { price: number; isActive: boolean; providerSkus?: Record<string, string> } | null {
    if (candidate.providerSkus) {
      const map = asRecord(candidate.providerSkus);
      const keys = Object.keys(map);
      if (keys.length === 0) {
        return null;
      }
      const costs = keys
        .map((key) => {
          const sku = map[key];
          const info = typeof sku === "string" ? costBySku.get(sku) : undefined;
          return info && info.active ? { key, cost: info.cost } : null;
        })
        .filter((entry): entry is { key: string; cost: number } => entry !== null);

      if (costs.length === 0) {
        // Tidak ada satu pun operator yang masih dijual Digiflazz untuk produk
        // ini — nonaktifkan, tetapi providerSkus TIDAK dikosongkan (supaya
        // siklus berikutnya bisa menghidupkan kembali begitu Digiflazz membuka
        // lagi salah satu kodenya, tanpa kehilangan pemetaan yang sudah ada).
        return { price: Number(candidate.price), isActive: false };
      }

      const band = selectPricingBand(costs);
      const providerSkus: Record<string, string> = {};
      for (const key of band.included) {
        providerSkus[key] = map[key] as string;
      }
      return { price: band.price, isActive: true, providerSkus };
    }

    if (candidate.providerSku) {
      const info = costBySku.get(candidate.providerSku);
      if (!info || !info.active) {
        return { price: Number(candidate.price), isActive: false };
      }
      return { price: ppobSellingPriceFor(info.cost), isActive: true };
    }

    // Tidak seharusnya tercapai: listProductsForPriceSync() hanya mengembalikan
    // produk dengan providerSku atau providerSkus. Diperlakukan sebagai galat
    // per-produk (dilewati), bukan diam-diam mengubah apa pun.
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sortedEntries(record: Record<string, unknown>): [string, unknown][] {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}
