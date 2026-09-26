"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { clearSession, readRole, roleAtLeast } from "../lib/api";

/**
 * Kerangka konsol: bilah samping bergrup + area isi.
 *
 * Menu hanya kemudahan — setiap endpoint tetap dijaga peran di server. Menu
 * yang bukan hak peran pengguna tidak ditampilkan sama sekali, supaya operator
 * tidak menemukan halaman yang hanya akan menjawab "tidak diizinkan".
 */

type Minimum = "ADMIN" | "SUPER_ADMIN" | "SUPER_ADMIN_VIP";
type IconName = "home" | "badge" | "car" | "users" | "wallet" | "chart" | "scale" | "clipboard" | "shield" | "route" | "pulse" | "bug";

const NAV_GROUPS: Array<{
  title: string;
  items: Array<{ href: string; label: string; minimum: Minimum; icon: IconName }>;
}> = [
  {
    title: "Ikhtisar",
    items: [{ href: "/beranda", label: "Beranda", minimum: "ADMIN", icon: "home" }]
  },
  {
    title: "Operasional",
    items: [
      { href: "/member-requests", label: "Persetujuan Member", minimum: "ADMIN", icon: "badge" },
      { href: "/driver-documents", label: "Dokumen Driver", minimum: "ADMIN", icon: "car" },
      { href: "/members", label: "Direktori Member", minimum: "ADMIN", icon: "users" },
      { href: "/rides", label: "Monitoring Perjalanan", minimum: "ADMIN", icon: "route" }
    ]
  },
  {
    title: "Keuangan",
    items: [
      { href: "/penarikan", label: "Penarikan Dana", minimum: "SUPER_ADMIN", icon: "wallet" },
      { href: "/top-up-manual", label: "Top Up Manual", minimum: "SUPER_ADMIN", icon: "wallet" },
      { href: "/reports", label: "Laporan Keuangan", minimum: "SUPER_ADMIN", icon: "chart" },
      { href: "/laba-rugi", label: "Laba Rugi", minimum: "SUPER_ADMIN_VIP", icon: "scale" }
    ]
  },
  {
    title: "Tata Kelola",
    items: [
      { href: "/log-audit", label: "Log Audit", minimum: "SUPER_ADMIN", icon: "clipboard" },
      { href: "/roles", label: "Pengaturan Role", minimum: "SUPER_ADMIN_VIP", icon: "shield" }
    ]
  },
  {
    title: "Pemantauan Sistem",
    items: [
      { href: "/system-health", label: "Kesehatan Server", minimum: "SUPER_ADMIN_VIP", icon: "pulse" },
      { href: "/error-monitoring", label: "Error & Bugs", minimum: "SUPER_ADMIN_VIP", icon: "bug" }
    ]
  }
];

const ROLE_INFO: Record<string, { title: string; duty: string }> = {
  ADMIN: { title: "Admin", duty: "Verifikasi dan bantuan. Tidak memindahkan uang." },
  SUPER_ADMIN: { title: "Super Admin", duty: "Persetujuan uang dan laporan keuangan." },
  SUPER_ADMIN_VIP: { title: "Super Admin VIP", duty: "Pemilik: seluruh akses, laba rugi, dan pengaturan role." }
};

const ICONS: Record<IconName, ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v9h13v-9M10 19v-5h4v5" />,
  badge: <path d="M12 3 5 6v5.5c0 4.3 2.9 8 7 9.5 4.1-1.5 7-5.2 7-9.5V6l-7-3ZM9 12l2.2 2.2L15.5 10" />,
  car: <path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2M8 13h.01M16 13h.01" />,
  users: (
    <>
      <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 6.5M18 13.5a6 6 0 0 1 3.5 6" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5Z" />
      <path d="M16 13.5h.01" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  scale: <path d="M12 4v16M6 20h12M5 8h14M5 8l-3 7a3.5 3.5 0 0 0 6 0L5 8ZM19 8l-3 7a3.5 3.5 0 0 0 6 0L19 8Z" />,
  clipboard: <path d="M9 4h6v3H9V4ZM7 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-1M8.5 12h7M8.5 16h5" />,
  shield: <path d="M12 3 5 6v5.5c0 4.3 2.9 8 7 9.5 4.1-1.5 7-5.2 7-9.5V6l-7-3Z" />,
  route: (
    <>
      <path d="M5 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM19 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M5 16.5V13a4 4 0 0 1 4-4h6a4 4 0 0 0 4-4" />
    </>
  ),
  pulse: <path d="M3 12h4l2-7 4 14 2-7h6" />,
  bug: (
    <>
      <path d="M9 8.5V6.5a3 3 0 1 1 6 0v2M6.5 11H4M20 11h-2.5M6.5 16H4M20 16h-2.5M8 20l-1.5 2M16 20l1.5 2" />
      <path d="M8 11.5a4 4 0 0 1 8 0V16a4 4 0 0 1-8 0v-4.5Z" />
    </>
  )
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0">
      {ICONS[name]}
    </svg>
  );
}

function Sidebar({ role, pathname, onNavigate }: { role: string; pathname: string; onNavigate?: () => void }) {
  const router = useRouter();
  const info = ROLE_INFO[role] ?? ROLE_INFO.ADMIN!;
  const effective = role || "ADMIN";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        {/* eslint-disable-next-line @next/next/no-img-element -- aset lokal statis */}
        <img src="/admin/logo.png" alt="Logo TapGo Lion" width={36} height={36} className="h-9 w-9 shrink-0 object-contain" />
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-white">TapGo Lion</p>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-gold">Konsol Admin</p>
        </div>
      </div>

      <nav aria-label="Menu konsol" className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => roleAtLeast(effective, item.minimum));
          if (items.length === 0) return null;
          return (
            <div key={group.title}>
              <p className="px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{group.title}</p>
              <ul className="mt-2 space-y-0.5">
                {items.map((item) => {
                  const active = pathname === item.href || pathname === `${item.href}/`;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={[
                          "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition",
                          active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
                        ].join(" ")}
                      >
                        {active ? <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand-gold" /> : null}
                        <Icon name={item.icon} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="rounded-xl bg-white/5 p-3">
          <span className="inline-block rounded-full bg-brand-gold/20 px-2.5 py-0.5 text-[11px] font-bold text-brand-gold">
            {info.title}
          </span>
          <p className="mt-2 text-xs leading-5 text-slate-300">{info.duty}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link href="/ganti-password" onClick={onNavigate} className="whitespace-nowrap rounded-lg border border-white/20 px-2 py-2 text-center text-[11px] font-semibold text-white hover:bg-white/10">
            Ganti password
          </Link>
          <button
            type="button"
            onClick={() => {
              clearSession();
              router.replace("/");
            }}
            className="rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"
          >
            Keluar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [role, setRole] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => setRole(readRole()), [pathname]);
  useEffect(() => setOpen(false), [pathname]);

  const isLogin = pathname === "/" || pathname === "";
  if (isLogin) return <>{children}</>;

  return (
    <div className="min-h-screen bg-slate-100 lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-brand-navy print:hidden lg:block">
        <Sidebar role={role} pathname={pathname} />
      </aside>

      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 print:hidden lg:hidden">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- aset lokal statis */}
          <img src="/admin/logo.png" alt="" width={28} height={28} className="h-7 w-7 object-contain" />
          <span className="text-sm font-extrabold text-brand-navy">TapGo Konsol Admin</span>
        </div>
        <button
          type="button"
          aria-label="Buka menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-brand-navy"
        >
          Menu
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <button type="button" aria-label="Tutup menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-brand-navyDeep/60" />
          <aside className="absolute inset-y-0 left-0 w-72 bg-brand-navy shadow-xl">
            <Sidebar role={role} pathname={pathname} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="min-w-0">{children}</div>
    </div>
  );
}
