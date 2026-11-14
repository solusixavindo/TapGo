"use client";

import { RefObject, useLayoutEffect } from "react";

/**
 * Pil penanda menu aktif yang meluncur, seperti pada dasbor rujukan.
 *
 * Pil adalah satu kotak penuh yang dipotong dengan clip-path menjadi sebesar menu aktif. Saat berpindah, tepi DEPAN
 * (arah gerak) bergerak cepat (0,36 dtk, keluar-lambat) dan tepi BELAKANG menyusul lebih pelan (0,55 dtk,
 * masuk-keluar), sehingga pil terlihat memanjang lalu mengerut ke menu baru.
 *
 * Perpindahan halaman konsol adalah muat-ulang penuh (lihat hard-nav), jadi keadaan di memori hilang tiap
 * berpindah. Kesinambungannya dijaga lewat sessionStorage: menu aktif sebelumnya dicatat, dan di halaman baru pil
 * dimulai dari posisi itu lalu meluncur ke menu sekarang. Posisi gulir menu samping dicatat dengan cara yang sama.
 */

const PREV_KEY = "tapgo.nav.prev";
const SCROLL_KEY = "tapgo.nav.scroll";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

type Edges = { t: number; b: number };

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* penyimpanan diblokir: pil tetap bekerja, hanya tanpa kesinambungan antarhalaman */
  }
}

function edgesOf(track: HTMLElement, el: HTMLElement): Edges {
  const tr = track.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { t: r.top - tr.top, b: tr.bottom - r.bottom };
}

function paint(pill: HTMLElement, e: Edges) {
  pill.style.opacity = "1";
  pill.style.clipPath = `inset(${e.t}px 0px ${e.b}px 0px round 12px)`;
}

function tween(from: number, to: number, ms: number, ease: (t: number) => number, update: (v: number) => void) {
  const start = performance.now();
  let raf = 0;
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / ms);
    update(from + (to - from) * ease(p));
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

type PillHost = HTMLElement & { __cancel?: () => void };

export function useNavPill(
  trackRef: RefObject<HTMLElement | null>,
  pillRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
  activeHref: string | null,
  layoutKey: string
) {
  useLayoutEffect(() => {
    const track = trackRef.current;
    const pill = pillRef.current as PillHost | null;
    const scroller = scrollRef.current;
    if (!track || !pill) return;

    const find = (href: string | null) =>
      href ? track.querySelector<HTMLElement>(`[data-nav-href="${CSS.escape(href)}"]`) : null;
    const target = find(activeHref);

    // Posisi gulir menu samping dipulihkan dulu agar ukuran yang dibaca sesudahnya benar.
    if (scroller) {
      const saved = Number(read(SCROLL_KEY));
      if (Number.isFinite(saved) && saved > 0) scroller.scrollTop = saved;
      if (target) {
        const box = scroller.getBoundingClientRect();
        const r = target.getBoundingClientRect();
        if (r.top < box.top || r.bottom > box.bottom) scroller.scrollTop += r.top - box.top - box.height / 2 + r.height / 2;
      }
    }

    pill.__cancel?.();
    if (!target || track.getBoundingClientRect().height === 0) {
      pill.style.opacity = "0";
      return;
    }

    const to = edgesOf(track, target);
    const prevHref = read(PREV_KEY);
    const prevEl = prevHref && prevHref !== activeHref ? find(prevHref) : null;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!prevEl || reduce) {
      paint(pill, to);
    } else {
      const from = edgesOf(track, prevEl);
      const forward = to.t > from.t;
      const cur = { ...from };
      paint(pill, cur);
      // Depan = tepi bawah saat turun, tepi atas saat naik; belakang adalah sebaliknya.
      const leadKey: keyof Edges = forward ? "b" : "t";
      const trailKey: keyof Edges = forward ? "t" : "b";
      const cancels = [
        tween(from[leadKey], to[leadKey], 360, easeOut, (v) => {
          cur[leadKey] = v;
          paint(pill, cur);
        }),
        tween(from[trailKey], to[trailKey], 550, easeInOut, (v) => {
          cur[trailKey] = v;
          paint(pill, cur);
        })
      ];
      pill.__cancel = () => cancels.forEach((c) => c());
    }
    if (activeHref) write(PREV_KEY, activeHref);

    const onScroll = () => scroller && write(SCROLL_KEY, String(scroller.scrollTop));
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    // Ukuran berubah (jendela diubah, huruf dimuat): tempelkan ulang pil tanpa animasi.
    let first = true; // ResizeObserver melapor sekali saat mulai mengamati; itu bukan perubahan ukuran
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      const el = find(activeHref);
      if (el && track.getBoundingClientRect().height > 0) {
        pill.__cancel?.();
        paint(pill, edgesOf(track, el));
      }
    });
    observer.observe(track);

    return () => {
      scroller?.removeEventListener("scroll", onScroll);
      observer.disconnect();
      pill.__cancel?.();
    };
  }, [trackRef, pillRef, scrollRef, activeHref, layoutKey]);
}
