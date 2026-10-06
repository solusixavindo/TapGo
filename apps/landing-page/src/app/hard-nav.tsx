"use client";

import { AnchorHTMLAttributes, useMemo } from "react";

/**
 * Navigasi antar halaman alur (upgrade, top up, mitra) memakai muat-ulang
 * halaman penuh, bukan router sisi-klien Next.js.
 *
 * Alasan (laporan Owner 6 Okt 2026: setelah login, layar menampilkan teks
 * mentah `1:"$Sreact.fragment" 2:I[453,...`): pada ekspor statis Next.js 15,
 * router sisi-klien mengambil `/…/index.txt` untuk tiap perpindahan. Bila
 * pengambilan itu gagal karena sebab apa pun (jaringan seluler putus sesaat,
 * Safari membatalkan permintaan, berkas baru saja diganti), Next.js "jatuh ke
 * navigasi peramban" ke URL `.txt` itu, sehingga pengguna melihat isi payload
 * mentah, bukan halaman. Direproduksi dengan membuat pengambilan `.txt`
 * gagal. Muat-ulang penuh meminta HTML halaman itu sendiri, jadi mode galat
 * ini tidak ada; kegagalannya berupa halaman galat peramban biasa.
 *
 * Situs ini kecil dan statis, dan status alur disimpan di sessionStorage,
 * sehingga muat-ulang penuh tidak kehilangan apa pun.
 */

/** "/upgrade/paket?id=1" -> "/upgrade/paket/?id=1" (situs memakai trailingSlash). */
export function withTrailingSlash(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? "" : href.slice(cut);
  return `${path.endsWith("/") ? path : `${path}/`}${rest}`;
}

export function useHardRouter() {
  return useMemo(
    () => ({
      push: (href: string) => window.location.assign(withTrailingSlash(href)),
      replace: (href: string) => window.location.replace(withTrailingSlash(href))
    }),
    []
  );
}

type HardLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string };

export default function HardLink({ href, ...rest }: HardLinkProps) {
  return <a href={withTrailingSlash(href)} {...rest} />;
}
