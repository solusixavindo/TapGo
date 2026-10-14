import { PpobKind, ppobMarginConfig, ppobNetMargin, ppobTargetNet } from "./ppobMargin.js";

/**
 * Kebijakan harga jual PPOB.
 *
 * Keputusan Owner 20 Sep 2026: harga jual di atas modal Digiflazz. Diperbarui 14 Okt 2026: yang dijamin kini
 * UNTUNG BERSIH minimal Rp500 per transaksi prabayar dan Rp1.000 per pascabayar (setelah PPN atas selisih dan PPh;
 * lihat ppobMargin.ts), bukan lagi selisih kotor Rp500 sampai Rp999. Karena PPh final dihitung dari omzet, produk
 * bernominal besar butuh selisih kotor lebih besar untuk bersih yang sama (modal Rp100.000 butuh selisih sekitar
 * Rp1.115); batas atas lama Rp1.000 karena itu tidak lagi menjadi batas keras.
 *
 * Dua bentuk produk PPOB butuh penanganan berbeda:
 *  - Produk SATU kode provider (mis. token PLN): satu biaya modal, satu harga.
 *  - Produk MULTI-OPERATOR (mis. pulsa Rp10.000 yang melayani Telkomsel, XL, Tri, dst di satu produk): setiap
 *    operator punya biaya modal Digiflazz yang BERBEDA untuk nominal yang sama. Satu harga jual dipakai untuk semua
 *    operator, jadi operator yang modalnya jauh dari kelompok lain TIDAK BOLEH ikut dijual di harga yang sama: itu
 *    membuat operator termahal di bawah target untung, atau operator termurah terlalu mahal bagi pelanggan.
 *    selectPricingBand memilih kelompok operator TERBESAR yang bisa berbagi satu harga; operator di luar kelompok
 *    tidak dijual untuk nominal ini sampai selisih modalnya menyempit pada sinkronisasi berikutnya.
 */

/** Selisih harga di atas harga minimum operator itu yang masih dianggap wajar bagi pelanggan (sebaran satu harga bersama). */
export const PPOB_MARKUP_SPREAD = 500;
/** Batas atas selisih kotor minimum yang dipakai bila lebih besar dari harga minimum + sebaran (kompatibel dengan kebijakan lama). */
export const PPOB_BASE_MAX_MARKUP = 1000;

export interface PricingOptions {
  /** Target untung bersih; bawaan dari ppobMarginConfig (PPOB_NET_MARGIN_PREPAID). */
  targetNet?: number;
  /** Kelipatan harga jual; bawaan dari ppobMarginConfig (PPOB_PRICE_ROUNDING). */
  rounding?: number;
}

function resolve(options: PricingOptions | undefined) {
  const config = ppobMarginConfig();
  return { targetNet: options?.targetNet ?? config.targetNetPrepaid, rounding: options?.rounding ?? config.priceRounding };
}

/**
 * Harga jual untuk SATU biaya modal: kelipatan pembulatan terkecil yang menghasilkan untung bersih >= target.
 * Mulai dari modal + target (batas bawah mutlak), lalu naik satu kelipatan sampai terpenuhi.
 */
export function ppobSellingPriceFor(providerCost: number, options?: PricingOptions): number {
  if (!Number.isFinite(providerCost) || providerCost < 0) {
    throw new RangeError(`Biaya modal PPOB tidak valid: ${providerCost}`);
  }
  const { targetNet, rounding } = resolve(options);
  let price = Math.ceil((providerCost + targetNet) / rounding) * rounding;
  // Batas iterasi: PPh dan PPN hanya persen kecil dari harga, jadi beberapa langkah cukup.
  for (let step = 0; step < 10_000; step += 1) {
    if (ppobNetMargin({ salePrice: price, cost: providerCost, kind: "PREPAID" }) + 1e-9 >= targetNet) return price;
    price += rounding;
  }
  throw new RangeError(`Harga jual yang memenuhi target untung tidak ditemukan untuk modal ${providerCost}`);
}

/** Selisih kotor tertinggi yang masih diterima bagi operator bermodal `cost` bila berbagi satu harga dengan operator lain. */
export function ppobMaxMarkupFor(cost: number, options?: PricingOptions): number {
  return Math.max(PPOB_BASE_MAX_MARKUP, ppobSellingPriceFor(cost, options) - cost + PPOB_MARKUP_SPREAD);
}

/**
 * Biaya layanan pascabayar terkecil (kelipatan Rp50) yang menghasilkan untung bersih >= target pascabayar.
 * Tagihan adalah modal; pelanggan membayar tagihan + biaya layanan ini.
 */
export function postpaidServiceFeeFor(options?: { targetNet?: number; rounding?: number }): number {
  const config = ppobMarginConfig();
  const targetNet = options?.targetNet ?? config.targetNetPostpaid;
  const rounding = options?.rounding ?? config.feeRounding;
  let fee = Math.ceil(targetNet / rounding) * rounding;
  for (let step = 0; step < 10_000; step += 1) {
    if (ppobNetMargin({ salePrice: fee, cost: 0, kind: "POSTPAID" }) + 1e-9 >= targetNet) return fee;
    fee += rounding;
  }
  throw new RangeError(`Biaya layanan pascabayar yang memenuhi target ${targetNet} tidak ditemukan`);
}

export { ppobTargetNet };
export type { PpobKind };

export interface OperatorCost {
  /** Kunci operator (mis. "telkomsel"); harus unik dalam satu pemanggilan. */
  key: string;
  /** Biaya modal Digiflazz untuk operator ini, pada nominal yang sama. */
  cost: number;
}

export interface PricingBandResult {
  /** Harga jual tunggal untuk seluruh operator yang termasuk (0 bila tidak ada). */
  price: number;
  /** Operator yang aman dijual pada `price` (margin di dalam batas), urut sesuai input. */
  included: string[];
  /** Operator yang margin-nya akan melanggar batas pada `price` — tidak dijual dulu. */
  excluded: string[];
}

/**
 * Memilih kelompok operator TERBESAR yang bisa berbagi satu harga jual tanpa
 * ada satu pun yang untung bersihnya di bawah target atau selisih kotornya melewati batas wajar (ppobMaxMarkupFor).
 *
 * Algoritma: urutkan biaya menaik, lalu sliding window. Untuk window yang
 * berakhir di operator termahal saat ini (`end`), harga yang dipakai adalah
 * ppobSellingPriceFor(cost[end]) — operator termahal SELALU mendapat margin
 * minimum yang sah. Operator di awal window (`start`) digeser maju selama
 * margin-nya pada harga itu melebihi batas atas. Window terpanjang menang;
 * bila seri, dipilih yang harga jualnya (dan karenanya termahal) paling
 * rendah — lebih murah untuk pelanggan.
 *
 * O(n log n) untuk pengurutan, O(n) untuk sliding window. Aman untuk daftar
 * kosong (mengembalikan price 0, included/excluded kosong).
 */
export function selectPricingBand(costs: readonly OperatorCost[], options?: PricingOptions): PricingBandResult {
  if (costs.length === 0) {
    return { price: 0, included: [], excluded: [] };
  }

  const seen = new Set<string>();
  for (const entry of costs) {
    if (seen.has(entry.key)) {
      throw new Error(`Kunci operator duplikat pada selectPricingBand: ${entry.key}`);
    }
    seen.add(entry.key);
  }

  const sorted = [...costs].sort((a, b) => a.cost - b.cost);

  let bestStart = 0;
  let bestEnd = 0;
  let bestLength = 0;
  let bestPrice = 0;
  let start = 0;

  for (let end = 0; end < sorted.length; end += 1) {
    const price = ppobSellingPriceFor(sorted[end]!.cost, options);
    while (price - sorted[start]!.cost > ppobMaxMarkupFor(sorted[start]!.cost, options)) {
      start += 1;
    }
    const length = end - start + 1;
    if (length > bestLength || (length === bestLength && price < bestPrice)) {
      bestLength = length;
      bestStart = start;
      bestEnd = end;
      bestPrice = price;
    }
  }

  const includedKeys = new Set(sorted.slice(bestStart, bestEnd + 1).map((entry) => entry.key));
  const included: string[] = [];
  const excluded: string[] = [];
  for (const entry of costs) {
    (includedKeys.has(entry.key) ? included : excluded).push(entry.key);
  }
  return { price: bestPrice, included, excluded };
}
