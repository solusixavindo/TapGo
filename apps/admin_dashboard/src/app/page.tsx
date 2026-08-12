"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { login, readToken } from "../lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (readToken()) {
      router.replace("/member-requests");
    }
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await login(phone.trim(), password);
      router.replace("/member-requests");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tidak dapat masuk.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-slate-950">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green">
          TapGo
        </p>
        <h1 className="mt-1 text-xl font-semibold">Konsol Admin</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Masuk dengan akun admin Anda untuk memeriksa pengajuan keanggotaan.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Nomor HP
            </span>
            <input
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-brand-green"
              type="tel"
              inputMode="tel"
              autoComplete="username"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="08xxxxxxxxxx"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Password
            </span>
            <div className="relative mt-1.5">
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-16 text-sm outline-none focus:border-brand-green"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setVisible((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-semibold text-slate-500 hover:text-brand-green"
              >
                {visible ? "Sembunyi" : "Lihat"}
              </button>
            </div>
          </label>

          {error ? (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Memeriksa…" : "Masuk"}
          </button>
        </form>
      </div>
    </main>
  );
}
