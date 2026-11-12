"use client";

import Link from "../hard-nav";
import { FormEvent, useState } from "react";
import { API_BASE } from "../upgrade/api";
import { Field, inputClass, primaryButtonClass } from "../upgrade/upgrade-shell";

/**
 * Pemulihan akun dengan kode dari admin: nomor HP + kode 6 digit -> password baru.
 *
 * Memakai endpoint pemulihan yang sama dengan aplikasi (/auth/recovery/verify lalu /auth/recovery/reset); pemilik
 * akun memilih password barunya sendiri dan semua sesi lama dicabut oleh server. Token reset hanya disimpan di memori
 * komponen selama satu pengiriman, tidak pernah ditulis ke penyimpanan peramban maupun URL.
 */

const FRIENDLY: Record<string, string> = {
  AUTH_RECOVERY_INVALID_OR_EXPIRED: "Kode salah atau sudah kedaluwarsa. Minta admin membuat kode baru.",
  AUTH_RECOVERY_ATTEMPTS_EXCEEDED: "Percobaan kode sudah habis. Minta admin membuat kode baru.",
  AUTH_RECOVERY_RATE_LIMITED: "Terlalu banyak percobaan. Tunggu beberapa saat lalu coba lagi.",
  RATE_LIMITED: "Terlalu banyak percobaan. Tunggu beberapa saat lalu coba lagi.",
  AUTH_PASSWORD_POLICY_FAILED: "Password baru belum memenuhi ketentuan: minimal 8 karakter, ada huruf dan angka."
};

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit"
    });
  } catch {
    throw new Error("Server TapGo belum dapat dihubungi. Periksa koneksi internet Anda lalu coba lagi.");
  }
  const payload = (await response.json().catch(() => ({}))) as { code?: string; message?: string; data?: T };
  if (!response.ok) {
    throw new Error(
      (payload.code && FRIENDLY[payload.code]) ||
        (response.status === 429
          ? "Terlalu banyak percobaan. Tunggu beberapa saat lalu coba lagi."
          : "Pemulihan belum berhasil. Periksa nomor HP dan kode, atau hubungi admin.")
    );
  }
  return payload.data as T;
}

export function passwordIssue(password: string): string | null {
  if (password.length < 8) return "Password baru minimal 8 karakter.";
  if (password.length > 128) return "Password baru terlalu panjang.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Password baru harus memuat huruf dan angka.";
  return null;
}

export default function RecoverForm() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (phone.replace(/\D/g, "").length < 8) {
      setError("Isi nomor HP yang terdaftar di akun Anda.");
      return;
    }
    if (!/^[0-9]{6}$/.test(code.trim())) {
      setError("Kode harus 6 digit angka.");
      return;
    }
    const issue = passwordIssue(password);
    if (issue) {
      setError(issue);
      return;
    }
    if (password !== confirm) {
      setError("Konfirmasi password tidak sama.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const verified = await post<{ resetToken: string }>("/auth/recovery/verify", {
        identifier: phone.trim(),
        code: code.trim()
      });
      await post("/auth/recovery/reset", { resetToken: verified.resetToken, newPassword: password });
      setPassword("");
      setConfirm("");
      setCode("");
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pemulihan belum berhasil.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-6" data-testid="recover-done">
        <p className="themed-text text-lg font-black">Password berhasil diperbarui</p>
        <p className="themed-text-muted mt-2 text-sm leading-7">
          Semua sesi lama sudah dikeluarkan. Silakan masuk dengan nomor HP dan password baru Anda di aplikasi TapGo atau di dashboard
          mitra. Setelah masuk, verifikasi email Anda di menu Profil supaya pemulihan berikutnya bisa otomatis.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Link href="/mitra" className={primaryButtonClass}>
            Masuk ke dashboard
          </Link>
          <a
            href="https://play.google.com/store/apps/details?id=com.xavindo.tapgo"
            rel="noopener noreferrer"
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border themed-border px-6 text-base font-bold themed-text"
          >
            Buka aplikasi TapGo
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field label="Nomor HP" hint="Nomor yang terdaftar di akun TapGo Anda.">
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

      <Field label="Kode dari admin" hint="6 digit, berlaku 30 menit sejak dibuat admin.">
        <input
          className={inputClass}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          required
        />
      </Field>

      <Field label="Password baru" hint="Minimal 8 karakter, memuat huruf dan angka.">
        <div className="relative">
          <input
            className={`${inputClass} pr-24`}
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl px-3 py-2 text-xs font-bold themed-text-muted"
          >
            {visible ? "Sembunyikan" : "Tampilkan"}
          </button>
        </div>
      </Field>

      <Field label="Ulangi password baru">
        <input
          className={inputClass}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
      </Field>

      {error ? (
        <p role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300">
          {error}
        </p>
      ) : null}

      <button type="submit" className={primaryButtonClass} disabled={busy}>
        {busy ? "Memproses…" : "Pulihkan akun"}
      </button>

      <p className="themed-text-muted text-center text-xs leading-6">
        Belum punya kode? Hubungi admin lewat WhatsApp dari nomor yang terdaftar. Akun yang emailnya sudah terverifikasi bisa memakai{" "}
        <strong>Lupa password</strong> di aplikasi.
      </p>
    </form>
  );
}
