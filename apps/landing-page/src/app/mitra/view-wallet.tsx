"use client";

import Link from "next/link";
import { useState } from "react";
import { MITRA_PREVIEW, WalletTransaction, getWalletTransactions } from "./mitra-api";
import { formatDateTime, formatRupiah, walletTypeLabel } from "./mitra-format";
import { PREVIEW_TRANSACTIONS } from "./mitra-preview";
import { useMitra } from "./mitra-data";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Icon,
  PageHeading,
  Skeleton,
  Spinner,
  primaryButtonClass,
  secondaryButtonClass,
  usePagedList
} from "./mitra-ui";
import type { ViewId } from "./mitra-nav";

type Filter = "all" | "in" | "out";
const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: "all", label: "Semua" },
  { id: "in", label: "Masuk" },
  { id: "out", label: "Keluar" }
];

export default function WalletView({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { core } = useMitra();
  const [filter, setFilter] = useState<Filter>("all");
  const list = usePagedList<WalletTransaction>(
    (page, size) => (MITRA_PREVIEW ? Promise.resolve(PREVIEW_TRANSACTIONS) : getWalletTransactions(page, size)),
    20
  );
  if (!core) return null;
  const { wallet } = core;

  const visible = list.items.filter((item) =>
    filter === "all" ? true : filter === "in" ? item.amount > 0 : item.amount < 0
  );

  return (
    <div className="space-y-6">
      <PageHeading
        title="Dompet"
        description="Saldo TapGoPay dan seluruh mutasi masuk dan keluar."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/topup" className={secondaryButtonClass}>
              <Icon name="plus" className="h-4 w-4" />
              Top up
            </Link>
            <button type="button" onClick={() => onNavigate("withdraw")} className={primaryButtonClass}>
              <Icon name="arrowUp" className="h-4 w-4" />
              Tarik dana
            </button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Saldo dapat ditarik", value: wallet.cashBalance, hint: "Komisi dan bonus tunai", strong: true },
          { label: "Saldo PPOB", value: wallet.ppobBalance, hint: "Untuk pulsa, tagihan, dan layanan digital" },
          { label: "Saldo total", value: wallet.balance, hint: "Gabungan seluruh saldo" }
        ].map((item) => (
          <Card key={item.label} as="div" className="p-5">
            <p className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">{item.label}</p>
            <p
              className={`m-num mt-2 text-2xl font-black ${item.strong ? "text-[var(--themed-accent-gold)]" : "themed-text"}`}
            >
              {formatRupiah(item.value)}
            </p>
            <p className="mt-1 text-xs themed-text-muted">{item.hint}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Mutasi saldo"
          action={
            <div className="flex rounded-xl themed-fill p-1" role="tablist" aria-label="Filter mutasi">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                    filter === item.id ? "bg-brand-gold text-brand-navyDeep shadow-sm" : "themed-text-muted hover:themed-text"
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
          <EmptyState icon="wallet" title={filter === "all" ? "Belum ada mutasi" : "Tidak ada mutasi pada filter ini"}>
            {filter === "all"
              ? "Mutasi saldo akan muncul di sini setelah ada transaksi."
              : "Coba ganti filter untuk melihat mutasi lainnya."}
          </EmptyState>
        ) : (
          <ul className="divide-y m-divide">
            {visible.map((item) => {
              const incoming = item.amount > 0;
              return (
                <li key={item.id} className="flex items-center gap-4 px-5 py-3.5 md:px-6">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${incoming ? "m-tone-green" : "m-tone-red"}`}
                  >
                    <Icon name={incoming ? "arrowDown" : "arrowUp"} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold themed-text">{walletTypeLabel(item.type)}</p>
                    <p className="text-xs themed-text-muted">{formatDateTime(item.createdAt)}</p>
                  </div>
                  <p className={`m-num shrink-0 text-sm font-black ${incoming ? "m-text-green" : "themed-text"}`}>
                    {incoming ? "+" : ""}
                    {formatRupiah(item.amount)}
                  </p>
                </li>
              );
            })}
          </ul>
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
