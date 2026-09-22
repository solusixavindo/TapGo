"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Commission, MITRA_PREVIEW, getCommissions } from "./mitra-api";
import {
  COMMISSION_LABELS,
  formatCompactRupiah,
  formatDate,
  formatRupiah,
  tierLabel
} from "./mitra-format";
import { PREVIEW_COMMISSIONS } from "./mitra-preview";
import { useMitra } from "./mitra-data";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Icon,
  PageHeading,
  Skeleton,
  primaryButtonClass,
  secondaryButtonClass,
  usePagedList
} from "./mitra-ui";
import type { ViewId } from "./mitra-nav";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const CHART_MONTHS = 6;
const SAMPLE_SIZE = 50;

function monthKey(date: Date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function buildSeries(commissions: Commission[]) {
  const now = new Date();
  const current = monthKey(now);
  const buckets = Array.from({ length: CHART_MONTHS }, (_, index) => {
    const key = current - (CHART_MONTHS - 1 - index);
    return { key, label: MONTHS[((key % 12) + 12) % 12] ?? "", value: 0 };
  });
  for (const item of commissions) {
    if (item.status !== "POSTED" && item.status !== "PAID") continue;
    const date = new Date(item.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const bucket = buckets.find((entry) => entry.key === monthKey(date));
    if (bucket) bucket.value += item.amount;
  }
  return buckets;
}

function CommissionChart({ series }: { series: ReturnType<typeof buildSeries> }) {
  const max = Math.max(...series.map((entry) => entry.value), 1);
  const lastIndex = series.length - 1;
  return (
    <div>
      <div className="flex h-44 items-end gap-2 sm:gap-3" role="img" aria-label="Grafik komisi enam bulan terakhir">
        {series.map((entry, index) => {
          const height = entry.value === 0 ? 4 : Math.max((entry.value / max) * 100, 6);
          return (
            <div key={entry.key} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
              <span className="m-num text-[11px] font-bold themed-text-muted">
                {entry.value > 0 ? formatCompactRupiah(entry.value) : ""}
              </span>
              <div
                className="m-bar w-full rounded-t-lg"
                data-active={index === lastIndex}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2 border-t themed-border pt-2 sm:gap-3">
        {series.map((entry) => (
          <span key={entry.key} className="min-w-0 flex-1 text-center text-[11px] font-semibold themed-text-muted">
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function OverviewView({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { core } = useMitra();
  const commissions = usePagedList<Commission>(
    (page, size) =>
      MITRA_PREVIEW ? Promise.resolve(PREVIEW_COMMISSIONS) : getCommissions(page, size),
    SAMPLE_SIZE
  );
  const series = useMemo(() => buildSeries(commissions.items), [commissions.items]);

  if (!core) return null;
  const { wallet, summary, profile, withdrawals } = core;
  const pending = withdrawals.filter((item) => item.status === "PENDING" || item.status === "APPROVED");
  const pendingTotal = pending.reduce((sum, item) => sum + item.amount, 0);
  const recent = commissions.items.slice(0, 5);
  const windowStart = new Date();
  windowStart.setMonth(windowStart.getMonth() - (CHART_MONTHS - 1), 1);
  windowStart.setHours(0, 0, 0, 0);
  const oldest = commissions.items[commissions.items.length - 1];
  const partial =
    commissions.hasMore && oldest !== undefined && new Date(oldest.createdAt).getTime() > windowStart.getTime();

  return (
    <div className="space-y-6">
      <PageHeading
        title={`Halo, ${profile.fullName.split(" ")[0] ?? "Mitra"}`}
        description="Ringkasan saldo, komisi, dan perkembangan referral Anda."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="m-hero relative overflow-hidden rounded-2xl p-6 lg:col-span-2 md:p-7">
          <p className="m-hero-muted text-xs font-bold uppercase tracking-wider">Saldo dapat ditarik</p>
          <p className="m-num mt-2 text-4xl font-black tracking-tight md:text-5xl">
            {formatRupiah(wallet.cashBalance)}
          </p>
          {pendingTotal > 0 ? (
            <p className="m-hero-muted mt-2 text-sm">
              <Icon name="clock" className="mr-1 inline h-4 w-4 align-[-3px]" />
              {formatRupiah(pendingTotal)} sedang diproses
            </p>
          ) : (
            <p className="m-hero-muted mt-2 text-sm">Tidak ada penarikan yang sedang diproses.</p>
          )}
          <div className="m-hero-line mt-6 flex flex-wrap items-center gap-3 border-t pt-5">
            <button type="button" onClick={() => onNavigate("withdraw")} className={primaryButtonClass}>
              <Icon name="arrowUp" className="h-4 w-4" />
              Tarik dana
            </button>
            <button
              type="button"
              onClick={() => onNavigate("wallet")}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/25 px-5 text-sm font-bold text-white transition hover:bg-white/10"
            >
              Lihat dompet
            </button>
            <div className="m-hero-muted ml-auto text-right text-xs">
              <p>Saldo PPOB</p>
              <p className="m-num text-sm font-bold text-white">{formatRupiah(wallet.ppobBalance)}</p>
            </div>
          </div>
        </div>

        <Card className="flex flex-col justify-between p-5 md:p-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Paket keanggotaan</p>
            <div className="mt-2 flex items-center gap-2">
              <p className="text-2xl font-black themed-text">{tierLabel(summary.membershipTier)}</p>
              <Badge tone="green">Aktif</Badge>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-2 rounded-xl themed-fill px-3 py-2.5">
              <p className="min-w-0 flex-1 truncate text-sm font-bold themed-text">{summary.referralCode}</p>
              <span className="text-[11px] themed-text-muted">Kode referral</span>
            </div>
            <Link href="/upgrade" className={`${secondaryButtonClass} w-full`}>
              Kelola paket
              <Icon name="external" className="h-4 w-4" />
            </Link>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Total komisi", value: formatRupiah(summary.totalCommission), icon: "coins" as const },
          { label: "Referral langsung", value: String(summary.directDownlines), icon: "users" as const },
          { label: "Total referral", value: String(summary.totalDownlines), icon: "users" as const },
          { label: "Saldo total", value: formatRupiah(wallet.balance), icon: "wallet" as const }
        ].map((item) => (
          <Card key={item.label} as="div" className="p-4 md:p-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">{item.label}</p>
              <Icon name={item.icon} className="h-4 w-4 themed-text-muted" />
            </div>
            <p className="m-num mt-2 truncate text-xl font-black themed-text md:text-2xl">{item.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Komisi per bulan" subtitle="Enam bulan terakhir, hanya komisi yang sudah masuk saldo" />
          <div className="p-5 md:p-6">
            {commissions.loading ? (
              <Skeleton className="h-44 w-full" />
            ) : commissions.error ? (
              <ErrorState message={commissions.error} onRetry={commissions.reload} />
            ) : (
              <>
                <CommissionChart series={series} />
                {partial ? (
                  <p className="mt-3 text-xs themed-text-muted">
                    Berdasarkan {SAMPLE_SIZE} komisi terbaru. Riwayat lengkap ada di menu Komisi.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Komisi terbaru"
            action={
              <button
                type="button"
                onClick={() => onNavigate("commission")}
                className="text-xs font-bold text-[var(--themed-accent-gold)] hover:underline"
              >
                Lihat semua
              </button>
            }
          />
          {commissions.loading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState icon="coins" title="Belum ada komisi">
              Komisi tercatat di sini saat referral Anda melakukan transaksi yang memenuhi syarat.
            </EmptyState>
          ) : (
            <ul className="divide-y m-divide">
              {recent.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3.5 md:px-6">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold themed-text">
                      {COMMISSION_LABELS[item.type] ?? item.type}
                    </p>
                    <p className="text-xs themed-text-muted">{formatDate(item.createdAt)}</p>
                  </div>
                  <p className="m-num shrink-0 text-sm font-black m-text-green">+{formatRupiah(item.amount)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
