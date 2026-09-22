"use client";

import { FormEvent, useMemo, useState } from "react";

type DeleteFormState = {
  name: string;
  whatsapp: string;
  email: string;
  reason: string;
  consent: boolean;
};

export default function DeleteAccountForm() {
  const [form, setForm] = useState<DeleteFormState>({
    name: "",
    whatsapp: "",
    email: "",
    reason: "",
    consent: false
  });
  const [error, setError] = useState("");

  const whatsappLink = useMemo(() => {
    const message = [
      "Halo TapGo Lion, saya ingin mengajukan penghapusan akun.",
      "",
      "Nama:",
      form.name || "-",
      "Nomor WhatsApp terdaftar:",
      form.whatsapp || "-",
      "Email:",
      form.email || "-",
      "Alasan:",
      form.reason || "-"
    ].join("\n");

    return `https://wa.me/6283800255588?text=${encodeURIComponent(message)}`;
  }, [form]);

  function updateField(field: keyof DeleteFormState, value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }));
    if (error) {
      setError("");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim()) {
      setError("Nama lengkap wajib diisi.");
      return;
    }

    if (!form.whatsapp.trim()) {
      setError("Nomor WhatsApp terdaftar wajib diisi.");
      return;
    }

    if (!form.consent) {
      setError("Mohon centang persetujuan sebelum mengajukan penghapusan akun.");
      return;
    }

    window.location.href = whatsappLink;
  }

  return (
    <form onSubmit={handleSubmit} className="themed-glass rounded-[2rem] p-6 md:p-8">
      <h2 className="themed-text text-2xl font-black">Form Pengajuan Hapus Akun</h2>
      <p className="themed-text-secondary mt-3 leading-7">
        Isi data akun yang ingin dihapus. Tim TapGo akan melakukan verifikasi sebelum memproses permintaan.
      </p>

      <div className="mt-6 grid gap-5">
        <label className="block">
          <span className="themed-text text-sm font-bold">Nama lengkap *</span>
          <input
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="mt-2 w-full rounded-2xl border themed-border bg-white px-4 py-3 text-brand-navyDeep outline-none transition focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
            placeholder="Nama lengkap"
          />
        </label>

        <label className="block">
          <span className="themed-text text-sm font-bold">Nomor WhatsApp terdaftar *</span>
          <input
            value={form.whatsapp}
            onChange={(event) => updateField("whatsapp", event.target.value)}
            className="mt-2 w-full rounded-2xl border themed-border bg-white px-4 py-3 text-brand-navyDeep outline-none transition focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
            placeholder="+62 atau 08..."
            inputMode="tel"
          />
        </label>

        <label className="block">
          <span className="themed-text text-sm font-bold">Email jika ada</span>
          <input
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            className="mt-2 w-full rounded-2xl border themed-border bg-white px-4 py-3 text-brand-navyDeep outline-none transition focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
            placeholder="nama@email.com"
            type="email"
          />
        </label>

        <label className="block">
          <span className="themed-text text-sm font-bold">Alasan penghapusan akun</span>
          <textarea
            value={form.reason}
            onChange={(event) => updateField("reason", event.target.value)}
            className="mt-2 min-h-28 w-full rounded-2xl border themed-border bg-white px-4 py-3 text-brand-navyDeep outline-none transition focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
            placeholder="Opsional"
          />
        </label>

        <label className="themed-border themed-card-bg themed-text-secondary flex gap-3 rounded-2xl border p-4 text-sm font-semibold leading-6">
          <input
            checked={form.consent}
            onChange={(event) => updateField("consent", event.target.checked)}
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[#FFC857]"
          />
          <span>Saya memahami bahwa penghapusan akun dapat membuat saya tidak dapat mengakses layanan TapGo.</span>
        </label>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-300">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        className="mt-7 w-full rounded-full bg-brand-green px-7 py-4 text-center font-bold text-white shadow-lg transition hover:-translate-y-1"
      >
        Ajukan Hapus Akun
      </button>
    </form>
  );
}
