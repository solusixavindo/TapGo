"use client";

import { useHardRouter as useRouter } from "../hard-nav";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ProfitLossReport,
  formatRupiah,
  profitLossReport,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import { PeriodState, defaultPeriod, periodLabel, periodQuery } from "../../lib/period";
import ConsoleHeader from "../console-header";
import PeriodFilter from "../period-filter";

/**
 * Laba rugi manajemen — hanya Super Admin VIP.
 *
 * Disusun mengikuti urutan laporan laba rugi menurut SAK Indonesia: pendapatan usaha (tanpa PPN), beban pokok
 * pendapatan, laba kotor, beban usaha, laba usaha, laba sebelum pajak, beban pajak penghasilan, laba bersih.
 * Angka dihitung dari data operasional sistem, bukan laporan keuangan teraudit; asumsi dan hal yang belum
 * dihitung ditampilkan di panel catatan supaya laba tidak terbaca lebih besar dari kenyataannya.
 */

function delta(current: string, previous: string | undefined) {
  if (previous === undefined) return null;
  const now = Number(current);
  const before = Number(previous);
  if (before === 0) return now === 0 ? null : { text: "baru", tone: "up" as const };
  const pct = ((now - before) / Math.abs(before)) * 100;
  return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs periode sebelumnya`, tone: pct >= 0 ? ("up" as const) : ("down" as const) };
}

function Kpi({
  label,
  value,
  note,
  tone
}: {
  label: string;
  value: string;
  note?: { text: string; tone: "up" | "down" } | null;
  tone?: "neutral" | "profit";
}) {
  return (
    <div className={`rounded-2xl p-5 shadow-sm ${tone === "profit" ? "bg-brand-navy text-white" : "bg-white"}`}>
      <p className={`text-[11px] font-bold uppercase tracking-wider ${tone === "profit" ? "text-slate-300" : "text-slate-500"}`}>{label}</p>
      <p className="mt-2 text-2xl font-black tabular-nums">{value}</p>
      {note ? (
        <p className={`mt-1 text-xs font-semibold ${note.tone === "up" ? (tone === "profit" ? "text-emerald-300" : "text-emerald-700") : "text-rose-500"}`}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}

function Line({ label, value, revenue, indent, bold, negative }: { label: string; value: string; revenue: number; indent?: boolean; bold?: boolean; negative?: boolean }) {
  const amount = Number(value);
  const share = revenue > 0 ? `${((amount / revenue) * 100).toFixed(1)}%` : "—";
  return (
    <tr className={bold ? "border-t border-slate-300 bg-slate-50 font-bold" : ""}>
      <td className={`px-5 py-2.5 ${indent ? "pl-10 text-slate-600" : ""}`}>{label}</td>
      <td className={`px-5 py-2.5 text-right tabular-nums ${negative && amount > 0 ? "text-rose-600" : ""}`}>
        {negative && amount > 0 ? `(${formatRupiah(amount)})` : formatRupiah(amount)}
      </td>
      <td className="w-24 px-5 py-2.5 text-right text-xs text-slate-500 tabular-nums">{share}</td>
    </tr>
  );
}

const METHOD_LABEL: Record<string, string> = {
  credit_card: "Kartu kredit/debit",
  gopay: "GoPay",
  qris: "QRIS",
  shopeepay: "ShopeePay",
  dana: "DANA",
  ovo: "OVO",
  bank_transfer: "Virtual account",
  echannel: "Virtual account Mandiri",
  permata: "Virtual account Permata",
  cstore: "Gerai ritel",
  akulaku: "Akulaku",
  kredivo: "Kredivo"
};

export default function ProfitLossPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod("month"));
  const [report, setReport] = useState<ProfitLossReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const range = useMemo(() => periodQuery(period), [period]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await profitLossReport(range));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Laporan belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    const current = readRole();
    if (!roleAtLeast(current, "SUPER_ADMIN_VIP")) {
      router.replace("/beranda");
      return;
    }
    setRole(current);
    void load();
  }, [router, load]);

  const revenueTotal = Number(report?.revenue.total ?? 0);

  return (
    <main className="min-h-screen p-6 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <ConsoleHeader
          title="Laba Rugi"
          subtitle={`Periode ${periodLabel(period.mode, period.anchor)}. Laporan manajemen dari data operasional sistem.`}
          role={role}
          actions={
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Cetak
            </button>
          }
        />

        <div className="mb-5 print:hidden">
          <PeriodFilter value={period} onChange={setPeriod} disabled={loading} />
        </div>

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {loading || !report ? (
          <p className="text-sm text-slate-500">Memuat…</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Kpi label="Pendapatan usaha" value={formatRupiah(report.revenue.total)} note={delta(report.revenue.total, report.previous?.totalRevenue)} />
              <Kpi label="Total beban (pokok + usaha + pajak)" value={formatRupiah(report.totalExpenses)} note={delta(report.totalExpenses, report.previous?.totalExpenses)} />
              <Kpi
                label={`Laba bersih${report.netMarginPercent ? ` · margin ${report.netMarginPercent}%` : ""}`}
                value={formatRupiah(report.netProfit)}
                note={delta(report.netProfit, report.previous?.netProfit)}
                tone="profit"
              />
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Uraian</th>
                    <th className="px-5 py-3 text-right">Jumlah</th>
                    <th className="px-5 py-3 text-right">% pendapatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td colSpan={3} className="bg-slate-50 px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Pendapatan usaha (tanpa PPN)
                    </td>
                  </tr>
                  <Line label="Penjualan membership" value={report.revenue.membershipSales} revenue={revenueTotal} indent />
                  <Line label="Pengembalian dana membership" value={report.revenue.membershipRefunds} revenue={revenueTotal} indent negative />
                  <Line label="Saldo PPOB manfaat paket (pendapatan diterima di muka, diakui saat dipakai)" value={report.revenue.membershipDeferred} revenue={revenueTotal} indent negative />
                  <Line label="Komisi platform ojek (TapGoPay)" value={report.revenue.rideCommission} revenue={revenueTotal} indent />
                  <Line label="Penjualan PPOB prabayar (bruto)" value={report.revenue.ppobPrepaid} revenue={revenueTotal} indent />
                  <Line label="Biaya layanan tagihan pascabayar (neto)" value={report.revenue.ppobPostpaidFee} revenue={revenueTotal} indent />
                  <Line label="Total pendapatan usaha" value={report.revenue.total} revenue={revenueTotal} bold />
                  <tr>
                    <td colSpan={3} className="bg-slate-50 px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Beban pokok pendapatan
                    </td>
                  </tr>
                  <Line label="HPP paket membership (perlengkapan dan BPJS, tanpa saldo PPOB)" value={report.cogs.hppPackages} revenue={revenueTotal} indent negative />
                  <Line label="Harga pokok PPOB prabayar (Digiflazz)" value={report.cogs.ppobCost} revenue={revenueTotal} indent negative />
                  <Line label="Total beban pokok pendapatan" value={report.cogs.total} revenue={revenueTotal} bold negative />
                  <Line label="Laba kotor" value={report.grossProfit} revenue={revenueTotal} bold />
                  <tr>
                    <td colSpan={3} className="bg-slate-50 px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Beban usaha
                    </td>
                  </tr>
                  <Line label="Bonus referral (sponsor)" value={report.opex.sponsorBonus} revenue={revenueTotal} indent negative />
                  <Line label="Bonus tingkat" value={report.opex.levelBonus} revenue={revenueTotal} indent negative />
                  <Line label="Reward milestone (saat tercapai)" value={report.opex.rewardAccrued} revenue={revenueTotal} indent negative />
                  <Line label="Bagi hasil dibayar" value={report.opex.profitSharing} revenue={revenueTotal} indent negative />
                  <Line label="Biaya gateway pembayaran (Midtrans)" value={report.opex.gatewayFee} revenue={revenueTotal} indent negative />
                  <Line label="Server" value={report.opex.serverCost} revenue={revenueTotal} indent negative />
                  <Line label="Total beban usaha" value={report.opex.total} revenue={revenueTotal} bold negative />
                  <Line label="Laba usaha" value={report.operatingProfit} revenue={revenueTotal} bold />
                  <Line label="Laba sebelum pajak" value={report.profitBeforeTax} revenue={revenueTotal} bold />
                  <Line
                    label={report.incomeTax.mode === "FINAL_OMZET"
                      ? `Beban pajak penghasilan (PPh final ${report.incomeTax.ratePercent}% dari pendapatan)`
                      : report.incomeTax.mode === "CORPORATE"
                        ? `Beban pajak penghasilan (PPh badan ${report.incomeTax.ratePercent}% dari laba sebelum pajak)`
                        : "Beban pajak penghasilan (belum dihitung)"}
                    value={report.incomeTax.amount}
                    revenue={revenueTotal}
                    indent
                    negative
                  />
                  <Line label="Laba bersih" value={report.netProfit} revenue={revenueTotal} bold />
                </tbody>
              </table>
            </div>

            <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Rincian biaya operasional</h2>
              <div className="mt-3 grid gap-6 md:grid-cols-2">
                <div>
                  <p className="text-sm font-bold">Gateway pembayaran (tarif publik Midtrans)</p>
                  {report.operating.gateway.byMethod.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">Belum ada pembayaran Midtrans yang berhasil pada periode ini.</p>
                  ) : (
                    <table className="mt-2 w-full text-left text-sm">
                      <thead className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="py-1.5">Metode</th>
                          <th className="py-1.5 text-right">Transaksi</th>
                          <th className="py-1.5 text-right">Nilai</th>
                          <th className="py-1.5 text-right">Biaya</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.operating.gateway.byMethod.map((row) => (
                          <tr key={row.type}>
                            <td className="py-1.5">{METHOD_LABEL[row.type] ?? row.type}</td>
                            <td className="py-1.5 text-right tabular-nums">{row.count}</td>
                            <td className="py-1.5 text-right tabular-nums">{formatRupiah(row.gross)}</td>
                            <td className="py-1.5 text-right tabular-nums">{formatRupiah(row.fee)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {report.operating.gateway.unknownCount > 0 ? (
                    <p className="mt-2 text-xs text-amber-700">
                      {report.operating.gateway.unknownCount} pembayaran tanpa jenis pembayaran tercatat belum dihitung biayanya.
                    </p>
                  ) : null}
                </div>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="font-bold">PPOB</dt>
                    <dd className="mt-1 text-slate-600">
                      {report.operating.ppob.successCount} transaksi sukses
                      {report.operating.ppob.withoutCostCount > 0
                        ? `, ${report.operating.ppob.withoutCostCount} di antaranya tanpa harga modal tercatat (belum dihitung).`
                        : ", seluruhnya dengan harga modal dari Digiflazz."}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold">Server</dt>
                    <dd className="mt-1 text-slate-600">
                      {formatRupiah(report.operating.server.monthly)} per bulan, dibagi per hari selama {report.operating.server.days} hari pada periode ini.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold">Pajak</dt>
                    <dd className="mt-1 text-slate-600">
                      {report.incomeTax.mode === "FINAL_OMZET"
                        ? `PPh final ${report.incomeTax.ratePercent}% dari pendapatan bruto tanpa PPN.`
                        : report.incomeTax.mode === "CORPORATE"
                          ? `PPh badan ${report.incomeTax.ratePercent}% dari laba sebelum pajak (nol bila rugi).`
                          : "Pajak penghasilan belum dihitung."}
                      {report.assumptions.ppnInclusive
                        ? ` Harga jual sudah termasuk PPN ${report.assumptions.ppnRatePercent}%; PPN dikeluarkan dari pendapatan.`
                        : " PPN tidak diperhitungkan."}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            {report.hpp.tiers.some((tier) => tier.items && tier.items.length > 0) ? (
              <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Rincian HPP paket</h2>
                <div className="mt-3 space-y-5">
                  {report.hpp.tiers
                    .filter((tier) => tier.items && tier.items.length > 0)
                    .map((tier) => (
                      <div key={tier.tier}>
                        <p className="text-sm font-bold">
                          {tier.name} · {tier.units} paket terjual × {formatRupiah(tier.unitCost)} = {formatRupiah(tier.total)}
                          {Number(tier.ppobBenefit) > 0 ? ` (HPP penuh ${formatRupiah(tier.fullUnitCost)} dikurangi saldo PPOB ${formatRupiah(tier.ppobBenefit)} yang ditangguhkan)` : ""}
                        </p>
                        <table className="mt-2 w-full text-left text-sm">
                          <thead className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            <tr>
                              <th className="py-1.5">Komponen per paket</th>
                              <th className="py-1.5 text-right">Jumlah</th>
                              <th className="py-1.5 text-right">HPP</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {(tier.items ?? []).map((item) => (
                              <tr key={item.name}>
                                <td className="py-1.5">{item.name}</td>
                                <td className="py-1.5 text-right tabular-nums text-slate-600">
                                  {item.quantity.toLocaleString("id-ID")} {item.unit}
                                </td>
                                <td className="py-1.5 text-right tabular-nums">{formatRupiah(item.cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                </div>
              </section>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <section className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Kewajiban dan catatan (bukan pendapatan/beban)</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">Saldo TapGoPay member (total)</dt>
                    <dd className="font-bold tabular-nums">{formatRupiah(report.memo.walletLiabilityWallet)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">Di antaranya dapat ditarik</dt>
                    <dd className="font-bold tabular-nums">{formatRupiah(report.memo.walletLiabilityCash)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">Saldo PPOB beredar</dt>
                    <dd className="font-bold tabular-nums">{formatRupiah(report.memo.walletLiabilityPpob)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">Penarikan menunggu/disetujui</dt>
                    <dd className="font-bold tabular-nums">{formatRupiah(report.memo.withdrawalsOutstanding)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">PPN keluaran atas penjualan (kewajiban ke negara)</dt>
                    <dd className="font-bold tabular-nums">{formatRupiah(report.memo.ppnOutput)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">Penjualan kotor PPOB (info)</dt>
                    <dd className="font-bold tabular-nums">{formatRupiah(report.memo.ppobGrossSales)}</dd>
                  </div>
                </dl>
              </section>
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-amber-800">Catatan perhitungan</h2>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-900">
                  {report.notes.map((note) => (
                    <li key={note} className="flex gap-2">
                      <span aria-hidden="true">•</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
