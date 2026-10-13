import { describe, expect, it } from "vitest";
import { midtransFeeFor } from "../../src/core/finance/midtransFees.js";
import { plConfig, prorateMonthlyCost } from "../../src/core/finance/plConfig.js";

describe("Biaya gateway Midtrans (tarif publik midtrans.com/pricing)", () => {
  it("kartu: 2,9% + Rp2.000, ditambah PPN 11% atas biaya", () => {
    // (2.000 + 2,9% x 500.000) x 1,11 = 16.500 x 1,11
    expect(midtransFeeFor("credit_card", 500_000).fee.toFixed(2)).toBe("18315.00");
  });

  it("GoPay 2% dan QRIS 0,7%: sudah termasuk PPN, tidak ditambah lagi", () => {
    expect(midtransFeeFor("gopay", 100_000).fee.toFixed(2)).toBe("2000.00");
    expect(midtransFeeFor("qris", 1_000_000).fee.toFixed(2)).toBe("7000.00");
    expect(midtransFeeFor("QRIS", 1_000_000).fee.toFixed(2)).toBe("7000.00");
  });

  it("virtual account Rp4.000 + PPN; jenis tak dikenal atau kosong tidak ditebak", () => {
    expect(midtransFeeFor("bank_transfer", 250_000).fee.toFixed(2)).toBe("4440.00");
    expect(midtransFeeFor("jenis_baru", 100_000)).toEqual({ known: false, fee: expect.anything() });
    expect(midtransFeeFor(null, 100_000).known).toBe(false);
    expect(midtransFeeFor(undefined, 100_000).fee.toFixed(2)).toBe("0.00");
  });
});

describe("Biaya server bulanan dibagi per hari (WIB)", () => {
  const monthly = 1_500_000;

  it("satu bulan penuh = tepat Rp1.500.000, apa pun panjang bulannya", () => {
    for (const [from, to] of [
      ["2026-08-31T17:00:00Z", "2026-09-30T16:59:59Z"], // September 2026 (30 hari) WIB
      ["2026-07-31T17:00:00Z", "2026-08-31T16:59:59Z"], // Agustus (31 hari)
      ["2026-01-31T17:00:00Z", "2026-02-28T16:59:59Z"] // Februari 2026 (28 hari)
    ] as const) {
      expect(prorateMonthlyCost(monthly, new Date(from), new Date(to)).amount, from).toBe(monthly);
    }
  });

  it("satu hari di bulan 30 hari = Rp50.000; periode melintasi dua bulan dihitung per bulan", () => {
    expect(prorateMonthlyCost(monthly, new Date("2026-09-09T17:00:00Z"), new Date("2026-09-10T16:59:59Z")).amount).toBe(50_000);
    // 30 Sep (1/30) + 1 Okt (1/31) WIB
    const cross = prorateMonthlyCost(monthly, new Date("2026-09-29T17:00:00Z"), new Date("2026-10-01T16:59:59Z"));
    expect(cross.days).toBe(2);
    expect(cross.amount).toBe(Math.round(monthly / 30 + monthly / 31));
  });

  it("biaya 0 atau periode terbalik tidak menghasilkan angka negatif", () => {
    expect(prorateMonthlyCost(0, new Date("2026-09-01"), new Date("2026-09-30")).amount).toBe(0);
    expect(prorateMonthlyCost(monthly, new Date("2026-09-10"), new Date("2026-09-01")).amount).toBeGreaterThanOrEqual(0);
  });
});

describe("Asumsi laporan laba rugi", () => {
  const KEYS = [
    "PL_SERVER_COST_MONTHLY",
    "PL_PPN_MODE",
    "PL_PPN_RATE_PERCENT",
    "PL_INCOME_TAX_MODE",
    "PL_FINAL_TAX_RATE_PERCENT",
    "PL_CORPORATE_TAX_RATE_PERCENT"
  ] as const;

  it("bawaan: server Rp1.500.000/bulan, PKP harga termasuk PPN 11%, PPh final 0,5% dari omzet; nilai env tak valid diabaikan", () => {
    const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    try {
      for (const key of KEYS) delete process.env[key];
      const defaults = {
        serverCostMonthly: 1_500_000,
        ppnMode: "INCLUSIVE",
        ppnRatePercent: 11,
        incomeTaxMode: "FINAL_OMZET",
        finalTaxRatePercent: 0.5,
        corporateTaxRatePercent: 22
      };
      expect(plConfig()).toEqual(defaults);

      process.env.PL_SERVER_COST_MONTHLY = "abc";
      process.env.PL_PPN_RATE_PERCENT = "-5";
      process.env.PL_INCOME_TAX_MODE = "ngawur";
      process.env.PL_FINAL_TAX_RATE_PERCENT = "x";
      expect(plConfig()).toEqual(defaults);

      process.env.PL_SERVER_COST_MONTHLY = "2000000";
      process.env.PL_PPN_MODE = "none";
      process.env.PL_INCOME_TAX_MODE = "corporate";
      process.env.PL_CORPORATE_TAX_RATE_PERCENT = "25";
      expect(plConfig()).toEqual({ ...defaults, serverCostMonthly: 2_000_000, ppnMode: "NONE", incomeTaxMode: "CORPORATE", corporateTaxRatePercent: 25 });
    } finally {
      for (const key of KEYS) {
        const value = saved[key];
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
