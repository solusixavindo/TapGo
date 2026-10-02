"use client";

import { useState } from "react";
import { ManualTransferInfo } from "../api";
import { formatRupiah } from "../upgrade-shell";

function CopyRow({ label, value, shown }: { label: string; value: string; shown?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <dt className="text-xs themed-text-muted">{label}</dt>
        <dd className="mt-0.5 break-all text-base font-black themed-text">{shown ?? value}</dd>
      </div>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-full border themed-border px-3 py-1.5 text-xs font-bold themed-text"
      >
        {copied ? "Tersalin" : "Salin"}
      </button>
    </div>
  );
}

/**
 * Petunjuk transfer bank manual. Nominal yang harus ditransfer adalah harga
 * paket ditambah kode unik: kode unik itulah satu-satunya petunjuk tim TapGo
 * untuk mencocokkan mutasi bank dengan pengajuan ini.
 */
export function ManualTransferCard({ info }: { info: ManualTransferInfo }) {
  const expires = new Date(info.expiresAt);
  const expiresLabel = Number.isNaN(expires.getTime())
    ? ""
    : expires.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" });

  return (
    <div className="rounded-[1.5rem] border themed-border themed-card-bg p-5" data-testid="manual-transfer-card">
      <p className="text-sm themed-text-muted">Transfer tepat sebesar</p>
      <p className="mt-1 text-3xl font-black themed-accent">{formatRupiah(info.transferAmount)}</p>
      <p className="mt-2 text-xs leading-6 themed-text-muted">
        {"Tiga digit terakhir ("}
        <strong className="themed-text">{String(info.uniqueCode).padStart(3, "0")}</strong>
        {") adalah kode unik agar transfer Anda mudah dikenali. Harga paket "}
        <strong className="themed-text">{formatRupiah(info.baseAmount)}</strong>
        {". Jangan dibulatkan."}
      </p>

      {info.expired ? (
        <p role="alert" className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs font-semibold text-amber-300">
          Batas waktu transfer sudah lewat. Tekan “Buat petunjuk transfer baru” untuk mendapat nominal baru sebelum
          mentransfer.
        </p>
      ) : null}

      <dl className="mt-5 space-y-4 border-t border-dashed themed-border pt-5">
        <CopyRow label="Bank" value={info.bank.bankName} />
        <CopyRow label="Nomor rekening" value={info.bank.accountNumber} />
        <CopyRow label="Atas nama" value={info.bank.accountHolder} />
        <CopyRow label="Nominal transfer" value={String(info.transferAmount)} shown={formatRupiah(info.transferAmount)} />
      </dl>

      <p className="mt-5 text-xs themed-text-muted">
        Nomor pengajuan {info.invoiceNumber}
        {expiresLabel ? ` · berlaku sampai ${expiresLabel}` : ""}
      </p>
    </div>
  );
}
