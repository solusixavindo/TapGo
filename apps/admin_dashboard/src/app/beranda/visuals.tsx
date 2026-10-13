"use client";

import { ReactNode } from "react";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

/**
 * Komponen visual Beranda VIP. Palet mengikuti merek konsol (navy, biru, cyan, emas) dengan hijau dan merah hanya
 * untuk makna (naik/turun, bagus/buruk). Tidak ada pustaka grafik baru: recharts sudah menjadi dependensi konsol.
 */
export const PALETTE = {
  navy: "#061A2F",
  navySoft: "#0E2C4C",
  blue: "#0877E8",
  cyan: "#00D4FF",
  gold: "#FFC857",
  emerald: "#10B981",
  rose: "#F43F5E",
  amber: "#F59E0B",
  violet: "#7C6CF2",
  slate: "#64748B",
  grid: "#E2E8F0",
  axis: "#64748B"
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Label bucket "YYYY-MM-DD HH:00" (WIB) menjadi teks sumbu yang pendek menurut granularitas. */
export function bucketText(label: string, bucket: "hour" | "day" | "month", long = false): string {
  const year = label.slice(0, 4);
  const month = MONTHS[Number(label.slice(5, 7)) - 1] ?? "";
  const day = Number(label.slice(8, 10));
  if (bucket === "hour") return long ? `${day} ${month}, ${label.slice(11, 16)}` : label.slice(11, 16);
  if (bucket === "day") return long ? `${day} ${month} ${year}` : `${day} ${month}`;
  return long ? `${month} ${year}` : `${month} ${year.slice(2)}`;
}

/** Rupiah ringkas untuk sumbu dan kartu: 1,2 jt, 340 rb. */
export function compactRupiah(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const fmt = (n: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(n);
  if (abs >= 1_000_000_000) return `${sign}Rp${fmt(abs / 1_000_000_000)} M`;
  if (abs >= 1_000_000) return `${sign}Rp${fmt(abs / 1_000_000)} jt`;
  if (abs >= 1_000) return `${sign}Rp${fmt(abs / 1_000)} rb`;
  return `${sign}Rp${fmt(abs)}`;
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  id
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-black tracking-tight text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs leading-5 text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Perubahan dibanding periode sebelumnya. `onDark` untuk tampil di atas latar navy. */
export function DeltaChip({ current, previous, onDark = false }: { current: number; previous: number; onDark?: boolean }) {
  if (previous === 0 && current === 0) {
    return <span className={`text-[11px] font-semibold ${onDark ? "text-slate-400" : "text-slate-400"}`}>sama dengan periode lalu</span>;
  }
  if (previous === 0) {
    return <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">baru</span>;
  }
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const up = percent >= 0;
  const tone = up ? (onDark ? "bg-emerald-400/15 text-emerald-300" : "bg-emerald-50 text-emerald-700") : onDark ? "bg-rose-400/15 text-rose-300" : "bg-rose-50 text-rose-700";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${tone}`}>
      {up ? "▲" : "▼"} {Math.abs(percent).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%
    </span>
  );
}

/** Garis mini tanpa sumbu untuk kartu angka. */
export function Sparkline({ values, color, height = 40 }: { values: number[]; color: string; height?: number }) {
  const data = values.map((value, index) => ({ index, value }));
  const gradient = `spark-${color.replace("#", "")}`;
  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.55} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradient})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const STAR_PATH = "M12 2.5l2.94 6.1 6.56.9-4.8 4.6 1.2 6.6L12 17.6l-5.9 3.1 1.2-6.6-4.8-4.6 6.56-.9L12 2.5z";

/** Bintang dengan pecahan (4,6 = empat penuh dan satu 60%). */
export function Stars({ value, size = 16, label }: { value: number; size?: number; label?: string }) {
  const clamped = Math.max(0, Math.min(5, value));
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label ?? `${clamped.toLocaleString("id-ID")} dari 5 bintang`}>
      {[0, 1, 2, 3, 4].map((position) => {
        const fill = Math.max(0, Math.min(1, clamped - position));
        const id = `star-${position}-${Math.round(fill * 100)}-${size}`;
        return (
          <svg key={position} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id={id}>
                <stop offset={`${fill * 100}%`} stopColor={PALETTE.gold} />
                <stop offset={`${fill * 100}%`} stopColor="#E2E8F0" />
              </linearGradient>
            </defs>
            <path d={STAR_PATH} fill={`url(#${id})`} stroke={fill > 0 ? PALETTE.amber : "#CBD5E1"} strokeWidth={0.6} strokeLinejoin="round" />
          </svg>
        );
      })}
    </span>
  );
}

export type DonutSlice = { label: string; value: number; color: string };

/** Donat dengan angka di tengah dan legenda bernilai persen. */
export function Donut({ data, centerValue, centerLabel }: { data: DonutSlice[]; centerValue: string; centerLabel: string }) {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const shown = total > 0 ? data.filter((slice) => slice.value > 0) : [{ label: "Belum ada data", value: 1, color: "#E2E8F0" }];
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-32 w-32 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={shown} dataKey="value" innerRadius={42} outerRadius={60} paddingAngle={shown.length > 1 ? 3 : 0} stroke="none" isAnimationActive={false}>
              {shown.map((slice) => (
                <Cell key={slice.label} fill={slice.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-lg font-black leading-none text-slate-900 tabular-nums">{centerValue}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{centerLabel}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {data.map((slice) => (
          <li key={slice.label} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="shrink-0 font-bold tabular-nums text-slate-900">
              {slice.value.toLocaleString("id-ID")}
              <span className="ml-1 font-semibold text-slate-400">{total > 0 ? `${Math.round((slice.value / total) * 100)}%` : "0%"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Daftar batang horizontal: nama, batang berskala terhadap nilai terbesar, jumlah, dan persen dari total. */
export function HBars({ items, color, total, empty }: { items: Array<{ name: string; count: number }>; color: string; total: number; empty: string }) {
  if (items.length === 0) return <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">{empty}</p>;
  const max = Math.max(...items.map((item) => item.count), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((item, position) => (
        <li key={item.name}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-semibold text-slate-700">
              <span className="mr-2 inline-block w-4 text-right text-slate-400 tabular-nums">{position + 1}</span>
              {item.name}
            </span>
            <span className="shrink-0 font-bold tabular-nums text-slate-900">
              {item.count.toLocaleString("id-ID")}
              <span className="ml-1 font-semibold text-slate-400">{total > 0 ? `${Math.round((item.count / total) * 100)}%` : ""}</span>
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${Math.max(4, (item.count / max) * 100)}%`, backgroundColor: color, opacity: 1 - position * 0.07 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/** Peta panas hari x jam (WIB): makin pekat makin ramai. */
export function Heatmap({ matrix }: { matrix: number[][] }) {
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[520px]">
        <div className="ml-9 grid gap-[3px] text-[9px] font-semibold text-slate-400" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} className="text-center">
              {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
            </span>
          ))}
        </div>
        <div className="mt-1 space-y-[3px]">
          {matrix.map((row, dayIndex) => (
            <div key={DAYS[dayIndex]} className="flex items-center gap-2">
              <span className="w-7 shrink-0 text-[10px] font-bold text-slate-500">{DAYS[dayIndex]}</span>
              <div className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                {row.map((count, hour) => (
                  <div
                    key={hour}
                    title={`${DAYS[dayIndex]} ${String(hour).padStart(2, "0")}.00 WIB: ${count} pesanan`}
                    className="aspect-square rounded-[3px]"
                    style={{ backgroundColor: count === 0 ? "#F1F5F9" : PALETTE.blue, opacity: count === 0 ? 1 : 0.18 + 0.82 * (count / max) }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="ml-9 mt-3 flex items-center gap-2 text-[10px] font-semibold text-slate-400">
          <span>Sepi</span>
          {[0.2, 0.4, 0.6, 0.8, 1].map((level) => (
            <span key={level} className="h-3 w-5 rounded-[3px]" style={{ backgroundColor: PALETTE.blue, opacity: level }} />
          ))}
          <span>Ramai</span>
        </div>
      </div>
    </div>
  );
}

/** Tooltip grafik: kotak gelap kecil selaras dengan hero. */
export function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormat
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string | number }>;
  label?: string | number;
  format: (value: number, name: string) => string;
  labelFormat: (label: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl bg-brand-navy px-3 py-2 text-xs text-white shadow-xl ring-1 ring-white/10">
      <p className="mb-1 font-bold text-slate-300">{labelFormat(String(label ?? ""))}</p>
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-200">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.name}
          </span>
          <span className="font-bold tabular-nums">{format(Number(entry.value ?? 0), String(entry.name ?? ""))}</span>
        </p>
      ))}
    </div>
  );
}
