"use client";

import { useEffect, useState } from "react";
import { getOwnAvatar, onOwnAvatarChanged } from "./mitra-api";
import { initials } from "./mitra-format";

/**
 * Foto profil pemilik sesi. Memuat dari server (sumber yang sama dengan aplikasi
 * Play Store) dan memuat ulang otomatis begitu foto diganti dari halaman mana pun.
 * Bila belum ada foto, tampil inisial nama.
 */
export default function ProfileAvatar({
  name,
  sizeClass = "h-10 w-10 text-xs"
}: {
  name: string;
  sizeClass?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => onOwnAvatarChanged(() => setVersion((value) => value + 1)), []);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    void getOwnAvatar().then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [version]);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`Foto profil ${name}`}
        onError={() => setFailed(true)}
        className={`${sizeClass} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <span className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full m-tone-gold font-black`}>
      {initials(name)}
    </span>
  );
}
