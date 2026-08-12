"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PREVIEW_MODE, PREVIEW_PACKAGES } from "../api";
import { formatRupiah, primaryButtonClass, secondaryButtonClass } from "../upgrade-shell";

export default function PaymentSummary() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Ringkasan hanya diisi data contoh pada mode tinjauan. Di produksi, data
  // berasal dari order yang dibuat server — halaman ini tidak boleh menampilkan
  // nama atau nominal karangan.
  const chosen = PREVIEW_MODE ? PREVIEW_PACKAGES[1]! : null;

  if (!chosen) {
    return (
      <div className="rounded-2xl bg-slate-50 px-5 py-6 text-center">
        <p className="text-sm font-bold text-brand-navy">
          Ringkasan pembayaran belum tersedia
        </p>
        <p className="mt-2 text-sm leading-7 text-slate-600">
          Mulai dari langkah pertama agar pengajuan Anda terbentuk lebih dulu.
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

  async function onPay() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (PREVIEW_MODE) {
        router.push("/upgrade/status?id=MBR-2026-000481");
        return;
      }
      // Alur pembayaran sesungguhnya menyusul bersama kredensial sandbox
      // Midtrans; halaman ini sengaja tidak memalsukan keberhasilan.
      setError("Pembayaran belum dapat diproses. Silakan coba beberapa saat lagi.");
    } finally {
      setBusy(false);
    }
  }

  const rows = [
    { label: "Paket dipilih", value: chosen.name },
    { label: "Nama", value: "Budi Santoso" },
    { label: "Dokumen", value: "KTP dan swafoto terlampir" }
  ];


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
              {formatRupiah(chosen.price)}
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
        {busy ? "Menyiapkan pembayaran…" : `Bayar ${formatRupiah(chosen.price)}`}
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
