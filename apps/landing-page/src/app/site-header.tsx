"use client";

import { useEffect, useState } from "react";
import { ThemeToggle } from "./theme-toggle";

const whatsappUrl =
  "https://wa.me/6283800255588?text=Halo%20TapGo%20Lion%2C%20saya%20ingin%20bertanya.";
const playStoreUrl = "https://play.google.com/store/apps/details?id=com.xavindo.tapgo";

/**
 * Tautan anchor (#layanan dst) ditulis sebagai "/#layanan" (bukan "#layanan"
 * polos) supaya bekerja dari halaman mana pun — di Beranda sendiri browser
 * cukup lompat ke bagiannya, di halaman lain browser memuat Beranda dulu
 * baru lompat, tanpa perlu client-side routing khusus.
 */
const links = [
  { href: "/#layanan", label: "Layanan" },
  { href: "/#cara-kerja", label: "Cara Kerja" },
  { href: "/#membership", label: "Membership" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#kontak", label: "Kontak" },
  { href: "/upgrade", label: "Upgrade Membership" },
  { href: "/mitra", label: "Mitra" }
];

export function LogoMark({ className = "h-10 w-10" }: { className?: string }) {
  return <img src="/images/tapgo-mark.png" alt="" className={`${className} object-contain`} />;
}

function MenuIcon({ open }: { open: boolean }) {
  return open ? (
    <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="none">
      <path d="m5 5 14 14M19 5 5 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ) : (
    <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="none">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  // Tutup laci menu otomatis kalau layar diperbesar melewati breakpoint desktop.
  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 1024) setOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Kunci scroll body saat laci mobile terbuka.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b themed-border themed-nav themed-text backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <a href="/" className="flex items-center gap-3 font-bold" aria-label="TapGo Lion Indonesia">
          <LogoMark />
          <span>
            <span className="block leading-tight">TapGo Lion</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-gold">
              Indonesia
            </span>
          </span>
        </a>

        <div className="hidden items-center gap-7 text-sm font-semibold lg:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="themed-text-secondary hover:opacity-80">
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle className="hidden themed-border themed-text sm:inline-flex" />
          <a
            href={playStoreUrl}
            className="hidden rounded-full border themed-border themed-text px-4 py-2 text-xs font-bold hover:opacity-80 sm:inline-flex"
          >
            Unduh di Google Play
          </a>
          <a
            href={whatsappUrl}
            className="inline-flex items-center gap-2 rounded-full bg-brand-green px-4 py-2.5 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5"
          >
            <span className="hidden sm:inline">Chat WhatsApp</span>
            <span className="sm:hidden">WA</span>
          </a>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Tutup menu" : "Buka menu"}
            aria-expanded={open}
            aria-controls="site-mobile-menu"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border themed-border themed-text lg:hidden"
          >
            <MenuIcon open={open} />
          </button>
        </div>
      </div>

      {open ? (
        <div id="site-mobile-menu" className="border-t themed-border themed-nav px-5 pb-6 pt-2 lg:hidden">
          <nav className="flex flex-col gap-1 text-base font-semibold">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="themed-text-secondary rounded-xl px-3 py-3 transition hover:opacity-80"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-dashed themed-border pt-4">
            <a href={playStoreUrl} className="themed-text-secondary text-sm font-bold hover:opacity-80">
              Unduh di Google Play
            </a>
            <ThemeToggle className="themed-border themed-text" />
          </div>
        </div>
      ) : null}
    </header>
  );
}
