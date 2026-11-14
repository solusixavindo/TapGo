"use client";

import gsap from "gsap";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";

/**
 * Koreografi gerak konsol admin dengan GSAP (meniru dasbor rujukan): halaman keluar ke "kekosongan" bercahaya, judul
 * muncul dengan efek acak-huruf, kartu kaca masuk bergiliran dari kabur ke jelas, cahaya latar bergeser per halaman.
 *
 * Aturan yang dijaga di sini:
 * - Tanpa JavaScript/GSAP konten tetap terlihat: keadaan awal tersembunyi hanya dipasang oleh GSAP (gsap.from).
 * - Setelah selesai, transform/filter/opacity DIHAPUS (clearProps). Elemen bertransform/berfilter menjadi acuan posisi
 *   bagi dialog `fixed` di dalamnya dan akan menggesernya dari layar.
 * - Gerak dikurangi menjadi nol bila peramban meminta (prefers-reduced-motion) dan tidak dijalankan saat mencetak.
 */
let registered = false;
function register() {
  if (registered) return;
  gsap.registerPlugin(ScrambleTextPlugin);
  registered = true;
  // Alat peninjauan: sessionStorage["tapgo.motion.timescale"]="0.15" memperlambat semua gerak (rekaman/uji tampilan).
  try {
    const slow = Number(window.sessionStorage.getItem("tapgo.motion.timescale"));
    if (Number.isFinite(slow) && slow >= 0.05 && slow <= 1) gsap.globalTimeline.timeScale(slow);
  } catch {
    /* penyimpanan diblokir */
  }
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Kartu tingkat atas: panel berkaca/putih berpojok membulat yang bukan bagian dari kartu lain dan bukan dialog. */
const CARD_SELECTOR = ".rounded-2xl.bg-white, .rounded-xl.bg-white, .rounded-3xl";
const MAX_CARDS = 36;

function isTopLevelCard(el: Element, root: Element): boolean {
  if (el.closest("[role='dialog'], [aria-modal='true'], .fixed")) return false;
  const parent = el.parentElement?.closest(CARD_SELECTOR);
  return !(parent && root.contains(parent));
}

/** Animasikan kartu-kartu yang belum pernah dianimasikan; dipanggil lagi saat isi baru muncul (data selesai dimuat). */
export function revealCards(root: HTMLElement) {
  if (prefersReducedMotion()) return;
  register();
  const fresh = [...root.querySelectorAll<HTMLElement>(CARD_SELECTOR)]
    .filter((el) => !el.dataset.motionDone && isTopLevelCard(el, root))
    .slice(0, MAX_CARDS);
  if (fresh.length === 0) return;
  fresh.forEach((el) => (el.dataset.motionDone = "1"));
  gsap.fromTo(
    fresh,
    { autoAlpha: 0, y: 24, scale: 0.985, filter: "blur(10px)" },
    {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      filter: "blur(0px)",
      duration: 0.85,
      ease: "power3.out",
      stagger: { each: 0.07, from: "start" },
      clearProps: "opacity,visibility,transform,filter"
    }
  );
  // Batang kemajuan/penanda yang memberi tahu "isi" tumbuh dari kiri.
  const bars = fresh.flatMap((el) => [...el.querySelectorAll<HTMLElement>("[data-grow]")]);
  if (bars.length > 0) {
    gsap.from(bars, { scaleX: 0, transformOrigin: "left center", duration: 1.1, ease: "power3.out", delay: 0.25, stagger: 0.05, clearProps: "transform" });
  }
}

/** Judul halaman: huruf berganti-ganti lalu menetap, seperti pada dasbor rujukan. */
function revealTitle(root: HTMLElement) {
  const title = root.querySelector<HTMLElement>("main h1");
  if (!title || title.dataset.motionDone) return;
  const text = title.textContent ?? "";
  if (text.length < 2) return;
  title.dataset.motionDone = "1";
  title.setAttribute("aria-label", text);
  gsap.to(title, {
    duration: 0.9,
    ease: "none",
    scrambleText: { text, chars: "abcdefghijklmnopqrstuvwxyz", speed: 0.7, revealDelay: 0.12, tweenLength: false },
    onComplete: () => {
      title.textContent = text;
      title.removeAttribute("aria-label");
    }
  });
}

/** Cahaya latar (dua gumpalan) bergeser ke posisi khas halaman; posisi terakhir diingat antar muat-ulang halaman. */
function moveAmbient(seed: string) {
  const a = document.querySelector<HTMLElement>("[data-blob='a']");
  const b = document.querySelector<HTMLElement>("[data-blob='b']");
  if (!a || !b) return;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pick = (n: number) => ((h >>> n) % 100) / 100;
  const key = "tapgo.ambient";
  let from: { ax: number; ay: number; bx: number; by: number } | null = null;
  try {
    from = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
  } catch {
    from = null;
  }
  const to = { ax: -20 + pick(1) * 60, ay: -20 + pick(5) * 50, bx: -30 + pick(9) * 60, by: -30 + pick(13) * 50 };
  try {
    window.sessionStorage.setItem(key, JSON.stringify(to));
  } catch {
    /* tanpa kesinambungan antarhalaman */
  }
  if (from) {
    gsap.set(a, { xPercent: from.ax, yPercent: from.ay });
    gsap.set(b, { xPercent: from.bx, yPercent: from.by });
  }
  gsap.to(a, { xPercent: to.ax, yPercent: to.ay, duration: 1.6, ease: "power2.inOut" });
  gsap.to(b, { xPercent: to.bx, yPercent: to.by, duration: 1.8, ease: "power2.inOut" });
}

/**
 * Dipasang sekali per muat halaman. Mengembalikan fungsi pembersih. Memantau perubahan isi supaya kartu yang baru muncul
 * setelah data selesai dimuat ikut masuk dengan efek yang sama (bukan hanya yang ada saat halaman pertama dirender).
 */
export function enterPage(root: HTMLElement, seed: string): () => void {
  if (prefersReducedMotion() || window.matchMedia?.("print").matches) return () => undefined;
  register();
  moveAmbient(seed);
  revealTitle(root);
  revealCards(root);
  let queued = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(queued);
    queued = window.setTimeout(() => {
      revealTitle(root);
      revealCards(root);
    }, 60);
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    window.clearTimeout(queued);
    observer.disconnect();
  };
}

/** Keluar halaman: isi memudar dan mengabur sebelum perpindahan. Selesai (resolve) setelah animasi atau bila gerak dimatikan. */
export function exitPage(root: HTMLElement | null): Promise<void> {
  if (!root || prefersReducedMotion()) return Promise.resolve();
  register();
  return new Promise((resolve) => {
    gsap.to(root, { autoAlpha: 0, y: -10, filter: "blur(8px)", duration: 0.24, ease: "power2.in", onComplete: () => resolve() });
    // Pengaman: perpindahan tidak boleh tertahan oleh animasi yang tidak selesai.
    window.setTimeout(resolve, 600);
  });
}

/** Sorotan kaca yang mengikuti kursor di atas kartu yang dapat diklik. Dipasang sekali; mengembalikan pembersih. */
export function installSpotlight(): () => void {
  if (prefersReducedMotion()) return () => undefined;
  let raf = 0;
  const onMove = (event: PointerEvent) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const card = (event.target as Element | null)?.closest?.<HTMLElement>(".click-card, .stat-card");
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    });
  };
  document.addEventListener("pointermove", onMove, { passive: true });
  return () => {
    document.removeEventListener("pointermove", onMove);
    cancelAnimationFrame(raf);
  };
}
