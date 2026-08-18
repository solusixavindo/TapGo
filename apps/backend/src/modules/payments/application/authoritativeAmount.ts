import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

/**
 * Verifikasi nominal callback terhadap nominal order yang otoritatif.
 *
 * KENAPA BERKAS INI ADA
 *
 * Kontrol ini dulu hidup sebagai method privat di MidtransPaymentService, dan
 * jalur DOKU tidak memiliki padanannya sama sekali — tidak ada satu pun
 * pembandingan terhadap invoice.amount sebelum membership diaktifkan beserta
 * bonus sponsor, bonus level, dan saldo PPOB-nya. Asimetri semacam itu adalah
 * pola yang berulang: satu gateway diperketat setelah temuan, gateway kedua
 * ditambahkan belakangan dan mewarisi bentuk lamanya.
 *
 * Menjadikannya satu fungsi bersama membuat penambahan gateway ketiga tidak lagi
 * dapat melewatkan kontrol ini tanpa terlihat.
 *
 * ATURANNYA
 *
 * - Nominal HANYA berasal dari backend (invoice.amount). Nilai dari callback
 *   diperlakukan sebagai klaim yang harus dibuktikan, bukan sebagai sumber
 *   kebenaran.
 * - Format string divalidasi ketat SEBELUM diparse. Parser Decimal bersifat
 *   permisif, sehingga "5e5", "0x7A120", "500_000", "500000,00", " 500000 ",
 *   "NaN", dan "Infinity" dapat lolos bila hanya diandalkan parsernya.
 * - Nominal wajib positif dan SAMA PERSIS. Kurang bayar maupun lebih bayar sama
 *   ditolaknya: keduanya berarti pembukuan tidak lagi mencerminkan uang yang
 *   sungguh diterima.
 * - Nominal yang tidak ada juga ditolak. Fail-closed: lebih baik aktivasi
 *   tertunda dan terlihat di log daripada benefit diberikan atas klaim yang tidak
 *   dapat diperiksa.
 */

/**
 * Kontrak nominal gateway: string desimal biasa (mis. "500000.00"). Hanya digit
 * dengan opsional 1-2 desimal yang diterima.
 */
const STRICT_DECIMAL_AMOUNT = /^\d+(\.\d{1,2})?$/;

export type PaymentGatewayCodePrefix = "MIDTRANS" | "DOKU";

/**
 * Menormalkan nilai nominal menjadi string yang siap divalidasi.
 *
 * Angka diterima karena DOKU dapat mengirim `order.amount` sebagai number,
 * sementara Midtrans selalu mengirim string. `String(value)` sengaja dipakai apa
 * adanya: bentuk eksponen seperti 5e21 akan menjadi "5e+21" dan gugur pada regex
 * ketat di atas — persis yang diinginkan, bukan diam-diam dibulatkan.
 */
function asAmountString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function assertAuthoritativeAmount(input: {
  /** Nama gateway untuk pesan galat yang dapat dibaca manusia. */
  gateway: string;
  /** Prefiks kode galat stabil yang sudah dipakai klien. */
  codePrefix: PaymentGatewayCodePrefix;
  /** Nominal otoritatif dari backend. */
  authoritativeAmount: Prisma.Decimal | string | number;
  /** Nominal sebagaimana diklaim callback. */
  providedAmount: unknown;
  /** Mata uang bila callback menyertakannya. */
  providedCurrency?: unknown;
}): void {
  const { gateway, codePrefix } = input;

  // Mata uang, bila disediakan callback, wajib literal IDR.
  if (
    input.providedCurrency !== undefined &&
    input.providedCurrency !== null &&
    input.providedCurrency !== "IDR"
  ) {
    throw new AppError(
      `${gateway} currency must be IDR`,
      StatusCodes.BAD_REQUEST,
      `${codePrefix}_CURRENCY_INVALID`,
    );
  }

  const raw = asAmountString(input.providedAmount);
  if (raw === null || !STRICT_DECIMAL_AMOUNT.test(raw)) {
    throw new AppError(
      `${gateway} amount is missing or malformed`,
      StatusCodes.BAD_REQUEST,
      `${codePrefix}_AMOUNT_INVALID`,
    );
  }

  const provided = new Prisma.Decimal(raw);

  if (!provided.isFinite() || provided.lte(0)) {
    throw new AppError(
      `${gateway} amount must be a positive value`,
      StatusCodes.BAD_REQUEST,
      `${codePrefix}_AMOUNT_INVALID`,
    );
  }

  if (!provided.equals(new Prisma.Decimal(input.authoritativeAmount))) {
    throw new AppError(
      `${gateway} amount does not match the authoritative order amount`,
      StatusCodes.BAD_REQUEST,
      `${codePrefix}_AMOUNT_MISMATCH`,
    );
  }
}
