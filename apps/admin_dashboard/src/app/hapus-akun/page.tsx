"use client";

import { useHardRouter as useRouter } from "../hard-nav";
import { useCallback, useEffect, useState } from "react";
import {
  DeletionPreview,
  DeletionRequestRow,
  DeletionStatus,
  completeDeletion,
  formatMoment,
  listDeletionRequests,
  previewDeletion,
  readRole,
  readToken,
  rejectDeletion
} from "../../lib/api";
import ConsoleHeader from "../console-header";

/**
 * Permintaan hapus akun (halaman hapus-akun di tapgolion.id), khusus pemilik sistem.
 *
 * Penghapusan menganonimkan data pribadi dan TIDAK dapat dibatalkan. Layar ini menampilkan dulu halangan yang dihitung
 * server (saldo, penarikan, pesanan berjalan); tombol hapus baru aktif bila tidak ada halangan, lalu menuntut kalimat
 * konfirmasi dan password. Invoice, pembayaran, dan riwayat withdrawal tetap disimpan sesuai janji di halaman publik.
 */

const TABS: Array<{ status: DeletionStatus; label: string }> = [
  { status: "PENDING", label: "Menunggu" },
  { status: "COMPLETED", label: "Selesai" },
  { status: "REJECTED", label: "Ditolak" }
];

const PHRASE = "HAPUS AKUN";

export default function AccountDeletionPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<DeletionStatus>("PENDING");
  const [items, setItems] = useState<DeletionRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [mode, setMode] = useState<"view" | "reject" | "complete">("view");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (next: DeletionStatus) => {
    setLoading(true);
    try {
      setItems(await listDeletionRequests(next));
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
    if (current !== "SUPER_ADMIN_VIP") {
      router.replace("/beranda");
      return;
    }
    setRole(current);
    void refresh(status);
  }, [router, refresh, status]);

  function close() {
    setPreview(null);
    setMode("view");
    setReason("");
    setPassword("");
    setConfirm("");
  }

  async function open(item: DeletionRequestRow) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setPreview(await previewDeletion(item.id));
      setMode("view");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pemeriksaan belum dapat dimuat.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "reject") {
        await rejectDeletion(preview.request.id, reason.trim());
        setNotice("Permintaan ditolak. Data akun tidak diubah.");
      } else {
        await completeDeletion(preview.request.id, confirm.trim(), password);
        setNotice("Akun dihapus: data pribadi dianonimkan dan sesi dicabut.");
      }
      close();
      await refresh(status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tindakan belum dapat diproses.");
    } finally {
      setBusy(false);
    }
  }

  const open_ = preview && preview.request.status === "PENDING";

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <ConsoleHeader
          title="Permintaan Hapus Akun"
          subtitle="Pengajuan dari halaman hapus-akun. Estimasi proses yang dijanjikan ke pengguna: 7–14 hari kerja."
          role={role}
        />

        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Status permintaan">
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
            <p className="font-bold">Tidak ada permintaan pada status ini</p>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="deletion-list">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div>
                  <p className="text-sm font-bold">{item.user.fullName}</p>
                  <p className="text-xs text-slate-500">
                    {item.user.phone}
                    {item.user.email ? ` · ${item.user.email}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Diajukan {formatMoment(item.createdAt)}
                    {item.completedAt ? ` · selesai ${formatMoment(item.completedAt)}` : ""}
                  </p>
                  {item.reason ? <p className="mt-1 text-xs text-slate-600">Alasan pengguna: {item.reason}</p> : null}
                </div>
                {item.status === "PENDING" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void open(item)}
                    className="rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    Periksa
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-brand-navyDeep/60 p-4">
          <div role="dialog" aria-modal="true" aria-label="Pemeriksaan hapus akun" className="my-6 w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-black">{preview.user.fullName}</h2>
            <p className="text-xs text-slate-500">
              {preview.user.phone} · peran {preview.user.role}
            </p>

            {preview.blockers.length > 0 ? (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3" data-testid="deletion-blockers">
                <p className="text-sm font-bold text-amber-900">Belum dapat dihapus</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-900">
                  {preview.blockers.map((blocker) => (
                    <li key={blocker.code}>{blocker.message}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Tidak ada halangan. Akun dapat dihapus.
              </p>
            )}

            <div className="mt-4 grid gap-3 text-xs leading-5 sm:grid-cols-2">
              <div>
                <p className="font-bold uppercase tracking-wider text-slate-500">Akan dihapus</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-700">
                  {preview.willErase.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-bold uppercase tracking-wider text-slate-500">Tetap disimpan</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-700">
                  {preview.willKeep.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>

            {mode === "reject" ? (
              <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Alasan penolakan
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={300}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal"
                />
              </label>
            ) : null}

            {mode === "complete" ? (
              <div className="mt-4 space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                <p className="text-xs leading-5 text-rose-900">
                  Tindakan ini tidak dapat dibatalkan. Ketik <strong>{PHRASE}</strong> dan masukkan password Anda.
                </p>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Password Anda
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal"
                  />
                </label>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Ketik {PHRASE}
                  <input
                    type="text"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    autoComplete="off"
                    name="konfirmasi-hapus-akun"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal"
                  />
                </label>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={close} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600">
                Tutup
              </button>
              {open_ && mode === "view" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setMode("reject")}
                    className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-bold text-rose-700"
                  >
                    Tolak permintaan
                  </button>
                  <button
                    type="button"
                    disabled={!preview.canComplete}
                    onClick={() => setMode("complete")}
                    className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    Hapus akun
                  </button>
                </>
              ) : null}
              {mode === "reject" ? (
                <button
                  type="button"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => void submit()}
                  className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy ? "Memproses…" : "Tolak"}
                </button>
              ) : null}
              {mode === "complete" ? (
                <button
                  type="button"
                  disabled={busy || password.length === 0 || confirm.trim().toUpperCase() !== PHRASE}
                  onClick={() => void submit()}
                  className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                >
                  {busy ? "Memproses…" : "Hapus akun sekarang"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
