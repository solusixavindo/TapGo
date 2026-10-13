"use client";

import { useHardRouter as useRouter } from "../hard-nav";
import { useCallback, useEffect, useState } from "react";
import {
  DigiflazzOverview,
  formatMoment,
  formatRupiah,
  getDigiflazzBalance,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import ConsoleHeader from "../console-header";
import HardLink from "../hard-nav";

/**
 * Saldo deposit Digiflazz. Hanya baca.
 *
 * Saldo ini dipakai membayar seluruh pembelian PPOB pelanggan; bila habis, pembelian gagal. Halaman menunjukkan
 * saldo saat ini, seberapa lama kira-kira cukup (dari rata-rata pemakaian 7 hari), dan perbandingannya dengan saldo
 * PPOB pelanggan yang beredar. Angka dibaca dari Digiflazz dan disimpan sebentar (1 menit) agar tidak membebani
 * batas permintaan; tombol Muat ulang membacanya lagi (paling cepat tiap 15 detik).
 */

const LEVEL: Record<DigiflazzOverview["level"], { label: string; className: string; hint: string }> = {
  OK: { label: "Aman", className: "bg-emerald-100 text-emerald-800", hint: "Saldo di atas ambang peringatan." },
  LOW: { label: "Menipis", className: "bg-amber-100 text-amber-800", hint: "Isi saldo Digiflazz dalam waktu dekat." },
  CRITICAL: { label: "Kritis", className: "bg-rose-100 text-rose-800", hint: "Segera isi saldo Digiflazz; pembelian PPOB bisa gagal." },
  UNKNOWN: { label: "Belum terbaca", className: "bg-slate-200 text-slate-700", hint: "Saldo belum dapat dibaca dari Digiflazz." }
};

export default function DigiflazzBalancePage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [data, setData] = useState<DigiflazzOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    try {
      setData(await getDigiflazzBalance(refresh));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

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
    void load(false);
  }, [router, load]);

  const level = data ? LEVEL[data.level] : null;
  const balance = data?.provider.balance ?? null;

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-4xl">
        <ConsoleHeader
          title="Saldo Digiflazz"
          subtitle="Saldo deposit untuk membayar pembelian PPOB pelanggan. Hanya baca."
          role={role}
          actions={
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "Memuat…" : "Muat ulang"}
            </button>
          }
        />

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {!data ? (
          loading ? <p className="text-sm text-slate-500">Memuat…</p> : null
        ) : !data.provider.configured ? (
          <div className="rounded-2xl bg-white px-6 py-10 text-center shadow-sm">
            <p className="font-bold">Digiflazz belum aktif di server</p>
            <p className="mt-1 text-sm text-slate-500">
              Penyedia PPOB saat ini: {data.provider.provider}. Saldo hanya dapat dibaca bila penyedia PPOB adalah Digiflazz.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl bg-brand-navy p-6 text-white shadow-sm" data-testid="df-balance">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Saldo deposit Digiflazz</p>
              <p className="mt-2 text-4xl font-black tabular-nums">{balance === null ? "—" : formatRupiah(balance)}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {level ? (
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${level.className}`}>{level.label}</span>
                ) : null}
                <p className="text-sm text-slate-200">{level?.hint}</p>
              </div>
              <p className="mt-3 text-xs text-slate-300">
                {data.provider.checkedAt ? `Dibaca ${formatMoment(data.provider.checkedAt)}` : "Belum pernah terbaca"}
                {data.provider.stale && data.provider.checkedAt ? " (bacaan terakhir yang berhasil)" : ""}
              </p>
              {data.provider.error ? (
                <p role="alert" className="mt-3 rounded-lg bg-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-100">
                  {data.provider.error}
                </p>
              ) : null}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Terpakai hari ini</p>
                <p className="mt-1 text-xl font-black tabular-nums">{formatRupiah(data.spend.today.cost)}</p>
                <p className="text-xs text-slate-500">{data.spend.today.count} transaksi sukses</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Rata-rata per hari (7 hari)</p>
                <p className="mt-1 text-xl font-black tabular-nums">{formatRupiah(data.spend.last7Days.averagePerDay)}</p>
                <p className="text-xs text-slate-500">{data.spend.last7Days.count} transaksi, {formatRupiah(data.spend.last7Days.cost)}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Perkiraan cukup untuk</p>
                <p className="mt-1 text-xl font-black tabular-nums">
                  {data.estimatedDaysLeft === null ? "—" : `${data.estimatedDaysLeft.toLocaleString("id-ID")} hari`}
                </p>
                <p className="text-xs text-slate-500">dari rata-rata pemakaian 7 hari</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Transaksi tertahan</p>
                <p className="mt-1 text-xl font-black tabular-nums">{data.inFlight.count}</p>
                <p className="text-xs text-slate-500">senilai {formatRupiah(data.inFlight.amount)}</p>
                <HardLink href="/transaksi-digiflazz" className="mt-1 inline-block text-xs font-bold text-brand-navy underline">
                  Lihat transaksi
                </HardLink>
              </div>
            </div>

            <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Dibandingkan dengan kewajiban ke pelanggan</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">Saldo PPOB pelanggan yang beredar</dt>
                  <dd className="font-bold tabular-nums">{formatRupiah(data.customerPpobLiability)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">Saldo Digiflazz dibanding saldo pelanggan</dt>
                  <dd className="font-bold tabular-nums">
                    {data.coverageRatio === null ? "—" : `${data.coverageRatio.toLocaleString("id-ID")}×`}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">Ambang peringatan</dt>
                  <dd className="font-bold tabular-nums">
                    menipis di bawah {formatRupiah(data.thresholds.warn)}, kritis di bawah {formatRupiah(data.thresholds.critical)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Saldo pelanggan adalah kewajiban menyediakan layanan, bukan saldo Digiflazz. Angka di bawah 1× berarti seandainya semua
                pelanggan membelanjakan seluruh saldo PPOB-nya sekaligus, deposit Digiflazz saat ini tidak cukup (menurut harga modal dapat lebih kecil dari nilai saldo).
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
