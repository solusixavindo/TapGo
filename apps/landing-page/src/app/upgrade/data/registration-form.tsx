"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { PREVIEW_MODE } from "../api";
import { Field, inputClass, primaryButtonClass } from "../upgrade-shell";

type DocumentSlot = "ktp" | "selfie";

const DOCUMENT_LABELS: Record<DocumentSlot, { title: string; hint: string }> = {
  ktp: { title: "Foto KTP", hint: "Pastikan NIK dan nama terbaca jelas." },
  selfie: { title: "Swafoto dengan KTP", hint: "Wajah dan KTP terlihat dalam satu foto." }
};

function DocumentUpload({
  slot,
  fileName,
  onPick
}: {
  slot: DocumentSlot;
  fileName: string;
  onPick: (slot: DocumentSlot, name: string) => void;
}) {
  const meta = DOCUMENT_LABELS[slot];
  const filled = fileName.length > 0;

  return (
    <label
      className={[
        "flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed p-4 transition",
        filled
          ? "border-brand-green/50 bg-brand-green/5"
          : "border-slate-200 bg-white hover:border-brand-blue/40"
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
          filled ? "bg-brand-green/15 text-brand-green" : "bg-slate-100 text-slate-400"
        ].join(" ")}
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="9" cy="10.5" r="1.8" stroke="currentColor" strokeWidth="1.8" />
          <path d="m4.5 17 4.2-3.6 3.3 2.6 3-2.3 4.5 3.3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-brand-navy">{meta.title}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-500">
          {filled ? fileName : meta.hint}
        </span>
      </span>
      <span className="shrink-0 text-xs font-black uppercase tracking-wider text-brand-blue">
        {filled ? "Ganti" : "Pilih"}
      </span>
      <input
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        onChange={(event) => onPick(slot, event.target.files?.[0]?.name ?? "")}
      />
    </label>
  );
}

export default function RegistrationForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState(PREVIEW_MODE ? "Budi Santoso" : "");
  const [address, setAddress] = useState(
    PREVIEW_MODE ? "Jl. Merdeka No. 12, Serang, Banten" : ""
  );
  const [documents, setDocuments] = useState<Record<DocumentSlot, string>>({
    ktp: PREVIEW_MODE ? "ktp-budi.jpg" : "",
    selfie: PREVIEW_MODE ? "swafoto-budi.jpg" : ""
  });
  const [consent, setConsent] = useState(PREVIEW_MODE);
  const [error, setError] = useState("");

  const complete =
    fullName.trim().length > 2 &&
    address.trim().length > 5 &&
    documents.ktp.length > 0 &&
    documents.selfie.length > 0 &&
    consent;

  function onPick(slot: DocumentSlot, name: string) {
    setDocuments((current) => ({ ...current, [slot]: name }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete) {
      setError("Lengkapi seluruh data dan kedua dokumen terlebih dahulu.");
      return;
    }
    setError("");
    router.push("/upgrade/bayar");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <Field label="Nama lengkap sesuai KTP">
        <input
          className={inputClass}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Nama lengkap"
          autoComplete="name"
          required
        />
      </Field>

      <Field label="Alamat domisili">
        <textarea
          className={`${inputClass} min-h-[96px] resize-y`}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Jalan, kelurahan, kecamatan, kota"
          required
        />
      </Field>

      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
          Dokumen verifikasi
        </p>
        <DocumentUpload slot="ktp" fileName={documents.ktp} onPick={onPick} />
        <DocumentUpload slot="selfie" fileName={documents.selfie} onPick={onPick} />
      </div>

      <label className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3.5">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-[#0B66E4]"
        />
        <span className="text-xs leading-6 text-slate-600">
          Saya menyatakan data dan dokumen di atas benar, serta menyetujui
          pemrosesan data untuk verifikasi keanggotaan sesuai Kebijakan Privasi
          TapGo.
        </span>
      </label>

      {error ? (
        <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {error}
        </p>
      ) : null}

      <button type="submit" className={primaryButtonClass} disabled={!complete}>
        Lanjut ke Pembayaran
      </button>
    </form>
  );
}
