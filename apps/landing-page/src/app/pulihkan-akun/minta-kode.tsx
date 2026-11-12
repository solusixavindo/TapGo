"use client";

import { useState } from "react";
import { Field, inputClass, primaryButtonClass } from "../upgrade/upgrade-shell";

/**
 * Menyusun pesan WhatsApp permintaan kode pemulihan supaya pemilik akun tidak perlu merangkai kata sendiri.
 *
 * Semua dirangkai di peramban: tidak ada data yang dikirim ke server TapGo. Isi pesan sengaja memuat hal-hal yang
 * hanya diketahui pemilik akun (tanggal daftar, email, sponsor) supaya admin dapat mencocokkannya dengan Direktori
 * Member, dan TIDAK pernah memuat password atau kode.
 */

const ADMIN_WHATSAPP = "6283800255588";

const PROBLEMS = [
  { code: "NO_VERIFIED_EMAIL", text: "Lupa password dan email saya belum terverifikasi" },
  { code: "LOST_EMAIL_ACCESS", text: "Lupa password dan saya tidak bisa membuka email yang terdaftar" },
  { code: "OTHER", text: "Tidak bisa masuk ke akun (saya jelaskan di bawah)" }
] as const;

const SOURCES = ["Aplikasi TapGo dari Play Store", "Website tapgolion.id", "Tidak ingat"] as const;

export function buildRecoveryRequestMessage(input: {
  name: string;
  phone: string;
  problem: string;
  source: string;
  registeredAt: string;
  email: string;
  sponsor: string;
  purpose: string;
}): string {
  const lines = [
    "Halo Admin TapGo Lion, saya minta kode pemulihan akun.",
    "",
    `Nama lengkap: ${input.name.trim()}`,
    `Nomor HP terdaftar: ${input.phone.trim()} (saya menghubungi dari nomor ini)`,
    `Masalah: ${input.problem}`,
    `Daftar lewat: ${input.source}`
  ];
  if (input.registeredAt.trim()) lines.push(`Perkiraan waktu daftar: ${input.registeredAt.trim()}`);
  if (input.email.trim()) lines.push(`Email yang saya pakai: ${input.email.trim()}`);
  if (input.sponsor.trim()) lines.push(`Nama pengajak/sponsor: ${input.sponsor.trim()}`);
  if (input.purpose.trim()) lines.push(`Keperluan: ${input.purpose.trim()}`);
  lines.push("", "Saya tidak mengirim password atau kode apa pun lewat chat ini. Mohon dibuatkan kode pemulihan. Terima kasih.");
  return lines.join("\n");
}

export default function RequestCode() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [problem, setProblem] = useState<string>(PROBLEMS[0].text);
  const [source, setSource] = useState<string>(SOURCES[0]);
  const [registeredAt, setRegisteredAt] = useState("");
  const [email, setEmail] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [purpose, setPurpose] = useState("");
  const [copied, setCopied] = useState(false);

  const phoneDigits = phone.replace(/\D/g, "");
  const ready = name.trim().length >= 3 && phoneDigits.length >= 9;
  const message = buildRecoveryRequestMessage({ name, phone, problem, source, registeredAt, email, sponsor, purpose });
  const link = `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(message)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="space-y-5" data-testid="request-code">
      <div>
        <h2 className="themed-text text-lg font-black">1. Minta kode ke admin</h2>
        <p className="themed-text-muted mt-1 text-sm leading-7">
          Isi data di bawah, lalu kirim pesannya lewat WhatsApp. <strong>Kirim dari nomor HP yang terdaftar di akun Anda</strong>:
          admin hanya membuat kode untuk nomor yang sama. Data ini hanya dirangkai di layar Anda dan tidak dikirim ke server.
        </p>
      </div>

      <Field label="Nama lengkap">
        <input className={inputClass} type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>

      <Field label="Nomor HP terdaftar" hint="Nomor yang Anda pakai untuk mendaftar TapGo.">
        <input
          className={inputClass}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="08xxxxxxxxxx"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </Field>

      <Field label="Masalah Anda">
        <select className={inputClass} value={problem} onChange={(event) => setProblem(event.target.value)}>
          {PROBLEMS.map((item) => (
            <option key={item.code} value={item.text}>
              {item.text}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Daftar lewat">
        <select className={inputClass} value={source} onChange={(event) => setSource(event.target.value)}>
          {SOURCES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Perkiraan waktu daftar (opsional)" hint="Misalnya: awal November 2026.">
        <input className={inputClass} type="text" value={registeredAt} onChange={(event) => setRegisteredAt(event.target.value)} />
      </Field>

      <Field label="Email yang dipakai (opsional)">
        <input className={inputClass} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>

      <Field label="Nama pengajak atau sponsor (opsional)">
        <input className={inputClass} type="text" value={sponsor} onChange={(event) => setSponsor(event.target.value)} />
      </Field>

      <Field label="Keperluan setelah masuk (opsional)" hint="Misalnya: ingin upgrade membership ke Platinum.">
        <input className={inputClass} type="text" value={purpose} onChange={(event) => setPurpose(event.target.value)} />
      </Field>

      <div className="themed-border rounded-2xl border px-4 py-3">
        <p className="themed-text-muted text-[11px] font-bold uppercase tracking-[0.18em]">Pratinjau pesan</p>
        <pre className="themed-text mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-6" data-testid="request-code-preview">
          {message}
        </pre>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {ready ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className={primaryButtonClass}>
            Kirim lewat WhatsApp
          </a>
        ) : (
          <button type="button" className={primaryButtonClass} disabled>
            Kirim lewat WhatsApp
          </button>
        )}
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!ready}
          className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl border themed-border px-6 text-base font-bold themed-text disabled:opacity-50"
        >
          {copied ? "Pesan tersalin" : "Salin pesan"}
        </button>
      </div>
      {!ready ? <p className="themed-text-muted text-xs">Isi nama lengkap dan nomor HP terlebih dahulu.</p> : null}
    </section>
  );
}
