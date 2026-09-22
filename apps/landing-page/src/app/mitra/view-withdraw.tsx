"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, BankAccount, Withdrawal } from "./mitra-api";
import {
  BANKS,
  MIN_WITHDRAWAL,
  bankCooldownRemaining,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRupiah,
  maskAccount
} from "./mitra-format";
import { useMitra } from "./mitra-data";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Icon,
  Modal,
  Notice,
  PageHeading,
  Spinner,
  Tone,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  useToast
} from "./mitra-ui";

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Menunggu persetujuan", tone: "amber" },
  APPROVED: { label: "Disetujui, menunggu transfer", tone: "blue" },
  PAID: { label: "Sudah ditransfer", tone: "green" },
  REJECTED: { label: "Ditolak", tone: "red" },
  CANCELLED: { label: "Dibatalkan", tone: "slate" }
};

const QUICK_AMOUNTS = [100_000, 250_000, 500_000, 1_000_000];

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function errorMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    switch (caught.code) {
      case "WITHDRAWAL_PASSWORD_INVALID":
        return "Password tidak sesuai. Periksa kembali lalu coba lagi.";
      case "WITHDRAWAL_BANK_ACCOUNT_COOLDOWN":
        return "Rekening yang baru disimpan atau diubah baru dapat dipakai 24 jam setelahnya.";
      case "WITHDRAWAL_BANK_ACCOUNT_REQUIRED":
        return "Simpan rekening bank terlebih dahulu.";
      case "INSUFFICIENT_BALANCE":
        return "Saldo yang dapat ditarik tidak mencukupi.";
      case "WITHDRAWAL_RATE_LIMITED":
      case "RATE_LIMITED":
        return "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.";
      case "WITHDRAWAL_WEB_DISABLED":
        return "Penarikan dana belum dibuka.";
      default:
        return caught.message;
    }
  }
  return "Permintaan belum dapat diproses. Coba lagi.";
}

/* ----------------------------- Rekening bank ----------------------------- */

function BankCard({ bank, cooldownMs }: { bank: BankAccount | null; cooldownMs: number }) {
  const { saveBank } = useMitra();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [bankCode, setBankCode] = useState(bank?.bankCode ?? "");
  const [number, setNumber] = useState(bank?.accountNumber ?? "");
  const [holder, setHolder] = useState(bank?.accountHolderName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const showForm = editing || !bank;

  function startEdit() {
    setBankCode(bank?.bankCode ?? "");
    setNumber(bank?.accountNumber ?? "");
    setHolder(bank?.accountHolderName ?? "");
    setError("");
    setEditing(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const selected = BANKS.find((item) => item.code === bankCode);
    if (!selected) return setError("Pilih bank tujuan.");
    if (number.length < 6) return setError("Nomor rekening minimal 6 digit.");
    if (holder.trim().length < 2) return setError("Isi nama pemilik rekening sesuai buku tabungan.");
    setBusy(true);
    setError("");
    try {
      await saveBank({
        bankName: selected.name,
        bankCode: selected.code,
        accountNumber: number,
        accountHolderName: holder.trim().toUpperCase()
      });
      setEditing(false);
      toast("success", "Rekening tersimpan. Rekening baru dapat dipakai penarikan setelah 24 jam.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Rekening tujuan"
        subtitle="Dana hanya dikirim ke rekening atas nama Anda"
        action={
          bank && !editing ? (
            <button
              type="button"
              onClick={startEdit}
              className="text-xs font-bold text-[var(--themed-accent-gold)] hover:underline"
            >
              Ubah
            </button>
          ) : undefined
        }
      />
      <div className="p-5 md:p-6">
        {!showForm && bank ? (
          <div>
            <div className="flex items-center gap-4 rounded-xl themed-fill p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl m-tone-gold">
                <Icon name="bank" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-black themed-text">{bank.bankName}</p>
                <p className="m-num text-sm themed-text-secondary">{maskAccount(bank.accountNumber)}</p>
                <p className="truncate text-xs themed-text-muted">{bank.accountHolderName}</p>
              </div>
            </div>
            {cooldownMs > 0 ? (
              <div className="mt-4">
                <Notice tone="amber" title="Rekening baru masih dalam masa tunggu">
                  Penarikan dapat dilakukan {formatDuration(cooldownMs)} lagi. Jeda ini melindungi dana Anda bila akun
                  diakses pihak lain.
                </Notice>
              </div>
            ) : null}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Bank">
              <select
                className={inputClass}
                value={bankCode}
                onChange={(event) => setBankCode(event.target.value)}
                required
              >
                <option value="">Pilih bank</option>
                {BANKS.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nomor rekening">
              <input
                className={inputClass}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Contoh: 8830123456"
                value={number}
                maxLength={30}
                onChange={(event) => setNumber(digitsOnly(event.target.value))}
                required
              />
            </Field>
            <Field label="Nama pemilik rekening" hint="Harus sama persis dengan nama di buku tabungan.">
              <input
                className={inputClass}
                autoComplete="off"
                placeholder="Nama sesuai buku tabungan"
                value={holder}
                maxLength={100}
                onChange={(event) => setHolder(event.target.value)}
                required
              />
            </Field>
            {error ? (
              <p role="alert" className="text-sm font-semibold m-text-red">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={busy} className={primaryButtonClass}>
                {busy ? <Spinner /> : null}
                {busy ? "Menyimpan…" : "Simpan rekening"}
              </button>
              {bank ? (
                <button type="button" onClick={() => setEditing(false)} className={secondaryButtonClass}>
                  Batal
                </button>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

/* ----------------------------- Riwayat penarikan ----------------------------- */

function Timeline({ item }: { item: Withdrawal }) {
  const rejected = item.status === "REJECTED";
  const steps: Array<{ label: string; at: string | null; done: boolean }> = [
    { label: "Diajukan", at: item.requestedAt, done: true },
    rejected
      ? { label: "Ditolak", at: item.rejectedAt, done: true }
      : { label: "Disetujui", at: item.approvedAt, done: item.status === "APPROVED" || item.status === "PAID" },
    ...(rejected ? [] : [{ label: "Ditransfer", at: item.paidAt, done: item.status === "PAID" }])
  ];
  return (
    <ol className="mt-4 grid gap-3 sm:grid-cols-3">
      {steps.map((step) => (
        <li key={step.label} className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
              step.done ? (rejected && step.label === "Ditolak" ? "m-tone-red" : "m-tone-green") : "themed-fill themed-text-muted"
            }`}
          >
            {step.done ? <Icon name="check" className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0">
            <p className={`text-xs font-bold ${step.done ? "themed-text" : "themed-text-muted"}`}>{step.label}</p>
            <p className="text-[11px] themed-text-muted">{step.at ? formatDateTime(step.at) : "Menunggu"}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function History({ items }: { items: Withdrawal[] }) {
  return (
    <Card>
      <CardHeader title="Riwayat penarikan" subtitle="Status diperbarui otomatis saat tim TapGo memproses" />
      {items.length === 0 ? (
        <EmptyState icon="bank" title="Belum ada penarikan">
          Pengajuan penarikan Anda akan tercatat di sini beserta statusnya.
        </EmptyState>
      ) : (
        <ul className="divide-y m-divide">
          {items.map((item) => {
            const meta = STATUS_META[item.status] ?? { label: item.status, tone: "slate" as Tone };
            return (
              <li key={item.id} className="px-5 py-4 md:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-num text-lg font-black themed-text">{formatRupiah(item.amount)}</p>
                    <p className="text-xs themed-text-muted">
                      {item.bankName} · {maskAccount(item.accountNumber)} · {formatDate(item.requestedAt)}
                    </p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <Timeline item={item} />
                {item.status === "REJECTED" && item.note ? (
                  <p className="mt-3 rounded-lg m-notice-red border px-3 py-2 text-xs leading-5 themed-text-secondary">
                    Alasan: {item.note}. Saldo sudah dikembalikan ke dompet Anda.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* --------------------------------- Halaman --------------------------------- */

export default function WithdrawView() {
  const { core, withdrawalOpen, withdraw } = useMitra();
  const toast = useToast();
  const [amountText, setAmountText] = useState("");
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const amount = Number(amountText || "0");
  const bank = core?.bank ?? null;
  const cooldownMs = useMemo(() => (bank ? bankCooldownRemaining(bank.updatedAt, now) : 0), [bank, now]);
  if (!core) return null;

  const available = core.wallet.cashBalance;
  const closed = withdrawalOpen === false;
  const blocked = closed || !bank || cooldownMs > 0;

  function validate(): string {
    if (!bank) return "Simpan rekening bank terlebih dahulu.";
    if (cooldownMs > 0) return `Rekening baru dapat dipakai ${formatDuration(cooldownMs)} lagi.`;
    if (!amount) return "Masukkan jumlah penarikan.";
    if (amount < MIN_WITHDRAWAL) return `Penarikan minimum ${formatRupiah(MIN_WITHDRAWAL)}.`;
    if (amount > available) return "Jumlah melebihi saldo yang dapat ditarik.";
    if (!password) return "Masukkan password akun Anda untuk konfirmasi.";
    return "";
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validate();
    setFieldError(problem);
    setError("");
    if (!problem) setConfirming(true);
  }

  async function onConfirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await withdraw({ amount, password });
      setConfirming(false);
      setAmountText("");
      setPassword("");
      setFieldError("");
      toast("success", "Pengajuan penarikan terkirim. Pantau statusnya di riwayat.");
    } catch (caught) {
      setConfirming(false);
      setPassword("");
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading title="Tarik dana" description="Cairkan saldo komisi ke rekening bank Anda." />

      {closed ? (
        <Notice tone="amber" title="Penarikan dana belum dibuka">
          Fitur ini sedang dipersiapkan. Saldo Anda tetap aman dan akan dapat ditarik setelah fitur dibuka.
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title="Ajukan penarikan" subtitle="Minimum Rp 50.000 · tanpa biaya penarikan" />
            <form onSubmit={onSubmit} className="space-y-5 p-5 md:p-6" noValidate>
              <div className="rounded-xl themed-fill px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider themed-text-muted">Saldo dapat ditarik</p>
                <p className="m-num mt-1 text-2xl font-black text-[var(--themed-accent-gold)]">{formatRupiah(available)}</p>
              </div>

              <Field label="Jumlah penarikan">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 mt-0.5 -translate-y-1/2 text-[15px] font-bold text-slate-500">
                    Rp
                  </span>
                  <input
                    className={`${inputClass} m-num pl-11 text-lg font-bold`}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0"
                    disabled={blocked}
                    value={amountText ? Number(amountText).toLocaleString("id-ID") : ""}
                    onChange={(event) => setAmountText(digitsOnly(event.target.value).slice(0, 10))}
                  />
                </div>
              </Field>

              <div className="flex flex-wrap gap-2" aria-label="Pilihan cepat">
                {QUICK_AMOUNTS.filter((value) => value <= available).map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={blocked}
                    onClick={() => setAmountText(String(value))}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                      amount === value
                        ? "border-brand-gold m-tone-gold"
                        : "themed-border themed-fill themed-text-secondary hover:bg-[var(--themed-fill-2)]"
                    }`}
                  >
                    {formatRupiah(value)}
                  </button>
                ))}
                {available >= MIN_WITHDRAWAL ? (
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => setAmountText(String(Math.floor(available)))}
                    className="rounded-lg border themed-border themed-fill px-3 py-1.5 text-xs font-bold themed-text-secondary transition hover:bg-[var(--themed-fill-2)] disabled:opacity-50"
                  >
                    Semua saldo
                  </button>
                ) : null}
              </div>

              <Field
                label="Password akun"
                hint="Diminta setiap kali menarik dana untuk memastikan ini benar-benar Anda."
              >
                <div className="relative">
                  <Icon
                    name="lock"
                    className="pointer-events-none absolute left-3.5 top-1/2 mt-0.5 h-4 w-4 -translate-y-1/2 text-slate-500"
                  />
                  <input
                    className={`${inputClass} pl-10`}
                    type="password"
                    autoComplete="current-password"
                    placeholder="Password akun TapGo"
                    disabled={blocked}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
              </Field>

              <dl className="space-y-2 rounded-xl border border-dashed themed-border px-4 py-3 text-sm">
                <div className="flex justify-between">
                  <dt className="themed-text-muted">Jumlah penarikan</dt>
                  <dd className="m-num font-bold themed-text">{formatRupiah(amount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="themed-text-muted">Biaya penarikan</dt>
                  <dd className="m-num font-bold themed-text">Rp 0</dd>
                </div>
                <div className="flex justify-between border-t themed-border pt-2">
                  <dt className="font-bold themed-text">Diterima di rekening</dt>
                  <dd className="m-num font-black themed-text">{formatRupiah(amount)}</dd>
                </div>
              </dl>

              {fieldError ? (
                <p role="alert" className="text-sm font-semibold m-text-red">
                  {fieldError}
                </p>
              ) : null}
              {error ? <Notice tone="red">{error}</Notice> : null}

              <button type="submit" disabled={blocked || busy} className={`${primaryButtonClass} w-full`}>
                Lanjutkan
              </button>
              <p className="text-center text-xs leading-5 themed-text-muted">
                Pengajuan diproses tim TapGo secara manual. Anda dapat memantau statusnya di riwayat di bawah.
              </p>
            </form>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <BankCard key={bank?.updatedAt ?? "none"} bank={bank} cooldownMs={cooldownMs} />
        </div>
      </div>

      <History items={core.withdrawals} />

      <Modal open={confirming} title="Konfirmasi penarikan" onClose={() => (busy ? undefined : setConfirming(false))}>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="themed-text-muted">Jumlah</dt>
            <dd className="m-num font-black themed-text">{formatRupiah(amount)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="themed-text-muted">Bank</dt>
            <dd className="text-right font-bold themed-text">{bank?.bankName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="themed-text-muted">No. rekening</dt>
            <dd className="m-num font-bold themed-text">{bank ? maskAccount(bank.accountNumber) : ""}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="themed-text-muted">Atas nama</dt>
            <dd className="text-right font-bold themed-text">{bank?.accountHolderName}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-5 themed-text-muted">
          Saldo langsung dikurangi saat pengajuan dikirim. Bila ditolak, saldo dikembalikan penuh.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={secondaryButtonClass}>
            Periksa lagi
          </button>
          <button type="button" disabled={busy} onClick={onConfirm} className={primaryButtonClass}>
            {busy ? <Spinner /> : null}
            {busy ? "Mengirim…" : "Ya, tarik dana"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
