"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ProfitLossReport,
  formatRupiah,
  profitLossReport,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import ConsoleHeader from "../console-header";

/**
 * Laba rugi manajemen — hanya Super Admin VIP.
 *
 * Angka dihitung dari data operasional sistem, bukan laporan keuangan
 * teraudit. Halaman ini sengaja menampilkan apa yang BELUM dihitung (biaya
 * gateway, harga modal PPOB, gaji, server, pajak) langsung di bawah angka
 * laba, supaya laba tidak terbaca lebih besar dari kenyataannya.
 */

type PresetId = "this-month" | "last-month" | "last-30" | "this-year";

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: "this-month", label: "Bulan ini" },
  { id: "last-month", label: "Bulan lalu" },
  { id: "last-30", label: "30 hari terakhir" },
  { id: "this-year", label: "Tahun ini" }
];

function rangeFor(preset: PresetId): { from: Date; to: Date } {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  switch (preset) {
    case "this-month":
      return { from: startOfMonth, to: now };
    case "last-month":
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      };
    case "last-30":
      return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now };
    case "this-year":
      return { from: new Date(now.getFullYear(), 0, 1), to: now };
  }
}

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

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
  const [preset, setPreset] = useState<PresetId>("this-month");
  const [report, setReport] = useState<ProfitLossReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const range = useMemo(() => rangeFor(preset), [preset]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await profitLossReport({ dateFrom: range.from.toISOString(), dateTo: range.to.toISOString() }));
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
          subtitle={`Periode ${formatDay(range.from)} – ${formatDay(range.to)}. Laporan manajemen dari data operasional sistem.`}
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

        <div className="mb-5 flex flex-wrap gap-1.5 print:hidden" role="tablist" aria-label="Periode">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={preset === item.id}
              onClick={() => setPreset(item.id)}
              className={[
                "rounded-lg px-3.5 py-1.5 text-sm font-bold transition",
                preset === item.id ? "bg-brand-navy text-white" : "bg-white text-slate-600 hover:bg-slate-200"
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
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
              <Kpi label="Pendapatan" value={formatRupiah(report.revenue.total)} note={delta(report.revenue.total, report.previous?.totalRevenue)} />
              <Kpi label="Beban (insentif + HPP)" value={formatRupiah(report.expenses.total)} note={delta(report.expenses.total, report.previous?.totalExpenses)} />
              <Kpi
                label={`Laba operasional${report.operatingMarginPercent ? ` · margin ${report.operatingMarginPercent}%` : ""}`}
                value={formatRupiah(report.operatingProfit)}
                note={delta(report.operatingProfit, report.previous?.operatingProfit)}
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
                      Pendapatan
                    </td>
                  </tr>
                  <Line label="Penjualan membership" value={report.revenue.membershipSales} revenue={revenueTotal} indent />
                  <Line label="Pengembalian dana membership" value={report.revenue.membershipRefunds} revenue={revenueTotal} indent negative />
                  <Line label="Komisi platform ojek (TapGoPay)" value={report.revenue.rideCommission} revenue={revenueTotal} indent />
                  <Line label="Penjualan PPOB" value={report.revenue.ppobSales} revenue={revenueTotal} indent />
                  <Line label="Total pendapatan" value={report.revenue.total} revenue={revenueTotal} bold />
                  <tr>
                    <td colSpan={3} className="bg-slate-50 px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Beban
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Biaya langsung
                    </td>
                  </tr>
                  <Line label="Bonus referral" value={report.expenses.sponsorBonus} revenue={revenueTotal} indent negative />
                  <Line label="Bonus tingkat" value={report.expenses.levelBonus} revenue={revenueTotal} indent negative />
                  <Line label="Reward dibayar" value={report.expenses.rewardPaid} revenue={revenueTotal} indent negative />
                  <Line label="Bagi hasil dibayar" value={report.expenses.profitSharing} revenue={revenueTotal} indent negative />
                  <Line label="HPP paket membership (perlengkapan, BPJS, saldo PPOB)" value={report.expenses.hppPackages} revenue={revenueTotal} indent negative />
                  <Line label="Harga modal PPOB (Digiflazz)" value={report.expenses.ppobCost} revenue={revenueTotal} indent negative />
                  <tr>
                    <td colSpan={3} className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Biaya operasional
                    </td>
                  </tr>
                  <Line label="Biaya gateway pembayaran (Midtrans)" value={report.expenses.gatewayFee} revenue={revenueTotal} indent negative />
                  <Line label="Server" value={report.expenses.serverCost} revenue={revenueTotal} indent negative />
                  <Line label={`Pajak (${report.operating.taxRatePercent}% dari pendapatan)`} value={report.expenses.tax} revenue={revenueTotal} indent negative />
                  <Line label="Total beban" value={report.expenses.total} revenue={revenueTotal} bold negative />
                  <Line label="Laba operasional" value={report.operatingProfit} revenue={revenueTotal} bold />
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
                    <dd className="mt-1 text-slate-600">{report.operating.taxRatePercent}% dari total pendapatan.</dd>
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
                    <dt className="text-slate-600">Penjualan kotor PPOB (info)</dt>
                    <dd className="font-bold tabular-nums">{formatRupiah(report.memo.ppobGrossSales)}</dd>
                  </div>
                </dl>
              </section>
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-amber-800">Yang belum dihitung</h2>
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
