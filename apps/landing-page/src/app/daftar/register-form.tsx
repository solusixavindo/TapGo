"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const packageOptions = ["Basic", "Silver", "Gold", "Platinum"];

const packageMap: Record<string, string> = {
  basic: "Basic",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum"
};

type FormState = {
  name: string;
  whatsapp: string;
  email: string;
  address: string;
  packageName: string;
  referral: string;
  notes: string;
};

function WhatsAppIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <path d="M12 3.8a8.2 8.2 0 0 0-7 12.5l-1 3.7 3.8-1a8.2 8.2 0 1 0 4.2-15.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8.9 8.5c.2-.5.4-.5.7-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.3.1.5-.1.7l-.4.5c.6 1 1.4 1.8 2.5 2.4l.5-.5c.2-.2.4-.2.7-.1l1.6.7c.3.1.4.3.4.6v.4c0 .4-.2.7-.5.8-.5.3-1.3.4-2.4 0-2.8-.9-4.9-3.1-5.8-5.8-.3-.8-.2-1.5.1-2.2Z" fill="currentColor" />
    </svg>
  );
}

function LogoMark() {
  return (
    <img
      src="/images/tapgo-mark.png"
      alt="TapGo Lion"
      className="h-10 w-10 object-contain"
      loading="eager"
    />
  );
}

export default function RegisterForm() {
  const searchParams = useSearchParams();
  const selectedPackage = packageMap[(searchParams.get("package") || "").toLowerCase()] || "";
  const [form, setForm] = useState<FormState>({
    name: "",
    whatsapp: "",
    email: "",
    address: "",
    packageName: selectedPackage,
    referral: "",
    notes: ""
  });
  const [error, setError] = useState("");

  const whatsappLink = useMemo(() => {
    const message = [
      "Halo TapGo Lion, saya ingin mendaftar membership.",
      "",
      "Nama:",
      form.name || "-",
      "Nomor WhatsApp:",
      form.whatsapp || "-",
      "Email:",
      form.email || "-",
      "Alamat:",
      form.address || "-",
      "Paket:",
      form.packageName || "-",
      "Kode Referral:",
      form.referral || "-",
      "Catatan:",
      form.notes || "-"
    ].join("\n");

    return `https://wa.me/6283800255588?text=${encodeURIComponent(message)}`;
  }, [form]);

  function updateField(field: keyof FormState, value: string) {
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
      setError("Nomor WhatsApp wajib diisi.");
      return;
    }

    if (!form.packageName) {
      setError("Paket membership wajib dipilih.");
      return;
    }

    window.location.href = whatsappLink;
  }

  return (
    <main data-themed="true" className="themed-text min-h-screen px-5 py-8">
      <nav className="mx-auto flex max-w-6xl items-center justify-between">
        <a href="/" className="themed-text flex items-center gap-3 font-bold" aria-label="TapGo Lion Indonesia">
          <LogoMark />
          <span>TapGo Lion</span>
        </a>
        <a href="https://wa.me/6283800255588" className="themed-border themed-fill themed-text hidden rounded-full border px-5 py-2.5 text-sm font-bold shadow-sm transition hover:-translate-y-0.5 hover:border-brand-gold/40 hover:text-[var(--themed-accent-gold)] sm:inline-flex">
          WhatsApp Resmi
        </a>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-8 py-12 lg:grid-cols-[0.88fr_1.12fr] lg:py-16">
        <div className="lg:pt-8">
          <div className="themed-fill inline-flex rounded-full border border-brand-gold/30 px-4 py-2 text-sm font-bold text-[var(--themed-accent-gold)] backdrop-blur">
            PT. TapGo Lion Indonesia
          </div>
          <h1 className="themed-text mt-6 text-4xl font-black tracking-tight md:text-6xl">
            Daftar Membership TapGo Lion
          </h1>
          <p className="themed-text-secondary mt-5 text-lg leading-8">
            Isi formulir berikut untuk mendapatkan informasi pendaftaran membership TapGo Lion.
          </p>

          <div className="themed-glass mt-8 rounded-[2rem] p-6">
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-green text-white">
              <WhatsAppIcon />
            </div>
            <h2 className="themed-text text-2xl font-black">Dilanjutkan via WhatsApp resmi</h2>
            <p className="themed-text-secondary mt-3 leading-7">
              Setelah form valid, data pendaftaran akan dikirim sebagai pesan otomatis ke WhatsApp resmi TapGo Lion: +62 838-0025-5588.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="themed-glass rounded-[2rem] p-6 md:p-8">
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block">
              <span className="themed-text text-sm font-bold">Nama lengkap *</span>
              <input
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                className="mt-2 w-full rounded-2xl border themed-border bg-white px-4 py-3 text-brand-navyDeep outline-none transition focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
                placeholder="Nama sesuai identitas"
              />
            </label>

            <label className="block">
              <span className="themed-text text-sm font-bold">Nomor WhatsApp *</span>
              <input
                value={form.whatsapp}
                onChange={(event) => updateField("whatsapp", event.target.value)}
                className="mt-2 w-full rounded-2xl border themed-border bg-white px-4 py-3 text-brand-navyDeep outline-none transition focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
                placeholder="08xxxxxxxxxx"
                inputMode="tel"
              />
            </label>

            <label className="block">
              <span className="themed-text text-sm font-bold">Email</span>
              <input
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                className="mt-2 w-full rounded-2xl border themed-border bg-white px-4 py-3 text-brand-navyDeep outline-none transition focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
                placeholder="nama@email.com"
                type="email"
              />
            </label>

            <label className="block">
              <span className="themed-text text-sm font-bold">Pilih Paket Membership *</span>
              <select
                value={form.packageName}
                onChange={(event) => updateField("packageName", event.target.value)}
                className="mt-2 w-full rounded-2xl border themed-border bg-white px-4 py-3 text-brand-navyDeep outline-none transition focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
              >
                <option value="">Pilih paket</option>
                {packageOptions.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <label className="block md:col-span-2">
              <span className="themed-text text-sm font-bold">Alamat</span>
              <textarea
                value={form.address}
                onChange={(event) => updateField("address", event.target.value)}
                className="mt-2 min-h-24 w-full rounded-2xl border themed-border bg-white px-4 py-3 text-brand-navyDeep outline-none transition focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
                placeholder="Alamat domisili"
              />
            </label>

            <label className="block">
              <span className="themed-text text-sm font-bold">Kode referral jika ada</span>
              <input
                value={form.referral}
                onChange={(event) => updateField("referral", event.target.value)}
                className="mt-2 w-full rounded-2xl border themed-border bg-white px-4 py-3 text-brand-navyDeep outline-none transition focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
                placeholder="Opsional"
              />
            </label>

            <label className="block">
              <span className="themed-text text-sm font-bold">Catatan tambahan</span>
              <input
                value={form.notes}
                onChange={(event) => updateField("notes", event.target.value)}
                className="mt-2 w-full rounded-2xl border themed-border bg-white px-4 py-3 text-brand-navyDeep outline-none transition focus:border-brand-gold focus:ring-4 focus:ring-brand-gold/20"
                placeholder="Opsional"
              />
            </label>
          </div>

          {error ? (
            <div className="mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-300">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-green px-7 py-4 text-center font-bold text-white shadow-lg transition hover:-translate-y-1"
          >
            <WhatsAppIcon />
            Kirim Pendaftaran
          </button>

          <p className="themed-text-muted mt-5 text-center text-sm leading-6">
            TapGo akan memproses informasi awal pendaftaran melalui WhatsApp resmi. Pastikan nomor yang dicantumkan aktif.
          </p>
        </form>
      </section>
    </main>
  );
}
