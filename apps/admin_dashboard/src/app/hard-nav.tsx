"use client";

import { AnchorHTMLAttributes, MouseEvent, useMemo } from "react";
import { exitPage, prefersReducedMotion } from "../lib/motion";

/**
 * Perpindahan halaman konsol memakai muat-ulang halaman penuh, bukan router sisi-klien Next.js.
 *
 * Alasan: konsol ini ekspor statis. Router sisi-klien mengambil berkas data internal
 * `/…/index.txt` untuk tiap perpindahan, lalu bila pengambilan itu bermasalah (tab yang masih memegang
 * build lama setelah konsol diperbarui, jaringan putus sesaat, berkas baru saja diganti) peramban dapat
 * berakhir di berkas itu dan menampilkan teks mentah `1:"$Sreact.fragment" 2:I[…` alih-alih halaman
 * (laporan Owner 14 Okt 2026; gejala yang sama pada situs landing 6 Okt 2026). Muat-ulang penuh selalu
 * meminta HTML halaman itu sendiri, jadi kelas masalah itu tidak ada. Konsol kecil dan statis, dan sesi
 * disimpan di sessionStorage, sehingga muat-ulang penuh tidak kehilangan apa pun.
 */

const BASE_PATH = (process.env.NEXT_PUBLIC_ADMIN_BASE_PATH ?? "").replace(/\/$/, "");

/** "/penarikan?status=PENDING" -> "/admin/penarikan/?status=PENDING" (basePath + trailingSlash). */
export function adminHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? "" : href.slice(cut);
  const withBase = BASE_PATH && path !== BASE_PATH && !path.startsWith(`${BASE_PATH}/`) ? `${BASE_PATH}${path}` : path;
  return `${withBase.endsWith("/") ? withBase : `${withBase}/`}${rest}`;
}

export function useHardRouter() {
  return useMemo(
    () => ({
      push: (href: string) => window.location.assign(adminHref(href)),
      replace: (href: string) => window.location.replace(adminHref(href))
    }),
    []
  );
}

type HardLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string };

/**
 * Tautan antarhalaman konsol. Klik biasa memutar animasi keluar (halaman mengabur, pil menu meluncur) lalu memuat halaman
 * baru; klik dengan Ctrl/Cmd/Shift, tombol tengah, atau target baru, dan gerak yang dimatikan, memakai tautan biasa tanpa
 * animasi. Bila animasi gagal, perpindahan tetap berjalan (lihat exitPage).
 */
export default function HardLink({ href, onClick, target, ...rest }: HardLinkProps) {
  const url = adminHref(href);
  function handle(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (target && target !== "_self") return;
    if (prefersReducedMotion()) return;
    if (url === `${window.location.pathname}${window.location.search}`) return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent("tapgo:nav", { detail: { href: href.split(/[?#]/)[0] } }));
    void exitPage(document.querySelector<HTMLElement>("[data-page-root]")).then(() => window.location.assign(url));
  }
  return <a href={url} target={target} onClick={handle} {...rest} />;
}
