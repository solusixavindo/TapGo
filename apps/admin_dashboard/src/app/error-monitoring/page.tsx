"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ErrorMonitoringReport,
  SENTRY_PROJECT_LABEL,
  SentryProjectKey,
  errorMonitoringReport,
  formatMoment,
  readRole,
  readToken
} from "../../lib/api";
import ConsoleHeader from "../console-header";

const REFRESH_INTERVAL_MS = 30_000;

const PROJECT_TABS: SentryProjectKey[] = ["backend", "driver_app", "user_app"];

const LEVEL_TONE: Record<string, string> = {
  fatal: "bg-rose-100 text-rose-800",
  error: "bg-rose-100 text-rose-800",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-blue-100 text-blue-800",
  debug: "bg-slate-100 text-slate-600"
};

export default function ErrorMonitoringPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [project, setProject] = useState<SentryProjectKey>("backend");
  const [statsPeriod, setStatsPeriod] = useState<"24h" | "14d">("24h");
  const [report, setReport] = useState<ErrorMonitoringReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await errorMonitoringReport(project, statsPeriod);
      setReport(result);
      setUpdatedAt(new Date());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [project, statsPeriod]);

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    setRole(readRole());
    setLoading(true);
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

  const configuredProjects = report?.configuredProjects ?? [];

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader
          title="Error & Bugs"
          subtitle="Issue Sentry terbaru dari backend, driver_app, dan user_app — diperbarui otomatis tiap 30 detik"
          role={role}
        />

        <div className="mb-4 flex gap-1 border-b border-slate-200">
          {PROJECT_TABS.map((key) => {
            const active = project === key;
            const isConfigured = configuredProjects.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setProject(key)}
                className={[
                  "relative -mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-semibold transition",
                  active
                    ? "border-brand-navy text-brand-navy"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                ].join(" ")}
              >
                {SENTRY_PROJECT_LABEL[key]}
                {!isConfigured ? (
                  <span
                    aria-label="Belum dikonfigurasi"
                    title="Belum dikonfigurasi"
                    className="h-1.5 w-1.5 rounded-full bg-slate-300"
                  />
                ) : null}
              </button>
            );
          })}
        </div>

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
        ) : !report?.configured ? (
          <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm">
            <p className="font-bold">Sentry untuk {SENTRY_PROJECT_LABEL[project]} belum dikonfigurasi</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Isi <code className="rounded bg-slate-100 px-1.5 py-0.5">SENTRY_AUTH_TOKEN</code>,{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5">SENTRY_ORG_SLUG</code>, dan{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5">
                SENTRY_PROJECT_SLUG_{project.toUpperCase()}
              </code>{" "}
              di environment backend untuk mengaktifkan tab ini.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Issue belum terselesaikan ({report.issues.length})
              </h2>
              <select
                value={statsPeriod}
                onChange={(event) => setStatsPeriod(event.target.value as "24h" | "14d")}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-green"
              >
                <option value="24h">24 jam terakhir</option>
                <option value="14d">14 hari terakhir</option>
              </select>
            </div>

            {report.issues.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm">
                <p className="font-bold">Tidak ada issue pada rentang ini</p>
                <p className="mt-1 text-sm text-slate-500">
                  {SENTRY_PROJECT_LABEL[project]} bersih dari error yang belum terselesaikan.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Issue</th>
                      <th className="px-4 py-3">Level</th>
                      <th className="px-4 py-3 text-right">Kejadian</th>
                      <th className="px-4 py-3 text-right">Pengguna terdampak</th>
                      <th className="px-4 py-3">Terakhir muncul</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.issues.map((issue) => (
                      <tr key={issue.id} className="align-top">
                        <td className="px-4 py-3">
                          <a
                            href={issue.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-brand-blue hover:underline"
                          >
                            {issue.title}
                          </a>
                          <p className="mt-1 font-mono text-xs text-slate-500">{issue.shortId}</p>
                          {issue.culprit ? <p className="text-xs text-slate-500">{issue.culprit}</p> : null}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${LEVEL_TONE[issue.level] ?? "bg-slate-100 text-slate-600"}`}>
                            {issue.level}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-black tabular-nums">{issue.count}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{issue.userCount}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{formatMoment(issue.lastSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-500">
              Data ditarik langsung dari Sentry setiap kali halaman ini dibuka — untuk investigasi mendalam (stack
              trace, breadcrumb, replay), buka issue di Sentry lewat tautan judul.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
