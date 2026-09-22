import { describe, expect, it } from "vitest";
import {
  PPOB_MAX_MARKUP,
  PPOB_MIN_MARKUP,
  ppobSellingPriceFor,
  selectPricingBand
} from "../../src/core/finance/ppobPricing.js";

describe("ppobSellingPriceFor — harga satu biaya modal", () => {
  it("margin selalu di dalam [500, 1000] untuk berbagai modal", () => {
    for (const cost of [0, 1, 499, 500, 501, 5405, 6500, 10662, 20000, 20499, 96600, 1_000_000]) {
      const price = ppobSellingPriceFor(cost);
      const margin = price - cost;
      expect(margin, `cost=${cost} price=${price}`).toBeGreaterThanOrEqual(PPOB_MIN_MARKUP);
      expect(margin, `cost=${cost} price=${price}`).toBeLessThanOrEqual(PPOB_MAX_MARKUP);
      expect(price % 500).toBe(0);
    }
  });

  it("nilai nyata Digiflazz (harga contoh sesi ini)", () => {
    expect(ppobSellingPriceFor(5405)).toBe(6000); // margin 595
    expect(ppobSellingPriceFor(96600)).toBe(97500); // margin 900
    expect(ppobSellingPriceFor(101095)).toBe(102000); // margin 905
  });

  it("menolak biaya modal negatif atau bukan angka", () => {
    expect(() => ppobSellingPriceFor(-1)).toThrow(RangeError);
    expect(() => ppobSellingPriceFor(Number.NaN)).toThrow(RangeError);
    expect(() => ppobSellingPriceFor(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("selectPricingBand — kelompok operator multi-operator", () => {
  it("daftar kosong: tidak ada yang dijual, tidak melempar", () => {
    expect(selectPricingBand([])).toEqual({ price: 0, included: [], excluded: [] });
  });

  it("satu operator: selalu termasuk, harga = ppobSellingPriceFor biayanya", () => {
    const result = selectPricingBand([{ key: "telkomsel", cost: 5405 }]);
    expect(result.included).toEqual(["telkomsel"]);
    expect(result.excluded).toEqual([]);
    expect(result.price).toBe(ppobSellingPriceFor(5405));
  });

  it("kasus nyata Pulsa Rp10.000 (harga Digiflazz sesi ini): Tri (termurah) dan Smartfren (termahal) dikeluarkan", () => {
    // telkomsel 10662, axis 10857, xl 10860, smartfren 11140 (termahal), tri 10165 (termurah)
    const costs = { telkomsel: 10662, axis: 10857, xl: 10860, smartfren: 11140, tri: 10165 };
    const result = selectPricingBand(Object.entries(costs).map(([key, cost]) => ({ key, cost })));
    // Kelompok terpadat: telkomsel+axis+xl berbagi Rp11.500. Tri terlalu murah untuk
    // harga itu (margin akan >1.000); Smartfren terlalu mahal (margin akan <500).
    expect(new Set(result.included)).toEqual(new Set(["telkomsel", "axis", "xl"]));
    expect(new Set(result.excluded)).toEqual(new Set(["tri", "smartfren"]));
    expect(result.price).toBe(11500);
    for (const key of result.included) {
      const margin = result.price - costs[key as keyof typeof costs];
      expect(margin, key).toBeGreaterThanOrEqual(PPOB_MIN_MARKUP);
      expect(margin, key).toBeLessThanOrEqual(PPOB_MAX_MARKUP);
    }
    expect(result.price - costs.tri).toBeGreaterThan(PPOB_MAX_MARKUP);
    expect(result.price - costs.smartfren).toBeLessThan(PPOB_MIN_MARKUP);
  });

  it("kasus nyata Pulsa Rp5.000: Telkomsel jauh lebih murah dari tiga lainnya, dikeluarkan sendiri", () => {
    const costs = { telkomsel: 5405, axis: 5882, tri: 5820, xl: 5862 };
    const result = selectPricingBand(Object.entries(costs).map(([key, cost]) => ({ key, cost })));
    // tri, xl, axis berbagi Rp6.500; menambahkan Telkomsel akan mendorong harga naik
    // untuk menampung operator lain, membuat margin Telkomsel sendiri melewati 1.000.
    expect(new Set(result.included)).toEqual(new Set(["tri", "xl", "axis"]));
    expect(result.excluded).toEqual(["telkomsel"]);
    expect(result.price).toBe(6500);
    expect(result.price - costs.telkomsel).toBeGreaterThan(PPOB_MAX_MARKUP);
  });

  it("seri panjang kelompok: memilih harga (dan kelompok termahal) yang lebih rendah", () => {
    // Dua kelompok terpisah jauh, masing-masing berisi 2 operator yang rapat.
    const result = selectPricingBand([
      { key: "a", cost: 1000 },
      { key: "b", cost: 1100 },
      { key: "c", cost: 5000 },
      { key: "d", cost: 5100 }
    ]);
    expect(result.included.length).toBe(2);
    // Kelompok termurah (a,b) dipilih karena harganya lebih rendah untuk pelanggan.
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

  it("properti acak: setiap operator yang termasuk selalu bermargin sah, pada 200 skenario acak", () => {
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
        const margin = result.price - byKey.get(key)!;
        expect(margin, JSON.stringify({ costs, result })).toBeGreaterThanOrEqual(PPOB_MIN_MARKUP);
        expect(margin, JSON.stringify({ costs, result })).toBeLessThanOrEqual(PPOB_MAX_MARKUP);
      }
      // Tidak ada operator yang lebih murah dari termurah yang termasuk namun dikeluarkan
      // padahal seharusnya masih sah pada harga terpilih (band harus "padat" pada window sortir).
      if (result.included.length > 0) {
        const includedCosts = result.included.map((k) => byKey.get(k)!).sort((a, b) => a - b);
        const minIncluded = includedCosts[0]!;
        const maxIncluded = includedCosts[includedCosts.length - 1]!;
        for (const key of result.excluded) {
          const cost = byKey.get(key)!;
          if (cost > minIncluded && cost < maxIncluded) {
            // Operator ini berada DI ANTARA rentang yang termasuk — pasti sah pula.
            const margin = result.price - cost;
            expect(margin).toBeGreaterThanOrEqual(PPOB_MIN_MARKUP);
            expect(margin).toBeLessThanOrEqual(PPOB_MAX_MARKUP);
            throw new Error(
              `Operator ${key} (cost=${cost}) berada di dalam rentang termasuk tetapi dikeluarkan`
            );
          }
        }
      }
    }
  });
});
