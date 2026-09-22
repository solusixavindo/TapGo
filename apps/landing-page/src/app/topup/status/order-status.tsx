"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  PREVIEW_MODE,
  PREVIEW_TOPUP_ORDER,
  TOKEN_KEY,
  TOPUP_ORDER_KEY,
  TopUpOrder,
  TopUpOrderStatus,
  getTopUpOrder,
  readSession
} from "../api";
import { formatRupiah, secondaryButtonClass } from "../../upgrade/upgrade-shell";

type Tone = "wait" | "done" | "refund";

const TONE_STYLE: Record<Tone, { bar: string; chip: string; icon: string }> = {
  wait: { bar: "bg-amber-400", chip: "bg-amber-400/15 text-amber-300", icon: "⏳" },
  done: { bar: "bg-brand-green", chip: "bg-brand-green/15 text-brand-green", icon: "✓" },
  refund: { bar: "bg-rose-400", chip: "bg-rose-500/15 text-rose-300", icon: "↩" }
};

const STATUS_VIEW: Record<TopUpOrderStatus, { tone: Tone; label: string; headline: string; body: string }> = {
  PENDING: {
    tone: "wait",
    label: "Menunggu pembayaran",
    headline: "Pembayaran belum kami terima",
    body: "Selesaikan pembayaran sebelum batas waktu."
  },
  AUTHORIZED: {
    tone: "wait",
    label: "Diproses",
    headline: "Pembayaran sedang diproses",
    body: "Saldo akan bertambah otomatis begitu pembayaran diverifikasi."
  },
  PAID: {
    tone: "done",
    label: "Berhasil",
    headline: "Saldo TapGoPay Anda sudah bertambah",
    body: "Buka aplikasi TapGo dan tarik layar ke bawah untuk menyegarkan saldo."
  },
  REFUNDED: {
    tone: "refund",
    label: "Dikembalikan",
    headline: "Pembayaran dikembalikan",
    body: "Dana Anda dikembalikan ke metode pembayaran semula."
  },
  FAILED: {
    tone: "refund",
    label: "Gagal",
    headline: "Pembayaran gagal",
    body: "Silakan mulai top up baru dari awal."
  },
  EXPIRED: {
    tone: "wait",
    label: "Kedaluwarsa",
    headline: "Pengajuan kedaluwarsa",
    body: "Batas waktu pembayaran terlewat. Anda dapat mengajukan top up baru kapan saja."
  },
  CANCELLED: {
    tone: "wait",
    label: "Dibatalkan",
    headline: "Pengajuan dibatalkan",
    body: "Pengajuan ini sudah tidak berlaku. Anda dapat mengajukan top up baru kapan saja."
  }
};

const LIVE_STATUSES: TopUpOrderStatus[] = ["PENDING", "AUTHORIZED"];
const POLL_INTERVAL_MS = 10000;

export default function OrderStatus() {
  const params = useSearchParams();
  const requested = params.get("state") as TopUpOrderStatus | null;

  const [order, setOrder] = useState<TopUpOrder | null>(PREVIEW_MODE ? PREVIEW_TOPUP_ORDER : null);
  const [previewStatus, setPreviewStatus] = useState<TopUpOrderStatus>(
    PREVIEW_MODE && requested && requested in STATUS_VIEW ? requested : "PENDING"
  );
  const [loading, setLoading] = useState(!PREVIEW_MODE);
  const [error, setError] = useState("");

  const orderId = readSession(TOPUP_ORDER_KEY) || params.get("id") || "";

  const refresh = useCallback(async () => {
    const token = readSession(TOKEN_KEY);
    if (!token || !orderId) {
      setError("Sesi Anda sudah berakhir. Masuk kembali untuk melihat status.");
      setLoading(false);
      return;
    }
    try {
      const result = await getTopUpOrder(token, orderId);
      setOrder(result);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Status belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (PREVIEW_MODE) return;
    void refresh();
  }, [refresh]);

  const status = PREVIEW_MODE ? previewStatus : order?.status;

  useEffect(() => {
    if (PREVIEW_MODE) return;
    if (!status || !LIVE_STATUSES.includes(status)) return;
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status, refresh]);

  if (loading) {
    return <p className="text-sm font-semibold themed-text-muted">Memuat status…</p>;
  }

  if (!order || !status) {
    return (
      <div className="rounded-2xl border themed-border themed-card-bg px-5 py-6 text-center">
        <p className="text-sm font-bold themed-text">Status belum dapat dimuat</p>
        <p className="mt-2 text-sm leading-7 themed-text-muted">
          {error || "Muat ulang halaman ini beberapa saat lagi."}
        </p>
        <Link href="/topup" className={`${secondaryButtonClass} mt-5`}>
          Masuk kembali
        </Link>
      </div>
    );
  }

  const view = STATUS_VIEW[status];
  const tone = TONE_STYLE[view.tone];

  return (
    <div>
      <div className="overflow-hidden rounded-[1.5rem] border themed-border themed-card-bg">
        <div className={`h-1.5 w-full ${tone.bar}`} />
        <div className="p-5">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${tone.chip}`}>
            <span aria-hidden="true">{tone.icon}</span>
            {view.label}
          </span>

          <h2 className="mt-4 text-xl font-black leading-snug themed-text">{view.headline}</h2>
          <p className="mt-2 text-sm leading-7 themed-text-muted">{view.body}</p>

          <dl className="mt-5 space-y-3 border-t border-dashed themed-border pt-5">
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm themed-text-muted">Nomor pengajuan</dt>
              <dd className="text-right text-sm font-bold themed-text">{order.reference}</dd>
            </div>
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm themed-text-muted">Jumlah</dt>
              <dd className="text-right text-sm font-bold themed-text">{formatRupiah(order.amount)}</dd>
            </div>
          </dl>

          {error ? (
            <p className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs font-semibold text-amber-300">
              Status terakhir yang berhasil dimuat ditampilkan di atas. {error}
            </p>
          ) : null}
        </div>
      </div>

      {LIVE_STATUSES.includes(status) && !PREVIEW_MODE ? (
        <p className="mt-4 text-center text-xs themed-text-muted">Halaman ini menyegarkan status secara otomatis.</p>
      ) : null}

      <Link href="/" className={`${secondaryButtonClass} mt-6`}>
        Selesai
      </Link>
    </div>
  );
}
