import { describe, expect, it } from "vitest";
import { ppobNetMargin } from "../../src/core/finance/ppobMargin.js";
import {
  PPOB_BASE_MAX_MARKUP,
  PPOB_MARKUP_SPREAD,
  ppobMaxMarkupFor,
  ppobSellingPriceFor,
  postpaidServiceFeeFor,
  selectPricingBand
} from "../../src/core/finance/ppobPricing.js";

const prepaidNet = (price: number, cost: number) => ppobNetMargin({ salePrice: price, cost, kind: "PREPAID" });

describe("ppobSellingPriceFor: harga satu biaya modal (untung bersih minimal Rp500)", () => {
  it("untung bersih selalu >= 500, dan satu langkah pembulatan lebih murah akan di bawah 500 (harga minimal)", () => {
    for (const cost of [0, 1, 499, 500, 501, 5405, 6500, 10662, 20000, 20499, 96600, 101095, 1_000_000]) {
      const price = ppobSellingPriceFor(cost);
      expect(prepaidNet(price, cost), `cost=${cost} price=${price}`).toBeGreaterThanOrEqual(500 - 1e-9);
      expect(prepaidNet(price - 100, cost), `cost=${cost} satu langkah di bawah`).toBeLessThan(500);
      expect(price % 100).toBe(0);
    }
  });

  it("nilai nyata Digiflazz, dihitung dengan rumus terpisah", () => {
    expect(ppobSellingPriceFor(5405)).toBe(6000); // selisih 595, bersih 506,33
    expect(ppobSellingPriceFor(96600)).toBe(97700); // selisih 1.100, bersih 503,04
    expect(ppobSellingPriceFor(101095)).toBe(102300); // selisih 1.205, bersih 574,68
    expect(ppobSellingPriceFor(10662)).toBe(11300); // selisih 638, bersih 518,59
  });

  it("nominal besar butuh selisih kotor lebih besar karena PPh final dari omzet", () => {
    expect(ppobSellingPriceFor(100_000) - 100_000).toBe(1200);
    expect(ppobSellingPriceFor(1_000_000) - 1_000_000).toBe(6200);
  });

  it("target dan pembulatan dapat diatur", () => {
    expect(ppobSellingPriceFor(5405, { targetNet: 500, rounding: 500 })).toBe(6000);
    expect(ppobSellingPriceFor(5405, { targetNet: 1000, rounding: 100 })).toBeGreaterThan(6000);
  });

  it("menolak biaya modal negatif atau bukan angka", () => {
    expect(() => ppobSellingPriceFor(-1)).toThrow(RangeError);
    expect(() => ppobSellingPriceFor(Number.NaN)).toThrow(RangeError);
    expect(() => ppobSellingPriceFor(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("postpaidServiceFeeFor: biaya layanan pascabayar (untung bersih minimal Rp1.000)", () => {
  it("Rp1.150: bersih 1.030,86; Rp1.100 hanya 986,04 sehingga belum cukup", () => {
    expect(postpaidServiceFeeFor()).toBe(1150);
    expect(ppobNetMargin({ salePrice: 1150, cost: 0, kind: "POSTPAID" })).toBeGreaterThanOrEqual(1000);
    expect(ppobNetMargin({ salePrice: 1100, cost: 0, kind: "POSTPAID" })).toBeLessThan(1000);
  });

  it("target dan pembulatan dapat diatur", () => {
    expect(postpaidServiceFeeFor({ targetNet: 2000, rounding: 100 })).toBe(2300);
  });
});

describe("selectPricingBand: kelompok operator multi-operator", () => {
  it("daftar kosong: tidak ada yang dijual, tidak melempar", () => {
    expect(selectPricingBand([])).toEqual({ price: 0, included: [], excluded: [] });
  });

  it("satu operator: selalu termasuk, harga = ppobSellingPriceFor biayanya", () => {
    const result = selectPricingBand([{ key: "telkomsel", cost: 5405 }]);
    expect(result.included).toEqual(["telkomsel"]);
    expect(result.excluded).toEqual([]);
    expect(result.price).toBe(ppobSellingPriceFor(5405));
  });

  it("kasus nyata Pulsa Rp10.000: Tri (termurah) dikeluarkan, empat lainnya berbagi Rp11.800", () => {
    // Harga minimum tiap operator: tri 10.800, telkomsel 11.300, axis dan xl 11.500, smartfren 11.800.
    // Pada Rp11.800 selisih Telkomsel 1.138 (batas wajarnya 638 + 500 = 1.138), Tri 1.635 (batas 1.135) tidak lolos.
    const costs = { telkomsel: 10662, axis: 10857, xl: 10860, smartfren: 11140, tri: 10165 };
    const result = selectPricingBand(Object.entries(costs).map(([key, cost]) => ({ key, cost })));
    expect(new Set(result.included)).toEqual(new Set(["telkomsel", "axis", "xl", "smartfren"]));
    expect(result.excluded).toEqual(["tri"]);
    expect(result.price).toBe(11800);
    for (const key of result.included) {
      const cost = costs[key as keyof typeof costs];
      expect(prepaidNet(result.price, cost), key).toBeGreaterThanOrEqual(500);
      expect(result.price - cost, key).toBeLessThanOrEqual(ppobMaxMarkupFor(cost));
    }
    expect(result.price - costs.tri).toBeGreaterThan(ppobMaxMarkupFor(costs.tri));
  });

  it("kasus nyata Pulsa Rp5.000: empat operator berbagi Rp6.500 (selisih Telkomsel tepat di batas wajarnya, 1.095)", () => {
    const costs = { telkomsel: 5405, axis: 5882, tri: 5820, xl: 5862 };
    const result = selectPricingBand(Object.entries(costs).map(([key, cost]) => ({ key, cost })));
    expect(new Set(result.included)).toEqual(new Set(["telkomsel", "tri", "xl", "axis"]));
    expect(result.excluded).toEqual([]);
    expect(result.price).toBe(6500);
    expect(result.price - costs.telkomsel).toBe(ppobMaxMarkupFor(costs.telkomsel));
  });

  it("operator yang jauh lebih murah dikeluarkan sendiri", () => {
    const result = selectPricingBand([
      { key: "murah", cost: 4000 },
      { key: "a", cost: 5820 },
      { key: "b", cost: 5862 },
      { key: "c", cost: 5882 }
    ]);
    // Pada Rp6.500 selisih 'murah' = 2.500, jauh di atas batas wajarnya (harga minimumnya 4.600, selisih 600, jadi batas wajarnya 600 + 500 = 1.100).
    expect(result.excluded).toEqual(["murah"]);
    expect(result.price).toBe(6500);
  });

  it("seri panjang kelompok: memilih kelompok dengan harga lebih rendah", () => {
    const result = selectPricingBand([
      { key: "a", cost: 1000 },
      { key: "b", cost: 1100 },
      { key: "c", cost: 5000 },
      { key: "d", cost: 5100 }
    ]);
    expect(result.included.length).toBe(2);
    expect(new Set(result.included)).toEqual(new Set(["a", "b"]));
  });

  it("urutan hasil included/excluded mengikuti urutan input, bukan urutan setelah sortir", () => {
    const result = selectPricingBand([
      { key: "z-mahal", cost: 50_000 },
      { key: "a-murah", cost: 1000 }
    ]);
    expect(result.included).toEqual(["a-murah"]);
    expect(result.excluded).toEqual(["z-mahal"]);
  });

  it("menolak kunci operator duplikat", () => {
    expect(() =>
      selectPricingBand([
        { key: "x", cost: 100 },
        { key: "x", cost: 200 }
      ])
    ).toThrow(/duplikat/);
  });

  it("batas wajar tidak pernah di bawah batas dasar Rp1.000 dan tumbuh bersama harga minimum", () => {
    expect(ppobMaxMarkupFor(5405)).toBe(Math.max(PPOB_BASE_MAX_MARKUP, 595 + PPOB_MARKUP_SPREAD));
    expect(ppobMaxMarkupFor(1_000_000)).toBe(6200 + PPOB_MARKUP_SPREAD);
  });

  it("properti acak: setiap operator yang termasuk memenuhi untung bersih dan batas wajar, pada 200 skenario", () => {
    for (let trial = 0; trial < 200; trial += 1) {
      const n = 1 + Math.floor(Math.random() * 8);
      const costs: { key: string; cost: number }[] = Array.from({ length: n }, (_, i) => ({
        key: `op${i}`,
        cost: Math.floor(Math.random() * 200_000)
      }));
      const result = selectPricingBand(costs);
      const byKey = new Map(costs.map((c) => [c.key, c.cost]));
      expect(result.included.length + result.excluded.length).toBe(n);
      for (const key of result.included) {
        const cost = byKey.get(key)!;
        expect(prepaidNet(result.price, cost), JSON.stringify({ costs, result })).toBeGreaterThanOrEqual(500 - 1e-9);
        expect(result.price - cost, JSON.stringify({ costs, result })).toBeLessThanOrEqual(ppobMaxMarkupFor(cost));
      }
      // Operator yang bermodal di antara dua operator yang termasuk tidak boleh dikeluarkan.
      if (result.included.length > 0) {
        const includedCosts = result.included.map((k) => byKey.get(k)!).sort((a, b) => a - b);
        const minIncluded = includedCosts[0]!;
        const maxIncluded = includedCosts[includedCosts.length - 1]!;
        for (const key of result.excluded) {
          const cost = byKey.get(key)!;
          if (cost > minIncluded && cost < maxIncluded) {
            throw new Error(`Operator ${key} (cost=${cost}) berada di dalam rentang termasuk tetapi dikeluarkan`);
          }
        }
      }
    }
  });
});
