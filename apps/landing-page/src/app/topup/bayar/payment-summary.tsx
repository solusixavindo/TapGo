"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BUYER_NAME_KEY,
  ManualTopUpOrder,
  PREVIEW_MANUAL_TOPUP,
  PREVIEW_MODE,
  TOKEN_KEY,
  TOPUP_ORDER_KEY,
  TOPUP_TARGETS,
  getManualTopUp,
  readSession
} from "../api";
import { InvoiceData, PaymentInvoice } from "../../upgrade/payment-invoice";
import { primaryButtonClass, secondaryButtonClass } from "../../upgrade/upgrade-shell";

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

  const target = TOPUP_TARGETS[order.target];
  const expired = !PREVIEW_MODE && new Date(order.expiresAt).getTime() < Date.now();
  const invoice: InvoiceData = {
    number: order.reference,
    heading: `Top Up ${target.label}`,
    ...(order.createdAt ? { issuedAt: order.createdAt } : {}),
    buyerName: PREVIEW_MODE ? "Budi Santoso" : readSession(BUYER_NAME_KEY),
    lines: [
      { label: `Top up ${target.label}`, amount: order.baseAmount },
      { label: "Kode unik", amount: order.uniqueCode, hint: "Untuk mengenali transfer Anda; ikut masuk ke saldo" }
    ],
    total: order.transferAmount,
    bank: order.bank,
    expiresAt: order.expiresAt,
    expired,
    notes: [
      `Seluruh nominal transfer, termasuk kode unik, masuk ke ${target.label} Anda.`,
      order.target === "PPOB"
        ? "Saldo PPOB hanya untuk pembelian pulsa, token listrik, dan tagihan. Saldo PPOB tidak dapat ditarik."
        : "Saldo TapGo dipakai untuk komisi pesanan tunai (driver) dan pembayaran perjalanan."
    ]
  };

  return (
    <div>
      <PaymentInvoice data={invoice} />

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
