"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ManualTopUp,
  ManualTopUpStatus,
  actOnManualTopUp,
  formatMoment,
  formatRupiah,
  listManualTopUps,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import ConsoleHeader from "../console-header";

/**
 * Konfirmasi top up manual (transfer bank ke rekening perusahaan).
 *
 * Cocokkan NOMINAL TEPAT (termasuk tiga digit kode unik) dengan mutasi bank
 * sebelum menekan "Konfirmasi". Konfirmasi menambah saldo anggota dan tidak
 * dapat dibatalkan; server mencatatnya di log audit dan menolak konfirmasi ganda.
 */

const TABS: Array<{ status: ManualTopUpStatus; label: string }> = [
  { status: "PENDING", label: "Menunggu transfer" },
  { status: "PAID", label: "Sudah dikonfirmasi" },
  { status: "CANCELLED", label: "Ditolak" }
];

type Pending = { item: ManualTopUp; action: "confirm" | "reject" };

export default function ManualTopUpPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<ManualTopUpStatus>("PENDING");
  const [items, setItems] = useState<ManualTopUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (next: ManualTopUpStatus) => {
    setLoading(true);
    try {
      setItems(await listManualTopUps(next));
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
    const current = readRole();
    if (!roleAtLeast(current, "SUPER_ADMIN")) {
      router.replace("/beranda");
      return;
    }
    setRole(current);
    void refresh(status);
  }, [router, refresh, status]);

  async function run() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      await actOnManualTopUp(pending.item.id, pending.action, reason.trim() || undefined);
      setNotice(pending.action === "confirm" ? "Top up dikonfirmasi dan saldo anggota bertambah." : "Top up ditolak.");
      setPending(null);
      setReason("");
      await refresh(status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tindakan belum dapat diproses.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader
          title="Top Up Manual"
          subtitle="Cocokkan nominal transfer (termasuk kode unik tiga digit) dengan mutasi rekening perusahaan, lalu konfirmasi."
          role={role}
        />

        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Status top up">
          {TABS.map((tab) => (
            <button
              key={tab.status}
              type="button"
              role="tab"
              aria-selected={status === tab.status}
              onClick={() => {
                setNotice("");
                setStatus(tab.status);
              }}
              className={[
                "rounded-lg px-3.5 py-1.5 text-sm font-bold transition",
                status === tab.status ? "bg-brand-navy text-white" : "bg-white text-slate-600 hover:bg-slate-200"
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {notice ? (
          <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Memuat…</p>
        ) : items.length === 0 ? (
          <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm">
            <p className="font-bold">Tidak ada top up pada status ini</p>
            <p className="mt-1 text-sm text-slate-500">Pengajuan baru muncul di tab Menunggu transfer.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Anggota</th>
                  <th className="px-4 py-3 text-right">Nominal transfer</th>
                  <th className="px-4 py-3 text-right">Saldo masuk</th>
                  <th className="px-4 py-3">Diajukan</th>
                  <th className="px-4 py-3 text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-bold">{item.memberName}</p>
                      <p className="text-xs text-slate-500">{item.memberPhone}</p>
                      <p className="font-mono text-[11px] text-slate-400">{item.reference}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="text-base font-black tabular-nums">{formatRupiah(item.transferAmount)}</p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {item.baseAmount === null ? "—" : formatRupiah(item.baseAmount)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {formatMoment(item.createdAt)}
                      {item.expired ? (
                        <p className="mt-1">
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800">Lewat batas waktu</span>
                        </p>
                      ) : null}
                      {item.paidAt ? <p>Dikonfirmasi: {formatMoment(item.paidAt)}</p> : null}
                    </td>
                    <td className="px-4 py-3">
                      {item.status === "PENDING" ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setPending({ item, action: "confirm" })}
                            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white"
                          >
                            Konfirmasi
                          </button>
                          <button
                            type="button"
                            onClick={() => setPending({ item, action: "reject" })}
                            className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-700"
                          >
                            Tolak
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pending ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navyDeep/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={pending.action === "confirm" ? "Konfirmasi top up" : "Tolak top up"}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-lg font-black">{pending.action === "confirm" ? "Konfirmasi top up" : "Tolak top up"}</h2>
            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Anggota</dt>
                <dd className="font-bold">{pending.item.memberName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Nominal transfer</dt>
                <dd className="font-black tabular-nums">{formatRupiah(pending.item.transferAmount)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-5 text-slate-600">
              {pending.action === "confirm"
                ? "Lakukan HANYA setelah dana dengan nominal TEPAT ini terlihat di mutasi rekening perusahaan. Saldo anggota langsung bertambah dan tidak dapat dibatalkan."
                : "Top up ditutup tanpa mengubah saldo. Anggota dapat mengajukan top up baru."}
            </p>
            {pending.action === "reject" ? (
              <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Alasan (opsional)
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={200}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal"
                />
              </label>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPending(null)} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600">
                Batal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={run}
                className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy ? "Memproses…" : pending.action === "confirm" ? "Ya, sudah masuk" : "Tolak"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
