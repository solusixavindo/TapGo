"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  SystemHealthReport,
  formatBytes,
  formatDuration,
  formatMoment,
  readRole,
  readToken,
  systemHealthReport
} from "../../lib/api";
import ConsoleHeader from "../console-header";

const REFRESH_INTERVAL_MS = 10_000;

function tone(ok: boolean) {
  return ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800";
}

function UsageBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const barColor = clamped >= 90 ? "bg-rose-500" : clamped >= 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full ${barColor}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export default function SystemHealthPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [report, setReport] = useState<SystemHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await systemHealthReport();
      setReport(result);
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
          title="Kesehatan Server"
          subtitle="Diagnostik ringan backend TapGo — diperbarui otomatis tiap 10 detik"
          role={role}
        />

        {updatedAt ? (
          <p className="mb-3 flex items-center gap-2 text-xs text-slate-500" aria-live="off">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            Langsung · diperbarui{" "}
            {new Intl.DateTimeFormat("id-ID", { timeStyle: "medium", timeZone: "Asia/Jakarta" }).format(updatedAt)} WIB
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Memuat…</p>
        ) : report ? (
          <>
            <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Database</p>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${tone(report.database.connected)}`}>
                    {report.database.connected ? "Terhubung" : "Terputus"}
                  </span>
                </div>
                <p className="mt-2 text-lg font-black text-brand-navy">
                  {report.database.latencyMs !== null ? `${report.database.latencyMs} ms` : "—"}
                </p>
                {report.database.error ? <p className="mt-1 text-xs text-rose-600">{report.database.error}</p> : null}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Redis</p>
                  {report.redis.configured ? (
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${tone(report.redis.connected)}`}>
                      {report.redis.connected ? "Terhubung" : "Terputus"}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                      Tidak dikonfigurasi
                    </span>
                  )}
                </div>
                <p className="mt-2 text-lg font-black text-brand-navy">
                  {report.redis.latencyMs !== null ? `${report.redis.latencyMs} ms` : "—"}
                </p>
                {report.redis.error ? <p className="mt-1 text-xs text-rose-600">{report.redis.error}</p> : null}
              </div>
            </section>

            <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Memori</p>
                <p className="mt-2 text-lg font-black text-brand-navy">
                  {formatBytes(report.memory.usedBytes)} / {formatBytes(report.memory.totalBytes)} ({report.memory.usedPercent}%)
                </p>
                <UsageBar percent={report.memory.usedPercent} />
                <p className="mt-2 text-xs text-slate-500">
                  Proses backend: {formatBytes(report.memory.processRssBytes)} RSS · {formatBytes(report.memory.processHeapUsedBytes)} heap
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Disk</p>
                {report.disk.available ? (
                  <>
                    <p className="mt-2 text-lg font-black text-brand-navy">
                      {formatBytes(report.disk.usedBytes)} / {formatBytes(report.disk.totalBytes)} ({report.disk.usedPercent}%)
                    </p>
                    <UsageBar percent={report.disk.usedPercent} />
                  </>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">Tidak tersedia di lingkungan ini.</p>
                )}
              </div>
            </section>

            <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Uptime proses</p>
                <p className="mt-2 text-lg font-black text-brand-navy">{formatDuration(report.server.processUptimeSeconds)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Uptime server</p>
                <p className="mt-2 text-lg font-black text-brand-navy">{formatDuration(report.server.systemUptimeSeconds)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Beban rata-rata (1 mnt)</p>
                <p className="mt-2 text-lg font-black text-brand-navy">{report.server.loadAverage[0].toFixed(2)}</p>
                <p className="text-xs text-slate-500">dari {report.server.cpuCount} CPU</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Node.js</p>
                <p className="mt-2 text-lg font-black text-brand-navy">{report.server.nodeVersion}</p>
                <p className="truncate text-xs text-slate-500">{report.server.platform}</p>
              </div>
            </section>

            <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-500">
              Diagnostik ringan satu proses backend — bukan pengganti stack monitoring penuh (Prometheus/Grafana).
              Terakhir dicek server: {formatMoment(report.checkedAt)}.
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
