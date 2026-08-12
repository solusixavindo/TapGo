"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  ORDER_KEY,
  PACKAGE_KEY,
  PREVIEW_MODE,
  TOKEN_KEY,
  createOrder,
  readSession,
  uploadDocument,
  writeSession
} from "../api";
import { Field, inputClass, primaryButtonClass } from "../upgrade-shell";

type DocumentSlot = "ktp" | "selfie";

type PickedDocument = {
  name: string;
  size: number;
  type: string;
  /** Null hanya pada mode tinjauan tampilan, yang tidak pernah mengunggah. */
  file: File | null;
};

const DOCUMENT_LABELS: Record<DocumentSlot, { title: string; hint: string }> = {
  ktp: { title: "Foto KTP", hint: "Pastikan NIK dan nama terbaca jelas." },
  selfie: { title: "Swafoto dengan KTP", hint: "Wajah dan KTP terlihat dalam satu foto." }
};

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg"];

function DocumentUpload({
  slot,
  document,
  onPick
}: {
  slot: DocumentSlot;
  document: PickedDocument | null;
  onPick: (slot: DocumentSlot, file: File | null) => void;
}) {
  const meta = DOCUMENT_LABELS[slot];
  const filled = document !== null;

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
          {document ? document.name : meta.hint}
        </span>
      </span>
      <span className="shrink-0 text-xs font-black uppercase tracking-wider text-brand-blue">
        {filled ? "Ganti" : "Pilih"}
      </span>
      <input
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        onChange={(event) => onPick(slot, event.target.files?.[0] ?? null)}
      />
    </label>
  );
}

/** Keterangan berkas untuk disimpan bersama pengajuan. Objek File tidak ikut. */
function describe(document: PickedDocument | null) {
  if (!document) return null;
  return { name: document.name, size: document.size, type: document.type };
}

export default function RegistrationForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState(PREVIEW_MODE ? "Budi Santoso" : "");
  const [address, setAddress] = useState(
    PREVIEW_MODE ? "Jl. Merdeka No. 12, Serang, Banten" : ""
  );
  const [documents, setDocuments] = useState<Record<DocumentSlot, PickedDocument | null>>({
    ktp: PREVIEW_MODE
      ? { name: "ktp-budi.jpg", size: 512000, type: "image/jpeg", file: null }
      : null,
    selfie: PREVIEW_MODE
      ? { name: "swafoto-budi.jpg", size: 480000, type: "image/jpeg", file: null }
      : null
  });
  const [consent, setConsent] = useState(PREVIEW_MODE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (PREVIEW_MODE) return;
    if (!readSession(TOKEN_KEY)) {
      router.replace("/upgrade");
      return;
    }
    if (!readSession(PACKAGE_KEY)) {
      router.replace("/upgrade/paket");
    }
  }, [router]);

  const complete =
    fullName.trim().length > 2 &&
    address.trim().length > 5 &&
    documents.ktp !== null &&
    documents.selfie !== null &&
    consent;

  function onPick(slot: DocumentSlot, file: File | null) {
    if (!file) {
      setDocuments((current) => ({ ...current, [slot]: null }));
      return;
    }
    // Divalidasi di sini supaya pengguna tahu berkasnya bermasalah sebelum
    // membayar, bukan setelah.
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Dokumen harus berformat JPG atau PNG.");
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError("Ukuran dokumen maksimal 5 MB.");
      return;
    }
    setError("");
    setDocuments((current) => ({
      ...current,
      [slot]: { name: file.name, size: file.size, type: file.type, file }
    }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!complete) {
      setError("Lengkapi seluruh data dan kedua dokumen terlebih dahulu.");
      return;
    }
    setError("");

    if (PREVIEW_MODE) {
      router.push("/upgrade/bayar");
      return;
    }

    setBusy(true);
    try {
      const order = await createOrder(readSession(TOKEN_KEY), readSession(PACKAGE_KEY), {
        fullName: fullName.trim(),
        address: address.trim(),
        consentAt: new Date().toISOString(),
        // Hanya keterangan berkasnya. Gambarnya dikirim terpisah di bawah,
        // sebagai berkas mentah ke endpoint dokumen, dan tersimpan terenkripsi
        // dengan masa simpan terbatas.
        documents: {
          ktp: describe(documents.ktp),
          selfie: describe(documents.selfie)
        }
      });
      writeSession(ORDER_KEY, order.id);

      // Berkas diunggah setelah pengajuan terbentuk karena dokumen menempel
      // pada satu pengajuan tertentu. Bila unggahan gagal, pengajuannya tetap
      // ada dan pemohon dapat mengulang tanpa kehilangan nomor invoice.
      const token = readSession(TOKEN_KEY);
      await uploadDocument(token, order.id, "ktp", documents.ktp!.file!);
      await uploadDocument(token, order.id, "selfie", documents.selfie!.file!);

      router.push("/upgrade/bayar");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Pengajuan belum dapat dibuat."
      );
    } finally {
      setBusy(false);
    }
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
        <DocumentUpload slot="ktp" document={documents.ktp} onPick={onPick} />
        <DocumentUpload slot="selfie" document={documents.selfie} onPick={onPick} />
        <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">
          Dokumen disimpan terenkripsi dan otomatis dihapus dari sistem paling
          lama 24 jam setelah diunggah, setelah tim verifikasi selesai
          memeriksanya.
        </p>
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

      <button type="submit" className={primaryButtonClass} disabled={!complete || busy}>
        {busy ? "Menyimpan pengajuan…" : "Lanjut ke Pembayaran"}
      </button>
    </form>
  );
}
