import { PpobCategory } from "@prisma/client";
import { MobileOperator } from "./operatorDetection.js";

/**
 * Daftar operator LENGKAP untuk produk pulsa multi-operator.
 *
 * Sinkronisasi harga memilih satu harga per nominal dan hanya menjual operator yang modalnya cukup berdekatan
 * (selectPricingBand), lalu menulis ulang `providerSkus` hanya dengan operator yang lolos. Tanpa daftar lengkap, operator
 * yang sekali tersingkir (modalnya sempat jauh dari yang lain) tidak pernah kembali, padahal harga penyedia terus
 * berubah. Daftar ini mengembalikan operator yang tersingkir ke perhitungan di setiap siklus.
 *
 * Kode produk Digiflazz untuk pulsa reguler mengikuti satu konvensi: awalan operator + nominal dalam ribuan (Telkomsel
 * s20, Indosat i20, Tri t20, XL x20, Axis ax20, Smartfren sm20); sama dengan peta awal pada migrasi 20260919170000.
 * Kode turunan yang tidak ada atau tidak aktif di daftar harga penyedia otomatis dilewati oleh sinkronisasi, jadi
 * menebak kode yang keliru tidak pernah menjual produk yang tidak ada.
 */
const CODE_PREFIX: Record<MobileOperator, string> = {
  telkomsel: "s",
  indosat: "i",
  xl: "x",
  axis: "ax",
  tri: "t",
  smartfren: "sm"
};

const OPERATORS = Object.keys(CODE_PREFIX) as MobileOperator[];

/**
 * Peta operator -> kode untuk produk ini, ditambah operator lain yang kodenya dapat diturunkan dari konvensi.
 *
 * Hanya berlaku bila produk adalah pulsa DAN setiap entri yang ada mengikuti konvensi dengan nominal yang sama;
 * peta lain (mis. Data Flash Telkomsel `flash1`) dikembalikan apa adanya, supaya tidak pernah menambah operator
 * yang tidak masuk akal. Entri yang sudah ada selalu dipertahankan (kode yang ada menang atas turunan).
 */
export function expandOperatorPool(category: PpobCategory, current: Record<string, unknown>): Record<string, string> {
  const existing: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    if (typeof value === "string") existing[key] = value;
  }
  if (category !== "PULSA") return existing;

  const keys = Object.keys(existing);
  if (keys.length === 0) return existing;

  let nominal: string | null = null;
  for (const key of keys) {
    const prefix = CODE_PREFIX[key as MobileOperator];
    if (prefix === undefined) return existing;
    const match = /^([a-z]+)(\d+)$/i.exec(existing[key]!);
    if (!match || match[1]!.toLowerCase() !== prefix) return existing;
    if (nominal !== null && nominal !== match[2]) return existing;
    nominal = match[2]!;
  }
  if (nominal === null) return existing;

  const expanded = { ...existing };
  for (const operator of OPERATORS) {
    if (expanded[operator] === undefined) expanded[operator] = `${CODE_PREFIX[operator]}${nominal}`;
  }
  return expanded;
}
