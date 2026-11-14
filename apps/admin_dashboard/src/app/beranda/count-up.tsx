"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Angka yang naik dari nol ke nilainya (0,9 dtk). Hanya untuk teks yang berbentuk
 * [awalan][bilangan bulat berpemisah titik][akhiran], mis. "1.234" atau "Rp1.250.000"; teks lain (strip "—",
 * pecahan, rentang) ditampilkan apa adanya. Pembaruan angka berikutnya (polling 10 detik) bergerak dari nilai
 * yang sedang tampil, bukan dari nol. Tanpa animasi bila peramban meminta gerak dikurangi.
 */
const SHAPE = /^(\D*?)(\d{1,3}(?:\.\d{3})+|\d+)(\D*)$/;

const format = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export default function CountUp({ text }: { text: string }) {
  const match = SHAPE.exec(text);
  const target = match ? Number(match[2]!.replace(/\./g, "")) : null;
  const [shown, setShown] = useState<number | null>(target);
  const current = useRef(0);

  useEffect(() => {
    if (target === null) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !Number.isFinite(target)) {
      current.current = target;
      setShown(target);
      return;
    }
    const from = current.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      current.current = from + (target - from) * eased;
      setShown(current.current);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  if (!match || target === null || shown === null) return <>{text}</>;
  return (
    <span aria-label={text}>
      <span aria-hidden="true">
        {match[1]}
        {format(shown)}
        {match[3]}
      </span>
    </span>
  );
}
