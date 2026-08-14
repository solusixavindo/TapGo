"use client";

import { useEffect, useState } from "react";
import {
  DocumentSummary,
  DocumentType,
  fetchDocumentObjectUrl,
  formatMoment,
  remainingRetention
} from "../../lib/api";

const LABELS: Record<DocumentType, string> = {
  KTP: "Foto KTP",
  SELFIE: "Swafoto dengan KTP"
};

/**
 * Menampilkan satu dokumen identitas.
 *
 * Gambarnya diambil sebagai blob karena endpoint-nya menuntut header
 * Authorization. Object URL dilepas saat komponen dibongkar atau dokumen
 * berganti, supaya isi dokumen tidak menetap di memori tab setelah admin
 * berpindah pengajuan.
 */
export default function DocumentViewer({
  orderId,
  document
}: {
  orderId: string;
  document: DocumentSummary;
}) {
  const [objectUrl, setObjectUrl] = useState("");
  const [checksum, setChecksum] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!document.available) {
      setObjectUrl("");
      return;
    }

    let revoked = false;
    let created = "";
    setLoading(true);
    fetchDocumentObjectUrl(orderId, document.type)
      .then((result) => {
        if (revoked) {
          URL.revokeObjectURL(result.url);
          return;
        }
        created = result.url;
        setObjectUrl(result.url);
        setChecksum(result.checksum);
        setError("");
      })
      .catch((caught: unknown) =>
        revoked
          ? undefined
          : setError(caught instanceof Error ? caught.message : "Dokumen belum dapat dibuka.")
      )
      .finally(() => (revoked ? undefined : setLoading(false)));

    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [orderId, document.type, document.available]);

  return (
    <figure className="rounded-xl border border-slate-200 bg-white p-4 print:break-inside-avoid">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900">{LABELS[document.type]}</span>
        <span className="text-xs text-slate-500">
          Diunggah {formatMoment(document.uploadedAt)}
        </span>
      </figcaption>

      <div className="mt-3 flex min-h-[220px] items-center justify-center overflow-hidden rounded-lg bg-slate-50 print:min-h-0 print:bg-white">
        {loading ? (
          <p className="text-sm text-slate-500">Memuat dokumen…</p>
        ) : objectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob URL, bukan aset yang dapat dioptimasi
          <img
            src={objectUrl}
            alt={LABELS[document.type]}
            className="max-h-[420px] w-full object-contain print:max-h-none"
          />
        ) : (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            {error || "Masa simpan dokumen sudah berakhir dan isinya telah dihapus."}
          </p>
        )}
      </div>

      <dl className="mt-3 space-y-1 text-xs text-slate-500">
        <div className="flex justify-between gap-4">
          <dt>Masa simpan</dt>
          <dd className={document.available ? "font-semibold text-amber-700" : "text-slate-400"}>
            {document.available ? remainingRetention(document.expiresAt) : "sudah dihapus"}
          </dd>
        </div>
        {checksum || document.checksum ? (
          <div className="flex justify-between gap-4">
            <dt>Checksum</dt>
            <dd className="break-all font-mono text-[10px] text-slate-400">
              {checksum || document.checksum}
            </dd>
          </div>
        ) : null}
      </dl>
    </figure>
  );
}
