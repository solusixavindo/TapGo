"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "tapgo.admin.theme";

/** Tema tersimpan di peramban operator. Tanpa pilihan (atau penyimpanan diblokir) = gelap. */
export function readTheme(): Theme {
  try {
    return window.localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Dijalankan sebelum cat pertama (lihat layout) agar tidak ada kilatan tema yang salah. */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(KEY)})==="light"){document.documentElement.setAttribute("data-theme","light")}}catch(e){}`;

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => setTheme(readTheme()), []);
  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* penyimpanan diblokir: tema tetap berlaku untuk sesi ini */
    }
    setTheme(next);
  }, [theme]);
  return [theme, toggle];
}
