"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ServiceSuspensionStatus,
  formatMoment,
  getServiceSuspension,
  readRole,
  readToken,
  roleAtLeast,
  setServiceSuspension
} from "../../lib/api";
import ConsoleHeader from "../console-header";
import { useHardRouter as useRouter } from "../hard-nav";

/**
 * Status layanan: menghentikan (suspend) atau memulihkan seluruh layanan untuk aplikasi HP. Hanya Super Admin VIP.
 *
 * Yang terjadi saat dihentikan: aplikasi driver dan penumpang menerima pesan layanan dihentikan dan tidak dapat memesan,
 * menerima order, atau bertransaksi. Konsol admin, pemberitahuan penyedia pembayaran, dan jalur hapus akun tetap hidup.
 * Tidak ada data yang dihapus; memulihkan layanan mengembalikan semuanya seperti semula. Setiap perubahan tercatat di audit.
 *
 * Pengaman: kalimat konfirmasi diketik (HENTIKAN / PULIHKAN) dan password akun yang sedang masuk diminta ulang.
 */

const DEFAULT_MESSAGE =
  "Layanan TapGo sedang dihentikan sementara. Silakan hubungi support@tapgolion.id untuk informasi.";

export default function ServiceStatusPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<ServiceSuspensionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await getServiceSuspension();
      setStatus(result);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Status layanan belum dapat dimuat.");
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
    setRole(current);
    if (roleAtLeast(current, "SUPER_ADMIN_VIP")) {
      void refresh();
    } else {
      setLoading(false);
    }
  }, [router, refresh]);

  const isVip = roleAtLeast(role, "SUPER_ADMIN_VIP");
  const target = status ? !status.suspended : true;
  const phrase = target ? "HENTIKAN" : "PULIHKAN";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!status || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await setServiceSuspension({
        suspended: target,
        ...(target && message.trim() ? { message: message.trim() } : {}),
        confirm: confirm.trim(),
        password
      });
      setNotice(target ? "Layanan dihentikan. Aplikasi HP kini menerima pesan layanan dihentikan." : "Layanan dipulihkan.");
      setConfirm("");
      setPassword("");
      setMessage("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Perubahan belum berhasil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-3xl">
        <ConsoleHeader
          title="Status Layanan"
          subtitle="Hentikan atau pulihkan layanan aplikasi. Khusus Super Admin VIP"
          role={role}
        />

        {!loading && !isVip ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Halaman ini khusus Super Admin VIP.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}

        {loading ? <p className="text-sm text-slate-500">Memuat…</p> : null}

        {isVip && status ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Status saat ini</p>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    status.suspended ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {status.suspended ? "Layanan dihentikan" : "Layanan berjalan"}
                </span>
              </div>
              {status.suspended ? (
                <p className="mt-3 text-sm text-slate-700">
                  Pesan untuk pengguna: <span className="font-semibold">{status.message}</span>
                </p>
              ) : null}
              <p className="mt-3 text-xs text-slate-500">
                {status.changedAt
                  ? `Terakhir diubah ${formatMoment(status.changedAt)}${status.changedByName ? ` oleh ${status.changedByName}` : ""}.`
                  : "Belum pernah diubah."}
              </p>
            </section>

            <form onSubmit={submit} className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-base font-black text-brand-navy">
                {target ? "Hentikan layanan" : "Pulihkan layanan"}
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {target ? (
                  <>
                    <li>Aplikasi driver dan penumpang tidak dapat memesan, menerima order, atau bertransaksi.</li>
                    <li>Konsol admin, pemberitahuan pembayaran, dan jalur hapus akun tetap hidup.</li>
                    <li>Tidak ada data yang dihapus. Layanan dapat dipulihkan kapan saja dari halaman ini.</li>
                  </>
                ) : (
                  <li>Aplikasi HP kembali dapat dipakai seperti biasa.</li>
                )}
              </ul>

              {target ? (
                <label className="mt-4 block text-sm font-semibold text-slate-700">
                  Pesan untuk pengguna (opsional, maksimal 300 karakter)
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={300}
                    rows={3}
                    placeholder={DEFAULT_MESSAGE}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                  />
                </label>
              ) : null}

              <label className="mt-4 block text-sm font-semibold text-slate-700">
                Ketik <span className="font-mono">{phrase}</span> untuk melanjutkan
                <input
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                />
              </label>

              <label className="mt-4 block text-sm font-semibold text-slate-700">
                Password akun Anda
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
                />
              </label>

              <button
                type="submit"
                disabled={saving || confirm.trim().toUpperCase() !== phrase || password.length === 0}
                className={`mt-5 rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                  target ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {saving ? "Memproses…" : target ? "Hentikan layanan" : "Pulihkan layanan"}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </main>
  );
}
