"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AdminWithdrawal,
  WITHDRAWAL_VIP_THRESHOLD,
  WithdrawalStatus,
  actOnWithdrawal,
  formatMoment,
  formatRupiah,
  listAdminWithdrawals,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import ConsoleHeader from "../console-header";

/**
 * Antrean penarikan dana.
 *
 * Alurnya dua langkah dan dipisah dengan sengaja: menyetujui hanya mengunci
 * pengajuan, sedangkan uang baru dianggap keluar setelah transfer manual
 * dilakukan dan ditandai "sudah ditransfer". Nominal di atas ambang hanya
 * dapat disetujui Super Admin VIP; tombolnya dinonaktifkan untuk peran lain,
 * dan server menolak permintaan yang tetap dikirim.
 */

const TABS: Array<{ status: WithdrawalStatus; label: string }> = [
  { status: "PENDING", label: "Menunggu" },
  { status: "APPROVED", label: "Disetujui" },
  { status: "PAID", label: "Sudah ditransfer" },
  { status: "REJECTED", label: "Ditolak" }
];

const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  PAID: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-slate-200 text-slate-700"
};

const ACTION_COPY = {
  approve: {
    title: "Setujui penarikan",
    confirm: "Setujui",
    body: "Pengajuan dikunci untuk ditransfer. Saldo anggota sudah ditahan sejak pengajuan."
  },
  reject: {
    title: "Tolak penarikan",
    confirm: "Tolak dan kembalikan saldo",
    body: "Saldo yang ditahan dikembalikan penuh ke dompet anggota. Tulis alasannya agar anggota paham."
  },
  paid: {
    title: "Tandai sudah ditransfer",
    confirm: "Ya, sudah ditransfer",
    body: "Lakukan HANYA setelah dana benar-benar terkirim ke rekening tujuan. Tindakan ini tidak dapat dibatalkan."
  }
} as const;

type PendingAction = { item: AdminWithdrawal; action: keyof typeof ACTION_COPY };

export default function WithdrawalsPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<WithdrawalStatus>("PENDING");
  const [items, setItems] = useState<AdminWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (next: WithdrawalStatus) => {
    setLoading(true);
    try {
      const result = await listAdminWithdrawals({ status: next });
      setItems(result.items);
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

  const isVip = roleAtLeast(role, "SUPER_ADMIN_VIP");

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      await actOnWithdrawal(pending.item.id, pending.action, note.trim() || undefined);
      setNotice(`${ACTION_COPY[pending.action].title} berhasil.`);
      setPending(null);
      setNote("");
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
          title="Penarikan Dana"
          subtitle={`Persetujuan dan pencatatan transfer. Nominal Rp ${WITHDRAWAL_VIP_THRESHOLD.toLocaleString("id-ID")} ke atas hanya untuk Super Admin VIP.`}
          role={role}
        />

        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Status penarikan">
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
            <p className="font-bold">Tidak ada penarikan pada status ini</p>
            <p className="mt-1 text-sm text-slate-500">Pengajuan baru akan muncul di tab Menunggu.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Anggota</th>
                  <th className="px-4 py-3">Rekening tujuan</th>
                  <th className="px-4 py-3 text-right">Jumlah</th>
                  <th className="px-4 py-3">Diajukan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const amount = Number(item.amount);
                  const needsVip = amount >= WITHDRAWAL_VIP_THRESHOLD;
                  const canApprove = item.status === "PENDING" && (!needsVip || isVip);
                  return (
                    <tr key={item.id} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-bold">{item.user?.fullName ?? "—"}</p>
                        <p className="text-xs text-slate-500">{item.user?.phone ?? ""}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{item.bankName ?? "—"}</p>
                        <p className="font-mono text-xs">{item.accountNumber ?? "—"}</p>
                        <p className="text-xs text-slate-500">{item.accountHolderName ?? ""}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <p className="font-black tabular-nums">{formatRupiah(item.amount)}</p>
                        {needsVip ? (
                          <span className="mt-1 inline-block rounded-full bg-brand-gold/25 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                            Perlu VIP
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {formatMoment(item.requestedAt)}
                        {item.paidAt ? <p>Transfer: {formatMoment(item.paidAt)}</p> : null}
                        {item.note ? <p className="mt-1 text-slate-500">Catatan: {item.note}</p> : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_TONE[item.status] ?? ""}`}>
                          {TABS.find((tab) => tab.status === item.status)?.label ?? item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          {item.status === "PENDING" ? (
                            <>
                              <button
                                type="button"
                                disabled={!canApprove}
                                title={!canApprove ? "Nominal ini hanya dapat disetujui Super Admin VIP" : undefined}
                                onClick={() => setPending({ item, action: "approve" })}
                                className="rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Setujui
                              </button>
                              <button
                                type="button"
                                onClick={() => setPending({ item, action: "reject" })}
                                className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-bold text-rose-700"
                              >
                                Tolak
                              </button>
                            </>
                          ) : null}
                          {item.status === "APPROVED" ? (
                            <button
                              type="button"
                              onClick={() => setPending({ item, action: "paid" })}
                              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white"
                            >
                              Sudah ditransfer
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pending ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navyDeep/60 p-4">
          <div role="dialog" aria-modal="true" aria-label={ACTION_COPY[pending.action].title} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-black">{ACTION_COPY[pending.action].title}</h2>
            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Anggota</dt>
                <dd className="font-bold">{pending.item.user?.fullName ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Jumlah</dt>
                <dd className="font-black tabular-nums">{formatRupiah(pending.item.amount)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Rekening</dt>
                <dd className="text-right font-semibold">
                  {pending.item.bankName} {pending.item.accountNumber}
                  <br />
                  <span className="text-xs font-normal text-slate-500">{pending.item.accountHolderName}</span>
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-5 text-slate-600">{ACTION_COPY[pending.action].body}</p>
            <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-slate-500">
              Catatan {pending.action === "reject" ? "(alasan penolakan)" : "(opsional)"}
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal"
              />
            </label>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  setNote("");
                }}
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy || (pending.action === "reject" && note.trim().length < 3)}
                onClick={confirm}
                className="rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy ? "Memproses…" : ACTION_COPY[pending.action].confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
