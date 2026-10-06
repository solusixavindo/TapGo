"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { NOTICE_KEY, PREVIEW_MODE, TOKEN_KEY, clearSession, login, readSession, takeNextPath, writeSession } from "./api";
import { Field, inputClass, primaryButtonClass } from "../upgrade/upgrade-shell";

export default function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState(PREVIEW_MODE ? "081234567890" : "");
  const [password, setPassword] = useState(PREVIEW_MODE ? "rahasia-contoh" : "");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
    setBusy(true);
    setError("");
    try {
      const result = await login(phone.trim(), password);
      writeSession(TOKEN_KEY, result.accessToken);
      router.push(takeNextPath("/topup", "/topup/jumlah"));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Nomor HP atau password belum sesuai."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
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
              {visible ? <path d="m4 20 16-16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : null}
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
        Belum punya akun TapGo?{" "}
        <Link href="/daftar" className="font-bold themed-accent">
          Daftar dulu di sini
        </Link>
      </p>
    </form>
  );
}
