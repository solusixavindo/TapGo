"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearSession } from "../lib/api";

/**
 * Kepala halaman bersama untuk seluruh layar konsol.
 *
 * Dijadikan satu komponen supaya logo, tombol kembali, dan navigasi tidak
 * pernah berbeda antar halaman — sebelumnya tiap halaman menyusun kepalanya
 * sendiri, dan tombol kembali sama sekali tidak ada.
 *
 * print:hidden di seluruh bagian: halaman ini juga dipakai mencetak dokumen
 * identitas, dan navigasi tidak boleh ikut tercetak pada berkas administrasi.
 */
export default function ConsoleHeader({
  title,
  subtitle,
  role,
  backHref,
  backLabel = "Kembali",
  actions
}: {
  title: string;
  subtitle?: string;
  role?: string;
  /** Diisi pada halaman selain beranda konsol. */
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}) {
  const router = useRouter();

  function signOut() {
    clearSession();
    router.replace("/");
  }

  return (
    <header className="mb-6 print:hidden">
      {backHref ? (
        <Link
          href={backHref}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-blue hover:underline"
        >
          <span aria-hidden="true">←</span> {backLabel}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-brand-navy px-5 py-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- aset lokal statis, tidak perlu dioptimasi */}
          <img
            src="/admin/logo.png"
            alt="Logo TapGo Lion Indonesia"
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 object-contain"
          />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-gold">
              TapGo Lion Indonesia
            </p>
            <h1 className="font-display text-lg font-extrabold text-white">{title}</h1>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-slate-300">{subtitle}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {role ? (
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-brand-gold">
              {role}
            </span>
          ) : null}
          <Link
            href="/ganti-password"
            className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            Ganti password
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            Keluar
          </button>
        </div>
      </div>
    </header>
  );
}
