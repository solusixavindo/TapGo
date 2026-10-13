"use client";

import { useEffect, useState } from "react";
import {
  PeriodMode,
  PeriodState,
  defaultPeriod,
  fromDateInputValue,
  isCurrentPeriod,
  periodLabel,
  shiftAnchor,
  toDateInputValue
} from "../lib/period";

/**
 * Pemilih periode untuk setiap laporan keuangan: harian, mingguan, bulanan, tahunan (dan seluruh waktu bila
 * `allowAll`). Panah menggeser satu periode; kotak tanggal melompat ke tanggal mana pun; tombol kanan kembali ke
 * periode berjalan. Batas hari memakai WIB (lihat lib/period.ts).
 */
const MODES: Array<{ id: PeriodMode; label: string }> = [
  { id: "day", label: "Harian" },
  { id: "week", label: "Mingguan" },
  { id: "month", label: "Bulanan" },
  { id: "year", label: "Tahunan" }
];

const CURRENT_LABEL: Record<PeriodMode, string> = {
  day: "Hari ini",
  week: "Minggu ini",
  month: "Bulan ini",
  year: "Tahun ini",
  all: "Seluruh waktu"
};

type Props = {
  value: PeriodState;
  onChange: (next: PeriodState) => void;
  /** Tampilkan tab "Semua" (seluruh waktu). Laporan yang membandingkan dengan periode sebelumnya tidak memakainya. */
  allowAll?: boolean;
  disabled?: boolean;
  /** `dark` untuk di atas latar navy (Beranda VIP): tab terpilih berwarna emas supaya tetap terlihat. */
  tone?: "light" | "dark";
};

export default function PeriodFilter({ value, onChange, allowAll = false, disabled = false, tone = "light" }: Props) {
  const dark = tone === "dark";
  // Label dan batas tanggal bergantung pada jam peramban; jangan dirender di HTML statis (hasil build) supaya
  // tidak berbeda dengan render pertama di peramban.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const modes = allowAll ? [...MODES, { id: "all" as PeriodMode, label: "Semua" }] : MODES;
  const isAll = value.mode === "all";
  const atCurrent = isCurrentPeriod(value.mode, value.anchor);

  if (!mounted) {
    return <div className="min-h-[2.25rem]" aria-hidden="true" />;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="period-filter">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Jenis periode">
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={value.mode === mode.id}
            disabled={disabled}
            onClick={() => onChange(mode.id === value.mode ? value : defaultPeriod(mode.id))}
            className={[
              "rounded-lg px-3.5 py-1.5 text-sm font-bold transition disabled:opacity-50",
              value.mode === mode.id
                ? dark
                  ? "bg-brand-gold text-brand-navy"
                  : "bg-brand-navy text-white"
                : dark
                  ? "bg-white/10 text-slate-200 hover:bg-white/20"
                  : "bg-white text-slate-600 hover:bg-slate-200"
            ].join(" ")}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {isAll ? (
        <p className={`text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-600"}`}>Seluruh data sejak awal</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-label="Periode sebelumnya"
            disabled={disabled}
            onClick={() => onChange({ mode: value.mode, anchor: shiftAnchor(value.mode, value.anchor, -1) })}
            className={dark ? "rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-sm font-bold text-white hover:bg-white/15 disabled:opacity-50" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"}
          >
            ‹
          </button>
          <p className={`min-w-[10rem] px-1 text-center text-sm font-bold ${dark ? "text-white" : "text-slate-900"}`} data-testid="period-label" aria-live="polite">
            {periodLabel(value.mode, value.anchor)}
          </p>
          <button
            type="button"
            aria-label="Periode berikutnya"
            disabled={disabled || atCurrent}
            onClick={() => onChange({ mode: value.mode, anchor: shiftAnchor(value.mode, value.anchor, 1) })}
            className={dark ? "rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-sm font-bold text-white hover:bg-white/15 disabled:opacity-30" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"}
          >
            ›
          </button>
          <input
            type="date"
            aria-label="Pilih tanggal"
            value={toDateInputValue(value.anchor)}
            max={toDateInputValue(Date.now())}
            disabled={disabled}
            onChange={(event) => {
              const anchor = fromDateInputValue(event.target.value);
              if (anchor !== null) onChange({ mode: value.mode, anchor });
            }}
            className={dark ? "rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-sm text-white [color-scheme:dark] disabled:opacity-50" : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 disabled:opacity-50"}
          />
          {!atCurrent ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(defaultPeriod(value.mode))}
              className={`rounded-lg px-2.5 py-1.5 text-sm font-bold hover:underline disabled:opacity-50 ${dark ? "text-brand-gold" : "text-brand-blue"}`}
            >
              {CURRENT_LABEL[value.mode]}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
