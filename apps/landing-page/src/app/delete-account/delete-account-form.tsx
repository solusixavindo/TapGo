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
    <form onSubmit={handleSubmit} className="glass rounded-[2rem] p-6 shadow-glass md:p-8">
      <h2 className="text-2xl font-black text-brand-navy">Form Pengajuan Hapus Akun</h2>
      <p className="mt-3 leading-7 text-slate-600">
        Isi data akun yang ingin dihapus. Tim TapGo akan melakukan verifikasi sebelum memproses permintaan.
      </p>

      <div className="mt-6 grid gap-5">
        <label className="block">
          <span className="text-sm font-bold text-brand-navy">Nama lengkap *</span>
          <input
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-brand-blue/10 bg-white px-4 py-3 text-brand-navy outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
            placeholder="Nama lengkap"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold text-brand-navy">Nomor WhatsApp terdaftar *</span>
          <input
            value={form.whatsapp}
            onChange={(event) => updateField("whatsapp", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-brand-blue/10 bg-white px-4 py-3 text-brand-navy outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
            placeholder="+62 atau 08..."
            inputMode="tel"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold text-brand-navy">Email jika ada</span>
          <input
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            className="mt-2 w-full rounded-2xl border border-brand-blue/10 bg-white px-4 py-3 text-brand-navy outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
            placeholder="nama@email.com"
            type="email"
          />
        </label>

        <label className="block">
          <span className="text-sm font-bold text-brand-navy">Alasan penghapusan akun</span>
          <textarea
            value={form.reason}
            onChange={(event) => updateField("reason", event.target.value)}
            className="mt-2 min-h-28 w-full rounded-2xl border border-brand-blue/10 bg-white px-4 py-3 text-brand-navy outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
            placeholder="Opsional"
          />
        </label>

        <label className="flex gap-3 rounded-2xl border border-brand-blue/10 bg-white p-4 text-sm font-semibold leading-6 text-slate-700">
          <input
            checked={form.consent}
            onChange={(event) => updateField("consent", event.target.checked)}
            type="checkbox"
            className="mt-1 h-4 w-4"
          />
          <span>Saya memahami bahwa penghapusan akun dapat membuat saya tidak dapat mengakses layanan TapGo.</span>
        </label>
      </div>

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        className="mt-7 w-full rounded-full bg-gradient-to-r from-brand-blue to-brand-green px-7 py-4 text-center font-bold text-white shadow-glow transition hover:-translate-y-1"
      >
        Ajukan Hapus Akun
      </button>
    </form>
  );
}
