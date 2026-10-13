"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DigiflazzTxItem,
  DigiflazzTxList,
  DigiflazzTxStatus,
  formatMoment,
  formatRupiah,
  listDigiflazzTransactions,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import { PeriodState, defaultPeriod, periodQuery } from "../../lib/period";
import ConsoleHeader from "../console-header";
import PeriodFilter from "../period-filter";
import { useHardRouter as useRouter } from "../hard-nav";

/**
 * Transaksi PPOB yang dikirim ke Digiflazz, satu per satu. Hanya baca.
 *
 * "Referensi" sama dengan `ref_id` di dasbor Digiflazz, jadi tempel ke kolom cari untuk mencocokkan kedua sisi.
 * Modal dan selisih memakai harga yang dilaporkan Digiflazz saat transaksi sukses. Nomor tujuan, nomor HP, dan
 * serial/token disamarkan: token PLN bisa dipakai siapa pun yang memegangnya.
 */

const STATUS_TABS: Array<{ id: DigiflazzTxStatus | ""; label: string }> = [
  { id: "", label: "Semua" },
  { id: "SUCCESS", label: "Berhasil" },
  { id: "PROCESSING", label: "Diproses" },
  { id: "PENDING", label: "Menunggu" },
  { id: "FAILED", label: "Gagal" }
];

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  SUCCESS: { label: "Berhasil", className: "bg-emerald-100 text-emerald-800" },
  PROCESSING: { label: "Diproses", className: "bg-sky-100 text-sky-800" },
  PENDING: { label: "Menunggu", className: "bg-amber-100 text-amber-800" },
  FAILED: { label: "Gagal", className: "bg-rose-100 text-rose-800" },
  REFUNDED: { label: "Dibatalkan", className: "bg-violet-100 text-violet-800" }
};

const CATEGORY_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "", label: "Semua kategori" },
  { id: "PULSA", label: "Pulsa" },
  { id: "DATA", label: "Paket data" },
  { id: "PLN_PREPAID", label: "Token PLN" },
  { id: "PLN_POSTPAID", label: "Listrik pascabayar" },
  { id: "BPJS", label: "BPJS Kesehatan" },
  { id: "BPJS_TK", label: "BPJS Ketenagakerjaan" },
  { id: "EWALLET", label: "E-wallet" },
  { id: "EMONEY", label: "E-money" },
  { id: "PDAM", label: "PDAM" },
  { id: "TELKOM", label: "Telkom" },
  { id: "INTERNET", label: "Internet" },
  { id: "TV", label: "TV" },
  { id: "HP_POSTPAID", label: "HP pascabayar" },
  { id: "MULTIFINANCE", label: "Multifinance" },
  { id: "PBB", label: "PBB" },
  { id: "GAS", label: "Gas" }
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTIONS.map((option) => [option.id, option.label]));

/** Arti kode jawaban (rc) Digiflazz yang paling sering muncul; kode lain ditampilkan apa adanya. */
const RC_MEANING: Record<string, string> = {
  "01": "Waktu tunggu habis",
  "02": "Transaksi gagal di sisi operator",
  "03": "Transaksi masih menunggu",
  "40": "Data yang dikirim tidak lengkap",
  "41": "Tanda tangan (signature) tidak cocok",
  "42": "Digiflazz gagal memproses ke operator",
  "43": "Kode produk tidak ditemukan",
  "44": "Saldo Digiflazz tidak cukup",
  "45": "Alamat IP server belum didaftarkan di Digiflazz",
  "47": "Transaksi yang sama sudah terjadi pada hari ini",
  "49": "Referensi transaksi tidak unik",
  "50": "Transaksi tidak ditemukan",
  "51": "Nomor tujuan diblokir",
  "52": "Awalan nomor tidak sesuai operator",
  "53": "Produk tidak tersedia untuk akun ini",
  "54": "Nomor tujuan salah",
  "55": "Produk sedang gangguan",
  "56": "Batas transaksi tercapai",
  "57": "Jumlah digit nomor tidak sesuai",
  "58": "Operator sedang cut off",
  "59": "Nomor tujuan di luar wilayah produk",
  "60": "Tagihan belum tersedia",
  "61": "Akun belum pernah melakukan deposit"
};

function failureMeaning(code: string | null): string | null {
  if (!code) return null;
  const match = /^DIGIFLAZZ_RC_(\d+)$/.exec(code);
  if (!match) return null;
  return RC_MEANING[match[1]] ?? "Kode belum dikenal; cek dasbor Digiflazz dengan referensi transaksi ini";
}

function duration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds} detik`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} menit ${seconds % 60} detik`;
}

function DetailPanel({ item, onClose }: { item: DigiflazzTxItem; onClose: () => void }) {
  const meaning = failureMeaning(item.failureCode);
  const style = STATUS_STYLE[item.status] ?? { label: item.status, className: "bg-slate-200 text-slate-700" };
  const fields: Array<[string, string]> = [
    ["Referensi (ref_id)", item.reference],
    ["Referensi dari Digiflazz", item.providerReference ?? "Belum ada"],
    ["Penyedia", item.provider],
    ["Kategori", CATEGORY_LABEL[item.category] ?? item.category],
    ["Kode produk TapGo", item.sku],
    ["Kode produk Digiflazz", item.providerSku ?? "—"],
    ["Nomor tujuan", item.targetMasked],
    ["Serial / token", item.serialMasked ?? "—"],
    ["Pelanggan", `${item.userName} · ${item.phoneMasked}`],
    ["Harga produk", formatRupiah(item.amount)],
    ["Biaya layanan", formatRupiah(item.adminFee)],
    ["Total dibayar", formatRupiah(item.totalAmount)],
    ["Modal Digiflazz", item.providerCost === null ? "Tidak tercatat" : formatRupiah(item.providerCost)],
    ["Selisih", item.margin === null ? "—" : formatRupiah(item.margin)],
    ["Lama proses", duration(item.durationSeconds)],
    ["Dibuat", formatMoment(item.createdAt)],
    ["Selesai", formatMoment(item.completedAt)]
  ];
  return (
    <section aria-label="Detail transaksi" data-testid="dg-detail" className="mb-4 rounded-2xl border border-brand-navy/20 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Detail transaksi</p>
          <h2 className="mt-0.5 text-lg font-black">{item.productName}</h2>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${style.className}`}>{style.label}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          Tutup
        </button>
      </div>
      <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</dt>
            <dd className="mt-0.5 break-all font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {item.stuck ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Transaksi ini belum selesai melewati batas wajar. Pekerjaan rekonsiliasi menanyakan statusnya ke Digiflazz secara berkala; bila tetap
          tertahan, cocokkan ref_id di atas dengan dasbor Digiflazz.
        </p>
      ) : null}
      {item.failureCode || item.failureReason ? (
        <div className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <p className="font-bold">Alasan gagal{item.failureCode ? ` · ${item.failureCode}` : ""}</p>
          {meaning ? <p className="mt-0.5">{meaning}</p> : null}
          {item.failureReason ? <p className="mt-0.5 text-rose-700">{item.failureReason}</p> : null}
          {item.status === "FAILED" ? (
            <p className="mt-1 text-rose-700">{item.refunded ? "Saldo pelanggan sudah dikembalikan." : "Pengembalian saldo belum tercatat untuk transaksi ini."}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default function DigiflazzTransactionsPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<DigiflazzTxStatus | "">("");
  const [category, setCategory] = useState("");
  const [period, setPeriod] = useState<PeriodState>(() => defaultPeriod("all"));
  const range = useMemo(() => periodQuery(period), [period]);
  const [stuckOnly, setStuckOnly] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DigiflazzTxList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await listDigiflazzTransactions({
          page,
          ...(status && !stuckOnly ? { status } : {}),
          ...(category ? { category } : {}),
          ...(search ? { search } : {}),
          ...(stuckOnly ? { stuck: true } : {}),
          range
        })
      );
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [page, status, category, range, search, stuckOnly]);

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

  const selected = data?.items.find((item) => item.id === openId) ?? null;
  const byStatus = data?.summary.byStatus ?? {};
  const success = data?.summary.success;
  // Hanya dari transaksi yang modalnya tercatat; penjualan tanpa modal bukan selisih penuh.
  const margin = success ? success.costedSales - success.providerCost : 0;
  const cards: Array<{ label: string; value: number; tone: string; hint?: string }> = [
    { label: "Berhasil", value: byStatus.SUCCESS ?? 0, tone: "text-emerald-700" },
    { label: "Diproses / menunggu", value: (byStatus.PROCESSING ?? 0) + (byStatus.PENDING ?? 0), tone: "text-sky-700" },
    {
      label: "Tertahan",
      value: data?.summary.stuck ?? 0,
      tone: (data?.summary.stuck ?? 0) > 0 ? "text-amber-700" : "text-slate-700",
      hint: data ? `lebih dari ${data.summary.stuckAfterMinutes} menit belum selesai` : undefined
    },
    { label: "Gagal", value: byStatus.FAILED ?? 0, tone: "text-rose-700", hint: "saldo pelanggan sudah dikembalikan" }
  ];

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader
          title="Transaksi Digiflazz"
          subtitle="Setiap pembelian PPOB yang dikirim ke Digiflazz. Hanya baca; nomor tujuan, nomor HP, dan token disamarkan."
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

        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="dg-summary">
          {cards.map((card) => (
            <div key={card.label} className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{card.label}</p>
              <p className={`mt-1 text-3xl font-black tabular-nums ${card.tone}`}>{card.value}</p>
              {card.hint ? <p className="mt-1 text-xs text-slate-500">{card.hint}</p> : null}
            </div>
          ))}
        </div>

        {success && success.count > 0 ? (
          <p className="mb-5 rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm" data-testid="dg-money">
            Penjualan berhasil <strong className="tabular-nums text-slate-900">{formatRupiah(success.sales)}</strong>
            {success.withCostCount > 0 ? (
              <>
                {" "}· modal Digiflazz <strong className="tabular-nums text-slate-900">{formatRupiah(success.providerCost)}</strong> · selisih{" "}
                <strong className="tabular-nums text-emerald-700">{formatRupiah(margin)}</strong>
              </>
            ) : null}
            {success.withCostCount < success.count ? (
              <span className="text-amber-700">
                {" "}
                (modal tercatat pada {success.withCostCount} dari {success.count} transaksi, jadi selisih belum utuh)
              </span>
            ) : null}
          </p>
        ) : (
          <div className="mb-5" />
        )}

        <div className="mb-4">
          <PeriodFilter
            value={period}
            onChange={(next) => {
              setPage(1);
              setPeriod(next);
            }}
            allowAll
            disabled={loading}
          />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Status transaksi">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id || "all"}
                type="button"
                role="tab"
                aria-selected={!stuckOnly && status === tab.id}
                onClick={() => {
                  setPage(1);
                  setStuckOnly(false);
                  setStatus(tab.id);
                }}
                className={[
                  "rounded-lg px-3.5 py-1.5 text-sm font-bold transition",
                  !stuckOnly && status === tab.id ? "bg-brand-navy text-white" : "bg-white text-slate-600 hover:bg-slate-200"
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))}
            <button
              type="button"
              role="tab"
              aria-selected={stuckOnly}
              onClick={() => {
                setPage(1);
                setStatus("");
                setStuckOnly((value) => !value);
              }}
              className={[
                "rounded-lg px-3.5 py-1.5 text-sm font-bold transition",
                stuckOnly ? "bg-amber-600 text-white" : "bg-white text-amber-700 hover:bg-amber-50"
              ].join(" ")}
            >
              Tertahan
            </button>
          </div>
          <select
            aria-label="Kategori produk"
            value={category}
            onChange={(event) => {
              setPage(1);
              setCategory(event.target.value);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700"
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.id || "all"} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <form
            className="flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchInput.trim());
            }}
          >
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Cari referensi (ref_id), produk, atau nomor"
              aria-label="Cari transaksi"
              className="w-72 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
            <button type="submit" className="rounded-lg bg-brand-navy px-3.5 py-1.5 text-sm font-bold text-white">
              Cari
            </button>
            {search ? (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                  setPage(1);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-600"
              >
                Hapus
              </button>
            ) : null}
          </form>
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
            <p className="font-bold">Belum ada transaksi pada pilihan ini</p>
            <p className="mt-1 text-sm text-slate-500">Pembelian pelanggan lewat Digiflazz akan muncul di sini.</p>
          </div>
        ) : data ? (
          <>
            {selected ? <DetailPanel item={selected} onClose={() => setOpenId(null)} /> : null}
            <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Produk</th>
                    <th className="px-4 py-3">Pelanggan</th>
                    <th className="px-4 py-3 text-right">Dibayar</th>
                    <th className="px-4 py-3 text-right">Modal</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Waktu</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((item) => {
                    const style = STATUS_STYLE[item.status] ?? { label: item.status, className: "bg-slate-200 text-slate-700" };
                    const open = openId === item.id;
                    return (
                      <tr key={item.id} className={open ? "bg-slate-50 align-top" : "align-top"} data-testid="dg-row">
                        <td className="px-4 py-3">
                          <p className="font-bold">{item.productName}</p>
                          <p className="font-mono text-[11px] text-slate-400">{item.reference}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{item.userName}</p>
                          <p className="text-xs text-slate-500">tujuan {item.targetMasked}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-black tabular-nums">{formatRupiah(item.totalAmount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {item.providerCost === null ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <>
                              <p>{formatRupiah(item.providerCost)}</p>
                              {item.margin !== null ? <p className="text-[11px] text-emerald-700">selisih {formatRupiah(item.margin)}</p> : null}
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${style.className}`}>{style.label}</span>
                          {item.stuck ? <p className="mt-1 text-[11px] font-semibold text-amber-700">Tertahan, menunggu rekonsiliasi</p> : null}
                          {item.status === "FAILED" ? (
                            <p className="mt-1 text-[11px] text-slate-500">{item.refunded ? "Saldo dikembalikan" : "Saldo belum tercatat kembali"}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <p>Dibuat: {formatMoment(item.createdAt)}</p>
                          {item.completedAt ? <p>Selesai: {formatMoment(item.completedAt)}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => {
                              setOpenId(open ? null : item.id);
                              if (!open) window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            {open ? "Tutup" : "Detail"}
                          </button>
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
