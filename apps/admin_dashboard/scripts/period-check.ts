/** Pemeriksaan hitungan periode (WIB). Jalankan: npx tsx scripts/period-check.ts */
import { periodBounds, shiftAnchor, periodQuery, periodLabel, isCurrentPeriod, toDateInputValue, fromDateInputValue } from "../src/lib/period";
const iso = (n: number) => new Date(n).toISOString();
let fails = 0;
function eq(name: string, got: unknown, want: unknown) { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails++; console.log("FAIL", name, got, "!=", want); } else console.log("ok  ", name); }
const t = Date.parse("2026-10-14T17:30:00Z"); // 15 Okt 00:30 WIB
let b = periodBounds("day", t)!; eq("day", [iso(b.start), iso(b.end)], ["2026-10-14T17:00:00.000Z", "2026-10-15T16:59:59.999Z"]);
const wed = Date.parse("2026-10-14T05:00:00Z");
b = periodBounds("week", wed)!; eq("week Mon-Sun", [iso(b.start), iso(b.end)], ["2026-10-11T17:00:00.000Z", "2026-10-18T16:59:59.999Z"]);
const sun = Date.parse("2026-10-18T10:00:00Z"); // Minggu 18 Okt WIB -> masih minggu yang sama
b = periodBounds("week", sun)!; eq("week on Sunday", iso(b.start), "2026-10-11T17:00:00.000Z");
const mon = Date.parse("2026-10-18T17:30:00Z"); // Senin 19 Okt 00:30 WIB -> minggu baru
b = periodBounds("week", mon)!; eq("week on Monday 00:30 WIB", iso(b.start), "2026-10-18T17:00:00.000Z");
b = periodBounds("month", wed)!; eq("month", [iso(b.start), iso(b.end)], ["2026-09-30T17:00:00.000Z", "2026-10-31T16:59:59.999Z"]);
b = periodBounds("year", wed)!; eq("year", [iso(b.start), iso(b.end)], ["2025-12-31T17:00:00.000Z", "2026-12-31T16:59:59.999Z"]);
eq("all", periodBounds("all", wed), null);
const jan31 = Date.parse("2026-01-31T05:00:00Z");
eq("month back from Jan 31", periodLabel("month", shiftAnchor("month", jan31, -1)), "Desember 2025");
eq("month forward from Jan 31", periodLabel("month", shiftAnchor("month", jan31, 1)), "Februari 2026");
eq("month forward twice", periodLabel("month", shiftAnchor("month", shiftAnchor("month", jan31, 1), 1)), "Maret 2026");
eq("year back from Feb 29 2028", periodLabel("year", shiftAnchor("year", Date.parse("2028-02-29T05:00:00Z"), -1)), "2027");
eq("day back", periodLabel("day", shiftAnchor("day", wed, -1)), "Selasa, 13 Oktober 2026");
eq("week label", periodLabel("week", wed), "12 Okt – 18 Okt 2026");
eq("day label", periodLabel("day", wed), "Rabu, 14 Oktober 2026");
eq("current month", isCurrentPeriod("month", wed, Date.parse("2026-10-30T00:00:00Z")), true);
eq("past month not current", isCurrentPeriod("month", wed, Date.parse("2026-11-02T00:00:00Z")), false);
const q = periodQuery({ mode: "month", anchor: wed }, Date.parse("2026-10-20T03:00:00Z")); eq("current month clamps to now", [q.dateFrom, q.dateTo], ["2026-09-30T17:00:00.000Z", "2026-10-20T03:00:00.000Z"]);
const q2 = periodQuery({ mode: "month", anchor: wed }, Date.parse("2026-12-01T00:00:00Z")); eq("past month keeps end", q2.dateTo, "2026-10-31T16:59:59.999Z");
eq("all query", periodQuery({ mode: "all", anchor: wed }), {});
eq("date input", toDateInputValue(t), "2026-10-15");
eq("from date input round trip", toDateInputValue(fromDateInputValue("2026-10-15")!), "2026-10-15");
eq("invalid date", fromDateInputValue("2026-02-31"), null);
eq("garbage", fromDateInputValue("besok"), null);
console.log(fails ? `${fails} GAGAL` : "SEMUA LULUS");
process.exit(fails ? 1 : 0);
