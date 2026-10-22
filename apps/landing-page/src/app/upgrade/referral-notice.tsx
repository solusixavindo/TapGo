"use client";

import { useEffect, useState } from "react";
import { REFERRAL_NOTICE_KEY, ReferralNotice, clearSession, readSession } from "./api";

const toneClass: Record<ReferralNotice["tone"], string> = {
  success: "border-emerald-500/40 bg-emerald-500/10 themed-text",
  info: "border-amber-400/40 bg-amber-400/10 themed-accent",
  warn: "border-rose-500/40 bg-rose-500/10 themed-text"
};

/**
 * Hasil pengaitan kode referral setelah pelanggan masuk. Ditulis oleh halaman masuk (login-form) lalu ditampilkan
 * SEKALI di langkah berikutnya, supaya pelanggan tahu kodenya masuk atau kenapa tidak dipakai.
 */
export default function ReferralNoticeBanner() {
  const [notice, setNotice] = useState<ReferralNotice | null>(null);

  useEffect(() => {
    const raw = readSession(REFERRAL_NOTICE_KEY);
    if (!raw) return;
    clearSession(REFERRAL_NOTICE_KEY);
    try {
      const parsed = JSON.parse(raw) as ReferralNotice;
      if (parsed?.message && parsed.tone in toneClass) setNotice(parsed);
    } catch {
      // diabaikan: pesan rusak tidak boleh mengganggu alur
    }
  }, []);

  if (!notice) return null;
  return (
    <p role="status" className={`mb-5 rounded-2xl border px-4 py-3 text-sm font-semibold ${toneClass[notice.tone]}`}>
      {notice.message}
    </p>
  );
}
