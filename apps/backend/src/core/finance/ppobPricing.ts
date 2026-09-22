/**
 * Kebijakan harga jual PPOB (keputusan Owner 20 Sep 2026): harga jual TapGo
 * harus di atas harga modal Digiflazz sebesar minimal Rp500 dan maksimal
 * Rp1.000 — cukup untuk dipakai sendiri maupun dijual ulang, tetapi tidak
 * pernah lebih mahal dari itu.
 *
 * Dua bentuk produk PPOB butuh penanganan berbeda:
 *  - Produk SATU kode provider (mis. token PLN): satu biaya modal, satu harga.
 *  - Produk MULTI-OPERATOR (mis. pulsa Rp10.000 yang melayani Telkomsel, XL,
 *    Tri, dst di satu produk): setiap operator punya biaya modal Digiflazz
 *    yang BERBEDA untuk nominal yang sama. Satu harga jual dipakai untuk
 *    semua operator, jadi operator yang biayanya jauh dari kelompok lain
 *    (mis. satu operator jauh lebih murah) TIDAK BOLEH ikut dijual di harga
 *    yang sama — itu akan melanggar batas Rp1.000 untuk operator termahal
 *    atau batas Rp500 untuk operator termurah. selectPricingBand memilih
 *    kelompok operator TERBESAR yang bisa berbagi satu harga tanpa melanggar
 *    kedua batas itu; operator di luar kelompok tidak dijual untuk nominal
 *    ini sampai selisih biayanya menyempit pada siklus sinkronisasi berikutnya.
 */

export const PPOB_MIN_MARKUP = 500;
export const PPOB_MAX_MARKUP = 1000;

/** Kelipatan harga jual — supaya harga selalu angka bulat, bukan sekadar +Rp500. */
const PRICE_ROUNDING = 500;

/**
 * Harga jual untuk SATU biaya modal: kelipatan Rp500 terkecil yang masih
 * menghasilkan margin di dalam [PPOB_MIN_MARKUP, PPOB_MAX_MARKUP].
 *
 * Rumus: bulatkan (modal + margin minimum) ke atas ke kelipatan Rp500.
 * Karena sisa pembulatan maksimum adalah PRICE_ROUNDING - 1, margin akhir
 * selalu berada di [PPOB_MIN_MARKUP, PPOB_MIN_MARKUP + PRICE_ROUNDING - 1] —
 * dengan PRICE_ROUNDING = 500 ini persis [500, 999], di dalam batas atas 1.000.
 */
export function ppobSellingPriceFor(providerCost: number): number {
  if (!Number.isFinite(providerCost) || providerCost < 0) {
    throw new RangeError(`Biaya modal PPOB tidak valid: ${providerCost}`);
  }
  return Math.ceil((providerCost + PPOB_MIN_MARKUP) / PRICE_ROUNDING) * PRICE_ROUNDING;
}

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
 * ada satu pun yang margin-nya di luar [PPOB_MIN_MARKUP, PPOB_MAX_MARKUP].
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
export function selectPricingBand(costs: readonly OperatorCost[]): PricingBandResult {
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
    const price = ppobSellingPriceFor(sorted[end]!.cost);
    while (price - sorted[start]!.cost > PPOB_MAX_MARKUP) {
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
