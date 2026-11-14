"use client";

import gsap from "gsap";
import { RefObject, useLayoutEffect } from "react";
import { prefersReducedMotion } from "../lib/motion";

/**
 * Pil penanda menu aktif yang meluncur, persis teknik pada dasbor rujukan (slidePill):
 * satu kotak penuh dipotong clip-path menjadi sebesar menu aktif; tepi DEPAN (arah gerak) bergerak 0,36 dtk
 * `power3.out`, tepi BELAKANG menyusul 0,55 dtk `power3.inOut`, sehingga pil memanjang lalu mengerut ke menu baru.
 *
 * Pil mulai bergerak SAAT menu diklik (peristiwa "tapgo:nav" dari tautan konsol), bersamaan dengan animasi keluar
 * halaman, lalu halaman baru memuat dan memasang pil langsung di tempatnya. Jalur cadangan (halaman dibuka langsung,
 * atau berpindah lewat jalur lain): pil mulai dari menu aktif sebelumnya yang dicatat di sessionStorage.
 */

const PREV_KEY = "tapgo.nav.prev";
const DONE_KEY = "tapgo.nav.moved";
const SCROLL_KEY = "tapgo.nav.scroll";

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
    /* tanpa kesinambungan antarhalaman */
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

type PillHost = HTMLElement & { __edges?: Edges; __tweens?: gsap.core.Tween[] };

/** slidePill dari dasbor rujukan: dari tepi sekarang ke tepi menu tujuan, depan cepat dan belakang menyusul. */
function slide(pill: PillHost, track: HTMLElement, target: HTMLElement) {
  const to = edgesOf(track, target);
  const from = pill.__edges ?? to;
  pill.__tweens?.forEach((t) => t.kill());
  const cur: Edges = { ...from };
  pill.__edges = cur;
  if (prefersReducedMotion() || (from.t === to.t && from.b === to.b)) {
    Object.assign(cur, to);
    paint(pill, cur);
    return;
  }
  paint(pill, cur);
  const forward = to.t > from.t;
  const lead: keyof Edges = forward ? "b" : "t";
  const trail: keyof Edges = forward ? "t" : "b";
  pill.__tweens = [
    gsap.to(cur, { [lead]: to[lead], duration: 0.36, ease: "power3.out", onUpdate: () => paint(pill, cur) }),
    gsap.to(cur, { [trail]: to[trail], duration: 0.55, ease: "power3.inOut", onUpdate: () => paint(pill, cur) })
  ];
}

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

    if (scroller) {
      const saved = Number(read(SCROLL_KEY));
      if (Number.isFinite(saved) && saved > 0) scroller.scrollTop = saved;
      if (target) {
        const box = scroller.getBoundingClientRect();
        const r = target.getBoundingClientRect();
        if (r.top < box.top || r.bottom > box.bottom) scroller.scrollTop += r.top - box.top - box.height / 2 + r.height / 2;
      }
    }

    pill.__tweens?.forEach((t) => t.kill());
    if (!target || track.getBoundingClientRect().height === 0) {
      pill.style.opacity = "0";
      return;
    }

    const to = edgesOf(track, target);
    const movedAtClick = read(DONE_KEY) === activeHref; // pil sudah meluncur saat menu diklik di halaman sebelumnya
    const prevHref = read(PREV_KEY);
    const prevEl = !movedAtClick && prevHref && prevHref !== activeHref ? find(prevHref) : null;
    window.sessionStorage?.removeItem?.(DONE_KEY);

    if (prevEl) {
      pill.__edges = edgesOf(track, prevEl);
      slide(pill, track, target);
    } else {
      pill.__edges = { ...to };
      paint(pill, to);
    }
    if (activeHref) write(PREV_KEY, activeHref);

    const onScroll = () => scroller && write(SCROLL_KEY, String(scroller.scrollTop));
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    // Menu diklik: pil meluncur sekarang, tanpa menunggu halaman baru.
    const onNav = (event: Event) => {
      const href = (event as CustomEvent<{ href: string }>).detail?.href;
      const el = find(href);
      if (!el) return;
      slide(pill, track, el);
      write(DONE_KEY, href);
    };
    window.addEventListener("tapgo:nav", onNav);

    let first = true; // ResizeObserver melapor sekali saat mulai mengamati; itu bukan perubahan ukuran
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      const el = find(activeHref);
      if (el && track.getBoundingClientRect().height > 0) {
        pill.__tweens?.forEach((t) => t.kill());
        const e = edgesOf(track, el);
        pill.__edges = e;
        paint(pill, e);
      }
    });
    observer.observe(track);

    return () => {
      scroller?.removeEventListener("scroll", onScroll);
      window.removeEventListener("tapgo:nav", onNav);
      observer.disconnect();
      pill.__tweens?.forEach((t) => t.kill());
    };
  }, [trackRef, pillRef, scrollRef, activeHref, layoutKey]);
}
