"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  OnlinePaymentList,
  OnlinePaymentStatus,
  formatMoment,
  formatRupiah,
  listOnlinePayments,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import ConsoleHeader from "../console-header";

/**
 * Pemantauan pembayaran online (Midtrans): top up saldo dan pembayaran membership. Hanya baca.
 *
 * "Menunggu" berarti pembeli sudah memilih bank dan kode pembayaran dibuat, tetapi uangnya belum masuk. Pesanan
 * kedaluwarsa otomatis 24 jam setelah dibuat; Midtrans lalu mengirim kabar "expire" dan statusnya berubah.
 * Nomor HP disamarkan; cari anggota di Direktori Member bila perlu menghubunginya.
 */

const STATUS_TABS: Array<{ id: OnlinePaymentStatus | ""; label: string }> = [
  { id: "", label: "Semua" },
  { id: "PENDING", label: "Menunggu" },
  { id: "PAID", label: "Berhasil" },
  { id: "EXPIRED", label: "Kedaluwarsa" },
  { id: "FAILED", label: "Gagal" },
  { id: "CANCELLED", label: "Dibatalkan" }
];

const KIND_TABS: Array<{ id: "" | "TOPUP" | "MEMBERSHIP"; label: string }> = [
  { id: "", label: "Semua jenis" },
  { id: "TOPUP", label: "Top up" },
  { id: "MEMBERSHIP", label: "Membership" }
];

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Menunggu pembayaran", className: "bg-amber-100 text-amber-800" },
  PAID: { label: "Berhasil", className: "bg-emerald-100 text-emerald-800" },
  EXPIRED: { label: "Kedaluwarsa", className: "bg-slate-200 text-slate-700" },
  FAILED: { label: "Gagal", className: "bg-rose-100 text-rose-800" },
  CANCELLED: { label: "Dibatalkan", className: "bg-slate-200 text-slate-700" },
  AUTHORIZED: { label: "Diproses", className: "bg-sky-100 text-sky-800" },
  REFUNDED: { label: "Dikembalikan", className: "bg-violet-100 text-violet-800" }
};

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Virtual account",
  echannel: "Mandiri Bill",
  permata: "Virtual account Permata",
  other_va: "Virtual account",
  gopay: "GoPay",
  qris: "QRIS",
  credit_card: "Kartu"
};

function remaining(expiresAt: string | null) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours} jam ${minutes} menit lagi` : `${minutes} menit lagi`;
}

export default function OnlinePaymentsPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<OnlinePaymentStatus | "">("");
  const [kind, setKind] = useState<"" | "TOPUP" | "MEMBERSHIP">("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OnlinePaymentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await listOnlinePayments({
          page,
          ...(kind ? { kind } : {}),
          ...(status ? { status } : {})
        })
      );
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [page, kind, status]);

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    const current = readRole();
    if (!roleAtLeast(current, "SUPER_ADMIN")) {
      router.replace("/beranda");
      return;
    }
    setRole(current);
    void load();
  }, [router, load]);

  const byStatus = data?.summary.byStatus ?? {};
  const cards: Array<{ label: string; value: number; tone: string; hint?: string }> = [
    { label: "Menunggu pembayaran", value: byStatus.PENDING ?? 0, tone: "text-amber-700", hint: data && data.summary.overduePending > 0 ? `${data.summary.overduePending} lewat batas waktu` : undefined },
    { label: "Berhasil", value: byStatus.PAID ?? 0, tone: "text-emerald-700" },
    { label: "Kedaluwarsa", value: byStatus.EXPIRED ?? 0, tone: "text-slate-700" },
    { label: "Gagal / dibatalkan", value: (byStatus.FAILED ?? 0) + (byStatus.CANCELLED ?? 0), tone: "text-rose-700" }
  ];

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader
          title="Pembayaran Online"
          subtitle="Top up saldo dan pembayaran membership lewat Midtrans. Hanya baca; nomor HP disamarkan."
          role={role}
          actions={
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "Memuat…" : "Muat ulang"}
            </button>
          }
        />

        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="op-summary">
          {cards.map((card) => (
            <div key={card.label} className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{card.label}</p>
              <p className={`mt-1 text-3xl font-black tabular-nums ${card.tone}`}>{card.value}</p>
              {card.hint ? <p className="mt-1 text-xs font-semibold text-amber-700">{card.hint}</p> : null}
            </div>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Status pembayaran">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id || "all"}
                type="button"
                role="tab"
                aria-selected={status === tab.id}
                onClick={() => {
                  setPage(1);
                  setStatus(tab.id);
                }}
                className={[
                  "rounded-lg px-3.5 py-1.5 text-sm font-bold transition",
                  status === tab.id ? "bg-brand-navy text-white" : "bg-white text-slate-600 hover:bg-slate-200"
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Jenis pembayaran">
            {KIND_TABS.map((tab) => (
              <button
                key={tab.id || "all"}
                type="button"
                role="tab"
                aria-selected={kind === tab.id}
                onClick={() => {
                  setPage(1);
                  setKind(tab.id);
                }}
                className={[
                  "rounded-lg border px-3 py-1.5 text-sm font-bold transition",
                  kind === tab.id ? "border-brand-navy bg-white text-brand-navy" : "border-transparent bg-white text-slate-500 hover:bg-slate-200"
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {!data && loading ? (
          <p className="text-sm text-slate-500">Memuat…</p>
        ) : data && data.items.length === 0 ? (
          <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm">
            <p className="font-bold">Belum ada pembayaran online pada pilihan ini</p>
            <p className="mt-1 text-sm text-slate-500">Pembayaran lewat Midtrans akan muncul di sini begitu pembeli memulainya.</p>
          </div>
        ) : data ? (
          <>
            <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Transaksi</th>
                    <th className="px-4 py-3">Pembeli</th>
                    <th className="px-4 py-3 text-right">Ditagih</th>
                    <th className="px-4 py-3">Metode</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Waktu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((item) => {
                    const style = STATUS_STYLE[item.status] ?? { label: item.status, className: "bg-slate-200 text-slate-700" };
                    const left = item.status === "PENDING" ? remaining(item.expiresAt) : null;
                    return (
                      <tr key={`${item.kind}-${item.id}`} className="align-top" data-testid="op-row">
                        <td className="px-4 py-3">
                          <p className="font-bold">{item.description}</p>
                          <p className="font-mono text-[11px] text-slate-400">{item.reference}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{item.userName}</p>
                          <p className="text-xs text-slate-500">{item.phoneMasked}</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="text-base font-black tabular-nums">{formatRupiah(item.amount)}</p>
                          {item.baseAmount !== null ? (
                            <p className="text-[11px] tabular-nums text-slate-500">
                              saldo {formatRupiah(item.baseAmount)} + biaya {formatRupiah(item.feeAmount)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {item.method ? (METHOD_LABEL[item.method] ?? item.method) : "Belum dipilih"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${style.className}`}>{style.label}</span>
                          {left ? <p className="mt-1 text-[11px] text-slate-500">{left}</p> : null}
                          {item.overdue ? (
                            <p className="mt-1 text-[11px] font-semibold text-amber-700">Lewat batas waktu, menunggu kabar dari Midtrans</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <p>Dibuat: {formatMoment(item.createdAt)}</p>
                          {item.paidAt ? <p>Dibayar: {formatMoment(item.paidAt)}</p> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <p>
                Halaman {data.pagination.page} dari {Math.max(1, data.pagination.totalPages)} · {data.pagination.total} transaksi
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-bold disabled:opacity-40"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  disabled={page >= data.pagination.totalPages || loading}
                  onClick={() => setPage((value) => value + 1)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-bold disabled:opacity-40"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
