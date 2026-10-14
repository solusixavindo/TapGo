import { plConfig } from "./plConfig.js";

/**
 * Untung BERSIH per transaksi PPOB.
 *
 * Keputusan Owner (14 Okt 2026): untung bersih minimal Rp500 per transaksi prabayar dan Rp1.000 per transaksi
 * pascabayar. "Bersih" di sini = selisih harga jual dan modal Digiflazz, dikurangi PPN atas selisih itu dan PPh
 * penghasilan, memakai pengaturan pajak yang sama dengan Laba Rugi (plConfig): harga jual sudah termasuk PPN, PPh
 * final dari omzet.
 *
 *  - PPN keluaran hanya atas SELISIH (bukan atas modal): seperti di Laba Rugi, pulsa/token dijual atas nama
 *    Digiflazz, sehingga PPN atas nilai modalnya bukan beban TapGo. Selisih sudah termasuk PPN (INCLUSIVE):
 *    PPN = selisih x tarif / (100 + tarif).
 *  - PPh final dari omzet. Dasar prabayar = penjualan bruto tanpa PPN selisih; dasar pascabayar = hanya biaya
 *    layanan (tagihan disajikan neto), tanpa PPN. Dasar PPh badan = selisih tanpa PPN.
 *
 * Prabayar dan pascabayar dibedakan hanya pada dasar pajak omzet. Biaya gateway tidak masuk: pembelian PPOB memakai
 * saldo, dan biaya top up ditanggung pelanggan.
 */
export type PpobKind = "PREPAID" | "POSTPAID";

function positiveNumber(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Target dan pembulatan; bisa diubah lewat environment tanpa deploy kode. */
export function ppobMarginConfig() {
  return {
    /** Untung bersih minimal per transaksi prabayar (bawaan Rp500). */
    targetNetPrepaid: positiveNumber(process.env.PPOB_NET_MARGIN_PREPAID, 500),
    /** Untung bersih minimal per transaksi pascabayar (bawaan Rp1.000). */
    targetNetPostpaid: positiveNumber(process.env.PPOB_NET_MARGIN_POSTPAID, 1000),
    /** Kelipatan harga jual prabayar (bawaan Rp100: harga tetap bulat tetapi tidak jauh melewati target). */
    priceRounding: Math.max(1, Math.round(positiveNumber(process.env.PPOB_PRICE_ROUNDING, 100))),
    /** Kelipatan biaya layanan pascabayar. */
    feeRounding: 50
  };
}

export type TaxConfig = Pick<ReturnType<typeof plConfig>, "ppnMode" | "ppnRatePercent" | "incomeTaxMode" | "finalTaxRatePercent" | "corporateTaxRatePercent">;

/**
 * Untung bersih satu transaksi, dalam rupiah (bisa pecahan dan bisa negatif).
 * `salePrice` = total yang dibayar pelanggan; `cost` = modal Digiflazz. Untuk pascabayar, salePrice = tagihan + biaya
 * layanan dan cost = tagihan, sehingga selisihnya adalah biaya layanan.
 */
export function ppobNetMargin(input: { salePrice: number; cost: number; kind: PpobKind }, tax: TaxConfig = plConfig()): number {
  const margin = input.salePrice - input.cost;
  const ppn = tax.ppnMode === "INCLUSIVE" && margin > 0 ? (margin * tax.ppnRatePercent) / (100 + tax.ppnRatePercent) : 0;
  const revenueBase = input.kind === "POSTPAID" ? margin - ppn : input.salePrice - ppn;
  let incomeTax = 0;
  if (tax.incomeTaxMode === "FINAL_OMZET") {
    incomeTax = (Math.max(0, revenueBase) * tax.finalTaxRatePercent) / 100;
  } else if (tax.incomeTaxMode === "CORPORATE") {
    incomeTax = (Math.max(0, margin - ppn) * tax.corporateTaxRatePercent) / 100;
  }
  return margin - ppn - incomeTax;
}

/** Target untung bersih menurut jenis. */
export function ppobTargetNet(kind: PpobKind, config = ppobMarginConfig()): number {
  return kind === "POSTPAID" ? config.targetNetPostpaid : config.targetNetPrepaid;
}

/** Status satu transaksi sukses terhadap target: rugi (bersih <= 0), di bawah target, atau memenuhi. */
export function ppobMarginStatus(netMargin: number, kind: PpobKind, config = ppobMarginConfig()): "LOSS" | "BELOW_TARGET" | "OK" {
  if (netMargin <= 0) return "LOSS";
  return netMargin + 1e-9 < ppobTargetNet(kind, config) ? "BELOW_TARGET" : "OK";
}
