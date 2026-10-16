"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  IncentiveClaim,
  IncentiveClaimStatus,
  IncentiveRule,
  IncentiveRuleInput,
  actOnIncentiveClaim,
  createIncentiveRule,
  formatMoment,
  formatRupiah,
  listIncentiveClaims,
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

const FLAG_LABEL: Record<string, string> = {
  NEW_ACCOUNTS: "Mayoritas penumpang akun baru (< 72 jam)",
  UNVERIFIED_PASSENGERS: "Mayoritas penumpang belum terverifikasi",
  SAME_ROUTE: "Rute yang sama berulang",
  HIGH_VOLUME: "Jumlah perjalanan tidak wajar dalam sehari",
  PRIOR_FRAUD: "Driver pernah punya klaim ditolak atau ditarik kembali"
};

const CLAIM_TABS: Array<{ id: IncentiveClaimStatus; label: string }> = [
  { id: "REVIEW", label: "Perlu tinjauan" },
  { id: "PENDING", label: "Menunggu masa tahan" },
  { id: "PAID", label: "Sudah dibayar" }
];

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
  const [claimTab, setClaimTab] = useState<IncentiveClaimStatus>("REVIEW");
  const [claims, setClaims] = useState<IncentiveClaim[] | null>(null);
  const [acting, setActing] = useState<{ id: string; action: "reject" | "reverse" } | null>(null);
  const [claimNote, setClaimNote] = useState("");

  const loadClaims = useCallback(async () => {
    try {
      setClaims(await listIncentiveClaims(claimTab));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Klaim belum dapat dimuat.");
    }
  }, [claimTab]);

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

  useEffect(() => {
    if (!readToken() || !roleAtLeast(readRole(), "SUPER_ADMIN")) return;
    void loadClaims();
  }, [loadClaims]);

  async function approveClaim(claim: IncentiveClaim) {
    if (busy) return;
    if (!window.confirm(`Setujui bonus ${formatRupiah(claim.amount)} untuk ${claim.driver.fullName}? Uang langsung masuk ke saldo driver yang dapat ditarik.`)) return;
    setBusy(true);
    try {
      await actOnIncentiveClaim(claim.id, "approve", "");
      setError("");
      await Promise.all([loadClaims(), load()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Klaim belum dapat disetujui.");
    } finally {
      setBusy(false);
    }
  }

  async function submitClaimAction() {
    if (busy || !acting) return;
    const note = claimNote.trim();
    if (note.length < 3) {
      setError("Tulis alasan (minimal 3 huruf).");
      return;
    }
    setBusy(true);
    try {
      await actOnIncentiveClaim(acting.id, acting.action, note);
      setActing(null);
      setClaimNote("");
      setError("");
      await Promise.all([loadClaims(), load()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tindakan belum dapat diproses.");
    } finally {
      setBusy(false);
    }
  }

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
      : `Aktifkan "${rule.name}"? Driver yang sudah memenuhi target hari ini akan mendapat klaim yang diverifikasi dulu sebelum dibayar.`;
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
          subtitle="Bonus harian untuk driver yang mencapai target perjalanan. Bonus masuk ke saldo driver yang dapat ditarik setelah masa tahan dan verifikasi ulang, dan baru tercatat sebagai beban di Laba Rugi saat dibayar."
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

        <section className="mt-10" data-testid="incentive-claims">
          <h2 className="text-xl font-black">Klaim bonus</h2>
          <p className="mt-1 text-sm text-slate-600">
            Bonus tidak langsung masuk saldo: setiap klaim diverifikasi ulang setelah masa tahan. Klaim dengan tanda kecurigaan ditahan di sini
            sampai Anda menyetujui atau menolaknya.
          </p>
          <div className="mb-4 mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Status klaim">
            {CLAIM_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={claimTab === tab.id}
                onClick={() => setClaimTab(tab.id)}
                className={["rounded-lg px-3.5 py-1.5 text-sm font-bold transition", claimTab === tab.id ? "bg-brand-navy text-white" : "bg-white text-slate-600 hover:bg-slate-200"].join(" ")}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {claims && claims.length === 0 ? (
            <p className="rounded-2xl bg-white px-6 py-8 text-center text-sm text-slate-500 shadow-sm">Tidak ada klaim pada tab ini.</p>
          ) : null}
          <div className="space-y-3">
            {(claims ?? []).map((claim) => (
              <article key={claim.id} data-testid="claim-row" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-black">{claim.driver.fullName}</h3>
                    <p className="text-sm text-slate-600">
                      {claim.driver.phone} · {claim.ruleName} · {claim.dayKey} · {claim.tripCount} perjalanan
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black">{formatRupiah(claim.amount)}</p>
                    <p className="text-xs text-slate-500">
                      {claim.status === "PAID" && claim.settledAt ? `Dibayar ${formatMoment(claim.settledAt)}` : `Jatuh tempo ${formatMoment(claim.settleAfter)}`}
                    </p>
                  </div>
                </div>
                {claim.flags.length > 0 ? (
                  <ul className="mt-3 space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    {claim.flags.map((flag) => (
                      <li key={flag}>⚠ {FLAG_LABEL[flag] ?? flag}</li>
                    ))}
                  </ul>
                ) : null}
                {claim.reviewNote ? <p className="mt-2 text-xs text-slate-500">Catatan: {claim.reviewNote}</p> : null}

                {acting?.id === claim.id ? (
                  <div className="mt-3 rounded-xl bg-slate-50 p-4">
                    <label className="text-sm font-bold" htmlFor={`claim-note-${claim.id}`}>
                      {acting.action === "reject" ? "Alasan penolakan" : "Alasan menarik kembali bonus"}
                    </label>
                    <textarea
                      id={`claim-note-${claim.id}`}
                      value={claimNote}
                      onChange={(event) => setClaimNote(event.target.value)}
                      maxLength={280}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                    <div className="mt-2 flex gap-2">
                      <button type="button" disabled={busy} onClick={() => void submitClaimAction()} className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-50">
                        {busy ? "Memproses…" : acting.action === "reject" ? "Tolak klaim" : "Tarik kembali"}
                      </button>
                      <button type="button" disabled={busy} onClick={() => { setActing(null); setClaimNote(""); }} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700">
                        Batal
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {claim.status === "REVIEW" ? (
                      <button type="button" disabled={busy} onClick={() => void approveClaim(claim)} className="rounded-lg bg-emerald-700 px-3.5 py-1.5 text-sm font-bold text-white hover:bg-emerald-800">
                        Setujui dan bayar
                      </button>
                    ) : null}
                    {claim.status === "REVIEW" || claim.status === "PENDING" ? (
                      <button type="button" disabled={busy} onClick={() => { setActing({ id: claim.id, action: "reject" }); setClaimNote(""); setError(""); }} className="rounded-lg bg-rose-50 px-3.5 py-1.5 text-sm font-bold text-rose-700 hover:bg-rose-100">
                        Tolak
                      </button>
                    ) : null}
                    {claim.status === "PAID" ? (
                      <button type="button" disabled={busy} onClick={() => { setActing({ id: claim.id, action: "reverse" }); setClaimNote(""); setError(""); }} className="rounded-lg bg-rose-50 px-3.5 py-1.5 text-sm font-bold text-rose-700 hover:bg-rose-100">
                        Tarik kembali
                      </button>
                    ) : null}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
