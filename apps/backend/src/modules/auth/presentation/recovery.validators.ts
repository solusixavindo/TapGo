import { z } from "zod";
import { normalizePhoneNumber } from "../../../core/security/phone.js";

const wrapBody = (value: unknown) => {
  if (value && typeof value === "object" && "body" in value) {
    return value;
  }
  return { body: value };
};

/**
 * Identifier pemulihan: nomor telepon ATAU email.
 *
 * Nomor dinormalisasi dengan aturan Indonesia yang sama seperti login dan
 * register, sehingga +62/62/0 menunjuk akun yang sama. Email di-lowercase.
 * Bentuk yang tidak dikenali TIDAK ditolak dengan error khusus — validator
 * hanya membatasi panjang, karena error validasi yang berbeda pun dapat
 * dipakai untuk enumerasi.
 */
const identifierSchema = z
  .string()
  .trim()
  .min(3)
  .max(180)
  .transform((value) => (value.includes("@") ? value.toLowerCase() : normalizePhoneNumber(value)));

const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, "Kode harus 6 digit angka");

const newPasswordSchema = z.string().min(1).max(200);

export const recoveryRequestSchema = z.preprocess(
  wrapBody,
  z.object({
    body: z.object({
      identifier: identifierSchema
    })
  })
);

export const recoveryVerifySchema = z.preprocess(
  wrapBody,
  z.object({
    body: z.object({
      identifier: identifierSchema,
      code: otpCodeSchema
    })
  })
);

export const recoveryResetSchema = z.preprocess(
  wrapBody,
  z.object({
    body: z.object({
      resetToken: z.string().trim().length(64),
      // Kebijakan panjang/komposisi ditegakkan service agar seluruh kegagalan
      // memakai satu kode stabil AUTH_PASSWORD_POLICY_FAILED, bukan bentuk
      // error validasi yang berbeda-beda.
      newPassword: newPasswordSchema
    })
  })
);
