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

/**
 * Biaya layanan pembayaran top up transfer bank (virtual account), dalam rupiah bulat: Rp4.000 + PPN 11% = Rp4.440.
 * Tarif tetap, tidak bergantung nominal. Dipertahankan untuk pemanggil lama; top up online kini memakai
 * [customerTopUpFee] menurut metode dan tujuan.
 */
export function topUpOnlineFee(): number {
  return midtransFeeFor("bank_transfer", 0).fee.ceil().toNumber();
}

/**
 * Metode bayar top up yang dapat dipilih pelanggan. Pelanggan memilih metode SEBELUM pesanan dibuat, supaya biaya
 * dapat dihitung dan ditampilkan di muka (biaya tiap metode berbeda: VA tetap Rp4.440, e-wallet dan QRIS berupa persen).
 * `snapCodes` = nilai `enabled_payments` Snap untuk metode itu; sebuah metode hanya ditawarkan bila setidaknya satu
 * kodenya ada di MIDTRANS_ENABLED_PAYMENTS (yaitu sudah aktif di akun Midtrans dan dinyalakan di server).
 */
export type TopUpMethod = "bank_transfer" | "gopay" | "qris" | "dana";

export const TOPUP_METHODS: Record<
  TopUpMethod,
  { label: string; description: string; paymentType: string; snapCodes: readonly string[] }
> = {
  bank_transfer: {
    label: "Transfer bank (virtual account)",
    description: "BNI, BRI, CIMB Niaga, Permata, atau Mandiri",
    paymentType: "bank_transfer",
    snapCodes: ["bni_va", "bri_va", "cimb_va", "permata_va", "echannel", "bca_va", "other_va"]
  },
  gopay: { label: "GoPay", description: "Bayar dari aplikasi GoPay", paymentType: "gopay", snapCodes: ["gopay"] },
  qris: { label: "QRIS", description: "Pindai dari aplikasi bank atau e-wallet apa pun", paymentType: "qris", snapCodes: ["other_qris"] },
  dana: { label: "DANA", description: "Bayar dari aplikasi DANA", paymentType: "dana", snapCodes: ["dana"] }
};

export const TOPUP_METHOD_ORDER: readonly TopUpMethod[] = ["bank_transfer", "gopay", "qris", "dana"];

/** Membaca daftar metode dari konfigurasi (dipisah koma). Nama yang tidak dikenal = galat, bukan diabaikan diam-diam. */
export function parseTopUpMethodList(raw: string): TopUpMethod[] {
  const items = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  const unknown = items.filter((item) => !isTopUpMethod(item));
  if (unknown.length > 0) {
    throw new Error(`WALLET_TOPUP_METHODS memuat metode yang tidak dikenal: ${unknown.join(", ")}`);
  }
  return TOPUP_METHOD_ORDER.filter((method) => items.includes(method));
}

export function isTopUpMethod(value: unknown): value is TopUpMethod {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TOPUP_METHODS, value);
}

/**
 * Metode yang tersedia menurut daftar `enabled_payments` yang berlaku. `undefined` (= "all") berarti semua metode yang
 * aktif di akun Midtrans boleh dipakai, jadi seluruh metode di atas ditawarkan.
 */
export function availableTopUpMethods(enabledPayments: readonly string[] | undefined): TopUpMethod[] {
  return TOPUP_METHOD_ORDER.filter((method) =>
    enabledPayments === undefined ? true : TOPUP_METHODS[method].snapCodes.some((code) => enabledPayments.includes(code))
  );
}

/** Kode Snap yang dikirim untuk metode ini: irisan dengan daftar yang berlaku (atau semua kode metode bila "all"). */
export function snapCodesFor(method: TopUpMethod, enabledPayments: readonly string[] | undefined): string[] {
  const codes = TOPUP_METHODS[method].snapCodes;
  return enabledPayments === undefined ? [...codes] : codes.filter((code) => enabledPayments.includes(code));
}

/** Biaya Midtrans yang sebenarnya untuk metode ini pada total tagihan `gross` (bisa berpecahan). */
export function gatewayFeeFor(method: TopUpMethod, gross: Prisma.Decimal.Value): Prisma.Decimal {
  return midtransFeeFor(TOPUP_METHODS[method].paymentType, gross).fee;
}

/**
 * Biaya layanan PENUH yang menutup seluruh biaya Midtrans: bilangan bulat terkecil f sehingga biaya Midtrans atas
 * (nominal + f) tidak melebihi f. Untuk tarif tetap sama dengan tarifnya; untuk tarif persen biaya ikut dihitung atas
 * dirinya sendiri (gross-up), sehingga hasil bersih yang diterima TapGo tepat sebesar nominal.
 */
export function fullTopUpFee(method: TopUpMethod, amount: number): number {
  let fee = gatewayFeeFor(method, amount).ceil().toNumber();
  for (let i = 0; i < 8; i += 1) {
    const next = gatewayFeeFor(method, amount + fee).ceil().toNumber();
    if (next <= fee) break;
    fee = next;
  }
  return fee;
}

export type TopUpFeeTarget = "WALLET" | "PPOB";

/**
 * Biaya yang DITAGIHKAN ke pelanggan, dalam rupiah bulat.
 *
 * - Saldo PPOB: pelanggan menanggung biaya penuh (untung PPOB hanya Rp500-1.000 per transaksi, tidak cukup menanggung
 *   biaya gateway).
 * - Saldo TapGo (komisi driver): pelanggan menanggung biaya penuh sampai batas `walletCap` (Rp2.500 bawaan); selisihnya
 *   ditanggung perusahaan karena top up ini menjadi komisi pesanan. Tidak pernah ditagih lebih dari biaya sebenarnya.
 */
export function customerTopUpFee(input: { target: TopUpFeeTarget; method: TopUpMethod; amount: number; walletCap: number }): number {
  const full = fullTopUpFee(input.method, input.amount);
  return input.target === "WALLET" ? Math.min(full, input.walletCap) : full;
}

/** Bagian biaya Midtrans yang ditanggung perusahaan (>= 0) untuk total tagihan `gross` dengan biaya pelanggan `customerFee`. */
export function companyBorneGatewayFee(paymentType: string | null | undefined, gross: Prisma.Decimal.Value, customerFee: Prisma.Decimal.Value) {
  const { known, fee } = midtransFeeFor(paymentType, gross);
  if (!known) return { known: false as const, fee: new Prisma.Decimal(0) };
  const borne = fee.minus(customerFee);
  return { known: true as const, fee: borne.isNegative() ? new Prisma.Decimal(0) : borne.toDecimalPlaces(2) };
}

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
