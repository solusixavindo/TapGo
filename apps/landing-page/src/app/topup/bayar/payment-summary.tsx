"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  PREVIEW_MODE,
  PREVIEW_TOPUP_ORDER,
  TOKEN_KEY,
  TOPUP_ORDER_KEY,
  TopUpOrder,
  getTopUpOrder,
  payTopUpOrder,
  readSession
} from "../api";
import { formatRupiah, primaryButtonClass, secondaryButtonClass } from "../../upgrade/upgrade-shell";

export default function PaymentSummary() {
  const router = useRouter();
  const [order, setOrder] = useState<TopUpOrder | null>(PREVIEW_MODE ? PREVIEW_TOPUP_ORDER : null);
  const [loading, setLoading] = useState(!PREVIEW_MODE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (PREVIEW_MODE) return;
    const token = readSession(TOKEN_KEY);
    const orderId = readSession(TOPUP_ORDER_KEY);
    if (!token) {
      router.replace("/topup");
      return;
    }
    if (!orderId) {
      router.replace("/topup/jumlah");
      return;
    }

    let alive = true;
    getTopUpOrder(token, orderId)
      .then((result) => {
        if (!alive) return;
        setOrder(result);
        setError("");
      })
      .catch((caught: unknown) =>
        alive ? setError(caught instanceof Error ? caught.message : "Ringkasan pembayaran belum dapat dimuat.") : undefined
      )
      .finally(() => (alive ? setLoading(false) : undefined));
    return () => {
      alive = false;
    };
  }, [router]);

  async function onPay() {
    if (busy || !order) return;
    setBusy(true);
    setError("");
    try {
      if (PREVIEW_MODE) {
        router.push(`/topup/status?id=${encodeURIComponent(order.id)}`);
        return;
      }

      const handoff = await payTopUpOrder(readSession(TOKEN_KEY), order.id);
      if (handoff.redirectUrl) {
        // Saldo hanya bertambah lewat webhook penyedia pembayaran, bukan dari
        // kembalinya pengguna ke situs ini — sama seperti alur upgrade.
        window.location.assign(handoff.redirectUrl);
        return;
      }
      router.push(`/topup/status?id=${encodeURIComponent(order.id)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pembayaran belum dapat diproses.");
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm font-semibold themed-text-muted">Memuat ringkasan…</p>;
  }

  if (!order) {
    return (
      <div className="rounded-2xl border themed-border themed-card-bg px-5 py-6 text-center">
        <p className="text-sm font-bold themed-text">Ringkasan pembayaran belum tersedia</p>
        <p className="mt-2 text-sm leading-7 themed-text-muted">
          {error || "Mulai dari langkah pertama agar pengajuan Anda terbentuk lebih dulu."}
        </p>
        <button type="button" onClick={() => router.push("/topup")} className={`${secondaryButtonClass} mt-5`}>
          Mulai dari awal
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-[1.5rem] border themed-border themed-card-bg p-5">
        <dl className="space-y-3">
          <div className="flex items-start justify-between gap-6">
            <dt className="text-sm themed-text-muted">Nomor pengajuan</dt>
            <dd className="text-right text-sm font-bold themed-text">{order.reference}</dd>
          </div>
        </dl>

        <div className="mt-5 border-t border-dashed themed-border pt-5">
          <div className="flex items-baseline justify-between gap-6">
            <span className="text-sm font-bold themed-text-muted">Jumlah top up</span>
            <span className="text-3xl font-black themed-accent">{formatRupiah(order.amount)}</span>
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300">
          {error}
        </p>
      ) : null}

      <button type="button" onClick={onPay} disabled={busy} className={`${primaryButtonClass} mt-6`}>
        {busy ? "Menyiapkan pembayaran…" : `Bayar ${formatRupiah(order.amount)}`}
      </button>

      <button type="button" onClick={() => router.push("/topup/jumlah")} className={`${secondaryButtonClass} mt-3`}>
        Ubah jumlah
      </button>
    </div>
  );
}
