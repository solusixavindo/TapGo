/**
 * Asumsi biaya operasional untuk laporan laba rugi. Bisa diubah lewat
 * environment tanpa deploy kode: PL_SERVER_COST_MONTHLY (rupiah per bulan) dan
 * PL_TAX_RATE_PERCENT (persen dari total pendapatan).
 */
function positiveNumber(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function plConfig() {
  return {
    serverCostMonthly: positiveNumber(process.env.PL_SERVER_COST_MONTHLY, 1_500_000),
    taxRatePercent: positiveNumber(process.env.PL_TAX_RATE_PERCENT, 11)
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
