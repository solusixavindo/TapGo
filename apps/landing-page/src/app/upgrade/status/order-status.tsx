"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ORDER_KEY,
  PREVIEW_MODE,
  TOKEN_KEY,
  UpgradeOrder,
  UpgradeOrderStatus,
  getOrder,
  readSession
} from "../api";
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

/** Status yang masih dapat berubah sendiri, jadi layak ditanyakan ulang. */
const LIVE_STATUSES: UpgradeOrderStatus[] = ["PENDING", "PAID_AWAITING_VERIFICATION"];
const POLL_INTERVAL_MS = 15000;

/** Data contoh; hanya dipakai saat PREVIEW_MODE menyala. */
const PREVIEW_ORDER: UpgradeOrder = {
  id: "preview-order",
  reference: "MBR-2026-000481",
  packageName: "Gold",
  amount: 3000000,
  status: "PAID_AWAITING_VERIFICATION",
  createdAt: "2026-08-12T09:20:00.000Z",
  invoiceNumber: "INV-2026-000481",
  buyerName: "Budi Santoso"
};

function formatMoment(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short"
  }).format(parsed);
}

export default function OrderStatus() {
  // Query param dipakai, bukan segmen dinamis: situs ini diekspor statis dan
  // payment gateway juga mengembalikan pengguna dengan parameter.
  const params = useSearchParams();
  const requested = params.get("state") as UpgradeOrderStatus | null;

  const [order, setOrder] = useState<UpgradeOrder | null>(PREVIEW_MODE ? PREVIEW_ORDER : null);
  const [previewStatus, setPreviewStatus] = useState<UpgradeOrderStatus>(
    PREVIEW_MODE && requested && requested in STATUS_VIEW
      ? requested
      : "PAID_AWAITING_VERIFICATION"
  );
  const [loading, setLoading] = useState(!PREVIEW_MODE);
  const [error, setError] = useState("");

  // Id order berasal dari sesi. Query param hanya cadangan untuk pengguna yang
  // kembali dari halaman penyedia pembayaran di tab yang sama.
  const orderId = readSession(ORDER_KEY) || params.get("id") || "";

  const refresh = useCallback(async () => {
    const token = readSession(TOKEN_KEY);
    if (!token || !orderId) {
      setError("Sesi Anda sudah berakhir. Masuk kembali untuk melihat status.");
      setLoading(false);
      return;
    }
    try {
      const result = await getOrder(token, orderId);
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
    // Verifikasi dikerjakan manusia, jadi jeda 15 detik sudah memadai dan tidak
    // membebani server. Polling berhenti sendiri begitu status final.
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status, refresh]);

  if (loading) {
    return <p className="text-sm font-semibold text-slate-500">Memuat status…</p>;
  }

  if (!order || !status) {
    return (
      <div className="rounded-2xl bg-slate-50 px-5 py-6 text-center">
        <p className="text-sm font-bold text-brand-navy">Status belum dapat dimuat</p>
        <p className="mt-2 text-sm leading-7 text-slate-600">
          {error ||
            "Muat ulang halaman ini beberapa saat lagi, atau buka kembali tautan status dari email konfirmasi Anda."}
        </p>
        <Link href="/upgrade" className={`${secondaryButtonClass} mt-5`}>
          Masuk kembali
        </Link>
      </div>
    );
  }

  const view = STATUS_VIEW[status];
  const tone = TONE_STYLE[view.tone];

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
                {order.reference}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm text-slate-500">Paket</dt>
              <dd className="text-right text-sm font-bold text-brand-navy">
                {order.packageName}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm text-slate-500">Total</dt>
              <dd className="text-right text-sm font-bold text-brand-navy">
                {formatRupiah(order.amount)}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm text-slate-500">Diajukan</dt>
              <dd className="text-right text-sm font-bold text-brand-navy">
                {formatMoment(order.createdAt)}
              </dd>
            </div>
          </dl>

          {error ? (
            <p className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
              Status terakhir yang berhasil dimuat ditampilkan di atas. {error}
            </p>
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
                onClick={() => setPreviewStatus(key)}
                className={[
                  "rounded-full px-3 py-1.5 text-xs font-bold transition",
                  previewStatus === key
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

      {LIVE_STATUSES.includes(status) && !PREVIEW_MODE ? (
        <p className="mt-4 text-center text-xs text-slate-400">
          Halaman ini menyegarkan status secara otomatis.
        </p>
      ) : null}

      <Link href="/" className={`${secondaryButtonClass} mt-6`}>
        Selesai
      </Link>
    </div>
  );
}
