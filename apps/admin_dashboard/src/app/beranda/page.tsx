"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import Link from "next/link";
import {
  AdminActivityEntry,
  DashboardGrowth,
  DashboardSummary,
  FinancialSummary,
  RetentionWarningDocument,
  dashboardGrowth,
  dashboardSummary,
  documentsNearingRetention,
  financialSummaryReport,
  formatMoment,
  formatRupiah,
  readRole,
  readToken,
  recentAdminActivity,
  roleAtLeast
} from "../../lib/api";
import ConsoleHeader from "../console-header";

const ACTIVITY_LABEL: Record<string, string> = {
  ADMIN_ROLE_ASSIGNED: "Mengubah role admin",
  ADMIN_ROLE_ASSIGN_DENIED: "Percobaan ubah role ditolak",
  SUPER_ADMIN_VIP_GRANTED: "Diangkat menjadi Super Admin VIP",
  SUPER_ADMIN_VIP_REVOKED: "Diturunkan dari Super Admin VIP",
  "admin.scope.bootstrap_completed": "Bootstrap pengelola scope",
  "admin.scope.break_glass_completed": "Pemulihan darurat pengelola scope",
  "admin.scope.granted": "Memberi izin scope",
  "admin.scope.self_granted": "Memberi izin scope untuk diri sendiri",
  "admin.scope.revoked": "Mencabut izin scope",
  "admin.scope.grant_denied": "Percobaan beri izin ditolak",
  "admin.scope.revoke_denied": "Percobaan cabut izin ditolak",
  "admin.scope.last_manager_protected": "Percobaan mencabut pengelola terakhir ditolak"
};

/**
 * Beranda konsol admin.
 *
 * Auto-refresh polling 10 detik (berhenti saat tab tersembunyi, langsung
 * menyegarkan saat tab kembali dilihat), bukan push/websocket — tidak ada plumbing
 * socket admin di backend (socket.io yang ada khusus alur ride/chat driver).
 * Ini keputusan pragmatis: cukup untuk kebutuhan "live" pemantauan, tanpa
 * membangun infrastruktur realtime baru.
 */
const REFRESH_INTERVAL_MS = 10_000;

function formatDateShort(iso: string) {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short" }).format(parsed);
}

export default function BerandaPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [growth, setGrowth] = useState<DashboardGrowth | null>(null);
  const [financial, setFinancial] = useState<FinancialSummary | null>(null);
  const [retentionWarnings, setRetentionWarnings] = useState<RetentionWarningDocument[]>([]);
  const [activity, setActivity] = useState<AdminActivityEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const isVip = readRole() === "SUPER_ADMIN_VIP";
      // Ringkasan keuangan hanya untuk SUPER_ADMIN ke atas; ADMIN (operator)
      // tidak memanggilnya sama sekali supaya tidak melihat galat izin.
      const canFinance = roleAtLeast(readRole(), "SUPER_ADMIN");
      const [summaryResult, growthResult, financialResult, retentionResult, activityResult] =
        await Promise.all([
          dashboardSummary(),
          dashboardGrowth(),
          canFinance ? financialSummaryReport() : Promise.resolve(null),
          documentsNearingRetention(),
          // Endpoint ini 403 untuk selain VIP — jangan dipanggil sama sekali,
          // supaya bukan-VIP tidak melihat pesan galat untuk sesuatu yang
          // memang bukan haknya.
          isVip ? recentAdminActivity() : Promise.resolve(null)
        ]);
      setSummary(summaryResult);
      setGrowth(growthResult);
      setFinancial(financialResult);
      setRetentionWarnings(retentionResult);
      setActivity(activityResult);
      setUpdatedAt(new Date());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data belum dapat dimuat.");
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
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(tick, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, refresh]);

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader
          title="Beranda"
          subtitle={roleAtLeast(role, "SUPER_ADMIN") ? "Ringkasan pendaftaran, aktivitas, dan keuangan TapGo — diperbarui otomatis tiap 10 detik" : "Ringkasan pendaftaran dan antrean kerja TapGo — diperbarui otomatis tiap 10 detik"}
          role={role}
        />

        {updatedAt ? (
          <p className="mb-3 flex items-center gap-2 text-xs text-slate-500" aria-live="off">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            Langsung · diperbarui {new Intl.DateTimeFormat("id-ID", { timeStyle: "medium", timeZone: "Asia/Jakarta" }).format(updatedAt)} WIB
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Memuat…</p>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard href="/members" label="Total member" value={String(summary?.totalMembers ?? 0)} />
              <KpiCard
                href="/members?aktif=7"
                label="User aktif (7 hari)"
                value={String(growth?.activeUsers7d ?? 0)}
                hint={`${growth?.activeUsers30d ?? 0} dalam 30 hari`}
              />
              <KpiCard
                href="/members?daftar=1"
                label="Pendaftaran hari ini"
                value={String(
                  growth?.registrationTrend[growth.registrationTrend.length - 1]?.count ?? 0
                )}
              />
              <KpiCard
                href="/members?daftar=7"
                label="Pendaftaran 7 hari terakhir"
                value={String(
                  growth?.registrationTrend.slice(-7).reduce((sum, row) => sum + row.count, 0) ?? 0
                )}
              />
            </section>

            {growth && growth.pendingApprovals.total > 0 ? (
              <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <h2 className="text-sm font-bold text-amber-900">
                  Menunggu persetujuan ({growth.pendingApprovals.total})
                </h2>
                <div className="mt-3 flex flex-wrap gap-4 text-sm text-amber-800">
                  <Link href="/member-requests" className="font-semibold underline underline-offset-4">
                    {growth.pendingApprovals.memberRequests} pengajuan member
                  </Link>
                  {roleAtLeast(role, "SUPER_ADMIN") ? (
                    <>
                      <Link href="/reports" className="font-semibold underline underline-offset-4">
                        {growth.pendingApprovals.rewards} reward
                      </Link>
                      <Link href="/penarikan?status=PENDING" className="font-semibold underline underline-offset-4">
                        {growth.pendingApprovals.withdrawals} penarikan saldo
                      </Link>
                    </>
                  ) : (
                    <>
                      <span>{growth.pendingApprovals.rewards} reward</span>
                      <span>{growth.pendingApprovals.withdrawals} penarikan saldo</span>
                    </>
                  )}
                </div>
              </section>
            ) : null}

            {retentionWarnings.length > 0 ? (
              <section className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5">
                <h2 className="text-sm font-bold text-rose-900">
                  Dokumen KYC mendekati batas retensi ({retentionWarnings.length})
                </h2>
                <p className="mt-1 text-xs text-rose-700">
                  Berkas akan otomatis tidak tersaji lagi setelah lewat batas — cetak dari halaman
                  Persetujuan Member sebelum itu terjadi.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {retentionWarnings.slice(0, 8).map((doc) => (
                    <li key={`${doc.orderId}-${doc.documentType}`} className="text-sm text-rose-800">
                      <span className="font-semibold">{doc.memberName}</span> ({doc.referralCode}) —{" "}
                      {doc.documentType} habis {formatMoment(doc.expiresAt)}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-bold text-slate-700">Tren pendaftaran 30 hari</h2>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={growth?.registrationTrend ?? []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDateShort}
                      tick={{ fontSize: 11, fill: "#64748B" }}
                      interval={4}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748B" }} />
                    <Tooltip
                      labelFormatter={(value) => formatDateShort(String(value))}
                      formatter={(value) => [String(value ?? 0), "Pendaftaran"]}
                    />
                    <Line type="monotone" dataKey="count" stroke="#0877E8" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            {roleAtLeast(role, "SUPER_ADMIN") ? (
            <section className="mt-6">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Ringkasan keuangan
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                <MoneyCard
                  href="/reports"
                  label="Pendapatan upgrade membership"
                  value={financial?.totalMembershipRevenuePaid}
                />
                <MoneyCard href="/reports" label="Total komisi (bonus)" value={summary?.totalCommission} />
                <MoneyCard href="/reports" label="Saldo TapGoPay beredar" value={financial?.totalWalletLiability} />
                <MoneyCard href="/reports" label="Saldo dapat ditarik" value={financial?.totalCashWalletLiability} />
                <MoneyCard href="/reports" label="Saldo PPOB beredar" value={financial?.totalPpobLiability} />
                <MoneyCard href="/penarikan?status=PENDING" label="Withdraw menunggu" value={financial?.totalWithdrawalPending} />
                <MoneyCard href="/penarikan?status=PAID" label="Withdraw disetujui/lunas" value={financial?.totalWithdrawalPaidApproved} />
                <MoneyCard href="/reports" label="Reward menunggu" value={financial?.totalRewardPending} />
                <MoneyCard href="/reports" label="Bagi hasil terbayar" value={financial?.totalProfitSharing} />
              </div>
            </section>
            ) : null}

            {activity ? (
              <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-bold text-slate-700">Aktivitas admin terbaru</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Khusus Super Admin VIP — perubahan role dan izin scope admin.
                </p>
                {activity.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">Belum ada aktivitas tercatat.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {activity.map((entry) => (
                      <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>
                          <span className="font-semibold">{entry.actorName}</span>{" "}
                          {ACTIVITY_LABEL[entry.action] ?? entry.action}
                        </span>
                        <span className="text-xs text-slate-400">{formatMoment(entry.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

const CARD_LINK =
  "group block rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand-green hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green";

function KpiCard({ href, label, value, hint }: { href: string; label: string; value: string; hint?: string }) {
  return (
    <Link href={href} className={CARD_LINK}>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-brand-navy">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      <p className="mt-2 text-[11px] font-semibold text-brand-green opacity-0 transition group-hover:opacity-100">Lihat rincian →</p>
    </Link>
  );
}

function MoneyCard({ href, label, value }: { href: string; label: string; value?: string }) {
  return (
    <Link href={href} className={CARD_LINK}>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-black text-brand-navy">
        {value !== undefined ? formatRupiah(value) : "—"}
      </p>
      <p className="mt-2 text-[11px] font-semibold text-brand-green opacity-0 transition group-hover:opacity-100">Lihat rincian →</p>
    </Link>
  );
}
