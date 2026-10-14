import { describe, expect, it } from "vitest";
import { ppobMarginStatus, ppobNetMargin, TaxConfig } from "../../src/core/finance/ppobMargin.js";

/**
 * Untung BERSIH per transaksi PPOB (keputusan Owner 14 Okt 2026: minimal Rp500 prabayar, Rp1.000 pascabayar).
 * Angka diperiksa dengan hitungan tangan dari rumus: PPN = selisih x 11/111; PPh final = 0,5% x dasar omzet.
 */
const DEFAULT_TAX: TaxConfig = {
  ppnMode: "INCLUSIVE",
  ppnRatePercent: 11,
  incomeTaxMode: "FINAL_OMZET",
  finalTaxRatePercent: 0.5,
  corporateTaxRatePercent: 22
};

describe("ppobNetMargin", () => {
  it("prabayar: modal 5.405, jual 6.000 -> selisih 595, PPN 58,96, PPh final 29,71, bersih 506,33", () => {
    // PPN = 595 x 11/111 = 58,964; dasar omzet = 6.000 - 58,964 = 5.941,036; PPh = 0,5% x 5.941,036 = 29,705.
    expect(ppobNetMargin({ salePrice: 6000, cost: 5405, kind: "PREPAID" }, DEFAULT_TAX)).toBeCloseTo(506.33, 1);
  });

  it("pascabayar: biaya layanan 1.150 -> PPN 113,96, PPh 5,18, bersih 1.030,86; biaya 1.100 belum cukup (986,04)", () => {
    // Dasar omzet pascabayar hanya biaya layanan tanpa PPN: 1.150 - 113,964 = 1.036,036; PPh = 5,18.
    expect(ppobNetMargin({ salePrice: 101_150, cost: 100_000, kind: "POSTPAID" }, DEFAULT_TAX)).toBeCloseTo(1030.86, 1);
    expect(ppobNetMargin({ salePrice: 101_100, cost: 100_000, kind: "POSTPAID" }, DEFAULT_TAX)).toBeCloseTo(986.04, 1);
  });

  it("PPh final dihitung dari omzet, jadi nominal besar butuh selisih lebih besar untuk bersih yang sama", () => {
    const small = ppobNetMargin({ salePrice: 10_600, cost: 10_000, kind: "PREPAID" }, DEFAULT_TAX);
    const large = ppobNetMargin({ salePrice: 1_000_600, cost: 1_000_000, kind: "PREPAID" }, DEFAULT_TAX);
    // Selisih sama (600); PPh atas omzet satu juta jauh lebih besar (sekitar 5.000 dibanding 53).
    expect(small).toBeGreaterThan(400);
    expect(large).toBeLessThan(-4000);
  });

  it("tanpa PPN dan tanpa pajak penghasilan: bersih = selisih", () => {
    const none: TaxConfig = { ...DEFAULT_TAX, ppnMode: "NONE", incomeTaxMode: "NONE" };
    expect(ppobNetMargin({ salePrice: 11_000, cost: 10_000, kind: "PREPAID" }, none)).toBe(1000);
  });

  it("hanya PPN: 11.000 - 10.000 = 1.000 dikurangi PPN 99,10", () => {
    expect(ppobNetMargin({ salePrice: 11_000, cost: 10_000, kind: "PREPAID" }, { ...DEFAULT_TAX, incomeTaxMode: "NONE" })).toBeCloseTo(900.9, 1);
  });

  it("PPh badan 22% dari selisih tanpa PPN: bersih 702,70", () => {
    // Selisih 1.000, PPN 99,099, laba 900,901, PPh 22% = 198,198.
    expect(ppobNetMargin({ salePrice: 11_000, cost: 10_000, kind: "PREPAID" }, { ...DEFAULT_TAX, incomeTaxMode: "CORPORATE" })).toBeCloseTo(702.7, 1);
  });

  it("rugi: jual sama dengan modal tetap rugi bersih karena PPh atas omzet (-50 pada 10.000)", () => {
    expect(ppobNetMargin({ salePrice: 10_000, cost: 10_000, kind: "PREPAID" }, DEFAULT_TAX)).toBeCloseTo(-50, 5);
    // Modal lebih tinggi dari harga jual: selisih negatif, tanpa PPN.
    expect(ppobNetMargin({ salePrice: 10_000, cost: 10_500, kind: "PREPAID" }, DEFAULT_TAX)).toBeLessThan(-500);
  });
});

describe("ppobMarginStatus", () => {
  it("LOSS bila bersih nol atau negatif, BELOW_TARGET bila positif tetapi di bawah target jenisnya, OK bila memenuhi", () => {
    expect(ppobMarginStatus(-50, "PREPAID")).toBe("LOSS");
    expect(ppobMarginStatus(0, "PREPAID")).toBe("LOSS");
    expect(ppobMarginStatus(499.9, "PREPAID")).toBe("BELOW_TARGET");
    expect(ppobMarginStatus(500, "PREPAID")).toBe("OK");
    // Target pascabayar lebih tinggi: 700 cukup untuk prabayar, tidak untuk pascabayar.
    expect(ppobMarginStatus(700, "PREPAID")).toBe("OK");
    expect(ppobMarginStatus(700, "POSTPAID")).toBe("BELOW_TARGET");
    expect(ppobMarginStatus(1000, "POSTPAID")).toBe("OK");
  });
});
