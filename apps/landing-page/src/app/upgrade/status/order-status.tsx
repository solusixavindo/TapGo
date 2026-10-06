"use client";

import Link from "../../hard-nav";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  NEXT_KEY,
  ORDER_KEY,
  PREVIEW_MODE,
  TOKEN_KEY,
  UpgradeOrder,
  UpgradeOrderStatus,
  getOrder,
  listMyOrders,
  readSession,
  uploadDocument,
  writeSession
} from "../api";
import { formatRupiah, primaryButtonClass, secondaryButtonClass } from "../upgrade-shell";
import { prepareImageForUpload } from "../image-prep";

type Tone = "wait" | "review" | "done" | "refund";

const TONE_STYLE: Record<Tone, { bar: string; chip: string; icon: string }> = {
  wait: { bar: "bg-amber-400", chip: "bg-amber-400/15 text-amber-300", icon: "⏳" },
  review: { bar: "bg-brand-gold", chip: "bg-brand-gold/15 themed-accent", icon: "🔍" },
  done: { bar: "bg-brand-green", chip: "bg-brand-green/15 text-brand-green", icon: "✓" },
  refund: { bar: "bg-rose-400", chip: "bg-rose-500/15 text-rose-300", icon: "↩" }
};

const STATUS_VIEW: Record<
  UpgradeOrderStatus,
  { tone: Tone; label: string; headline: string; body: string }
> = {
  PENDING: {
    tone: "wait",
    label: "Menunggu pembayaran",
    headline: "Pembayaran belum kami terima",
    body: "Selesaikan pembayaran sebelum batas waktu. Untuk transfer bank, tim TapGo mengonfirmasi setelah mutasi rekening dicek. Pengajuan otomatis kedaluwarsa setelah 24 jam."
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
    body: "Pembayaran Anda dikembalikan penuh. Untuk pembayaran online, dana kembali ke metode pembayaran semula mengikuti waktu penyedia. Untuk transfer bank, tim TapGo menghubungi Anda untuk rekening tujuan lalu mentransfer balik sebesar pembayaran Anda."
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
  buyerName: "Budi Santoso",
  correction: { reason: "Foto KTP kurang jelas, mohon unggah ulang", resubmitted: false }
};

/**
 * Admin meminta dokumen diperbaiki: tampilkan catatannya dan beri jalan
 * mengunggah ulang tanpa mengulang pembayaran.
 */
function CorrectionPanel({ order, onDone }: { order: UpgradeOrder; onDone: () => void }) {
  const [ktp, setKtp] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    if (busy || preparing || (!ktp && !selfie)) return;
    setBusy(true);
    setError("");
    try {
      const token = readSession(TOKEN_KEY);
      if (ktp) await uploadDocument(token, order.id, "ktp", ktp);
      if (selfie) await uploadDocument(token, order.id, "selfie", selfie);
      setDone(true);
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Dokumen belum dapat diunggah.");
    } finally {
      setBusy(false);
    }
  }

  // Foto divalidasi dan diperkecil saat dipilih (server hanya menerima badan
  // permintaan 1 MB); sebelumnya panel ini tidak memeriksa jenis maupun ukuran.
  const pick = (setter: (file: File | null) => void) => async (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = "";
    setError("");
    if (!chosen) {
      setter(null);
      return;
    }
    setPreparing(true);
    try {
      setter(await prepareImageForUpload(chosen));
    } catch (caught) {
      setter(null);
      setError(caught instanceof Error ? caught.message : "Foto belum dapat diproses.");
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="mt-5 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4" data-testid="correction-panel">
      <p className="text-sm font-black themed-accent">Dokumen perlu diperbaiki</p>
      {order.correction?.reason ? (
        <p className="mt-2 text-sm leading-7 themed-text">Catatan tim TapGo: “{order.correction.reason}”</p>
      ) : null}
      <p className="mt-2 text-xs leading-6 themed-text-muted">
        Unggah ulang dokumen yang perlu diganti (JPG atau PNG; foto diperkecil otomatis). Pembayaran Anda tetap aman dan tidak perlu diulang.
      </p>
      {done ? (
        <p role="status" className="mt-3 text-sm font-bold text-brand-green">
          Dokumen perbaikan terkirim. Kami periksa kembali secepatnya.
        </p>
      ) : (
        <>
          <label className="mt-4 block text-xs font-bold uppercase tracking-wider themed-text-muted">
            Foto KTP (opsional bila tidak diganti)
            <input type="file" accept="image/png,image/jpeg" onChange={pick(setKtp)} className="mt-1 block w-full text-sm themed-text" />
          </label>
          <label className="mt-3 block text-xs font-bold uppercase tracking-wider themed-text-muted">
            Swafoto dengan KTP (opsional bila tidak diganti)
            <input type="file" accept="image/png,image/jpeg" onChange={pick(setSelfie)} className="mt-1 block w-full text-sm themed-text" />
          </label>
          {error ? (
            <p role="alert" className="mt-3 text-sm font-semibold text-rose-300">
              {error}
            </p>
          ) : null}
          <button type="button" onClick={() => void submit()} disabled={busy || preparing || (!ktp && !selfie)} className={`${primaryButtonClass} mt-4`}>
            {busy ? "Mengunggah…" : preparing ? "Memproses foto…" : "Kirim dokumen perbaikan"}
          </button>
        </>
      )}
    </div>
  );
}

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
    if (!token) {
      // Mis. kembali dari pembayaran di tab/aplikasi lain: sesi tab ini kosong.
      // Ingat halaman ini supaya setelah masuk pengguna langsung kembali ke sini.
      writeSession(NEXT_KEY, window.location.pathname + window.location.search);
      setError("Sesi Anda sudah berakhir. Masuk kembali untuk melihat status.");
      setLoading(false);
      return;
    }
    try {
      if (orderId) {
        setOrder(await getOrder(token, orderId));
      } else {
        // Tanpa id (tab baru): tampilkan pengajuan terbaru akun ini.
        const mine = await listMyOrders(token);
        if (mine.length === 0) {
          setError("Belum ada pengajuan upgrade pada akun ini.");
          setLoading(false);
          return;
        }
        setOrder(mine[0]!);
      }
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
    return <p className="text-sm font-semibold themed-text-muted">Memuat status…</p>;
  }

  if (!order || !status) {
    return (
      <div className="rounded-2xl border themed-border themed-card-bg px-5 py-6 text-center">
        <p className="text-sm font-bold themed-text">Status belum dapat dimuat</p>
        <p className="mt-2 text-sm leading-7 themed-text-muted">
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
      <div className="overflow-hidden rounded-[1.5rem] border themed-border themed-card-bg">
        <div className={`h-1.5 w-full ${tone.bar}`} />
        <div className="p-5">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${tone.chip}`}
          >
            <span aria-hidden="true">{tone.icon}</span>
            {view.label}
          </span>

          <h2 className="mt-4 text-xl font-black leading-snug themed-text">
            {view.headline}
          </h2>
          <p className="mt-2 text-sm leading-7 themed-text-muted">{view.body}</p>

          <dl className="mt-5 space-y-3 border-t border-dashed themed-border pt-5">
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm themed-text-muted">Nomor pengajuan</dt>
              <dd className="text-right text-sm font-bold themed-text">
                {order.reference}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm themed-text-muted">Paket</dt>
              <dd className="text-right text-sm font-bold themed-text">
                {order.packageName}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm themed-text-muted">Total</dt>
              <dd className="text-right text-sm font-bold themed-text">
                {formatRupiah(order.amount)}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-6">
              <dt className="text-sm themed-text-muted">Diajukan</dt>
              <dd className="text-right text-sm font-bold themed-text">
                {formatMoment(order.createdAt)}
              </dd>
            </div>
          </dl>

          {status === "PENDING" && !PREVIEW_MODE ? (
            <Link href="/upgrade/bayar" className={`${secondaryButtonClass} mt-5`}>
              Lihat petunjuk pembayaran
            </Link>
          ) : null}

          {status === "PAID_AWAITING_VERIFICATION" && order.correction && !order.correction.resubmitted ? (
            <CorrectionPanel order={order} onDone={() => void refresh()} />
          ) : null}
          {status === "PAID_AWAITING_VERIFICATION" && order.correction?.resubmitted ? (
            <p className="mt-5 rounded-2xl border border-brand-green/30 bg-brand-green/10 px-4 py-3 text-xs font-semibold text-brand-green">
              Dokumen perbaikan Anda sudah kami terima dan sedang diperiksa ulang.
            </p>
          ) : null}

          {error ? (
            <p className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs font-semibold text-amber-300">
              Status terakhir yang berhasil dimuat ditampilkan di atas. {error}
            </p>
          ) : null}
        </div>
      </div>

      {PREVIEW_MODE ? (
        <div className="mt-5 rounded-2xl border themed-border themed-card-bg p-4">
          <p className="text-xs font-bold uppercase tracking-wider themed-text-muted">
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
                    ? "bg-brand-gold text-brand-navyDeep"
                    : "themed-fill themed-text-muted hover:text-[var(--themed-text-primary)]"
                ].join(" ")}
              >
                {STATUS_VIEW[key].label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {LIVE_STATUSES.includes(status) && !PREVIEW_MODE ? (
        <p className="mt-4 text-center text-xs themed-text-muted">
          Halaman ini menyegarkan status secara otomatis.
        </p>
      ) : null}

      {status === "ACTIVE" ? (
        <Link href="/upgrade/tim-referral" className={`${primaryButtonClass} mt-6`}>
          Lihat Daftar Referral
        </Link>
      ) : null}

      <Link href="/" className={`${secondaryButtonClass} mt-6`}>
        Selesai
      </Link>
    </div>
  );
}
