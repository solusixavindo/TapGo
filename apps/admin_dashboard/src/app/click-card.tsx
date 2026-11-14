"use client";

import { KeyboardEvent, MouseEvent, ReactNode } from "react";
import Link, { adminHref } from "./hard-nav";

/**
 * Kartu ringkasan yang dapat diklik di seluruh permukaannya.
 *
 * Tujuan: dari angka langsung ke rincian yang menjelaskannya. Dua jenis tujuan:
 *  - `href`: halaman konsol lain (muat-ulang penuh seperti tautan lain, lihat hard-nav);
 *  - `onActivate`: tindakan di halaman yang sama (mis. menyaring daftar di bawah kartu), atau `href="#id"` untuk
 *    menggulir ke bagian lain halaman.
 *
 * Klik pada isi yang sudah interaktif (tombol, tautan, kolom isian, tab) TIDAK ikut membuka kartu, dan memilih/menyeret
 * teks juga tidak. Hover di atas grafik tetap berfungsi karena tidak ada lapisan penutup. Untuk papan ketik dan
 * pembaca layar, kartu memuat satu tautan/tombol "Rincian" sungguhan (tampak saat disorot atau difokus).
 */
type Props = {
  /** Nama tujuan, dibaca pembaca layar: "Buka Direktori Member". */
  label: string;
  href?: string;
  onActivate?: () => void;
  as?: "div" | "section" | "article";
  id?: string;
  className?: string;
  children: ReactNode;
  testId?: string;
};

const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role='tab'],[data-no-card-nav]";

function scrollToHash(hash: string) {
  const el = document.getElementById(hash.slice(1));
  el?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

export default function ClickCard({ label, href, onActivate, as = "div", id, className = "", children, testId }: Props) {
  const Tag = as;
  const isPage = Boolean(href && !href.startsWith("#"));

  function activate(newTab: boolean) {
    if (onActivate) return onActivate();
    if (!href) return;
    if (href.startsWith("#")) return scrollToHash(href);
    const target = adminHref(href);
    if (newTab) window.open(target, "_blank", "noopener");
    else window.location.assign(target);
  }

  function onClick(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    if ((event.target as Element).closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    activate(event.metaKey || event.ctrlKey);
  }

  const cueClass =
    "click-card-cue absolute bottom-2 right-3 rounded px-1.5 py-0.5 text-[11px] font-semibold text-brand-green opacity-0 transition hover:underline focus-visible:opacity-100 print:hidden";

  return (
    <Tag id={id} data-testid={testId} onClick={onClick} className={`click-card group relative cursor-pointer ${className}`}>
      {children}
      {isPage ? (
        <Link href={href!} aria-label={label} className={cueClass}>
          Rincian →
        </Link>
      ) : (
        <button
          type="button"
          aria-label={label}
          className={cueClass}
          onClick={() => activate(false)}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => event.stopPropagation()}
        >
          Rincian →
        </button>
      )}
    </Tag>
  );
}
