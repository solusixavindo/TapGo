"use client";

import { AnchorHTMLAttributes, useMemo } from "react";

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

export default function HardLink({ href, ...rest }: HardLinkProps) {
  return <a href={adminHref(href)} {...rest} />;
}
