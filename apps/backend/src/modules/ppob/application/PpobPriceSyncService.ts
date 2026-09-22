import { logger } from "../../../core/logger/logger.js";
import { ppobSellingPriceFor, selectPricingBand } from "../../../core/finance/ppobPricing.js";
import {
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
