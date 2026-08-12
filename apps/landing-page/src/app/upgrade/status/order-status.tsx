"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { PREVIEW_MODE, UpgradeOrderStatus } from "../api";
import { formatRupiah, secondaryButtonClass } from "../upgrade-shell";

type Tone = "wait" | "review" | "done" | "refund";

const TONE_STYLE: Record<Tone, { bar: string; chip: string; icon: string }> = {
  wait: { bar: "bg-amber-400", chip: "bg-amber-100 text-amber-800", icon: "⏳" },
  review: { bar: "bg-brand-blue", chip: "bg-brand-blue/12 text-brand-blue", icon: "🔍" },
  done: { bar: "bg-brand-green", chip: "bg-brand-green/12 text-brand-green", icon: "✓" },
  refund: { bar: "bg-rose-400", chip: "bg-rose-100 text-rose-700", icon: "↩" }
};

const STATUS_VIEW: Record<
  UpgradeOrderStatus,
  { tone: Tone; label: string; headline: string; body: string }
> = {
  PENDING: {
    tone: "wait",
    label: "Menunggu pembayaran",
    headline: "Pembayaran belum kami terima",
    body: "Selesaikan pembayaran sebelum batas waktu. Pengajuan otomatis kedaluwarsa setelah 24 jam."
  },
  PAID_AWAITING_VERIFICATION: {
    tone: "review",
    label: "Menunggu verifikasi",
    headline: "Pembayaran diterima. Dokumen sedang diverifikasi.",
    body: "Tim TapGo memeriksa dokumen identitas Anda. Manfaat membership aktif setelah verifikasi selesai. Anda tidak perlu melakukan apa pun."
  },
  ACTIVE: {
    tone: "done",
    label: "Aktif",
    headline: "Membership Anda sudah aktif",
    body: "Paket baru sudah berlaku. Buka aplikasi TapGo dan tarik layar ke bawah untuk menyegarkan status."
  },
  REJECTED_REFUNDING: {
    tone: "refund",
    label: "Dokumen ditolak",
    headline: "Dokumen tidak dapat diverifikasi",
    body: "Pembayaran Anda dikembalikan penuh ke metode pembayaran semula. Proses pengembalian mengikuti waktu penyedia pembayaran."
  },
  EXPIRED: {
    tone: "wait",
    label: "Kedaluwarsa",
    headline: "Pengajuan kedaluwarsa",
    body: "Batas waktu pembayaran terlewat. Anda dapat mengajukan upgrade baru kapan saja."
  },
  CANCELLED: {
    tone: "wait",
    label: "Dibatalkan",
    headline: "Pengajuan dibatalkan",
    body: "Pengajuan ini sudah tidak berlaku. Anda dapat mengajukan upgrade baru kapan saja."
  }
};

/** Data contoh; hanya dipakai saat PREVIEW_MODE menyala. */
const PREVIEW_ORDER = {
  reference: "MBR-2026-000481",
  packageName: "Gold",
  amount: 3000000,
  invoiceNumber: "INV-2026-000481",
  createdAt: "12 Agustus 2026, 16:20 WIB"
};

export default function OrderStatus() {
  // Query param dipakai, bukan segmen dinamis: situs ini diekspor statis dan
  // payment gateway juga mengembalikan pengguna dengan parameter.

  // Pada tinjauan tampilan, seluruh kondisi dapat dilihat bergantian. Di
  // produksi status hanya berasal dari server.
  const params = useSearchParams();
  const orderId = params.get("id") ?? "-";
  const requested = params.get("state") as UpgradeOrderStatus | null;
  const [status, setStatus] = useState<UpgradeOrderStatus>(
    PREVIEW_MODE && requested && requested in STATUS_VIEW
      ? requested
      : "PAID_AWAITING_VERIFICATION"
  );
  const view = STATUS_VIEW[status];
  const tone = TONE_STYLE[view.tone];

  if (!PREVIEW_MODE) {
    // Di produksi status dibaca dari server. Tanpa itu halaman tidak menampilkan
    // nomor pengajuan maupun nominal karangan.
    return (
      <div className="rounded-2xl bg-slate-50 px-5 py-6 text-center">
        <p className="text-sm font-bold text-brand-navy">Status belum dapat dimuat</p>
        <p className="mt-2 text-sm leading-7 text-slate-600">
          Muat ulang halaman ini beberapa saat lagi, atau buka kembali tautan
          status dari email konfirmasi Anda.
        </p>
        <p className="mt-4 text-xs text-slate-400">Pengajuan #{orderId}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white">
        <div className={`h-1.5 w-full ${tone.bar}`} />
        <div className="p-5">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${tone.chip}`}
          >
            <span aria-hidden="true">{tone.icon}</span>
            {view.label}
          </span>

          <h2 className="mt-4 text-xl font-black leading-snug text-brand-navy">
            {view.headline}
          </h2>
          <p className="mt-2 text-sm leading-7 text-slate-600">{view.body}</p>

          <dl className="mt-5 space-y-3 border-t border-dashed border-slate-200 pt-5">
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm text-slate-500">Nomor pengajuan</dt>
              <dd className="text-right text-sm font-bold text-brand-navy">
                {PREVIEW_ORDER.reference}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm text-slate-500">Paket</dt>
              <dd className="text-right text-sm font-bold text-brand-navy">
                {PREVIEW_ORDER.packageName}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm text-slate-500">Total</dt>
              <dd className="text-right text-sm font-bold text-brand-navy">
                {formatRupiah(PREVIEW_ORDER.amount)}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm text-slate-500">Diajukan</dt>
              <dd className="text-right text-sm font-bold text-brand-navy">
                {PREVIEW_ORDER.createdAt}
              </dd>
            </div>
          </dl>

          {status === "ACTIVE" || status === "PAID_AWAITING_VERIFICATION" ? (
            <a
              href="#"
              className="mt-5 inline-flex items-center gap-2 text-sm font-black text-brand-blue"
            >
              Unduh invoice {PREVIEW_ORDER.invoiceNumber}
            </a>
          ) : null}
        </div>
      </div>

      {PREVIEW_MODE ? (
        <div className="mt-5 rounded-2xl bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Tinjauan tampilan — lihat kondisi lain
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(STATUS_VIEW) as UpgradeOrderStatus[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatus(key)}
                className={[
                  "rounded-full px-3 py-1.5 text-xs font-bold transition",
                  status === key
                    ? "bg-brand-navy text-white"
                    : "bg-white text-slate-500 hover:text-brand-navy"
                ].join(" ")}
              >
                {STATUS_VIEW[key].label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Link href="/" className={`${secondaryButtonClass} mt-6`}>
        Selesai
      </Link>

      <p className="mt-4 text-center text-xs text-slate-400">Pengajuan #{orderId}</p>
    </div>
  );
}
