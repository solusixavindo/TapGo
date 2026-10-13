/**
 * Periode laporan keuangan: harian, mingguan, bulanan, tahunan, atau seluruh waktu.
 *
 * Batas hari memakai WIB (UTC+7, tanpa DST), bukan zona waktu peramban, supaya laporan "hari ini" sama di laptop
 * mana pun. Minggu dimulai hari Senin. Fungsi di sini murni (tanpa DOM) agar mudah diuji.
 */
export type PeriodMode = "day" | "week" | "month" | "year" | "all";

export type PeriodState = { mode: PeriodMode; /** Satu instan di dalam periode yang dipilih (ms sejak epoch). */ anchor: number };

export type PeriodQuery = { dateFrom?: string; dateTo?: string };

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function wibParts(instant: number) {
  const shifted = new Date(instant + WIB_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

/** Pukul 00:00 WIB pada tanggal kalender tersebut (bulan/hari di luar rentang dinormalkan oleh Date.UTC). */
function wibMidnight(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) - WIB_OFFSET_MS;
}

/** Awal dan akhir (inklusif sampai milidetik terakhir) periode yang memuat `anchor`; null untuk "all". */
export function periodBounds(mode: PeriodMode, anchor: number): { start: number; end: number } | null {
  const { year, month, day, weekday } = wibParts(anchor);
  switch (mode) {
    case "day":
      return { start: wibMidnight(year, month, day), end: wibMidnight(year, month, day + 1) - 1 };
    case "week": {
      const sinceMonday = (weekday + 6) % 7;
      return { start: wibMidnight(year, month, day - sinceMonday), end: wibMidnight(year, month, day - sinceMonday + 7) - 1 };
    }
    case "month":
      return { start: wibMidnight(year, month, 1), end: wibMidnight(year, month + 1, 1) - 1 };
    case "year":
      return { start: wibMidnight(year, 0, 1), end: wibMidnight(year + 1, 0, 1) - 1 };
    case "all":
      return null;
  }
}

/** Geser satu periode ke belakang (-1) atau ke depan (1). */
export function shiftAnchor(mode: PeriodMode, anchor: number, direction: -1 | 1): number {
  const { year, month, day } = wibParts(anchor);
  switch (mode) {
    case "day":
      return anchor + direction * DAY_MS;
    case "week":
      return anchor + direction * 7 * DAY_MS;
    case "month":
      // Tengah bulan tujuan: aman dari bulan yang lebih pendek.
      return wibMidnight(year, month + direction, 15) + DAY_MS / 2;
    case "year":
      return wibMidnight(year + direction, Math.min(month, 11), Math.min(day, 28)) + DAY_MS / 2;
    case "all":
      return anchor;
  }
}

/** Periode yang sedang berjalan (memuat `now`): tidak ada periode setelahnya. */
export function isCurrentPeriod(mode: PeriodMode, anchor: number, now: number = Date.now()): boolean {
  const bounds = periodBounds(mode, anchor);
  return bounds === null ? true : now >= bounds.start && now <= bounds.end;
}

/**
 * Parameter untuk API. Akhir periode yang masih berjalan dipotong sampai `now`: laporan seperti Laba Rugi
 * membagi biaya server per hari sepanjang periode, sehingga akhir di masa depan akan membebankan biaya sebulan
 * penuh pada bulan yang belum selesai.
 */
export function periodQuery(state: PeriodState, now: number = Date.now()): PeriodQuery {
  const bounds = periodBounds(state.mode, state.anchor);
  if (!bounds) return {};
  return { dateFrom: new Date(bounds.start).toISOString(), dateTo: new Date(Math.min(bounds.end, now)).toISOString() };
}

const WIB_ZONE = "Asia/Jakarta";

function format(instant: number, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("id-ID", { timeZone: WIB_ZONE, ...options }).format(new Date(instant));
}

export function periodLabel(mode: PeriodMode, anchor: number): string {
  const bounds = periodBounds(mode, anchor);
  if (!bounds) return "Seluruh waktu";
  switch (mode) {
    case "day":
      return format(bounds.start, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    case "week":
      return `${format(bounds.start, { day: "numeric", month: "short" })} – ${format(bounds.end, { day: "numeric", month: "short", year: "numeric" })}`;
    case "month":
      return format(bounds.start, { month: "long", year: "numeric" });
    case "year":
      return format(bounds.start, { year: "numeric" });
    case "all":
      return "Seluruh waktu";
  }
}

/** Tanggal kalender WIB sebagai YYYY-MM-DD, untuk <input type="date">. */
export function toDateInputValue(instant: number): string {
  const { year, month, day } = wibParts(instant);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Kebalikan toDateInputValue: tengah hari WIB pada tanggal itu; null bila bukan tanggal yang valid. */
export function fromDateInputValue(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const instant = wibMidnight(year, month, day) + DAY_MS / 2;
  const back = wibParts(instant);
  return back.year === year && back.month === month && back.day === day ? instant : null;
}

export function defaultPeriod(mode: PeriodMode = "month", now: number = Date.now()): PeriodState {
  return { mode, anchor: now };
}
