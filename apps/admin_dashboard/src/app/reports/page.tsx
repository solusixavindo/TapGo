"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FinancialSummary,
  PpobSummary,
  downloadReportCsv,
  financialSummaryReport,
  formatRupiah,
  ppobSummaryReportApi,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import { PeriodState, defaultPeriod, periodLabel, periodQuery } from "../../lib/period";
import ConsoleHeader from "../console-header";
import { useHardRouter as useRouter } from "../hard-nav";
import PeriodFilter from "../period-filter";

const CSV_REPORTS: Array<{
  kind: "bonus" | "ppob" | "ppob-transactions" | "reward";
  label: string;
  description: string;
}> = [
  { kind: "bonus", label: "Laporan Bonus/Komisi", description: "Seluruh baris bonus referral, tingkat, reward, dan bagi hasil." },
  {
    kind: "ppob-transactions",
    label: "Laporan Transaksi PPOB",
    description: "Transaksi beli pulsa/token/dll per member, lengkap dengan modal Digiflazz dan selisihnya."
  },
  {
    kind: "ppob",
    label: "Laporan Benefit PPOB Membership",
    description: "Kredit PPOB GRATIS dari paket membership (Silver/Gold/Platinum) — bukan transaksi beli."
  },
  { kind: "reward", label: "Laporan Reward", description: "Riwayat reward — pending, disetujui, dibayar, ditolak." }
];

export default function ReportsPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod("month"));
  const [financial, setFinancial] = useState<FinancialSummary | null>(null);
  const [ppob, setPpob] = useState<PpobSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");

  const range = useMemo(() => periodQuery(period), [period]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [financialResult, ppobResult] = await Promise.all([financialSummaryReport(range), ppobSummaryReportApi(range)]);
      setFinancial(financialResult);
      setPpob(ppobResult);
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
    if (!roleAtLeast(current, "SUPER_ADMIN")) {
      router.replace("/beranda");
      return;
    }
    setRole(current);
    void refresh();
  }, [router, refresh]);

  async function onDownload(kind: "bonus" | "ppob" | "ppob-transactions" | "reward") {
    if (downloading) return;
    setDownloading(kind);
    setError("");
    try {
      await downloadReportCsv(kind, range);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Laporan belum dapat diunduh.");
    } finally {
      setDownloading("");
    }
  }

  const sales = ppob?.sales;
  const funding = ppob?.funding;
  const cashFromTopUps = funding ? Number(funding.topUpOnline) + Number(funding.topUpManual) : 0;
  const freeBalance = ppob ? Number(ppob.packagePpobBenefitTotal) + Number(ppob.basicRegistrationPpobTotal) : 0;

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader
          title="Laporan Keuangan"
          subtitle={`Ringkasan membership dan PPOB untuk periode: ${periodLabel(period.mode, period.anchor)}`}
          role={role}
        />

        <div className="mb-5">
          <PeriodFilter value={period} onChange={setPeriod} allowAll disabled={loading} />
        </div>

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {loading && !financial ? (
          <p className="text-sm text-slate-500">Memuat…</p>
        ) : (
          <>
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Upgrade membership dan bonus (periode ini)</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <MoneyCard label="Pendapatan upgrade (lunas)" value={financial?.totalMembershipRevenuePaid} />
                <MoneyCard label="Bonus referral" value={financial?.totalSponsorBonus} />
                <MoneyCard label="Bonus tingkat" value={financial?.totalLevelBonus} />
                <MoneyCard label="Bagi hasil terbayar" value={financial?.totalProfitSharing} />
              </div>
              <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">Jumlah member aktif saat ini (tidak mengikuti periode)</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Card label="Basic" value={String(financial?.totalActiveBasic ?? 0)} />
                <Card label="Silver" value={String(financial?.totalActiveSilver ?? 0)} />
                <Card label="Gold" value={String(financial?.totalActiveGold ?? 0)} />
                <Card label="Platinum" value={String(financial?.totalActivePlatinum ?? 0)} />
              </div>
            </section>

            <section className="mt-6">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Saldo member saat ini (tidak mengikuti periode)</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <MoneyCard label="Saldo TapGoPay beredar" value={financial?.totalWalletLiability} />
                <MoneyCard label="Di antaranya dapat ditarik" value={financial?.totalCashWalletLiability} />
                <MoneyCard label="Saldo PPOB beredar" value={financial?.totalPpobLiability} />
                <MoneyCard label="Penarikan menunggu (periode ini)" value={financial?.totalWithdrawalPending} />
              </div>
            </section>

            <section className="mt-6" data-testid="ppob-flow">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Penjualan PPOB (Digiflazz), periode ini</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <MoneyCard label={`Penjualan berhasil${sales ? ` (${sales.successCount} transaksi)` : ""}`} value={sales?.salesTotal} />
                <MoneyCard label="Modal dibayar ke Digiflazz" value={sales?.providerCost} />
                <MoneyCard label="Selisih (pendapatan perusahaan)" value={sales?.margin} />
                <MoneyCard label={`Masih diproses${sales ? ` (${sales.openCount})` : ""}`} value={sales?.openAmount} />
              </div>
              {sales && sales.withoutCostCount > 0 ? (
                <p className="mt-2 text-xs text-amber-700">
                  {sales.withoutCostCount} transaksi sukses belum punya modal tercatat, jadi selisih di atas belum utuh.
                </p>
              ) : null}

              <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">Dari mana uang untuk penjualan itu</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <MoneyCard label={`Top up saldo PPOB online (${funding?.topUpOnlineCount ?? 0})`} value={funding?.topUpOnline} />
                <MoneyCard label={`Top up saldo PPOB manual (${funding?.topUpManualCount ?? 0})`} value={funding?.topUpManual} />
                <MoneyCard label="Benefit paket membership" value={ppob?.packagePpobBenefitTotal} />
                <MoneyCard label="Bonus registrasi Basic" value={ppob?.basicRegistrationPpobTotal} />
              </div>

              {sales ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-700" data-testid="ppob-flow-note">
                  <p className="font-bold text-slate-900">Mengapa transaksi Digiflazz belum tentu menambah uang masuk</p>
                  <p className="mt-1">
                    Pembelian PPOB memakai <strong>saldo PPOB yang sudah dimiliki pelanggan</strong>. Saat transaksi, tidak ada uang baru
                    masuk ke perusahaan; yang terjadi adalah saldo pelanggan berkurang {formatRupiah(sales.salesTotal)} dan deposit
                    Digiflazz berkurang {formatRupiah(sales.providerCost)} untuk transaksi yang modalnya tercatat.
                  </p>
                  <p className="mt-2">
                    Uang tunai baru hanya masuk saat pelanggan membayar membership atau top up saldo PPOB. Pada periode ini top up PPOB
                    yang lunas berjumlah <strong>{formatRupiah(cashFromTopUps)}</strong>, sedangkan saldo PPOB gratis yang dibagikan
                    (benefit paket dan bonus registrasi) berjumlah <strong>{formatRupiah(freeBalance)}</strong>. Saldo gratis yang dipakai
                    membeli pulsa membuat perusahaan membayar Digiflazz tanpa menerima uang baru; biayanya sudah ada di harga
                    paket atau di anggaran bonus.
                  </p>
                  <p className="mt-2">
                    Selisih penjualan dan modal ({formatRupiah(sales.margin)}) adalah pendapatan perusahaan. Besarnya hanya sebesar
                    selisih itu, dan tersimpan di dalam uang yang sudah diterima sebelumnya.
                  </p>
                </div>
              ) : null}
            </section>

            <section className="mt-6">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Unduh laporan (CSV) untuk periode yang dipilih</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                {CSV_REPORTS.map((report) => (
                  <div key={report.kind} className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold">{report.label}</p>
                    <p className="mt-1 text-xs text-slate-500">{report.description}</p>
                    <button
                      type="button"
                      disabled={downloading === report.kind}
                      onClick={() => onDownload(report.kind)}
                      className="mt-3 rounded-lg bg-brand-ink px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {downloading === report.kind ? "Mengunduh…" : "Unduh CSV"}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-500">
              Pengaturan komisi (<code>commission-settings</code>) dan pengaturan aplikasi (<code>app-settings</code>)
              belum diaktifkan — backend sengaja menahannya sampai ada persetujuan produk, bukan bug. Halaman ini
              tidak menampilkannya sampai keputusan itu diambil.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-black text-brand-navy">{value}</p>
    </div>
  );
}

function MoneyCard({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-black text-brand-navy">
        {value !== undefined ? formatRupiah(value) : "—"}
      </p>
    </div>
  );
}
