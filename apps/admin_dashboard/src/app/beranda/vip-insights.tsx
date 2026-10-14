"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { VipInsights, formatRupiah, getVipInsights } from "../../lib/api";
import { PeriodState, defaultPeriod, periodLabel, periodQuery } from "../../lib/period";
import Link from "../hard-nav";
import PeriodFilter from "../period-filter";
import {
  ChartTooltip,
  DeltaChip,
  Donut,
  DonutSlice,
  HBars,
  Heatmap,
  PALETTE,
  Panel,
  Sparkline,
  Stars,
  bucketText,
  compactRupiah
} from "./visuals";

/**
 * Beranda Super Admin VIP: pusat kendali dengan pertumbuhan, pendapatan, perjalanan, wilayah, usia pengemudi, rating dan
 * ulasan, serta hal yang butuh perhatian. Seluruh angka dari /admin/dashboard/insights (tidak ada data karangan).
 *
 * Satu permintaan untuk semuanya, diperbarui tiap 60 detik saat tab terlihat: pembatas laju admin 80 permintaan/menit
 * per IP dibagi dengan halaman lain.
 */
const REFRESH_MS = 60_000;
const MIN_GAP_MS = 5_000;

const RIDE_STATUS_LABEL: Record<string, string> = {
  COMPLETED: "Selesai",
  CANCELLED_BY_PASSENGER: "Dibatalkan penumpang",
  CANCELLED_BY_DRIVER: "Dibatalkan pengemudi",
  CANCELLED_BY_SYSTEM: "Dibatalkan sistem",
  NO_DRIVER: "Tanpa pengemudi",
  EXPIRED: "Kedaluwarsa",
  CREATED: "Baru dibuat",
  SEARCHING_DRIVER: "Mencari pengemudi",
  DRIVER_ASSIGNED: "Pengemudi ditetapkan",
  DRIVER_TO_PICKUP: "Menuju penjemputan",
  DRIVER_ARRIVED: "Pengemudi tiba",
  IN_TRIP: "Sedang berjalan"
};

const SERVICE_LABEL: Record<string, string> = { MOTORCYCLE: "Motor", CAR: "Mobil" };
const TIER_COLOR: Record<string, string> = { BASIC: "#94A3B8", SILVER: PALETTE.cyan, GOLD: PALETTE.gold, PLATINUM: PALETTE.violet };
const STAR_COLOR: Record<number, string> = { 5: PALETTE.emerald, 4: "#84CC16", 3: PALETTE.amber, 2: "#FB923C", 1: PALETTE.rose };

type RegionView = "members" | "drivers" | "pickups";
const REGION_VIEWS: Array<{ id: RegionView; label: string; hint: string; color: string }> = [
  { id: "members", label: "Domisili member", hint: "Dari alamat yang diisi saat upgrade membership", color: PALETTE.blue },
  { id: "drivers", label: "Domisili pengemudi", hint: "Dari alamat pada data pengajuan pengemudi", color: PALETTE.gold },
  { id: "pickups", label: "Area penjemputan", hint: "Dari alamat titik jemput pesanan pada periode ini", color: PALETTE.cyan }
];

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.round(hours / 24);
  return days < 31 ? `${days} hari lalu` : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(iso));
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const number = (value: number) => value.toLocaleString("id-ID");

type AttentionItem = { key: string; label: string; detail?: string; href?: string; tone: "rose" | "amber" | "sky" };

function attentionItems(data: VipInsights): AttentionItem[] {
  const a = data.attention;
  const items: AttentionItem[] = [];
  if (a.digiflazz && (a.digiflazz.level === "CRITICAL" || a.digiflazz.level === "LOW")) {
    items.push({
      key: "digiflazz",
      label: a.digiflazz.level === "CRITICAL" ? "Saldo Digiflazz kritis" : "Saldo Digiflazz menipis",
      detail: a.digiflazz.balance !== null ? formatRupiah(a.digiflazz.balance) : undefined,
      href: "/saldo-digiflazz",
      tone: a.digiflazz.level === "CRITICAL" ? "rose" : "amber"
    });
  }
  if (a.stuckPpob > 0) items.push({ key: "ppob", label: `${a.stuckPpob} transaksi PPOB tertahan`, detail: "lebih dari 10 menit", href: "/transaksi-digiflazz", tone: "rose" });
  if (a.ppobLossWeek > 0)
    items.push({ key: "ppob-loss", label: `${a.ppobLossWeek} transaksi PPOB rugi bersih`, detail: "7 hari terakhir", href: "/transaksi-digiflazz?margin=1", tone: "rose" });
  if (a.ppobBelowTargetWeek > 0)
    items.push({ key: "ppob-low", label: `${a.ppobBelowTargetWeek} transaksi PPOB di bawah target untung`, detail: "7 hari terakhir", href: "/transaksi-digiflazz?margin=1", tone: "amber" });
  if (a.withdrawalsPending > 0)
    items.push({ key: "wd", label: `${a.withdrawalsPending} penarikan menunggu`, detail: formatRupiah(a.withdrawalsPendingAmount), href: "/penarikan?status=PENDING", tone: "amber" });
  if (a.memberRequestsAwaiting > 0) items.push({ key: "member", label: `${a.memberRequestsAwaiting} pengajuan member menunggu verifikasi`, href: "/member-requests", tone: "amber" });
  if (a.driverApplicationsPending > 0) items.push({ key: "driver", label: `${a.driverApplicationsPending} pendaftaran pengemudi menunggu`, href: "/driver-documents", tone: "sky" });
  if (a.overdueOnlinePayments > 0) items.push({ key: "pay", label: `${a.overdueOnlinePayments} pembayaran online lewat batas`, href: "/pembayaran-online", tone: "sky" });
  if (a.lowRatingsThisWeek > 0) items.push({ key: "rating", label: `${a.lowRatingsThisWeek} penilaian 1–2 bintang minggu ini`, href: "#ulasan", tone: "rose" });
  if (a.openSupportTickets > 0) items.push({ key: "ticket", label: `${a.openSupportTickets} tiket bantuan terbuka`, tone: "sky" });
  return items;
}

const TONE_CLASS: Record<AttentionItem["tone"], string> = {
  rose: "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100",
  amber: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
  sky: "border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100"
};

export default function VipInsightsView() {
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod("month"));
  const range = useMemo(() => periodQuery(period), [period]);
  const [data, setData] = useState<VipInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [regionView, setRegionView] = useState<RegionView>("members");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getVipInsights(range));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wawasan belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    let lastRunAt = Date.now();
    void load();
    const run = () => {
      lastRunAt = Date.now();
      void load();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRunAt >= MIN_GAP_MS) run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const { labels, bucket } = data.period;
    return labels.map((label, index) => ({
      label,
      members: data.series.registrations.members[index] ?? 0,
      drivers: data.series.registrations.drivers[index] ?? 0,
      membership: data.series.revenue.membership[index] ?? 0,
      ppobMargin: data.series.revenue.ppobMargin[index] ?? 0,
      rideCommission: data.series.revenue.rideCommission[index] ?? 0,
      ridesTotal: data.series.rides.total[index] ?? 0,
      ridesCompleted: data.series.rides.completed[index] ?? 0,
      text: bucketText(label, bucket)
    }));
  }, [data]);

  const bucket = data?.period.bucket ?? "day";
  const axisProps = { tick: { fontSize: 11, fill: PALETTE.axis }, tickLine: false, axisLine: false } as const;
  const labelFormat = (label: string) => bucketText(label, bucket, true);
  const attention = data ? attentionItems(data) : [];

  return (
    <div className="space-y-6" data-testid="vip-insights">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-navy via-brand-navySoft to-[#0B4A8F] p-5 text-white shadow-lg sm:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand-cyan/25 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-brand-gold/15 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-brand-gold">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
                Pusat kendali · Super Admin VIP
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">TapGo dalam satu layar</h2>
              <p className="mt-1 text-sm text-slate-300">
                Periode {periodLabel(period.mode, period.anchor)}
                {data ? ` · ${data.totals.members.toLocaleString("id-ID")} member, ${data.totals.driversActive.toLocaleString("id-ID")} pengemudi aktif` : ""}
              </p>
            </div>
            <PeriodFilter value={period} onChange={setPeriod} disabled={loading && !data} tone="dark" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiTile
              label="Pendaftar baru"
              value={data ? number(data.totals.registrations.current) : "—"}
              sub={data ? `${number(sum(data.series.registrations.members))} member · ${number(sum(data.series.registrations.drivers))} pengemudi` : ""}
              delta={data?.totals.registrations}
              spark={rows.map((row) => row.members + row.drivers)}
              color={PALETTE.cyan}
            />
            <KpiTile
              label="Pendapatan kotor"
              value={data ? compactRupiah(data.totals.revenue.current) : "—"}
              sub="upgrade + selisih PPOB + komisi ojek"
              delta={data?.totals.revenue}
              spark={rows.map((row) => row.membership + row.ppobMargin + row.rideCommission)}
              color={PALETTE.gold}
            />
            <KpiTile
              label="Perjalanan selesai"
              value={data ? number(data.totals.ridesCompleted.current) : "—"}
              sub={data?.rides.completionRate != null ? `${data.rides.completionRate.toLocaleString("id-ID")}% dari ${number(data.rides.total)} pesanan` : "belum ada pesanan"}
              delta={data?.totals.ridesCompleted}
              spark={rows.map((row) => row.ridesCompleted)}
              color="#34D399"
            />
            <div className="rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Rating pengemudi</p>
              <p className="mt-2 text-3xl font-black tabular-nums">{data?.totals.rating.average != null ? data.totals.rating.average.toLocaleString("id-ID") : "—"}</p>
              <div className="mt-1">{data?.totals.rating.average != null ? <Stars value={data.totals.rating.average} size={17} /> : null}</div>
              <p className="mt-2 text-xs text-slate-300">{data ? `${number(data.totals.rating.count)} penilaian sepanjang waktu` : ""}</p>
            </div>
            <div className="rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Pengemudi online</p>
              <p className="mt-2 text-3xl font-black tabular-nums">
                {data ? number(data.totals.driversOnline) : "—"}
                <span className="ml-1 text-base font-bold text-slate-400">/ {data ? number(data.totals.driversActive) : "—"}</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-emerald-400"
                  style={{ width: `${data && data.totals.driversActive > 0 ? Math.round((data.totals.driversOnline / data.totals.driversActive) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-300">aktif = sudah lolos verifikasi</p>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {!data && loading ? <p className="text-sm text-slate-500">Memuat wawasan…</p> : null}

      {data ? (
        <>
          {/* Perlu perhatian */}
          <section aria-label="Perlu perhatian" className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm" data-testid="attention">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-2 text-sm font-black text-slate-900">Perlu perhatian</h2>
              {attention.length === 0 ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Semua terkendali, tidak ada yang menunggu</span>
              ) : (
                attention.map((item) => {
                  const body = (
                    <>
                      <span className="font-bold">{item.label}</span>
                      {item.detail ? <span className="ml-1.5 opacity-70">{item.detail}</span> : null}
                    </>
                  );
                  const className = `rounded-full border px-3 py-1 text-xs transition ${TONE_CLASS[item.tone]}`;
                  return item.href ? (
                    item.href.startsWith("#") ? (
                      <a key={item.key} href={item.href} className={className}>
                        {body}
                      </a>
                    ) : (
                      <Link key={item.key} href={item.href} className={className}>
                        {body}
                      </Link>
                    )
                  ) : (
                    <span key={item.key} className={className.replace("hover:bg-sky-100", "")}>
                      {body}
                    </span>
                  );
                })
              )}
            </div>
          </section>

          {/* Pertumbuhan dan pendapatan */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Pertumbuhan pendaftar" subtitle="Member dan pengemudi baru per waktu">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="g-members" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PALETTE.blue} stopOpacity={0.5} />
                        <stop offset="100%" stopColor={PALETTE.blue} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="g-drivers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PALETTE.gold} stopOpacity={0.6} />
                        <stop offset="100%" stopColor={PALETTE.gold} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
                    <XAxis dataKey="label" tickFormatter={(value: string) => bucketText(value, bucket)} minTickGap={28} {...axisProps} />
                    <YAxis allowDecimals={false} {...axisProps} />
                    <Tooltip content={<ChartTooltip format={(value) => number(value)} labelFormat={labelFormat} />} />
                    <Area type="monotone" dataKey="members" name="Member" stackId="a" stroke={PALETTE.blue} strokeWidth={2} fill="url(#g-members)" />
                    <Area type="monotone" dataKey="drivers" name="Pengemudi" stackId="a" stroke={PALETTE.amber} strokeWidth={2} fill="url(#g-drivers)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <Legend items={[{ label: "Member", color: PALETTE.blue }, { label: "Pengemudi", color: PALETTE.gold }]} />
            </Panel>

            <Panel title="Pendapatan kotor" subtitle="Belum dikurangi PPN dan biaya; angka akuntansi ada di Laba Rugi">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
                    <XAxis dataKey="label" tickFormatter={(value: string) => bucketText(value, bucket)} minTickGap={28} {...axisProps} />
                    <YAxis tickFormatter={(value: number) => compactRupiah(value).replace("Rp", "")} {...axisProps} />
                    <Tooltip cursor={{ fill: "rgba(8,119,232,0.06)" }} content={<ChartTooltip format={(value) => formatRupiah(value)} labelFormat={labelFormat} />} />
                    <Bar dataKey="membership" name="Upgrade membership" stackId="r" fill={PALETTE.blue} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="ppobMargin" name="Selisih PPOB" stackId="r" fill={PALETTE.cyan} />
                    <Bar dataKey="rideCommission" name="Komisi ojek" stackId="r" fill={PALETTE.gold} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <Metric color={PALETTE.blue} label="Upgrade" value={compactRupiah(data.revenueBreakdown.membership)} />
                <Metric color={PALETTE.cyan} label="Selisih PPOB" value={compactRupiah(data.revenueBreakdown.ppobMargin)} />
                <Metric color={PALETTE.gold} label="Komisi ojek" value={compactRupiah(data.revenueBreakdown.rideCommission)} />
              </dl>
              {data.revenueBreakdown.ppobWithoutCost > 0 ? (
                <p className="mt-2 text-[11px] text-amber-700">{data.revenueBreakdown.ppobWithoutCost} transaksi PPOB belum punya modal tercatat, selisihnya belum terhitung.</p>
              ) : null}
            </Panel>
          </div>

          {/* Perjalanan */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="lg:col-span-2" title="Aktivitas perjalanan" subtitle="Pesanan masuk dibanding yang selesai">
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="g-rides" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PALETTE.cyan} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={PALETTE.cyan} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="g-done" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PALETTE.emerald} stopOpacity={0.55} />
                        <stop offset="100%" stopColor={PALETTE.emerald} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
                    <XAxis dataKey="label" tickFormatter={(value: string) => bucketText(value, bucket)} minTickGap={28} {...axisProps} />
                    <YAxis allowDecimals={false} {...axisProps} />
                    <Tooltip content={<ChartTooltip format={(value) => number(value)} labelFormat={labelFormat} />} />
                    <Area type="monotone" dataKey="ridesTotal" name="Pesanan masuk" stroke={PALETTE.cyan} strokeWidth={2} fill="url(#g-rides)" />
                    <Area type="monotone" dataKey="ridesCompleted" name="Selesai" stroke={PALETTE.emerald} strokeWidth={2} fill="url(#g-done)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Metric color={PALETTE.cyan} label="Pesanan" value={number(data.rides.total)} />
                <Metric color={PALETTE.emerald} label="Selesai" value={number(data.rides.completed)} />
                <Metric color={PALETTE.rose} label="Dibatalkan" value={number(data.rides.cancelled)} />
                <Metric color={PALETTE.blue} label="Tingkat selesai" value={data.rides.completionRate != null ? `${data.rides.completionRate.toLocaleString("id-ID")}%` : "—"} />
              </dl>
            </Panel>

            <Panel title="Status pesanan" subtitle="Seluruh pesanan pada periode ini">
              <Donut
                centerValue={number(data.rides.total)}
                centerLabel="pesanan"
                data={rideStatusSlices(data)}
              />
              <h3 className="mt-5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Jenis layanan</h3>
              <div className="mt-2">
                <HBars
                  items={data.composition.rideServices.map((row) => ({ name: SERVICE_LABEL[row.type] ?? row.type, count: row.count }))}
                  color={PALETTE.blue}
                  total={data.rides.total}
                  empty="Belum ada pesanan."
                />
              </div>
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="lg:col-span-2" title="Jam sibuk" subtitle="Pesanan menurut hari dan jam (WIB) pada periode ini">
              {data.rides.total === 0 ? <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Belum ada pesanan pada periode ini.</p> : <Heatmap matrix={data.rides.heatmap} />}
            </Panel>
            <Panel title="Paket member" subtitle="Member aktif saat ini">
              <Donut
                centerValue={number(sum(data.composition.tiers.map((row) => row.count)))}
                centerLabel="member"
                data={data.composition.tiers.map((row) => ({ label: row.tier.charAt(0) + row.tier.slice(1).toLowerCase(), value: row.count, color: TIER_COLOR[row.tier] ?? PALETTE.slate }))}
              />
            </Panel>
          </div>

          {/* Wilayah dan sumber pendaftaran */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title="Sebaran wilayah"
              subtitle="Dibaca dari alamat yang diketik, jadi perkiraan"
              action={
                <div className="flex flex-wrap gap-1" role="tablist" aria-label="Sumber wilayah">
                  {REGION_VIEWS.map((view) => (
                    <button
                      key={view.id}
                      type="button"
                      role="tab"
                      aria-selected={regionView === view.id}
                      onClick={() => setRegionView(view.id)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${regionView === view.id ? "bg-brand-navy text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>
              }
            >
              <RegionPanel data={data} view={regionView} />
            </Panel>

            <Panel title="Sumber pendaftaran" subtitle="Dari mana akun baru mendaftar pada periode ini">
              <Donut
                centerValue={number(sum(Object.values(data.composition.signupSources)))}
                centerLabel="pendaftar"
                data={[
                  { label: "Google Play", value: data.composition.signupSources.play, color: PALETTE.emerald },
                  { label: "Di luar Play (APK)", value: data.composition.signupSources.other, color: PALETTE.gold },
                  { label: "Tidak diketahui", value: data.composition.signupSources.unknown, color: "#CBD5E1" }
                ]}
              />
              <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-500">
                Lokasi pengunduhan aplikasi tidak tersimpan di sistem TapGo; hanya Google Play Console yang memilikinya (Statistik › Pengguna › Negara/wilayah).
              </p>
            </Panel>
          </div>

          {/* Usia pengemudi */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Panel className="lg:col-span-2" title="Usia pengemudi" subtitle="Dari tanggal lahir pada data pengajuan pengemudi">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.driverAges.buckets} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis allowDecimals={false} {...axisProps} />
                    <Tooltip cursor={{ fill: "rgba(8,119,232,0.06)" }} content={<ChartTooltip format={(value) => `${number(value)} pengemudi`} labelFormat={(label) => `Usia ${label}`} />} />
                    <Bar dataKey="count" name="Pengemudi" radius={[6, 6, 0, 0]}>
                      {data.driverAges.buckets.map((bracket, index) => (
                        <Cell key={bracket.label} fill={[PALETTE.cyan, PALETTE.blue, "#3B82F6", PALETTE.violet, PALETTE.gold, PALETTE.amber, "#FB923C"][index] ?? PALETTE.blue} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Metric color={PALETTE.blue} label="Rata-rata usia" value={data.driverAges.average != null ? `${data.driverAges.average.toLocaleString("id-ID")} th` : "—"} />
                <Metric color={PALETTE.cyan} label="Termuda" value={data.driverAges.youngest != null ? `${data.driverAges.youngest} th` : "—"} />
                <Metric color={PALETTE.gold} label="Tertua" value={data.driverAges.oldest != null ? `${data.driverAges.oldest} th` : "—"} />
                <Metric color="#CBD5E1" label="Belum ada tanggal lahir" value={number(data.driverAges.unknown)} />
              </dl>
            </Panel>
            <Panel title="Status pengemudi" subtitle="Seluruh pendaftar pengemudi">
              <Donut
                centerValue={number(data.totals.drivers)}
                centerLabel="pengemudi"
                data={driverStatusSlices(data)}
              />
              <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-500">Usia member dan penumpang tidak dikumpulkan aplikasi, jadi belum dapat ditampilkan.</p>
            </Panel>
          </div>

          {/* Rating dan ulasan */}
          <div className="grid gap-6 lg:grid-cols-3" id="ulasan">
            <Panel title="Penilaian penumpang" subtitle="Bintang untuk pengemudi, periode ini">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-5xl font-black tabular-nums text-slate-900">{data.ratings.periodAverage != null ? data.ratings.periodAverage.toLocaleString("id-ID") : "—"}</p>
                  {data.ratings.periodAverage != null ? <Stars value={data.ratings.periodAverage} size={18} /> : null}
                  <p className="mt-1 text-xs text-slate-500">{number(data.ratings.periodCount)} penilaian</p>
                </div>
                <ul className="min-w-0 flex-1 space-y-1.5">
                  {[...data.ratings.distribution].reverse().map((row) => (
                    <li key={row.stars} className="flex items-center gap-2 text-xs">
                      <span className="w-6 shrink-0 font-bold tabular-nums text-slate-600">{row.stars}★</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${data.ratings.periodCount > 0 ? Math.max(row.count > 0 ? 4 : 0, (row.count / data.ratings.periodCount) * 100) : 0}%`, backgroundColor: STAR_COLOR[row.stars] }}
                        />
                      </span>
                      <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-slate-500">{row.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {data.ratings.periodCount === 0 ? <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">Belum ada penilaian pada periode ini.</p> : null}
            </Panel>

            <Panel title="Pengemudi" subtitle="Rata-rata seumur hidup, minimal 3 penilaian">
              <DriverList title="Terbaik" tone="emerald" drivers={data.ratings.topDrivers} empty="Belum ada pengemudi dengan 3 penilaian." />
              <div className="mt-5">
                <DriverList title="Perlu perhatian (di bawah 4,0)" tone="rose" drivers={data.ratings.attentionDrivers} empty="Tidak ada pengemudi di bawah 4,0." />
              </div>
            </Panel>

            <Panel title="Ulasan terbaru" subtitle="Komentar penumpang pada penilaian">
              {data.ratings.recent.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Belum ada ulasan bertulis.</p>
              ) : (
                <ul className="max-h-96 space-y-3 overflow-y-auto pr-1">
                  {data.ratings.recent.map((review, index) => (
                    <li
                      key={`${review.createdAt}-${index}`}
                      className={`rounded-xl border p-3 ${review.stars <= 2 ? "border-rose-200 bg-rose-50/60" : review.stars === 3 ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50/70"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Stars value={review.stars} size={14} />
                        <span className="text-[11px] text-slate-400">{ago(review.createdAt)}</span>
                      </div>
                      <p className="mt-1.5 text-sm leading-5 text-slate-800">“{review.note}”</p>
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        {review.passengerName} menilai <span className="font-semibold text-slate-700">{review.driverName}</span> · {SERVICE_LABEL[review.service] ?? review.service}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] leading-4 text-slate-400">Aplikasi hanya memuat penilaian penumpang untuk pengemudi; belum ada penilaian pengemudi untuk penumpang.</p>
            </Panel>
          </div>

          <aside className="rounded-2xl bg-slate-50 px-5 py-4 text-xs leading-6 text-slate-500">
            <p className="font-bold text-slate-600">Catatan data</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {data.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </aside>
        </>
      ) : null}
    </div>
  );
}

function rideStatusSlices(data: VipInsights): DonutSlice[] {
  const by = (statuses: string[]) => data.composition.rideStatus.filter((row) => statuses.includes(row.status)).reduce((total, row) => total + row.count, 0);
  const known = ["COMPLETED", "CANCELLED_BY_PASSENGER", "CANCELLED_BY_DRIVER", "CANCELLED_BY_SYSTEM", "NO_DRIVER", "EXPIRED"];
  const other = data.composition.rideStatus.filter((row) => !known.includes(row.status)).reduce((total, row) => total + row.count, 0);
  return [
    { label: RIDE_STATUS_LABEL.COMPLETED!, value: by(["COMPLETED"]), color: PALETTE.emerald },
    { label: "Dibatalkan", value: by(["CANCELLED_BY_PASSENGER", "CANCELLED_BY_DRIVER", "CANCELLED_BY_SYSTEM"]), color: PALETTE.rose },
    { label: "Tanpa pengemudi", value: by(["NO_DRIVER", "EXPIRED"]), color: PALETTE.amber },
    { label: "Sedang diproses", value: other, color: PALETTE.cyan }
  ];
}

const DRIVER_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: "Aktif", color: PALETTE.emerald },
  PENDING: { label: "Menunggu verifikasi", color: PALETTE.amber },
  SUSPENDED: { label: "Ditangguhkan", color: PALETTE.rose },
  REJECTED: { label: "Ditolak", color: "#94A3B8" }
};

function driverStatusSlices(data: VipInsights): DonutSlice[] {
  return data.composition.driverStatus.map((row) => ({
    label: DRIVER_STATUS_LABEL[row.status]?.label ?? row.status,
    value: row.count,
    color: DRIVER_STATUS_LABEL[row.status]?.color ?? PALETTE.slate
  }));
}

function RegionPanel({ data, view }: { data: VipInsights; view: RegionView }) {
  const meta = REGION_VIEWS.find((item) => item.id === view)!;
  const tally = data.regions[view];
  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        {meta.hint}. {number(tally.total)} alamat dibaca{tally.unreadable > 0 ? `, ${number(tally.unreadable)} tanpa nama kota yang jelas` : ""}.
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Kota / kabupaten teratas</h3>
          <HBars items={tally.cities} color={meta.color} total={tally.total} empty="Belum ada alamat yang bisa dibaca." />
        </div>
        <div>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Provinsi</h3>
          <HBars items={tally.provinces} color={PALETTE.navySoft} total={tally.total} empty="Alamat belum memuat nama provinsi." />
        </div>
      </div>
    </div>
  );
}

function DriverList({ title, tone, drivers, empty }: { title: string; tone: "emerald" | "rose"; drivers: Array<{ name: string; average: number; count: number }>; empty: string }) {
  return (
    <div>
      <h3 className={`text-[11px] font-bold uppercase tracking-wider ${tone === "emerald" ? "text-emerald-600" : "text-rose-600"}`}>{title}</h3>
      {drivers.length === 0 ? (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {drivers.map((driver) => (
            <li key={driver.name} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-semibold text-slate-800">{driver.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Stars value={driver.average} size={12} />
                <span className="w-8 text-right text-xs font-black tabular-nums text-slate-900">{driver.average.toLocaleString("id-ID")}</span>
                <span className="w-12 text-right text-[11px] text-slate-400">({driver.count})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  delta,
  spark,
  color
}: {
  label: string;
  value: string;
  sub: string;
  delta?: { current: number; previous: number };
  spark: number[];
  color: string;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{label}</p>
        {delta ? <DeltaChip current={delta.current} previous={delta.previous} onDark /> : null}
      </div>
      {/* Angka panjang (mis. Rp1.234,5 jt) mengecil agar tidak melebar keluar kartu. */}
      <p className={`mt-2 font-black tabular-nums ${value.length > 9 ? "text-2xl" : "text-3xl"}`}>{value}</p>
      <p className="mt-0.5 min-h-[1rem] text-xs text-slate-300">{sub}</p>
      <div className="mt-2">
        <Sparkline values={spark.length > 1 ? spark : [0, 0]} color={color} />
      </div>
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-black tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
