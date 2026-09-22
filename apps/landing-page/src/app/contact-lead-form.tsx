"use client";

import { FormEvent, useMemo, useState } from "react";

/**
 * Form minat di section Kontak homepage.
 *
 * Sama seperti form di /daftar (register-form.tsx): tidak ada backend untuk
 * menerima pesan minat anonim (endpoint /contact yang ada menuntut login),
 * jadi pesan dibangun jadi link wa.me lalu pengunjung diarahkan ke WhatsApp
 * resmi — pola yang sudah dipakai dan terbukti jalan di /daftar.
 */

const interestOptions = ["Penumpang", "Mitra driver", "Agen PPOB", "Anggota membership"];

type FormState = {
  name: string;
  whatsapp: string;
  interest: string;
  message: string;
};

export default function ContactLeadForm() {
  const [form, setForm] = useState<FormState>({
    name: "",
    whatsapp: "",
    interest: interestOptions[0]!,
    message: ""
  });
  const [error, setError] = useState("");

  const whatsappLink = useMemo(() => {
    const message = [
      "Halo TapGo Lion, saya ingin bertanya.",
      "",
      "Nama:",
      form.name || "-",
      "Nomor WhatsApp:",
      form.whatsapp || "-",
      "Saya tertarik sebagai:",
      form.interest,
      "Pesan:",
      form.message || "-"
    ].join("\n");
    return `https://wa.me/6283800255588?text=${encodeURIComponent(message)}`;
  }, [form]);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (error) setError("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("Nama lengkap wajib diisi.");
      return;
    }
    if (!form.whatsapp.trim()) {
      setError("Nomor WhatsApp wajib diisi.");
      return;
    }
    window.location.href = whatsappLink;
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <label className="block">
        <span className="text-sm font-bold themed-text">Nama lengkap</span>
        <input
          value={form.name}
          onChange={(event) => updateField("name", event.target.value)}
          className="mt-2 w-full rounded-2xl border border-brand-blue/10 bg-white px-4 py-3 text-brand-navy outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
          placeholder="Nama Anda"
        />
      </label>
      <label className="block">
        <span className="text-sm font-bold themed-text">Nomor WhatsApp</span>
        <input
          value={form.whatsapp}
          onChange={(event) => updateField("whatsapp", event.target.value)}
          className="mt-2 w-full rounded-2xl border border-brand-blue/10 bg-white px-4 py-3 text-brand-navy outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
          placeholder="08xxxxxxxxxx"
          inputMode="tel"
        />
      </label>
      <label className="block">
        <span className="text-sm font-bold themed-text">Saya tertarik sebagai</span>
        <select
          value={form.interest}
          onChange={(event) => updateField("interest", event.target.value)}
          className="mt-2 w-full rounded-2xl border border-brand-blue/10 bg-white px-4 py-3 text-brand-navy outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
        >
          {interestOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-bold themed-text">Pesan</span>
        <textarea
          value={form.message}
          onChange={(event) => updateField("message", event.target.value)}
          className="mt-2 min-h-24 w-full rounded-2xl border border-brand-blue/10 bg-white px-4 py-3 text-brand-navy outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
          placeholder="Tulis pertanyaan Anda"
        />
      </label>

      {error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-300">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-green px-6 py-3.5 text-sm font-bold text-white shadow-lg transition hover:-translate-y-1"
      >
        Kirim Pesan
      </button>
    </form>
  );
}
