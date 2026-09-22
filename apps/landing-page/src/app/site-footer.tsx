"use client";

import { LogoMark } from "./site-header";

const companyAddress = [
  "PT. TapGo Lion Indonesia",
  "Jalan Kp. Pasir Gendok No. 11",
  "Desa Bojongleles",
  "Kecamatan Rangkasbitung",
  "Kabupaten Lebak",
  "Banten",
  "Indonesia"
];

const legalLinks = [
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms-and-conditions", label: "Terms & Conditions" },
  { href: "/refund-policy", label: "Refund & Cancellation" },
  { href: "/contact", label: "Contact" },
  { href: "/mitra", label: "Mitra" },
  { href: "/delete-account", label: "Hapus Akun" }
];

export function SiteFooter() {
  return (
    <footer className="themed-border themed-text-muted border-t px-5 py-10">
      <div className="mx-auto grid max-w-7xl gap-8 text-sm md:grid-cols-[1.2fr_0.9fr_0.7fr]">
        <div>
          <div className="flex items-center gap-3">
            <LogoMark className="h-9 w-9" />
            <p className="themed-text font-bold">PT. TapGo Lion Indonesia</p>
          </div>
          <p className="mt-4 max-w-[30ch]">
            Satu aplikasi untuk perjalanan, penghasilan, dan pembayaran harian. Dimulai dari Banten, dibangun untuk Indonesia.
          </p>
          <p className="mt-4">© 2026 PT. TapGo Lion Indonesia. All rights reserved.</p>
        </div>
        <address className="not-italic leading-7">
          {companyAddress.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </address>
        <div className="themed-text-secondary flex flex-wrap content-start gap-5 font-semibold">
          {legalLinks.map((link) => (
            <a key={link.href} href={link.href} className="hover:opacity-80">
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
