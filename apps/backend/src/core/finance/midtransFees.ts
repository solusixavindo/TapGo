import { Prisma } from "@prisma/client";

/**
 * Tarif Midtrans per transaksi berhasil (MDR), sesuai halaman resmi
 * https://midtrans.com/pricing (dicek 19 Sep 2026):
 *   VA semua bank Rp4.000 · GoPay 2% · QRIS 0,7% · ShopeePay 2% · DANA 1,5% ·
 *   OVO 1,5% · Kartu 2,9% + Rp2.000 · Alfamart Rp5.000 · Akulaku 1,7% · Kredivo 2%.
 * Semua tarif belum termasuk PPN, KECUALI QRIS, GoPay, dan ShopeePay.
 *
 * TapGo hanya mengaktifkan kartu, GoPay, dan QRIS di Snap; sisanya disediakan
 * agar laporan tetap benar bila metode ditambah. Tarif kontrak sebenarnya bisa
 * berbeda dari tarif publik — ganti tabel ini bila Midtrans memberi penawaran lain.
 */

export const PPN_RATE = new Prisma.Decimal("0.11");

interface FeeRule {
  percent?: number;
  flat?: number;
  /** true bila tarif belum termasuk PPN (PPN 11% ditambahkan di atas tarif). */
  vatOnFee: boolean;
}

const RULES: Record<string, FeeRule> = {
  credit_card: { percent: 2.9, flat: 2000, vatOnFee: true },
  gopay: { percent: 2, vatOnFee: false },
  qris: { percent: 0.7, vatOnFee: false },
  shopeepay: { percent: 2, vatOnFee: false },
  dana: { percent: 1.5, vatOnFee: true },
  ovo: { percent: 1.5, vatOnFee: true },
  bank_transfer: { flat: 4000, vatOnFee: true },
  echannel: { flat: 4000, vatOnFee: true },
  permata: { flat: 4000, vatOnFee: true },
  cstore: { flat: 5000, vatOnFee: true },
  akulaku: { percent: 1.7, vatOnFee: true },
  kredivo: { percent: 2, vatOnFee: true }
};

export function midtransFeeFor(paymentType: string | null | undefined, gross: Prisma.Decimal.Value) {
  const rule = paymentType ? RULES[paymentType.toLowerCase()] : undefined;
  if (!rule) {
    return { known: false as const, fee: new Prisma.Decimal(0) };
  }
  let fee = new Prisma.Decimal(rule.flat ?? 0).plus(
    new Prisma.Decimal(gross).mul(rule.percent ?? 0).div(100)
  );
  if (rule.vatOnFee) {
    fee = fee.mul(PPN_RATE.plus(1));
  }
  return { known: true as const, fee: fee.toDecimalPlaces(2) };
}
