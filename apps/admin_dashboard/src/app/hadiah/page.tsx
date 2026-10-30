"use client";

import { useHardRouter as useRouter } from "../hard-nav";
import { useCallback, useEffect, useState } from "react";
import {
  RewardRow,
  RewardStatus,
  actOnReward,
  formatMoment,
  formatRupiah,
  listRewards,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import ConsoleHeader from "../console-header";

/**
 * Hadiah milestone referral (10 / 100 / ... anggota Silver langsung).
 *
 * Alurnya tiga langkah, dan hanya langkah terakhir yang memindahkan uang:
 * hadiah lahir PENDING -> disetujui -> "Bayarkan" memasukkan nominal ke saldo
 * yang dapat ditarik anggota. Pembayaran tidak dapat dibatalkan dan server
 * menolak pembayaran ganda; setiap keputusan tercatat di log audit.
 */

const TABS: Array<{ status: RewardStatus; label: string }> = [
  { status: "PENDING", label: "Menunggu persetujuan" },
  { status: "APPROVED", label: "Disetujui, belum dibayar" },
  { status: "PAID", label: "Sudah dibayar" },
  { status: "REJECTED", label: "Ditolak" }
];

type Pending = { item: RewardRow; action: "approve" | "reject" | "mark-paid" };

const DIALOG: Record<Pending["action"], { title: string; confirm: string; body: string }> = {
  approve: {
    title: "Setujui hadiah",
    confirm: "Setujui",
    body: "Hadiah disetujui tetapi belum dibayar. Saldo anggota belum berubah sampai Anda menekan Bayarkan."
  },
  reject: {
    title: "Tolak hadiah",
    confirm: "Tolak",
    body: "Hadiah ditutup tanpa mengubah saldo. Hadiah yang sama tidak muncul lagi untuk anggota ini."
  },
  "mark-paid": {
    title: "Bayarkan hadiah",
    confirm: "Ya, bayarkan",
    body: "Nominal langsung masuk ke saldo yang dapat ditarik anggota. Tindakan ini tidak dapat dibatalkan."
  }
};

export default function RewardsPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<RewardStatus>("PENDING");
  const [items, setItems] = useState<RewardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (next: RewardStatus) => {
    setLoading(true);
    try {
      setItems(await listRewards(next));
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
      await actOnReward(pending.item.id, pending.action, note.trim() || undefined);
      setNotice(
        pending.action === "approve"
          ? "Hadiah disetujui. Bayarkan dari tab Disetujui."
          : pending.action === "reject"
            ? "Hadiah ditolak."
            : "Hadiah dibayarkan ke saldo anggota."
      );
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
          title="Hadiah Milestone"
          subtitle="Hadiah untuk anggota yang mencapai jumlah Silver langsung tertentu. Setujui dulu, lalu bayarkan ke saldo anggota."
          role={role}
        />

        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Status hadiah">
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
            <p className="font-bold">Tidak ada hadiah pada status ini</p>
            <p className="mt-1 text-sm text-slate-500">Hadiah baru muncul di tab Menunggu persetujuan.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Anggota</th>
                  <th className="px-4 py-3">Pencapaian</th>
                  <th className="px-4 py-3 text-right">Hadiah</th>
                  <th className="px-4 py-3">Waktu</th>
                  <th className="px-4 py-3 text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="align-top" data-testid="reward-row">
                    <td className="px-4 py-3">
                      <p className="font-bold">{item.user.fullName}</p>
                      <p className="text-xs text-slate-500">{item.user.phone}</p>
                      <p className="font-mono text-[11px] text-slate-400">{item.user.referralCode}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      <p className="font-bold">Target {item.threshold} Silver langsung</p>
                      <p>Tercatat {item.directSilverCount} anggota</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="text-base font-black tabular-nums">{formatRupiah(item.amount)}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p>Dibuat: {formatMoment(item.createdAt)}</p>
                      {item.approvedAt ? <p>Disetujui: {formatMoment(item.approvedAt)}</p> : null}
                      {item.paidAt ? <p>Dibayar: {formatMoment(item.paidAt)}</p> : null}
                      {item.rejectedAt ? <p>Ditolak: {formatMoment(item.rejectedAt)}</p> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {item.status === "PENDING" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setPending({ item, action: "approve" })}
                              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white"
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
                            onClick={() => setPending({ item, action: "mark-paid" })}
                            className="rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-bold text-white"
                          >
                            Bayarkan
                          </button>
                        ) : null}
                      </div>
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
          <div role="dialog" aria-modal="true" aria-label={DIALOG[pending.action].title} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-black">{DIALOG[pending.action].title}</h2>
            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Anggota</dt>
                <dd className="font-bold">{pending.item.user.fullName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Pencapaian</dt>
                <dd className="font-bold">{pending.item.threshold} Silver langsung</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Hadiah</dt>
                <dd className="font-black tabular-nums">{formatRupiah(pending.item.amount)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-5 text-slate-600">{DIALOG[pending.action].body}</p>
            <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-slate-500">
              {pending.action === "reject" ? "Alasan penolakan" : "Catatan (opsional)"}
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                  setNote("");
                }}
                className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy || (pending.action === "reject" && note.trim().length === 0)}
                onClick={run}
                className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy ? "Memproses…" : DIALOG[pending.action].confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
