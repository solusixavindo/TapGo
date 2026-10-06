"use client";

import { ReactNode, useState } from "react";
import { formatRupiah, secondaryButtonClass } from "./upgrade-shell";

/**
 * Invoice pembayaran transfer bank (top up dan upgrade membership).
 *
 * Satu komponen untuk dua alur, supaya rekening perusahaan, nominal berkode
 * unik, dan batas waktu selalu tampil sama. Isinya dapat dicetak / disimpan
 * sebagai PDF (CSS cetak di globals.css hanya menampilkan `.invoice-print`),
 * dibagikan lewat WhatsApp, atau disalin sebagai teks — supaya pengguna tidak
 * perlu mencari ulang nomor rekening setelah halaman ditutup.
 *
 * Ini INSTRUKSI pembayaran, bukan bukti bayar: pembayaran sah setelah transfer
 * dikonfirmasi tim TapGo.
 */

export type InvoiceLine = { label: string; amount: number; hint?: string };

export type InvoiceBank = { bankName: string; accountNumber: string; accountHolder: string };

export type InvoiceData = {
  /** Nomor invoice (upgrade: INV-MBR-…) atau nomor pengajuan (top up: MTOP-…). */
  number: string;
  /** Judul transaksi, mis. "Top Up Saldo PPOB" atau "Upgrade Membership Gold". */
  heading: string;
  issuedAt?: string;
  buyerName?: string;
  /** Rincian yang menjumlah ke `total`, mis. nominal + kode unik. */
  lines: InvoiceLine[];
  total: number;
  bank: InvoiceBank;
  expiresAt?: string;
  expired?: boolean;
  /** Catatan khusus transaksi (mis. Saldo PPOB tidak dapat ditarik). */
  notes?: string[];
  /** Slot QRIS resmi perusahaan; kosong sampai QRIS terverifikasi tersedia. */
  qris?: { imageSrc: string; caption: string };
  children?: ReactNode;
};

const COMPANY = "PT. TapGo Lion Indonesia";

function formatMoment(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" });
}

/** Teks polos untuk disalin / dibagikan. Hanya data rekening perusahaan dan tagihan. */
export function invoiceText(data: InvoiceData): string {
  const rows = [
    `INVOICE ${data.number}`,
    COMPANY,
    data.heading,
    ...(data.buyerName ? [`Atas nama pemohon: ${data.buyerName}`] : []),
    "",
    ...data.lines.map((line) => `${line.label}: ${formatRupiah(line.amount)}`),
    `TOTAL TRANSFER: ${formatRupiah(data.total)} (tepat, jangan dibulatkan)`,
    "",
    "Transfer ke:",
    `Bank: ${data.bank.bankName}`,
    `No. rekening: ${data.bank.accountNumber}`,
    `Atas nama: ${data.bank.accountHolder}`,
    ...(data.expiresAt ? [`Berlaku sampai: ${formatMoment(data.expiresAt)}`] : []),
    "",
    "Pembayaran sah setelah transfer dikonfirmasi tim TapGo."
  ];
  return rows.join("\n");
}

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
        className="no-print shrink-0 rounded-full border themed-border px-3 py-1.5 text-xs font-bold themed-text"
      >
        {copied ? "Tersalin" : "Salin"}
      </button>
    </div>
  );
}

export function PaymentInvoice({ data }: { data: InvoiceData }) {
  const [copiedAll, setCopiedAll] = useState(false);
  const issued = formatMoment(data.issuedAt);
  const expires = formatMoment(data.expiresAt);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(invoiceText(data));
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 2200);
    } catch {
      setCopiedAll(false);
    }
  }

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(invoiceText(data))}`;

  return (
    <div>
      <section
        className="invoice-print rounded-[1.5rem] border themed-border themed-card-bg p-5"
        data-testid="invoice"
        aria-label={`Invoice ${data.number}`}
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-dashed themed-border pb-4">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] themed-accent">Invoice</p>
            <p className="mt-1 break-all font-mono text-sm font-bold themed-text" data-testid="invoice-number">
              {data.number}
            </p>
          </div>
          <p className="text-right text-xs font-bold themed-text-muted">{COMPANY}</p>
        </header>

        <p className="mt-4 text-base font-black themed-text" data-testid="invoice-heading">
          {data.heading}
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {issued ? (
            <div>
              <dt className="text-xs themed-text-muted">Tanggal</dt>
              <dd className="font-semibold themed-text">{issued}</dd>
            </div>
          ) : null}
          {data.buyerName ? (
            <div>
              <dt className="text-xs themed-text-muted">Pemohon</dt>
              <dd className="font-semibold themed-text">{data.buyerName}</dd>
            </div>
          ) : null}
          {expires ? (
            <div>
              <dt className="text-xs themed-text-muted">Berlaku sampai</dt>
              <dd className="font-semibold themed-text">{expires}</dd>
            </div>
          ) : null}
        </dl>

        {data.expired ? (
          <p
            role="alert"
            className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs font-semibold text-amber-300"
          >
            Batas waktu transfer sudah lewat. Buat petunjuk transfer baru sebelum mentransfer.
          </p>
        ) : null}

        <table className="mt-5 w-full text-sm">
          <tbody>
            {data.lines.map((line) => (
              <tr key={line.label} className="align-top">
                <td className="py-1.5 pr-4 themed-text-muted">
                  {line.label}
                  {line.hint ? <span className="block text-[11px]">{line.hint}</span> : null}
                </td>
                <td className="py-1.5 text-right font-semibold tabular-nums themed-text">{formatRupiah(line.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-dashed themed-border">
              <td className="pt-3 text-sm font-black themed-text">Total transfer</td>
              <td className="whitespace-nowrap pt-3 text-right text-2xl font-black tabular-nums themed-accent" data-testid="invoice-total">
                {formatRupiah(data.total)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-xs themed-text-muted">Transfer tepat sesuai total, termasuk kode unik. Jangan dibulatkan.</p>

        <div className="mt-5 rounded-2xl border themed-border p-4" data-testid="invoice-bank">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] themed-text-muted">Rekening tujuan</p>
          <dl className="mt-3 space-y-4">
            <CopyRow label="Bank" value={data.bank.bankName} />
            <CopyRow label="Nomor rekening" value={data.bank.accountNumber} />
            <CopyRow label="Atas nama" value={data.bank.accountHolder} />
            <CopyRow label="Nominal transfer" value={String(data.total)} shown={formatRupiah(data.total)} />
          </dl>
        </div>

        {data.qris ? (
          <div className="mt-5 text-center" data-testid="invoice-qris">
            <img src={data.qris.imageSrc} alt="QRIS resmi PT. TapGo Lion Indonesia" className="mx-auto h-48 w-48 rounded-xl bg-white p-2" />
            <p className="mt-2 text-xs themed-text-muted">{data.qris.caption}</p>
          </div>
        ) : null}

        {data.notes && data.notes.length > 0 ? (
          <ul className="mt-5 space-y-1.5 text-xs leading-6 themed-text-muted">
            {data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}

        <p className="mt-5 border-t border-dashed themed-border pt-3 text-[11px] leading-5 themed-text-muted">
          Invoice ini adalah petunjuk pembayaran, bukan bukti bayar. Pembayaran sah setelah transfer dikonfirmasi tim
          TapGo, biasanya dalam 1×24 jam kerja.
        </p>
      </section>

      {data.children}

      <div className="no-print mt-4 grid gap-3 sm:grid-cols-3" data-testid="invoice-actions">
        <button type="button" onClick={() => window.print()} className={`${secondaryButtonClass}`}>
          Cetak / simpan PDF
        </button>
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={`${secondaryButtonClass}`}>
          Kirim ke WhatsApp
        </a>
        <button type="button" onClick={copyAll} className={`${secondaryButtonClass}`}>
          {copiedAll ? "Tersalin" : "Salin semua"}
        </button>
      </div>
    </div>
  );
}
