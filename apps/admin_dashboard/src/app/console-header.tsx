"use client";

import Link from "next/link";

/**
 * Judul halaman konsol.
 *
 * Navigasi, logo, dan menu akun sekarang ada di bilah samping (ConsoleShell);
 * komponen ini hanya memuat judul, keterangan, dan tindakan halaman. Prop
 * `role` dipertahankan agar halaman lama tidak perlu diubah, tetapi tidak lagi
 * ditampilkan di sini — peran pengguna terlihat di bilah samping.
 *
 * print:hidden: halaman ini juga dipakai mencetak dokumen identitas, dan
 * judul konsol tidak boleh ikut tercetak pada berkas administrasi.
 */
export default function ConsoleHeader({
  title,
  subtitle,
  backHref,
  backLabel = "Kembali",
  actions
}: {
  title: string;
  subtitle?: string;
  /** Diisi pada halaman selain beranda konsol. */
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  /** Diterima demi kompatibilitas; peran ditampilkan di bilah samping. */
  role?: string;
}) {
  return (
    <header className="mb-6 print:hidden">
      {backHref ? (
        <Link href={backHref} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-blue hover:underline">
          <span aria-hidden="true">←</span> {backLabel}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight text-slate-900">{title}</h1>
          {subtitle ? <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
