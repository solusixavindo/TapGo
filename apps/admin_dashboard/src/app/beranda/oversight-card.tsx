"use client";

import { useEffect, useState } from "react";
import { OversightReport, fetchOversight, formatRupiah } from "../../lib/api";
import ClickCard from "../click-card";

/** Ringkas pengawasan admin 24 jam terakhir di Beranda VIP; rincian ada di Log Aktivitas. */
export default function OversightCard() {
  const [report, setReport] = useState<OversightReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchOversight(24)
      .then((r) => alive && setReport(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const warnings = report?.alerts.filter((a) => a.severity === "warning") ?? [];
  const actions = report?.admins.reduce((sum, a) => sum + a.total, 0) ?? 0;
  const money = report?.admins.reduce((sum, a) => sum + a.moneyTotal, 0) ?? 0;
  const tone = warnings.length > 0 ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white";

  return (
    <ClickCard
      as="section"
      href="/log-aktivitas"
      label="Buka Log Aktivitas"
      testId="oversight-card"
      className={`mb-6 rounded-2xl border p-5 pb-8 shadow-sm ${tone}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-black tracking-tight text-slate-900">Pengawasan admin · 24 jam terakhir</h2>
          <p className="mt-0.5 text-xs text-slate-500">Aksi Admin dan Super Admin, terutama yang menyangkut uang.</p>
        </div>
        {report ? (
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${warnings.length > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
            {warnings.length > 0 ? `${warnings.length} perlu ditinjau` : "Tidak ada yang perlu ditinjau"}
          </span>
        ) : null}
      </div>
      {failed ? (
        <p className="mt-3 text-sm text-slate-500">Ringkasan pengawasan belum dapat dimuat.</p>
      ) : !report ? (
        <p className="mt-3 text-sm text-slate-500">Memuat…</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-slate-700">
            <strong className="tabular-nums">{actions}</strong> aksi oleh <strong>{report.admins.length}</strong> admin · uang diproses{" "}
            <strong className="tabular-nums">{formatRupiah(money)}</strong>
          </p>
          {warnings.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-amber-900">
              {warnings.slice(0, 3).map((a, i) => (
                <li key={`${a.key}-${i}`}>{a.message}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </ClickCard>
  );
}
