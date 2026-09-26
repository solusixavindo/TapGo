"use client";

import { useEffect, useState } from "react";
import {
  DRIVER_REJECT_REASONS,
  activateDriverProfile,
  DriverDocumentQueueRow,
  approveDriverApplication,
  claimDriverApplication,
  grantSelfReviewScopes,
  listOwnReviewScopes,
  rejectDriverApplication,
  releaseDriverApplication,
  renewDriverApplication
} from "../../lib/api";

/**
 * Keputusan menyetujui / menolak pengajuan driver.
 *
 * Alurnya mengikuti server: (1) ambil klaim (berlaku 15 menit), (2) periksa
 * dokumen di atas, (3) setujui atau tolak. Server memeriksa ulang kewenangan
 * dan klaim pada setiap langkah; tombol di sini hanya jalan pintas.
 * Keputusan tidak dapat dibatalkan dari layar ini.
 */
export default function DriverDecisionPanel({
  row,
  onChanged
}: {
  row: DriverDocumentQueueRow;
  onChanged: () => void;
}) {
  const application = row.application;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(DRIVER_REJECT_REASONS[0]!.code);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [missingScope, setMissingScope] = useState(false);

  useEffect(() => {
    setError("");
    setNotice("");
    setRejecting(false);
    setConfirmApprove(false);
    setMissingScope(false);
  }, [row.driverId]);

  async function run(action: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(done);
      setRejecting(false);
      setConfirmApprove(false);
      onChanged();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Tindakan belum dapat diproses.";
      setMissingScope(/kewenangan|scope/i.test(message));
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function giveScopes() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const own = await listOwnReviewScopes();
      await grantSelfReviewScopes(own.userId);
      setMissingScope(false);
      setNotice("Kewenangan review aktif untuk akun Anda. Silakan ambil klaim pengajuan.");
    } catch (caught) {
      setError(
        (caught instanceof Error ? caught.message : "Kewenangan belum dapat diberikan.") +
          " Hanya akun pengelola kewenangan (ADMIN_SCOPE_MANAGE) yang dapat memberikannya."
      );
    } finally {
      setBusy(false);
    }
  }

  const box = "mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 print:hidden";

  const profile = row.profile;
  const activation =
    profile && profile.status === "PENDING" ? (
      <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-3">
        <p className="text-sm text-slate-700">
          Dokumen sudah disetujui. Driver belum bisa menerima pesanan sampai diaktifkan.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => activateDriverProfile(profile.id), "Driver diaktifkan dan dapat menerima pesanan.")}
          className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          {busy ? "Memproses…" : "Aktifkan driver"}
        </button>
        <p className="mt-2 text-[11px] text-slate-400">Khusus Super Admin.</p>
      </div>
    ) : profile && profile.status === "ACTIVE" ? (
      <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Driver sudah aktif.</p>
    ) : null;

  if (!application) {
    return (
      <div className={box}>
        <p className="text-sm font-bold text-slate-800">Keputusan pengajuan</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Tidak ada pengajuan terbuka untuk mitra ini. Status verifikasi saat ini:{" "}
          <strong>{row.kycStatus}</strong>. Mitra yang ditolak dapat mengajukan ulang dari aplikasinya.
        </p>
        {notice ? (
          <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        {activation}
      </div>
    );
  }

  const mine = application.claimedByMe;
  const heldByOther = application.claimActive && !mine;

  return (
    <div className={box} data-testid="driver-decision-panel">
      <p className="text-sm font-bold text-slate-800">Keputusan pengajuan</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        {mine
          ? "Anda memegang klaim pengajuan ini. Periksa dokumen di atas, lalu putuskan sebelum klaim habis."
          : heldByOther
            ? "Pengajuan ini sedang ditinjau admin lain. Tunggu klaimnya habis atau minta ia melepasnya."
            : "Ambil klaim untuk mulai meninjau. Klaim berlaku 15 menit."}
      </p>

      {notice ? (
        <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {missingScope ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void giveScopes()}
          className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
        >
          Berikan kewenangan review ke akun saya
        </button>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {!mine ? (
          <button
            type="button"
            disabled={busy || heldByOther}
            onClick={() => void run(() => claimDriverApplication(application.id), "Klaim diambil. Silakan periksa dokumen dan putuskan.")}
            className="rounded-lg bg-brand-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            Ambil untuk ditinjau
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmApprove(true);
                setRejecting(false);
              }}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              Setujui
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRejecting(true);
                setConfirmApprove(false);
              }}
              className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-bold text-rose-700 disabled:opacity-40"
            >
              Tolak
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => renewDriverApplication(application.id), "Klaim diperpanjang 15 menit.")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40"
            >
              Perpanjang klaim
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => releaseDriverApplication(application.id), "Klaim dilepas.")}
              className="rounded-lg px-3 py-2 text-xs font-bold text-slate-500 disabled:opacity-40"
            >
              Lepas klaim
            </button>
          </>
        )}
      </div>

      {activation}

      {confirmApprove ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-3">
          <p className="text-sm text-slate-700">
            Setujui dokumen <strong>{row.fullName}</strong>? Setelah itu Super Admin masih perlu menekan “Aktifkan driver” agar ia dapat menerima pesanan.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => approveDriverApplication(application.id), "Driver disetujui.")}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "Memproses…" : "Ya, setujui"}
            </button>
            <button type="button" onClick={() => setConfirmApprove(false)} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-500">
              Batal
            </button>
          </div>
        </div>
      ) : null}

      {rejecting ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-white p-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
            Alasan penolakan
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal"
            >
              {DRIVER_REJECT_REASONS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-slate-500">Mitra dapat memperbaiki dokumen dan mengajukan ulang dari aplikasinya.</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => rejectDriverApplication(application.id, reason), "Pengajuan ditolak.")}
              className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "Memproses…" : "Tolak pengajuan"}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="rounded-lg px-3 py-2 text-sm font-bold text-slate-500">
              Batal
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
