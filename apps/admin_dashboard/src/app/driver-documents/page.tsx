"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DriverDocumentQueueRow,
  clearSession,
  formatMoment,
  listDriverDocumentQueue,
  readRole,
  readToken,
  remainingRetention
} from "../../lib/api";
import ConsoleHeader from "../console-header";
import DriverDocumentViewer from "./driver-document-viewer";

/**
 * Peninjauan dan pencetakan dokumen mitra driver.
 *
 * Yang perlu diingat saat membaca berkas ini: isi dokumen hanya bertahan 24 jam
 * di database. Layar ini karena itu menonjolkan sisa masa simpan, dan menaruh
 * tombol cetak sebagai tindakan utama — mencetak adalah cara berkas ini menjadi
 * dokumen administrasi sebelum salinan digitalnya hilang.
 *
 * Layar ini TIDAK memutuskan status KYC. Keputusan menyetujui atau menolak
 * mitra berjalan lewat alur peninjauan pengajuan yang terpisah, lengkap dengan
 * mekanisme klaimnya; menaruh tombol keputusan di sini akan membuat dua jalur
 * memperebutkan pengajuan yang sama.
 */

const KYC_LABEL: Record<string, string> = {
  NOT_SUBMITTED: "Belum mengirim",
  PENDING: "Menunggu pemeriksaan",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak"
};

function kycTone(status: string) {
  if (status === "APPROVED") return "bg-emerald-100 text-emerald-800";
  if (status === "REJECTED") return "bg-rose-100 text-rose-800";
  if (status === "PENDING") return "bg-blue-100 text-blue-800";
  return "bg-slate-200 text-slate-700";
}

/** Dokumen yang isinya masih dapat dibuka, dan karena itu masih dapat dicetak. */
function printableCount(row: DriverDocumentQueueRow) {
  return row.documents.filter((item) => item.available).length;
}

export default function DriverDocumentsPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [rows, setRows] = useState<DriverDocumentQueueRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => rows.find((item) => item.driverId === selectedId) ?? null,
    [rows, selectedId]
  );

  const refresh = useCallback(async () => {
    try {
      const result = await listDriverDocumentQueue();
      setRows(result.items);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Daftar belum dapat dimuat."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!readToken()) {
      router.replace("/");
      return;
    }
    setRole(readRole());
    void refresh();
  }, [router, refresh]);

  function signOut() {
    clearSession();
    router.replace("/");
  }

  const menungguPemeriksaan = rows.filter((row) => row.kycStatus === "PENDING");

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950 print:bg-white print:p-0">
      <div className="mx-auto max-w-7xl">
        <ConsoleHeader
          title="Dokumen Mitra Driver"
          subtitle={`${menungguPemeriksaan.length} mitra menunggu pemeriksaan dari ${rows.length} yang memiliki dokumen`}
          role={role}
          backHref="/member-requests"
          backLabel="Kembali ke verifikasi keanggotaan"
          actions={
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-white/25 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10"
            >
              Muat ulang
            </button>
          }
        />

        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
          Isi dokumen dihapus otomatis paling lama 24 jam setelah diunggah.
          Cetak selagi masih tersedia — setelah dihapus, mitra harus diminta
          mengunggah ulang.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 print:hidden"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr] print:mt-0 print:block">
          <section className="print:hidden">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Daftar mitra
            </h2>

            {loading ? (
              <p className="mt-3 rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500">
                Memuat…
              </p>
            ) : rows.length === 0 ? (
              <p className="mt-3 rounded-xl bg-white px-4 py-8 text-center text-sm text-slate-500">
                Belum ada mitra yang mengunggah dokumen.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {rows.map((row) => {
                  const active = row.driverId === selectedId;
                  const siap = printableCount(row);
                  return (
                    <li key={row.driverId}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.driverId)}
                        className={[
                          "w-full rounded-xl border px-4 py-3 text-left transition",
                          active
                            ? "border-brand-ink bg-white shadow"
                            : "border-slate-200 bg-white/70 hover:border-slate-300"
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-semibold text-slate-900">
                            {row.fullName}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${kycTone(row.kycStatus)}`}
                          >
                            {KYC_LABEL[row.kycStatus] ?? row.kycStatus}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{row.phone}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {siap} dari {row.documents.length} berkas masih dapat
                          dicetak
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {!selected ? (
            <p className="rounded-xl bg-white px-6 py-16 text-center text-sm text-slate-500 print:hidden">
              Pilih satu mitra untuk melihat dan mencetak dokumennya.
            </p>
          ) : (
            <article className="rounded-xl border border-slate-200 bg-white p-6 print:border-0 print:p-0">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {selected.fullName}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">{selected.phone}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Kendaraan: {selected.vehicleType ?? "-"}
                    {selected.vehiclePlate ? ` · ${selected.vehiclePlate}` : ""}
                  </p>
                  {/* ID mitra dicetak agar berkas fisik dapat ditelusuri kembali
                      ke barisnya di sistem. */}
                  <p className="mt-1 font-mono text-[10px] text-slate-400">
                    ID mitra: {selected.driverId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-lg bg-brand-ink px-4 py-2 text-sm font-semibold text-white print:hidden"
                >
                  Cetak berkas
                </button>
              </div>

              {selected.documents.length === 0 ? (
                <p className="mt-6 text-sm text-slate-500">
                  Mitra ini belum mengunggah dokumen apa pun.
                </p>
              ) : (
                <div className="mt-6 grid gap-4 sm:grid-cols-2 print:gap-6">
                  {selected.documents.map((document) => (
                    <DriverDocumentViewer
                      key={document.type}
                      driverId={selected.driverId}
                      document={document}
                    />
                  ))}
                </div>
              )}

              <dl className="mt-6 space-y-1 text-xs text-slate-500 print:mt-4">
                <div className="flex justify-between gap-4">
                  <dt>Status verifikasi</dt>
                  <dd className="font-semibold text-slate-700">
                    {KYC_LABEL[selected.kycStatus] ?? selected.kycStatus}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Unggahan terakhir</dt>
                  <dd>
                    {formatMoment(
                      selected.documents
                        .map((item) => item.uploadedAt)
                        .filter((value): value is string => Boolean(value))
                        .sort()
                        .at(-1) ?? null
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Berkas paling cepat dihapus</dt>
                  <dd className="font-semibold text-amber-700">
                    {(() => {
                      const tersedia = selected.documents
                        .filter((item) => item.available && item.expiresAt)
                        .map((item) => item.expiresAt as string)
                        .sort();
                      return tersedia.length
                        ? remainingRetention(tersedia[0]!)
                        : "tidak ada berkas tersisa";
                    })()}
                  </dd>
                </div>
              </dl>

              <p className="mt-4 text-[11px] leading-5 text-slate-400 print:mt-6 print:text-slate-600">
                Keputusan menyetujui atau menolak mitra dilakukan melalui alur
                peninjauan pengajuan, bukan dari layar ini.
              </p>
            </article>
          )}
        </div>
      </div>
    </main>
  );
}
