import { PpobCategory } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

/**
 * Validasi dan normalisasi nomor tujuan per kategori PPOB.
 *
 * Normalisasi dilakukan di SERVER, bukan klien: "0856...", "+62856...", dan
 * "62856..." adalah nomor yang sama dan harus tersimpan dalam satu bentuk
 * kanonik ("0856...") supaya histori dan dedup tidak terpecah.
 *
 * Aturan sengaja ketat pada Stage foundation ini — melonggarkan di kemudian
 * hari selalu aman, mengetatkan setelah data masuk tidak.
 */

/// MSISDN seluler Indonesia: 08 + 8–11 digit (total 10–13 digit).
const MSISDN_ID = /^08\d{8,11}$/;
/// ID pelanggan / nomor meter PLN: 11–12 digit.
const PLN_CUSTOMER_ID = /^\d{11,12}$/;
/// Nomor kartu BPJS: 13 digit.
const BPJS_CARD_NUMBER = /^\d{13}$/;

const TARGET_RULES: Record<
  PpobCategory,
  { pattern: RegExp; example: string; msisdn: boolean }
> = {
  PULSA: { pattern: MSISDN_ID, example: "08xxxxxxxxxx", msisdn: true },
  DATA: { pattern: MSISDN_ID, example: "08xxxxxxxxxx", msisdn: true },
  EWALLET: { pattern: MSISDN_ID, example: "08xxxxxxxxxx", msisdn: true },
  PLN_PREPAID: { pattern: PLN_CUSTOMER_ID, example: "11–12 digit nomor meter/IDPEL", msisdn: false },
  PLN_POSTPAID: { pattern: PLN_CUSTOMER_ID, example: "11–12 digit IDPEL", msisdn: false },
  BPJS: { pattern: BPJS_CARD_NUMBER, example: "13 digit nomor kartu", msisdn: false }
};

/// Menormalkan prefiks +62/62 menjadi 0 untuk nomor seluler Indonesia.
function normalizeMsisdn(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("62")) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

export function normalizePpobTarget(category: PpobCategory, rawTarget: string): string {
  const trimmed = rawTarget.trim();
  const rule = TARGET_RULES[category];
  // Kategori di luar allowlist (mis. payload yang melewati validasi Zod) harus
  // gagal dengan error operasional, bukan TypeError tak terkendali.
  if (!rule) {
    throw new AppError(
      "Kategori PPOB tidak dikenal",
      StatusCodes.BAD_REQUEST,
      "PPOB_TARGET_INVALID"
    );
  }
  const normalized = rule.msisdn ? normalizeMsisdn(trimmed) : trimmed.replace(/\D/g, "");

  if (!rule.pattern.test(normalized)) {
    throw new AppError(
      `Nomor tujuan tidak valid untuk kategori ${category} (contoh: ${rule.example})`,
      StatusCodes.BAD_REQUEST,
      "PPOB_TARGET_INVALID"
    );
  }
  return normalized;
}

/// Masking untuk log/respons non-pemilik: 0812••••890.
export function maskPpobTarget(target: string): string {
  if (target.length <= 7) {
    return "***";
  }
  return `${target.slice(0, 4)}••••${target.slice(-3)}`;
}
