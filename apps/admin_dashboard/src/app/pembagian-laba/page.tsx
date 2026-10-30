"use client";

import { useHardRouter as useRouter } from "../hard-nav";
import { useCallback, useEffect, useState } from "react";
import {
  ProfitPeriod,
  ProfitPreview,
  approveProfitPeriod,
  createProfitPeriod,
  distributeProfitPeriod,
  formatMoment,
  formatRupiah,
  getProfitPeriod,
  listProfitPeriods,
  previewProfitPeriod,
  readRole,
  readToken,
  roleAtLeast
} from "../../lib/api";
import ConsoleHeader from "../console-header";

/**
 * Pembagian laba bulanan. Alurnya tiga langkah: buat periode (DRAFT) -> setujui -> bagikan.
 * Hanya langkah terakhir memindahkan uang: bagian tiap golongan dibagi rata ke anggota aktif golongan itu dan
 * masuk ke saldo yang dapat ditarik. Pembagian tidak dapat dibatalkan dan server menolak pembagian ganda.
 * Pratinjau dihitung server dengan aturan yang sama persis dengan pembagian sungguhan.
 */

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const STATUS_LABEL = { DRAFT: "Draf", APPROVED: "Disetujui", DISTRIBUTED: "Sudah dibagikan" } as const;
const STATUS_TONE = {
  DRAFT: "bg-slate-200 text-slate-700",
  APPROVED: "bg-amber-100 text-amber-900",
  DISTRIBUTED: "bg-emerald-100 text-emerald-800"
} as const;
const PHRASE = "BAGIKAN";

export default function ProfitSharingPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [periods, setPeriods] = useState<ProfitPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [profit, setProfit] = useState("");

  const [selected, setSelected] = useState<ProfitPeriod | null>(null);
  const [preview, setPreview] = useState<ProfitPreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phrase, setPhrase] = useState("");

  const refresh = useCallback(async () => {
    try {
      setPeriods(await listProfitPeriods());
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
    void refresh();
  }, [router, refresh]);

  async function openPeriod(id: string) {
    setError("");
    setNotice("");
    setConfirmOpen(false);
    setPhrase("");
    try {
      const detail = await getProfitPeriod(id);
      setSelected(detail);
      setPreview(detail.status === "DISTRIBUTED" ? null : await previewProfitPeriod(id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Periode belum dapat dibuka.");
    }
  }

  async function create() {
    const amount = Number(profit.replace(/[^0-9]/g, ""));
    if (!amount || amount <= 0) {
      setError("Isi laba bersih dalam rupiah (angka lebih dari nol).");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await createProfitPeriod(month, year, amount);
      setNotice(`Periode ${MONTHS[month - 1]} ${year} dibuat sebagai draf.`);
      setProfit("");
      await refresh();
      await openPeriod(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Periode belum dapat dibuat.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await approveProfitPeriod(selected.id);
      setNotice("Periode disetujui. Periksa pratinjau, lalu bagikan.");
      await refresh();
      await openPeriod(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Periode belum dapat disetujui.");
    } finally {
      setBusy(false);
    }
  }

  async function distribute() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await distributeProfitPeriod(selected.id);
      setNotice("Laba dibagikan ke saldo penerima.");
      setConfirmOpen(false);
      setPhrase("");
      await refresh();
      await openPeriod(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pembagian belum dapat diproses.");
    } finally {
      setBusy(false);
    }
  }

  const tiers = preview
    ? ([
        ["Silver", preview.silver],
        ["Gold", preview.gold],
        ["Platinum", preview.platinum]
      ] as const)
    : [];

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <ConsoleHeader
          title="Pembagian Laba"
          subtitle="Pool 60% dari laba bersih: Silver 30%, Gold 20%, Platinum 10%, dibagi rata per golongan."
          role={role}
        />

        {notice ? (
          <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">Buat periode baru</h2>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Bulan
              <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal">
                {MONTHS.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Tahun
              <input
                type="number"
                min={2024}
                max={2200}
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
                className="mt-1 block w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal"
              />
            </label>
            <label className="min-w-[220px] flex-1 text-xs font-bold uppercase tracking-wider text-slate-500">
              Laba bersih (Rp)
              <input
                inputMode="numeric"
                value={profit}
                onChange={(event) => setProfit(event.target.value)}
                placeholder="Contoh: 10000000"
                autoComplete="off"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void create()}
              className="rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              Buat draf
            </button>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Periode</h2>
            {loading ? (
              <p className="text-sm text-slate-500">Memuat…</p>
            ) : periods.length === 0 ? (
              <p className="rounded-xl bg-white px-5 py-8 text-center text-sm text-slate-500">Belum ada periode.</p>
            ) : (
              <ul className="space-y-2" data-testid="period-list">
                {periods.map((period) => (
                  <li key={period.id}>
                    <button
                      type="button"
                      onClick={() => void openPeriod(period.id)}
                      className={[
                        "flex w-full items-center justify-between gap-3 rounded-xl border bg-white p-4 text-left",
                        selected?.id === period.id ? "border-brand-navy" : "border-slate-200"
                      ].join(" ")}
                    >
                      <span>
                        <span className="block text-sm font-bold">
                          {MONTHS[period.periodMonth - 1]} {period.periodYear}
                        </span>
                        <span className="block text-xs text-slate-500">Laba bersih {formatRupiah(period.netProfitAmount)}</span>
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[period.status]}`}>
                        {STATUS_LABEL[period.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            {selected ? (
              <div className="rounded-xl border border-slate-200 bg-white p-5" data-testid="period-detail">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-black">
                    {MONTHS[selected.periodMonth - 1]} {selected.periodYear}
                  </h2>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[selected.status]}`}>
                    {STATUS_LABEL[selected.status]}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-slate-500">Laba bersih</dt>
                  <dd className="text-right font-bold tabular-nums">{formatRupiah(selected.netProfitAmount)}</dd>
                  <dt className="text-slate-500">Pool (60%)</dt>
                  <dd className="text-right font-bold tabular-nums">{formatRupiah(selected.totalPoolAmount)}</dd>
                  {selected.distributedAt ? (
                    <>
                      <dt className="text-slate-500">Dibagikan</dt>
                      <dd className="text-right">{formatMoment(selected.distributedAt)}</dd>
                      <dt className="text-slate-500">Tidak terbagi (ditahan)</dt>
                      <dd className="text-right font-bold tabular-nums">{formatRupiah(selected.retainedAmount)}</dd>
                    </>
                  ) : null}
                </dl>

                {preview ? (
                  <div className="mt-4 overflow-x-auto">
                    <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Pratinjau pembagian</p>
                    <table className="w-full min-w-[420px] text-left text-sm" data-testid="profit-preview">
                      <thead className="border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="py-2">Golongan</th>
                          <th className="py-2 text-right">Bagian</th>
                          <th className="py-2 text-right">Penerima</th>
                          <th className="py-2 text-right">Per orang</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {tiers.map(([label, tier]) => (
                          <tr key={label}>
                            <td className="py-2 font-bold">{label}</td>
                            <td className="py-2 text-right tabular-nums">{formatRupiah(tier.allocation)}</td>
                            <td className="py-2 text-right tabular-nums">{tier.recipients}</td>
                            <td className="py-2 text-right tabular-nums">{tier.perMember ? formatRupiah(tier.perMember) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-[11px] leading-5 text-slate-500">
                      Golongan tanpa penerima tidak dibagikan; bagiannya tetap ditahan perusahaan. Daftar penerima dihitung saat Anda
                      menekan Bagikan, jadi angka bisa bergeser bila ada perubahan keanggotaan sebelum itu.
                    </p>
                  </div>
                ) : null}

                {selected.status === "DRAFT" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void approve()}
                    className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >
                    Setujui periode
                  </button>
                ) : null}

                {selected.status === "APPROVED" ? (
                  confirmOpen ? (
                    <div className="mt-4 space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                      <p className="text-xs leading-5 text-rose-900">
                        Bagian langsung masuk ke saldo yang dapat ditarik semua penerima di atas dan tidak dapat dibatalkan. Ketik{" "}
                        <strong>{PHRASE}</strong> untuk melanjutkan.
                      </p>
                      <input
                        value={phrase}
                        onChange={(event) => setPhrase(event.target.value)}
                        autoComplete="off"
                        name="konfirmasi-bagi-laba"
                        className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy || phrase.trim().toUpperCase() !== PHRASE}
                          onClick={() => void distribute()}
                          className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                        >
                          {busy ? "Memproses…" : "Bagikan sekarang"}
                        </button>
                        <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-600">
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmOpen(true)}
                      className="mt-4 rounded-lg bg-brand-navy px-4 py-2 text-sm font-bold text-white"
                    >
                      Bagikan laba…
                    </button>
                  )
                ) : null}

                {selected.status === "DISTRIBUTED" && selected.distributions ? (
                  <div className="mt-4 overflow-x-auto">
                    <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Penerima ({selected.distributions.length})
                    </p>
                    <table className="w-full min-w-[420px] text-left text-sm">
                      <tbody className="divide-y divide-slate-100">
                        {selected.distributions.map((row) => (
                          <tr key={row.id}>
                            <td className="py-2">
                              <span className="font-bold">{row.user.fullName}</span>
                              <span className="block text-xs text-slate-500">{row.user.phone}</span>
                            </td>
                            <td className="py-2 text-xs font-bold text-slate-600">{row.category}</td>
                            <td className="py-2 text-right tabular-nums">{formatRupiah(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="rounded-xl bg-white px-5 py-8 text-center text-sm text-slate-500">Pilih periode untuk melihat rinciannya.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
