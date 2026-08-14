"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ORDER_KEY,
  PREVIEW_MODE,
  PREVIEW_PACKAGES,
  TOKEN_KEY,
  UpgradeOrder,
  getOrder,
  payOrder,
  readSession
} from "../api";
import { formatRupiah, primaryButtonClass, secondaryButtonClass } from "../upgrade-shell";

/** Ringkasan contoh; hanya dipakai saat PREVIEW_MODE menyala. */
const PREVIEW_ORDER: UpgradeOrder = {
  id: "preview-order",
  reference: "INV-MBR-20260812-CONTOH",
  packageName: PREVIEW_PACKAGES[1]!.name,
  amount: PREVIEW_PACKAGES[1]!.price,
  status: "PENDING",
  createdAt: new Date().toISOString(),
  invoiceNumber: "INV-MBR-20260812-CONTOH",
  buyerName: "Budi Santoso"
};

export default function PaymentSummary() {
  const router = useRouter();
  const [order, setOrder] = useState<UpgradeOrder | null>(PREVIEW_MODE ? PREVIEW_ORDER : null);
  const [loading, setLoading] = useState(!PREVIEW_MODE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (PREVIEW_MODE) return;
    const token = readSession(TOKEN_KEY);
    const orderId = readSession(ORDER_KEY);
    if (!token) {
      router.replace("/upgrade");
      return;
    }
    if (!orderId) {
      router.replace("/upgrade/paket");
      return;
    }

    let alive = true;
    getOrder(token, orderId)
      .then((result) => {
        if (!alive) return;
        setOrder(result);
        setError("");
      })
      .catch((caught: unknown) =>
        alive
          ? setError(
              caught instanceof Error
                ? caught.message
                : "Ringkasan pembayaran belum dapat dimuat."
            )
          : undefined
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
        router.push(`/upgrade/status?id=${encodeURIComponent(order.id)}`);
        return;
      }

      const handoff = await payOrder(readSession(TOKEN_KEY), order.id);
      if (handoff.redirectUrl) {
        // Pengguna berpindah ke halaman penyedia pembayaran. Aktivasi tetap
        // hanya boleh datang dari webhook penyedia, bukan dari kembalinya
        // pengguna ke situs ini.
        window.location.assign(handoff.redirectUrl);
        return;
      }
      router.push(`/upgrade/status?id=${encodeURIComponent(order.id)}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Pembayaran belum dapat diproses."
      );
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm font-semibold text-slate-500">Memuat ringkasan…</p>;
  }

  if (!order) {
    return (
      <div className="rounded-2xl bg-slate-50 px-5 py-6 text-center">
        <p className="text-sm font-bold text-brand-navy">
          Ringkasan pembayaran belum tersedia
        </p>
        <p className="mt-2 text-sm leading-7 text-slate-600">
          {error || "Mulai dari langkah pertama agar pengajuan Anda terbentuk lebih dulu."}
        </p>
        <button
          type="button"
          onClick={() => router.push("/upgrade")}
          className={`${secondaryButtonClass} mt-5`}
        >
          Mulai dari awal
        </button>
      </div>
    );
  }

  const rows = [
    { label: "Nomor pengajuan", value: order.reference },
    { label: "Paket dipilih", value: order.packageName },
    { label: "Nama", value: order.buyerName }
  ].filter((row) => row.value.length > 0);

  return (
    <div>
      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
        <dl className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-6">
              <dt className="text-sm text-slate-500">{row.label}</dt>
              <dd className="text-right text-sm font-bold text-brand-navy">{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 border-t border-dashed border-slate-200 pt-5">
          <div className="flex items-baseline justify-between gap-6">
            <span className="text-sm font-bold text-slate-500">Total pembayaran</span>
            <span className="text-3xl font-black text-brand-blue">
              {formatRupiah(order.amount)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-start gap-3 rounded-2xl bg-brand-blue/5 px-4 py-3.5">
        <span aria-hidden="true" className="mt-0.5 text-brand-blue">ⓘ</span>
        <p className="text-xs leading-6 text-slate-600">
          Setelah pembayaran diterima, dokumen Anda masuk antrean verifikasi tim
          TapGo. Bila dokumen tidak dapat diverifikasi, pembayaran dikembalikan
          penuh sesuai kebijakan pengembalian dana.
        </p>
      </div>

      {error ? (
        <p role="alert" className="mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {error}
        </p>
      ) : null}

      <button type="button" onClick={onPay} disabled={busy} className={`${primaryButtonClass} mt-6`}>
        {busy ? "Menyiapkan pembayaran…" : `Bayar ${formatRupiah(order.amount)}`}
      </button>

      <button
        type="button"
        onClick={() => router.push("/upgrade/paket")}
        className={`${secondaryButtonClass} mt-3`}
      >
        Ubah pilihan paket
      </button>
    </div>
  );
}
