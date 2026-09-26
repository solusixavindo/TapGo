"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ManualTopUpOrder,
  PREVIEW_MANUAL_TOPUP,
  PREVIEW_MODE,
  TOKEN_KEY,
  TOPUP_ORDER_KEY,
  getManualTopUp,
  readSession
} from "../api";
import { formatRupiah, primaryButtonClass, secondaryButtonClass } from "../../upgrade/upgrade-shell";

function CopyRow({ label, value, shown }: { label: string; value: string; shown?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <dt className="text-xs themed-text-muted">{label}</dt>
        <dd className="mt-0.5 break-all text-base font-black themed-text">{shown ?? value}</dd>
      </div>
      <button type="button" onClick={copy} className="shrink-0 rounded-full border themed-border px-3 py-1.5 text-xs font-bold themed-text">
        {copied ? "Tersalin" : "Salin"}
      </button>
    </div>
  );
}

export default function PaymentSummary() {
  const router = useRouter();
  const [order, setOrder] = useState<ManualTopUpOrder | null>(PREVIEW_MODE ? PREVIEW_MANUAL_TOPUP : null);
  const [loading, setLoading] = useState(!PREVIEW_MODE);
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
    getManualTopUp(token, orderId)
      .then((result) => {
        if (!alive) return;
        setOrder(result);
        setError("");
      })
      .catch((caught: unknown) =>
        alive ? setError(caught instanceof Error ? caught.message : "Petunjuk transfer belum dapat dimuat.") : undefined
      )
      .finally(() => (alive ? setLoading(false) : undefined));
    return () => {
      alive = false;
    };
  }, [router]);

  if (loading) {
    return <p className="text-sm font-semibold themed-text-muted">Memuat petunjuk transfer…</p>;
  }

  if (!order) {
    return (
      <div className="rounded-2xl border themed-border themed-card-bg px-5 py-6 text-center">
        <p className="text-sm font-bold themed-text">Petunjuk transfer belum tersedia</p>
        <p className="mt-2 text-sm leading-7 themed-text-muted">{error || "Mulai dari langkah pertama agar pengajuan Anda terbentuk lebih dulu."}</p>
        <button type="button" onClick={() => router.push("/topup")} className={`${secondaryButtonClass} mt-5`}>
          Mulai dari awal
        </button>
      </div>
    );
  }

  const expires = new Date(order.expiresAt);
  const expiresLabel = Number.isNaN(expires.getTime())
    ? ""
    : expires.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" });

  return (
    <div>
      <div className="rounded-[1.5rem] border themed-border themed-card-bg p-5">
        <p className="text-sm themed-text-muted">Transfer tepat sebesar</p>
        <p className="mt-1 text-3xl font-black themed-accent">{formatRupiah(order.transferAmount)}</p>
        <p className="mt-2 text-xs leading-6 themed-text-muted">
          {"Tiga digit terakhir ("}
          <strong className="themed-text">{String(order.uniqueCode).padStart(3, "0")}</strong>
          {") adalah kode unik agar transfer Anda mudah dikenali. Saldo yang masuk: "}
          <strong className="themed-text">{formatRupiah(order.baseAmount)}</strong>. Jangan dibulatkan.
        </p>

        <dl className="mt-5 space-y-4 border-t border-dashed themed-border pt-5">
          <CopyRow label="Bank" value={order.bank.bankName} />
          <CopyRow label="Nomor rekening" value={order.bank.accountNumber} />
          <CopyRow label="Atas nama" value={order.bank.accountHolder} />
          <CopyRow label="Nominal transfer" value={String(order.transferAmount)} shown={formatRupiah(order.transferAmount)} />
        </dl>

        <p className="mt-5 text-xs themed-text-muted">
          Nomor pengajuan {order.reference}
          {expiresLabel ? ` · berlaku sampai ${expiresLabel}` : ""}
        </p>
      </div>

      {error ? (
        <p role="alert" className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300">
          {error}
        </p>
      ) : null}

      <button type="button" onClick={() => router.push(`/topup/status?id=${encodeURIComponent(order.id)}`)} className={`${primaryButtonClass} mt-6`}>
        Saya sudah transfer
      </button>
      <button type="button" onClick={() => router.push("/topup/jumlah")} className={`${secondaryButtonClass} mt-3`}>
        Ubah jumlah
      </button>
    </div>
  );
}
