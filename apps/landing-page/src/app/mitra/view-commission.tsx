"use client";

import { useState } from "react";
import { Commission, MITRA_PREVIEW, getCommissions } from "./mitra-api";
import {
  COMMISSION_LABELS,
  COMMISSION_STATUS_LABELS,
  formatDate,
  formatRupiah
} from "./mitra-format";
import { PREVIEW_COMMISSIONS } from "./mitra-preview";
import { useMitra } from "./mitra-data";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeading,
  Skeleton,
  Spinner,
  Tone,
  secondaryButtonClass,
  usePagedList
} from "./mitra-ui";

type Filter = "ALL" | "POSTED" | "PENDING" | "REVERSED";
const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: "ALL", label: "Semua" },
  { id: "POSTED", label: "Masuk saldo" },
  { id: "PENDING", label: "Menunggu" },
  { id: "REVERSED", label: "Dibatalkan" }
];

function statusTone(status: string): Tone {
  if (status === "POSTED" || status === "PAID") return "green";
  if (status === "PENDING") return "amber";
  if (status === "REVERSED") return "red";
  return "slate";
}

export default function CommissionView() {
  const { core } = useMitra();
  const [filter, setFilter] = useState<Filter>("ALL");
  const list = usePagedList<Commission>(
    (page, size) => (MITRA_PREVIEW ? Promise.resolve(PREVIEW_COMMISSIONS) : getCommissions(page, size)),
    30
  );
  if (!core) return null;

  const visible = list.items.filter((item) =>
    filter === "ALL" ? true : filter === "POSTED" ? item.status === "POSTED" || item.status === "PAID" : item.status === filter
  );
  const posted = list.items
    .filter((item) => item.status === "POSTED" || item.status === "PAID")
    .reduce((sum, item) => sum + item.amount, 0);
  const pending = list.items.filter((item) => item.status === "PENDING").reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeading title="Komisi" description="Riwayat bonus referral, reward, dan bagi hasil." />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card as="div" className="p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Total komisi</p>
          <p className="m-num mt-2 text-2xl font-black text-[var(--themed-accent-gold)]">
            {formatRupiah(core.summary.totalCommission)}
          </p>
          <p className="mt-1 text-xs themed-text-muted">Sejak bergabung</p>
        </Card>
        <Card as="div" className="p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Sudah masuk saldo</p>
          <p className="m-num mt-2 text-2xl font-black themed-text">{formatRupiah(posted)}</p>
          <p className="mt-1 text-xs themed-text-muted">Dari riwayat yang dimuat</p>
        </Card>
        <Card as="div" className="p-5">
          <p className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Menunggu</p>
          <p className="m-num mt-2 text-2xl font-black themed-text">{formatRupiah(pending)}</p>
          <p className="mt-1 text-xs themed-text-muted">Belum masuk saldo</p>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Riwayat komisi"
          action={
            <div className="flex max-w-full flex-wrap rounded-xl themed-fill p-1" role="tablist" aria-label="Filter status">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    filter === item.id ? "bg-brand-gold text-brand-navyDeep shadow-sm" : "themed-text-muted"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          }
        />
        {list.loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : list.error && list.items.length === 0 ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : visible.length === 0 ? (
          <EmptyState icon="coins" title="Belum ada komisi">
            {filter === "ALL"
              ? "Komisi tercatat di sini setiap kali referral Anda melakukan transaksi yang memenuhi syarat."
              : "Tidak ada komisi dengan status ini."}
          </EmptyState>
        ) : (
          <>
            <div className="hidden grid-cols-[1.4fr_0.6fr_1fr_1fr_1fr] gap-4 border-b themed-border px-6 py-2.5 text-[11px] font-bold uppercase tracking-wider themed-text-muted md:grid">
              <span>Jenis</span>
              <span>Tingkat</span>
              <span>Tanggal</span>
              <span>Status</span>
              <span className="text-right">Jumlah</span>
            </div>
            <ul className="divide-y m-divide">
              {visible.map((item) => (
                <li
                  key={item.id}
                  className="grid grid-cols-2 items-center gap-x-4 gap-y-1 px-5 py-3.5 md:grid-cols-[1.4fr_0.6fr_1fr_1fr_1fr] md:px-6"
                >
                  <p className="text-sm font-bold themed-text">{COMMISSION_LABELS[item.type] ?? item.type}</p>
                  <p className="order-3 text-xs themed-text-muted md:order-none md:text-sm">
                    {item.level > 0 ? `Tingkat ${item.level}` : "-"}
                  </p>
                  <p className="order-4 text-xs themed-text-muted md:order-none md:text-sm">{formatDate(item.createdAt)}</p>
                  <div className="order-5 md:order-none">
                    <Badge tone={statusTone(item.status)}>{COMMISSION_STATUS_LABELS[item.status] ?? item.status}</Badge>
                  </div>
                  <p
                    className={`m-num order-2 text-right text-sm font-black md:order-none ${
                      item.status === "REVERSED" ? "themed-text-muted line-through" : "m-text-green"
                    }`}
                  >
                    +{formatRupiah(item.amount)}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
        {list.hasMore ? (
          <div className="border-t themed-border p-4">
            <button
              type="button"
              onClick={list.loadMore}
              disabled={list.loadingMore}
              className={`${secondaryButtonClass} w-full`}
            >
              {list.loadingMore ? <Spinner /> : null}
              {list.loadingMore ? "Memuat…" : "Muat lebih banyak"}
            </button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
