/**
 * Asumsi laporan laba rugi. Bisa diubah lewat environment tanpa deploy kode:
 *  - PL_SERVER_COST_MONTHLY: biaya server (rupiah per bulan).
 *  - PL_PPN_MODE: INCLUSIVE (PKP, harga jual sudah termasuk PPN; bawaan) atau NONE (tanpa PPN).
 *  - PL_PPN_RATE_PERCENT: tarif PPN efektif (bawaan 11).
 *  - PL_INCOME_TAX_MODE: FINAL_OMZET (PPh final dari omzet; bawaan), CORPORATE (PPh badan dari laba sebelum pajak),
 *    atau NONE (pajak penghasilan belum dihitung).
 *  - PL_FINAL_TAX_RATE_PERCENT (bawaan 0,5) dan PL_CORPORATE_TAX_RATE_PERCENT (bawaan 22).
 */
function positiveNumber(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export type IncomeTaxMode = "FINAL_OMZET" | "CORPORATE" | "NONE";

export function plConfig() {
  const taxMode = (process.env.PL_INCOME_TAX_MODE ?? "FINAL_OMZET").trim().toUpperCase();
  const incomeTaxMode: IncomeTaxMode = taxMode === "CORPORATE" || taxMode === "NONE" ? taxMode : "FINAL_OMZET";
  return {
    serverCostMonthly: positiveNumber(process.env.PL_SERVER_COST_MONTHLY, 1_500_000),
    ppnMode: (process.env.PL_PPN_MODE ?? "INCLUSIVE").trim().toUpperCase() === "NONE" ? ("NONE" as const) : ("INCLUSIVE" as const),
    ppnRatePercent: positiveNumber(process.env.PL_PPN_RATE_PERCENT, 11),
    incomeTaxMode,
    finalTaxRatePercent: positiveNumber(process.env.PL_FINAL_TAX_RATE_PERCENT, 0.5),
    corporateTaxRatePercent: positiveNumber(process.env.PL_CORPORATE_TAX_RATE_PERCENT, 22)
  };
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * Biaya server bulanan dibagi rata per hari kalender WIB pada bulan yang
 * bersangkutan, lalu dijumlahkan sepanjang periode (hari yang tersentuh
 * dihitung penuh). Batas atas 5 tahun agar tidak berulang tanpa akhir.
 */
export function prorateMonthlyCost(monthly: number, from: Date, to: Date) {
  const start = new Date(from.getTime() + WIB_OFFSET_MS);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(to.getTime() + WIB_OFFSET_MS);
  end.setUTCHours(0, 0, 0, 0);
  const days = Math.min(1830, Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS)) + 1);
  let total = 0;
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start.getTime() + i * DAY_MS);
    const daysInMonth = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
    total += monthly / daysInMonth;
  }
  return { amount: Math.round(total), days };
}
