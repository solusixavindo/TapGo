"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "tapgo.theme";

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage dapat ditolak (mode privat/penyimpanan penuh) — tema
    // tetap berlaku untuk sesi ini lewat atribut di <html>, hanya tidak
    // tersimpan untuk kunjungan berikutnya. Bukan kegagalan yang berarti.
  }
}

/**
 * Tombol terang/gelap untuk seluruh situs SELAIN Beranda (yang sengaja
 * dikunci navy+emas, lihat globals.css). Tema tersimpan di localStorage dan
 * langsung diterapkan oleh skrip inline di layout.tsx sebelum render
 * pertama, jadi tidak ada kedipan warna saat halaman dimuat.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(current);
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "light" ? "Ganti ke tema gelap" : "Ganti ke tema terang"}
      title={theme === "light" ? "Tema gelap" : "Tema terang"}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition hover:-translate-y-0.5 ${className}`}
    >
      {theme === "light" ? (
        <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none">
          <path
            d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
