"use client";

import { useHardRouter as useRouter } from "../hard-nav";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuditLogEntry,
  OversightReport,
  fetchAuditLogs,
  fetchOversight,
  formatMoment,
  formatRupiah,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import { MONEY_AUDIT_ACTIONS, auditLabel } from "../../lib/audit-labels";
import ClickCard from "../click-card";
import ConsoleHeader from "../console-header";

const PAGE_SIZE = 25;
const WINDOWS = [
  { hours: 24, label: "24 jam" },
  { hours: 72, label: "3 hari" },
  { hours: 168, label: "7 hari" }
];

/** Tanggal "YYYY-MM-DD" (hari kalender WIB) menjadi batas ISO. */
const dayStart = (d: string) => `${d}T00:00:00+07:00`;
const dayEnd = (d: string) => `${d}T23:59:59.999+07:00`;

const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", SUPER_ADMIN: "Super Admin", SUPER_ADMIN_VIP: "VIP" };

export default function ActivityLogPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [hours, setHours] = useState(24);
  const [report, setReport] = useState<OversightReport | null>(null);
  const [actorId, setActorId] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<{ total: number; items: AuditLogEntry[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const logRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    const current = readRole();
    setRole(current);
    if (!roleAtLeast(current, "SUPER_ADMIN_VIP")) router.replace("/beranda");
  }, [router]);

  const loadReport = useCallback(async () => {
    try {
      setReport(await fetchOversight(hours));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ringkasan pengawasan belum dapat dimuat.");
    }
  }, [hours]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      setLogs(
        await fetchAuditLogs({
          page,
          pageSize: PAGE_SIZE,
          ...(action ? { action } : {}),
          ...(actorId ? { actorId } : {}),
          ...(from ? { dateFrom: dayStart(from) } : {}),
          ...(to ? { dateTo: dayEnd(to) } : {})
        })
      );
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Log belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [page, action, actorId, from, to]);

  const isVip = roleAtLeast(role, "SUPER_ADMIN_VIP");
  useEffect(() => {
    if (isVip) void loadReport();
  }, [isVip, loadReport]);
  useEffect(() => {
    if (isVip) void loadLogs();
  }, [isVip, loadLogs]);

  const totalPages = logs ? Math.max(1, Math.ceil(logs.total / PAGE_SIZE)) : 1;
  const filterBy = (id: string) => {
    setActorId(id);
    setPage(1);
    logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!isVip) return null;

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-950 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader
          title="Log Aktivitas"
          subtitle="Apa saja yang dilakukan admin dan Super Admin, terutama yang menyangkut uang. Peringatan hanya petunjuk untuk ditinjau, bukan tuduhan."
          role={role}
        />

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <section aria-label="Pengawasan">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Pengawasan</h2>
            <div className="flex gap-1" role="group" aria-label="Rentang pengamatan">
              {WINDOWS.map((w) => (
                <button
                  key={w.hours}
                  type="button"
                  onClick={() => setHours(w.hours)}
                  aria-pressed={hours === w.hours}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold ${hours === w.hours ? "bg-brand-ink text-white" : "bg-slate-200 text-slate-700 hover:bg-slate-200"}`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          {report && report.alerts.length > 0 ? (
            <ul className="mt-3 space-y-2" data-testid="oversight-alerts">
              {report.alerts.map((alert, index) => (
                <li
                  key={`${alert.key}-${alert.actorId}-${index}`}
                  className={`rounded-xl border px-4 py-3 text-sm ${alert.severity === "warning" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-100 text-sky-900"}`}
                >
                  <p className="font-semibold">{alert.message}</p>
                  <p className="mt-0.5 text-xs opacity-80">
                    {formatMoment(alert.firstAt)} – {formatMoment(alert.lastAt)}
                    {alert.actorId ? (
                      <>
                        {" · "}
                        <button type="button" onClick={() => filterBy(alert.actorId!)} className="font-semibold underline underline-offset-2">
                          Lihat aksinya
                        </button>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="oversight-clear">
              {report ? "Tidak ada pola yang perlu ditinjau pada rentang ini." : "Memuat…"}
            </p>
          )}

          {report && report.admins.length > 0 ? (
            <div className="reveal-group mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="oversight-admins">
              {report.admins.map((admin) => {
                const top = Object.entries(admin.byAction).sort((a, b) => b[1] - a[1]).slice(0, 3);
                return (
                  <ClickCard
                    key={admin.actorId}
                    onActivate={() => filterBy(admin.actorId)}
                    label={`Lihat aksi ${admin.name}`}
                    className="rounded-2xl border border-slate-200 bg-white p-4 pb-7"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-black">{admin.name}</p>
                      <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">{ROLE_LABEL[admin.role] ?? admin.role}</span>
                    </div>
                    <p className="mt-2 text-2xl font-black tabular-nums">{admin.total} <span className="text-sm font-semibold text-slate-500">aksi</span></p>
                    <p className="text-xs text-slate-500">Uang diproses: {formatRupiah(admin.moneyTotal)}</p>
                    <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                      {top.map(([name, count]) => (
                        <li key={name}>
                          {count}× {auditLabel(name)}
                        </li>
                      ))}
                    </ul>
                  </ClickCard>
                );
              })}
            </div>
          ) : report ? (
            <p className="mt-4 text-sm text-slate-500">Belum ada aksi admin pada rentang ini.</p>
          ) : null}
        </section>

        <section ref={logRef} aria-label="Log lengkap" className="mt-8 scroll-mt-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Log lengkap</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <select
              aria-label="Pelaku"
              value={actorId}
              onChange={(e) => {
                setActorId(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Semua pelaku</option>
              {report?.admins.map((a) => (
                <option key={a.actorId} value={a.actorId}>
                  {a.name} ({ROLE_LABEL[a.role] ?? a.role})
                </option>
              ))}
            </select>
            <select
              aria-label="Jenis aksi"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Semua aksi</option>
              {[...MONEY_AUDIT_ACTIONS].map((a) => (
                <option key={a} value={a}>
                  {auditLabel(a)}
                </option>
              ))}
            </select>
            <input aria-label="Dari tanggal" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            <input aria-label="Sampai tanggal" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            <button
              type="button"
              onClick={() => {
                setActorId("");
                setAction("");
                setFrom("");
                setTo("");
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            >
              Atur ulang
            </button>
          </div>

          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Waktu</th>
                  <th className="px-4 py-3">Pelaku</th>
                  <th className="px-4 py-3">Aksi</th>
                  <th className="px-4 py-3">Sasaran</th>
                  <th className="px-4 py-3">Rincian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs?.items.map((entry) => (
                  <tr key={entry.id} data-testid="log-row">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatMoment(entry.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold">{entry.actorName}</span>
                      {entry.actorRole ? <span className="ml-1.5 text-[11px] text-slate-500">{ROLE_LABEL[entry.actorRole] ?? entry.actorRole}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      {MONEY_AUDIT_ACTIONS.has(entry.action) ? (
                        <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">UANG</span>
                      ) : null}
                      {auditLabel(entry.action)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {entry.entityType}
                      {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ""}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <Details value={entry.metadata} ip={entry.ipAddress ?? null} />
                    </td>
                  </tr>
                ))}
                {logs && logs.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      Tidak ada catatan untuk saringan ini.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>{logs ? `${logs.total.toLocaleString("id-ID")} catatan` : loading ? "Memuat…" : ""}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold disabled:opacity-40">
                ← Sebelumnya
              </button>
              <span className="text-xs tabular-nums">
                {page} / {totalPages}
              </span>
              <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold disabled:opacity-40">
                Berikutnya →
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Details({ value, ip }: { value: unknown; ip: string | null }) {
  const text = value && typeof value === "object" && Object.keys(value as object).length > 0 ? JSON.stringify(value) : "";
  if (!text && !ip) return <span className="text-slate-400">—</span>;
  return (
    <details>
      <summary className="cursor-pointer font-semibold text-brand-blue">Buka</summary>
      {text ? <pre className="mt-1 max-w-xs whitespace-pre-wrap break-words text-[11px]">{text}</pre> : null}
      {ip ? <p className="mt-1 text-[11px] text-slate-500">IP {ip}</p> : null}
    </details>
  );
}
