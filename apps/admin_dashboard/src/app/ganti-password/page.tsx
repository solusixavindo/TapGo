"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ConsoleHeader from "../console-header";
import { changePassword, clearSession, readRole, readToken } from "../../lib/api";

/**
 * Ganti password akun sendiri.
 *
 * Setelah berhasil, server mencabut SELURUH sesi — termasuk token yang sedang
 * dipakai layar ini. Karena itu layar sengaja tidak mencoba melanjutkan apa pun:
 * sesi lokal dibersihkan dan pengguna diantar kembali ke halaman masuk. Mencoba
 * bertahan hanya akan menghasilkan galat 401 beruntun yang membingungkan.
 */
export default function GantiPasswordPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [lama, setLama] = useState("");
  const [baru, setBaru] = useState("");
  const [ulangi, setUlangi] = useState("");
  const [lihat, setLihat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selesai, setSelesai] = useState(false);

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    setRole(readRole());
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (baru !== ulangi) {
      setError("Konfirmasi password tidak sama.");
      return;
    }
    if (baru.length < 8) {
      // Server menerima minimal 6. Konsol ini menuntut 8 karena akun di sini
      // dapat membuka dokumen identitas dan mengubah peran admin lain.
      setError("Password baru minimal 8 karakter.");
      return;
    }
    if (baru === lama) {
      setError("Password baru harus berbeda dari yang lama.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await changePassword(lama, baru);
      setSelesai(true);
      clearSession();
      // Jeda singkat supaya pengguna sempat membaca konfirmasinya.
      setTimeout(() => router.replace("/"), 2200);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Password belum dapat diganti."
      );
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-brand-blue";

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-2xl">
        <ConsoleHeader
          title="Ganti Password"
          subtitle="Berlaku untuk akun yang sedang masuk"
          role={role}
          backHref="/member-requests"
          backLabel="Kembali ke verifikasi keanggotaan"
        />

        {selesai ? (
          <div
            role="status"
            className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-8 text-center"
          >
            <p className="text-lg font-bold text-emerald-800">Password berhasil diganti</p>
            <p className="mt-2 text-sm text-emerald-900">
              Seluruh sesi lama sudah dicabut, termasuk perangkat lain yang masih
              masuk. Anda akan diantar ke halaman masuk sebentar lagi.
            </p>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="rounded-2xl border border-slate-200 bg-white p-6"
          >
            <p className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              Setelah password berganti, <strong>semua sesi dicabut</strong> — termasuk
              perangkat lain dan tab yang sedang terbuka. Anda perlu masuk kembali.
            </p>

            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-bold text-slate-700">
                Password saat ini
              </span>
              <input
                type={lihat ? "text" : "password"}
                value={lama}
                onChange={(e) => setLama(e.target.value)}
                autoComplete="current-password"
                required
                className={inputClass}
              />
            </label>

            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-bold text-slate-700">
                Password baru
              </span>
              <input
                type={lihat ? "text" : "password"}
                value={baru}
                onChange={(e) => setBaru(e.target.value)}
                autoComplete="new-password"
                required
                className={inputClass}
              />
              <span className="mt-1.5 block text-xs text-slate-500">
                Minimal 8 karakter. Sebaiknya gabungkan huruf besar, angka, dan simbol.
              </span>
            </label>

            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-bold text-slate-700">
                Ulangi password baru
              </span>
              <input
                type={lihat ? "text" : "password"}
                value={ulangi}
                onChange={(e) => setUlangi(e.target.value)}
                autoComplete="new-password"
                required
                className={inputClass}
              />
            </label>

            <label className="mb-5 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={lihat}
                onChange={(e) => setLihat(e.target.checked)}
              />
              Tampilkan password
            </label>

            {error ? (
              <p
                role="alert"
                className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-brand-navy px-4 py-3 text-base font-bold text-white disabled:opacity-60"
            >
              {busy ? "Menyimpan…" : "Ganti Password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
