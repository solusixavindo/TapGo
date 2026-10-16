"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  IncentiveRule,
  IncentiveRuleInput,
  createIncentiveRule,
  formatRupiah,
  listIncentiveRules,
  readRole,
  readToken,
  roleAtLeast,
  updateIncentiveRule
} from "../../lib/api";
import ConsoleHeader from "../console-header";
import { useHardRouter as useRouter } from "../hard-nav";

/**
 * Insentif harian driver: "selesaikan N perjalanan dalam satu hari (WIB), dapatkan bonus". Bonus langsung masuk ke saldo
 * driver yang dapat ditarik, dan dicatat sebagai beban di Laba Rugi. Hanya Super Admin. Setiap perubahan tercatat di audit.
 *
 * Pengaman: bonus Rp1.000-Rp500.000, target 1-100 perjalanan, maksimal 10 aturan aktif, dan anggaran harian opsional yang
 * menghentikan pembayaran aturan itu begitu habis. Aturan tidak dihapus agar riwayat bonus tetap utuh: cukup dinonaktifkan.
 */

type Draft = {
  name: string;
  targetTrips: string;
  bonusAmount: string;
  minTripFare: string;
  dailyBudget: string;
  startsAt: string;
  endsAt: string;
};

const EMPTY: Draft = { name: "", targetTrips: "", bonusAmount: "", minTripFare: "0", dailyBudget: "", startsAt: "", endsAt: "" };

/** Server mengirim waktu UTC; tanggal aturan dipahami dalam WIB (UTC+7). */
function toDateInput(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Date(parsed.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

function draftOf(rule: IncentiveRule): Draft {
  return {
    name: rule.name,
    targetTrips: String(rule.targetTrips),
    bonusAmount: String(rule.bonusAmount),
    minTripFare: String(rule.minTripFare),
    dailyBudget: rule.dailyBudget === null ? "" : String(rule.dailyBudget),
    startsAt: toDateInput(rule.startsAt),
    endsAt: toDateInput(rule.endsAt)
  };
}

function parseDraft(draft: Draft): { input?: Omit<IncentiveRuleInput, "isActive">; error?: string } {
  const name = draft.name.trim();
  const target = Number(draft.targetTrips);
  const bonus = Number(draft.bonusAmount);
  const minFare = draft.minTripFare === "" ? 0 : Number(draft.minTripFare);
  const budget = draft.dailyBudget === "" ? null : Number(draft.dailyBudget);
  if (!name) return { error: "Nama aturan wajib diisi." };
  if (!Number.isInteger(target) || target < 1 || target > 100) return { error: "Target perjalanan harus bilangan bulat 1 sampai 100." };
  if (!Number.isFinite(bonus) || bonus < 1000 || bonus > 500000) return { error: "Bonus harus Rp1.000 sampai Rp500.000." };
  if (!Number.isFinite(minFare) || minFare < 0) return { error: "Tarif minimum tidak boleh negatif." };
  if (budget !== null && (!Number.isFinite(budget) || budget < bonus)) return { error: "Anggaran harian tidak boleh lebih kecil dari satu bonus." };
  const startsAt = draft.startsAt ? `${draft.startsAt}T00:00:00+07:00` : null;
  const endsAt = draft.endsAt ? `${draft.endsAt}T00:00:00+07:00` : null;
  if (startsAt && endsAt && endsAt <= startsAt) return { error: "Tanggal berakhir harus setelah tanggal mulai." };
  return { input: { name, targetTrips: target, bonusAmount: bonus, minTripFare: minFare, dailyBudget: budget, startsAt, endsAt } };
}

function Field(props: { label: string; hint?: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: "numeric"; testId: string }) {
  return (
    <label className="block text-sm">
      <span className="font-bold">{props.label}</span>
      <input
        data-testid={props.testId}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
      />
      {props.hint ? <span className="mt-0.5 block text-xs text-slate-500">{props.hint}</span> : null}
    </label>
  );
}

export default function IncentivePage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [rules, setRules] = useState<IncentiveRule[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRules(await listIncentiveRules());
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
    void load();
  }, [router, load]);

  function startNew() {
    setEditing("new");
    setDraft(EMPTY);
    setError("");
  }

  function startEdit(rule: IncentiveRule) {
    setEditing(rule.id);
    setDraft(draftOf(rule));
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = parseDraft(draft);
    if (!parsed.input) {
      setError(parsed.error ?? "Isian belum benar.");
      return;
    }
    setBusy(true);
    try {
      if (editing === "new") await createIncentiveRule({ ...parsed.input, isActive: true });
      else if (editing) await updateIncentiveRule(editing, parsed.input);
      setEditing(null);
      setError("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aturan belum dapat disimpan.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: IncentiveRule) {
    if (busy) return;
    const message = rule.isActive
      ? `Nonaktifkan "${rule.name}"? Bonus baru tidak akan dibayarkan, bonus yang sudah dibayar tetap.`
      : `Aktifkan "${rule.name}"? Driver yang sudah memenuhi target hari ini akan langsung menerima bonus saat berikutnya mereka membuka progres atau menyelesaikan perjalanan.`;
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      await updateIncentiveRule(rule.id, { isActive: !rule.isActive });
      setError("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Status aturan belum dapat diubah.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <ConsoleHeader
          title="Insentif Driver"
          subtitle="Bonus harian untuk driver yang mencapai target perjalanan. Bonus langsung masuk ke saldo driver yang dapat ditarik dan tercatat sebagai beban di Laba Rugi."
          role={role}
          actions={
            <button
              type="button"
              onClick={startNew}
              className="rounded-lg bg-brand-navy px-3.5 py-2 text-sm font-bold text-white hover:opacity-90"
              data-testid="incentive-new"
            >
              Aturan baru
            </button>
          }
        />

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {editing ? (
          <form onSubmit={submit} className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="incentive-form">
            <h2 className="text-lg font-black">{editing === "new" ? "Aturan baru" : "Ubah aturan"}</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Nama aturan" testId="incentive-name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} hint="Tampil ke driver, mis. Rajin 5 perjalanan." />
              <Field label="Target perjalanan per hari" testId="incentive-target" inputMode="numeric" value={draft.targetTrips} onChange={(v) => setDraft({ ...draft, targetTrips: v })} hint="1 sampai 100. Hari dihitung WIB (00.00-24.00)." />
              <Field label="Bonus (Rp)" testId="incentive-bonus" inputMode="numeric" value={draft.bonusAmount} onChange={(v) => setDraft({ ...draft, bonusAmount: v })} hint="Rp1.000 sampai Rp500.000, dibayar sekali per driver per hari." />
              <Field label="Tarif minimum yang dihitung (Rp)" testId="incentive-minfare" inputMode="numeric" value={draft.minTripFare} onChange={(v) => setDraft({ ...draft, minTripFare: v })} hint="Perjalanan dengan tarif di bawah ini tidak dihitung. 0 = semua." />
              <Field label="Anggaran harian (Rp, opsional)" testId="incentive-budget" inputMode="numeric" value={draft.dailyBudget} onChange={(v) => setDraft({ ...draft, dailyBudget: v })} hint="Total bonus aturan ini per hari. Kosong = tanpa batas." />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mulai (opsional)" testId="incentive-start" type="date" value={draft.startsAt} onChange={(v) => setDraft({ ...draft, startsAt: v })} />
                <Field label="Berakhir (opsional)" testId="incentive-end" type="date" value={draft.endsAt} onChange={(v) => setDraft({ ...draft, endsAt: v })} />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="submit" disabled={busy} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50" data-testid="incentive-save">
                {busy ? "Menyimpan…" : "Simpan"}
              </button>
              <button type="button" disabled={busy} onClick={() => setEditing(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700">
                Batal
              </button>
            </div>
          </form>
        ) : null}

        {loading && !rules ? <p className="text-sm text-slate-500">Memuat…</p> : null}

        {rules && rules.length === 0 ? (
          <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-sm">
            <p className="font-bold">Belum ada aturan insentif</p>
            <p className="mt-1 text-sm text-slate-500">Buat aturan pertama: misalnya 5 perjalanan sehari, bonus Rp25.000.</p>
          </div>
        ) : null}

        <div className="space-y-3">
          {(rules ?? []).map((rule) => (
            <section key={rule.id} data-testid="incentive-row" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${rule.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                    {rule.isActive ? "Aktif" : "Nonaktif"}
                  </span>
                  <h2 className="mt-1.5 text-lg font-black">{rule.name}</h2>
                  <p className="text-sm text-slate-600">
                    {rule.targetTrips} perjalanan sehari · bonus {formatRupiah(rule.bonusAmount)}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p data-testid="incentive-paid-today">
                    Hari ini: {rule.paidTodayCount} driver · {formatRupiah(rule.paidTodayAmount)}
                  </p>
                  {rule.dailyBudget !== null ? <p>Anggaran harian {formatRupiah(rule.dailyBudget)}</p> : <p>Tanpa anggaran harian</p>}
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Tarif minimum {rule.minTripFare > 0 ? formatRupiah(rule.minTripFare) : "tidak ada"}
                {rule.startsAt ? ` · mulai ${toDateInput(rule.startsAt)}` : ""}
                {rule.endsAt ? ` · berakhir ${toDateInput(rule.endsAt)}` : ""}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy} onClick={() => startEdit(rule)} className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
                  Ubah
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void toggle(rule)}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-bold ${rule.isActive ? "bg-rose-50 text-rose-700 hover:bg-rose-100" : "bg-emerald-700 text-white hover:bg-emerald-800"}`}
                >
                  {rule.isActive ? "Nonaktifkan" : "Aktifkan"}
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
