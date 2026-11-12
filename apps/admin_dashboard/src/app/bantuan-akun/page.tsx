"use client";

import { useHardRouter as useRouter } from "../hard-nav";
import { FormEvent, useEffect, useState } from "react";
import {
  ASSIST_REASONS,
  AccountAssistLookup,
  formatMoment,
  issueRecoveryCode,
  lookupAccountByPhone,
  readRole,
  readToken
} from "../../lib/api";
import ConsoleHeader from "../console-header";

/**
 * Bantuan akun untuk pemilik sistem: kenapa seorang anggota/driver tidak bisa masuk atau tidak bisa menerima order, dan
 * cara memulihkannya.
 *
 * Pemulihan otomatis hanya lewat email yang SUDAH terverifikasi. Anggota yang lupa password tanpa email terverifikasi
 * tidak punya jalan sendiri; di sini VIP menerbitkan kode sekali pakai (30 menit) SETELAH memastikan identitas pemilik,
 * lalu menyampaikannya (mis. lewat WhatsApp ke nomor yang sama). Pemilik memakai layar "Lupa password" biasa dan memilih
 * password barunya sendiri — admin tidak pernah mengetahui atau menetapkan password.
 */

const RECOVER_URL = "tapgolion.id/pulihkan-akun";

const EVIDENCE_MIN = 10;
const EVIDENCE_MAX = 500;

const ROLE_LABEL: Record<string, string> = { USER: "Anggota", DRIVER: "Driver", ADMIN: "Admin", SUPER_ADMIN: "Super Admin", SUPER_ADMIN_VIP: "Super Admin VIP" };

export default function AccountAssistPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<AccountAssistLookup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [reason, setReason] = useState(ASSIST_REASONS[0]!.code);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [password, setPassword] = useState("");
  const [issued, setIssued] = useState<{ code: string; expiresAt: string; ttlMinutes: number; maskedPhone: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    const current = readRole();
    if (current !== "SUPER_ADMIN_VIP") {
      router.replace("/beranda");
      return;
    }
    setRole(current);
  }, [router]);

  async function copyMessage(code: string, minutes: number) {
    const text =
      `Kode pemulihan akun TapGo Anda: ${code} (berlaku ${minutes} menit, sekali pakai).\n` +
      `Buka https://${RECOVER_URL}, masukkan nomor HP Anda dan kode tersebut, lalu pilih password baru.\n` +
      "Jangan bagikan kode ini kepada siapa pun.";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Pesan tidak dapat disalin otomatis. Salin kode secara manual.");
    }
  }

  function resetIssue() {
    setIssued(null);
    setCopied(false);
    setIdentityChecked(false);
    setEvidenceNote("");
    setPassword("");
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || phone.trim().length < 6) return;
    setBusy(true);
    setError("");
    setResult(null);
    resetIssue();
    try {
      setResult(await lookupAccountByPhone(phone.trim()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Akun belum dapat dicari.");
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    if (!result || busy) return;
    setBusy(true);
    setError("");
    try {
      setIssued(await issueRecoveryCode(result.account.id, reason, evidenceNote.trim(), password));
      setPassword("");
      setResult(await lookupAccountByPhone(result.account.phone));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kode belum dapat dibuat.");
    } finally {
      setBusy(false);
    }
  }

  const account = result?.account;
  const noteLength = evidenceNote.trim().length;
  const noteValid = noteLength >= EVIDENCE_MIN && noteLength <= EVIDENCE_MAX;

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <div className="mx-auto max-w-3xl">
        <ConsoleHeader
          title="Bantuan Akun"
          subtitle="Cari akun lewat nomor HP untuk melihat kenapa tidak bisa masuk atau tidak bisa menerima order, lalu pulihkan."
          role={role}
        />

        <form onSubmit={search} className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4">
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="Nomor HP, mis. 0812xxxxxxxx"
            autoComplete="off"
            inputMode="tel"
            name="cari-nomor-akun"
            className="min-w-[240px] flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-green"
          />
          <button type="submit" disabled={busy} className="rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {busy && !issued ? "Mencari…" : "Cari akun"}
          </button>
        </form>

        {error ? (
          <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {account && result ? (
          <div className="mt-4 space-y-4" data-testid="assist-result">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-black">{account.fullName}</h2>
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700">{ROLE_LABEL[account.role] ?? account.role}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${account.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}
                >
                  {account.status}
                </span>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-slate-500">Nomor HP</dt><dd className="font-semibold">{account.phone}</dd></div>
                <div><dt className="text-xs text-slate-500">Terakhir masuk</dt><dd className="font-semibold">{formatMoment(account.lastLoginAt)}</dd></div>
                <div>
                  <dt className="text-xs text-slate-500">Email</dt>
                  <dd className="font-semibold">
                    {account.emailMasked ?? "Belum ada"}
                    {account.emailMasked ? (
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${account.emailVerified ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                        {account.emailVerified ? "Terverifikasi" : "Belum terverifikasi"}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div><dt className="text-xs text-slate-500">Dibuat</dt><dd className="font-semibold">{formatMoment(account.createdAt)}</dd></div>
              </dl>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="assist-recovery">
              <h3 className="text-sm font-black">Pemulihan password</h3>
              {result.recovery.automaticViaEmail ? (
                <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Email sudah terverifikasi: anggota bisa memulihkan sendiri lewat <strong>Lupa password</strong> memakai emailnya.
                </p>
              ) : (
                <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                  <strong>Tidak ada pemulihan otomatis.</strong> {account.emailMasked ? "Email belum terverifikasi" : "Akun ini belum punya email"} dan
                  kode belum dapat dikirim ke nomor HP, jadi &quot;Lupa password&quot; tidak mengirim apa pun. Gunakan kode dari admin di bawah.
                </p>
              )}

              {!result.recovery.canIssueAssistedCode ? (
                <p className="mt-3 text-sm text-slate-600">Kode admin hanya untuk akun anggota atau driver yang aktif. Akun ini tidak memenuhi syarat.</p>
              ) : issued ? (
                <div className="mt-3 rounded-lg border-2 border-emerald-500 bg-emerald-50 p-4" data-testid="assist-code">
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Kode pemulihan (hanya tampil sekali)</p>
                  <p className="mt-1 text-4xl font-black tracking-[0.3em] text-emerald-900">{issued.code}</p>
                  <p className="mt-2 text-xs leading-5 text-emerald-900">
                    Berlaku {issued.ttlMinutes} menit (sampai {formatMoment(issued.expiresAt)}), sekali pakai, 5 percobaan. Sampaikan ke
                    pemilik akun lewat WhatsApp ke nomor {issued.maskedPhone}.
                  </p>
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-5 text-slate-700">
                    <li>
                      Minta pemilik membuka <strong>{RECOVER_URL}</strong>, memasukkan nomor HP-nya dan kode di atas, lalu memilih password baru
                      (minimal 8 karakter, ada huruf dan angka). Halaman ini berlaku untuk aplikasi user maupun driver.
                    </li>
                    <li>Setelah masuk, sarankan memverifikasi email di menu Profil supaya pemulihan berikutnya bisa otomatis.</li>
                  </ol>
                  <button
                    type="button"
                    onClick={() => void copyMessage(issued.code, issued.ttlMinutes)}
                    className="mt-3 mr-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white"
                  >
                    {copied ? "Pesan tersalin" : "Salin pesan untuk WhatsApp"}
                  </button>
                  <button type="button" onClick={resetIssue} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700">
                    Selesai, sembunyikan kode
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {result.recovery.activeCodeUntil ? (
                    <p className="text-xs text-slate-500">Ada kode aktif sampai {formatMoment(result.recovery.activeCodeUntil)}. Membuat kode baru mengganti kode itu.</p>
                  ) : null}
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Alasan
                    <select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal">
                      {ASSIST_REASONS.map((item) => (
                        <option key={item.code} value={item.code}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={identityChecked} onChange={(event) => setIdentityChecked(event.target.checked)} className="mt-1" />
                    <span>Saya sudah memastikan bahwa yang meminta adalah pemilik akun ini (mis. lewat WhatsApp dari nomor yang sama dan data yang hanya diketahui pemiliknya).</span>
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Catatan bukti
                    <textarea
                      value={evidenceNote}
                      onChange={(event) => setEvidenceNote(event.target.value)}
                      maxLength={EVIDENCE_MAX}
                      rows={3}
                      placeholder="Contoh: WA dari nomor terdaftar 22 Okt 14.05, menyebut nama sponsor dan tanggal daftar dengan benar. Tangkapan layar disimpan di folder bukti."
                      className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal"
                    />
                    <span className={`mt-1 block text-[11px] font-normal normal-case tracking-normal ${noteLength > 0 && !noteValid ? "text-rose-700" : "text-slate-500"}`}>
                      Wajib, {EVIDENCE_MIN}-{EVIDENCE_MAX} huruf ({noteLength}/{EVIDENCE_MAX}). Tersimpan di catatan audit dan terlihat oleh admin VIP berikutnya. Jangan tulis password atau kode.
                    </span>
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Password Anda
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !identityChecked || !noteValid || password.length === 0}
                    onClick={() => void issue()}
                    className="rounded-lg bg-brand-navy px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {busy ? "Memproses…" : "Buat kode pemulihan 30 menit"}
                  </button>
                </div>
              )}
            </section>

            {(result.codeHistory ?? []).length > 0 ? (
              <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="assist-history">
                <h3 className="text-sm font-black">Riwayat kode pemulihan</h3>
                <ul className="mt-2 divide-y divide-slate-100">
                  {(result.codeHistory ?? []).map((entry) => (
                    <li key={entry.at} className="py-2 text-sm">
                      <p className="font-semibold">
                        {formatMoment(entry.at)} <span className="font-normal text-slate-600">oleh {entry.by ?? "admin"}</span>
                      </p>
                      <p className="text-xs text-slate-500">{ASSIST_REASONS.find((item) => item.code === entry.reasonCode)?.label ?? entry.reasonCode ?? "-"}</p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">
                        {entry.evidenceNote ? `Bukti: ${entry.evidenceNote}` : "Tanpa catatan bukti (dibuat sebelum kolom ini ada)."}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {result.driver ? (
              <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="assist-driver">
                <h3 className="text-sm font-black">Kesiapan menerima order</h3>
                {result.driver.readiness.canAccept ? (
                  <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Siap menerima order (profil {result.driver.profileStatus}).</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {result.driver.readiness.cashOnly ? (
                      <li className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                        Hanya pesanan TUNAI yang ditolak. Pesanan non-tunai tetap bisa diterima.
                      </li>
                    ) : null}
                    {result.driver.readiness.blockers.map((blocker) => (
                      <li key={blocker.code} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
                        <p className="font-bold text-rose-800">{blocker.message}</p>
                        <p className="mt-0.5 text-xs text-slate-700">Perbaikan: {blocker.fix}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {result.driver.readiness.notes.map((note) => (
                  <p key={note} className="mt-2 text-xs leading-5 text-slate-500">{note}</p>
                ))}
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
