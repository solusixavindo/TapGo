"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  FinancialSummary,
  PpobSummary,
  downloadReportCsv,
  financialSummaryReport,
  formatRupiah,
  ppobSummaryReportApi,
  readRole,
  readToken
} from "../../lib/api";
import ConsoleHeader from "../console-header";

const CSV_REPORTS: Array<{ kind: "bonus" | "ppob" | "reward"; label: string; description: string }> = [
  { kind: "bonus", label: "Laporan Bonus/Komisi", description: "Seluruh baris bonus referral, tingkat, reward, dan bagi hasil." },
  { kind: "ppob", label: "Laporan PPOB", description: "Transaksi wallet bertipe benefit PPOB per member." },
  { kind: "reward", label: "Laporan Reward", description: "Riwayat reward — pending, disetujui, dibayar, ditolak." }
];

export default function ReportsPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [financial, setFinancial] = useState<FinancialSummary | null>(null);
  const [ppob, setPpob] = useState<PpobSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [financialResult, ppobResult] = await Promise.all([
        financialSummaryReport(),
        ppobSummaryReportApi()
      ]);
      setFinancial(financialResult);
      setPpob(ppobResult);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Laporan belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    setRole(readRole());
    void refresh();
  }, [router, refresh]);

  async function onDownload(kind: "bonus" | "ppob" | "reward") {
    if (downloading) return;
    setDownloading(kind);
    setError("");
    try {
      await downloadReportCsv(kind);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Laporan belum dapat diunduh.");
    } finally {
      setDownloading("");
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader
          title="Laporan Keuangan"
          subtitle="Ringkasan upgrade membership dan PPOB, sepanjang waktu"
          role={role}
        />

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Memuat…</p>
        ) : (
          <>
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Upgrade membership
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <MoneyCard label="Pendapatan upgrade (lunas)" value={financial?.totalMembershipRevenuePaid} />
                <Card label="Member Basic aktif" value={String(financial?.totalActiveBasic ?? 0)} />
                <Card label="Member Silver aktif" value={String(financial?.totalActiveSilver ?? 0)} />
                <Card label="Member Gold aktif" value={String(financial?.totalActiveGold ?? 0)} />
                <Card label="Member Platinum aktif" value={String(financial?.totalActivePlatinum ?? 0)} />
                <MoneyCard label="Bonus referral" value={financial?.totalSponsorBonus} />
                <MoneyCard label="Bonus tingkat" value={financial?.totalLevelBonus} />
                <MoneyCard label="Bagi hasil terbayar" value={financial?.totalProfitSharing} />
              </div>
            </section>

            <section className="mt-6">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">PPOB</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <MoneyCard label="Saldo PPOB beredar" value={ppob?.totalPpobLiability} />
                <MoneyCard label="Benefit PPOB Silver" value={ppob?.silverPpobTotal} />
                <MoneyCard label="Benefit PPOB Gold" value={ppob?.goldPpobTotal} />
                <MoneyCard label="Benefit PPOB Platinum" value={ppob?.platinumPpobTotal} />
                <MoneyCard label="PPOB registrasi Basic" value={ppob?.basicRegistrationPpobTotal} />
                <MoneyCard label="Total benefit PPOB paket" value={ppob?.packagePpobBenefitTotal} />
              </div>
            </section>

            <section className="mt-6">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Unduh laporan (CSV)</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
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
