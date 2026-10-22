"use client";

import Link from "../hard-nav";
import { useHardRouter as useRouter } from "../hard-nav";
import { FormEvent, useEffect, useState } from "react";
import {
  NOTICE_KEY,
  PACKAGE_HINT_KEY,
  PREVIEW_MODE,
  REFERRAL_NOTICE_KEY,
  TOKEN_KEY,
  claimRememberedReferral,
  clearSession,
  login,
  readReferralHint,
  readSession,
  rememberReferral,
  takeNextPath,
  writeSession
} from "./api";
import { Field, inputClass, primaryButtonClass } from "./upgrade-shell";

export default function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState(PREVIEW_MODE ? "081234567890" : "");
  const [password, setPassword] = useState(PREVIEW_MODE ? "rahasia-contoh" : "");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Paket yang ditunjuk dari halaman depan (/upgrade/?paket=gold) dipilihkan di langkah paket.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("paket")?.trim().toUpperCase() ?? "";
    if (["SILVER", "GOLD", "PLATINUM"].includes(wanted)) writeSession(PACKAGE_HINT_KEY, wanted);
  }, []);

  // Kode referral dari tautan (/r/KODE -> /upgrade/?ref=KODE) diingat; dikaitkan ke akun setelah masuk.
  const [referral, setReferral] = useState("");
  useEffect(() => {
    setReferral(rememberReferral(new URLSearchParams(window.location.search).get("ref")) || readReferralHint());
  }, []);

  // Pesan dari sesi yang baru berakhir (lihat endSession di api.ts); sekali tampil.
  useEffect(() => {
    const saved = readSession(NOTICE_KEY);
    if (saved) {
      setNotice(saved);
      clearSession(NOTICE_KEY);
    }
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!phone.trim() || !password) {
      setError("Isi nomor HP dan password terlebih dahulu.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await login(phone.trim(), password);
      // Token disimpan hanya untuk sesi tab ini. Tidak ada data sensitif lain
      // yang ditulis ke perangkat.
      writeSession(TOKEN_KEY, result.accessToken);
      // Kaitkan kode referral yang diingat (tidak pernah menghalangi masuk); hasilnya tampil di langkah berikutnya.
      const referralOutcome = await claimRememberedReferral(result.accessToken);
      if (referralOutcome) writeSession(REFERRAL_NOTICE_KEY, JSON.stringify(referralOutcome));
      router.push(takeNextPath("/upgrade", "/upgrade/paket"));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Nomor HP atau password belum sesuai."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {referral ? (
        <p role="status" className="themed-text rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-semibold">
          Anda diajak dengan kode referral <span className="font-black tracking-wider">{referral}</span>. Kode ini otomatis
          dikaitkan ke akun Anda setelah masuk, selama akun belum pernah membeli membership berbayar.
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm font-semibold themed-accent">
          {notice}
        </p>
      ) : null}
      <Field label="Nomor HP" hint="Nomor yang terdaftar di aplikasi TapGo.">
        <input
          className={inputClass}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="08xxxxxxxxxx"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />
      </Field>

      <Field label="Password">
        <div className="relative">
          <input
            className={`${inputClass} pr-14`}
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Password akun TapGo"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? "Sembunyikan password" : "Tampilkan password"}
            className="absolute right-2 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-xl themed-text-muted transition hover:text-[var(--themed-accent-gold)]"
          >
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none">
              <path
                d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
              {visible ? (
                <path d="m4 20 16-16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : null}
            </svg>
          </button>
        </div>
      </Field>

      {error ? (
        <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300">
          {error}
        </p>
      ) : null}

      <button type="submit" className={primaryButtonClass} disabled={busy}>
        {busy ? "Memproses…" : "Masuk dan Lanjutkan"}
      </button>

      <p className="text-center text-sm themed-text-muted">
        Belum punya akun TapGo? Pasang aplikasi TapGo dari{" "}
        <a
          href="https://play.google.com/store/apps/details?id=com.xavindo.tapgo"
          className="font-bold themed-accent"
          rel="noopener noreferrer"
        >
          Google Play
        </a>{" "}
        dan daftar di sana, lalu kembali ke halaman ini.{referral ? " Kode referral Anda tetap diingat." : ""}{" "}
        <Link href={referral ? `/daftar?ref=${encodeURIComponent(referral)}` : "/daftar"} className="font-bold themed-accent">
          Butuh bantuan mendaftar? Hubungi admin
        </Link>
      </p>
    </form>
  );
}
