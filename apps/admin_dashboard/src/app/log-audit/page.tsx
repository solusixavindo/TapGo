"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AuditLogItem,
  formatMoment,
  listAuditLogs,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import ConsoleHeader from "../console-header";

/**
 * Log audit: siapa melakukan apa, kapan. Hanya-baca. Super Admin melihat aksi
 * operasional dan uang; aksi otoritas (peran, scope) serta alamat IP hanya
 * dikirim server ke Super Admin VIP.
 */

const ACTION_LABELS: Record<string, string> = {
  WITHDRAWAL_APPROVED: "Penarikan disetujui",
  WITHDRAWAL_REJECTED: "Penarikan ditolak",
  WITHDRAWAL_PAID: "Penarikan ditransfer",
  MEMBERSHIP_PAYMENT_CONFIRMED: "Pembayaran membership dikonfirmasi",
  MEMBERSHIP_DOCUMENTS_VERIFIED: "Dokumen member diverifikasi",
  MEMBERSHIP_DOCUMENTS_REJECTED: "Dokumen member ditolak",
  MEMBERSHIP_DOCUMENT_VIEWED: "Dokumen member dibuka",
  DRIVER_DOCUMENT_VIEWED: "Dokumen driver dibuka",
  DRIVER_APPLICATION_APPROVED: "Pendaftaran driver disetujui",
  DRIVER_APPLICATION_REJECTED: "Pendaftaran driver ditolak",
  RIDE_DRIVER_STATUS_CHANGED: "Status driver diubah",
  RIDE_VEHICLE_VERIFICATION_CHANGED: "Verifikasi kendaraan diubah",
  FOUNDER_PLATINUM_GRANTED: "Founder Platinum diberikan",
  FOUNDER_CHAIRMAN_GRANTED: "Founder Chairman diberikan",
  SUPPORT_TICKET_UPDATED: "Tiket bantuan diperbarui",
  ADMIN_ROLE_ASSIGNED: "Peran admin diberikan"
};

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

export default function AuditLogPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (nextPage: number, nextAction: string) => {
    setLoading(true);
    try {
      const result = await listAuditLogs({ page: nextPage, ...(nextAction ? { action: nextAction } : {}) });
      setItems(result.items);
      setTotal(result.total);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Log belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

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
    void refresh(page, action);
  }, [router, refresh, page, action]);

  const isVip = roleAtLeast(role, "SUPER_ADMIN_VIP");
  const lastPage = Math.max(1, Math.ceil(total / 25));

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader title="Log Audit" subtitle={`${total} catatan aktivitas`} role={role} />

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Jenis aksi
            <select
              value={action}
              onChange={(event) => {
                setPage(1);
                setAction(event.target.value);
              }}
              className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal"
            >
              <option value="">Semua</option>
              {Object.entries(ACTION_LABELS)
                .filter(([key]) => isVip || key !== "ADMIN_ROLE_ASSIGNED")
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
        </div>

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Memuat…</p>
        ) : items.length === 0 ? (
          <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm">
            <p className="font-bold">Belum ada catatan</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Waktu</th>
                  <th className="px-4 py-3">Pelaku</th>
                  <th className="px-4 py-3">Aksi</th>
                  <th className="px-4 py-3">Objek</th>
                  {isVip ? <th className="px-4 py-3">IP</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="px-4 py-3 text-xs text-slate-600">{formatMoment(item.createdAt)}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{item.actorName}</p>
                      {item.actorRole ? <p className="text-[11px] text-slate-500">{item.actorRole}</p> : null}
                    </td>
                    <td className="px-4 py-3 font-semibold">{actionLabel(item.action)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {item.entityType}
                      {item.entityId ? <span className="block font-mono">{item.entityId.slice(0, 8)}…</span> : null}
                    </td>
                    {isVip ? <td className="px-4 py-3 font-mono text-xs">{item.ipAddress ?? "—"}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => value - 1)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-bold disabled:opacity-40"
          >
            Sebelumnya
          </button>
          <span className="text-slate-500">
            Halaman {page} dari {lastPage}
          </span>
          <button
            type="button"
            disabled={page >= lastPage || loading}
            onClick={() => setPage((value) => value + 1)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-bold disabled:opacity-40"
          >
            Berikutnya
          </button>
        </div>
      </div>
    </main>
  );
}
