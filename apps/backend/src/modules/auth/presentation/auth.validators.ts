import { z } from "zod";
import { normalizePhoneNumber } from "../../../core/security/phone.js";

const phoneSchema = z
  .string()
  .min(8)
  .max(32)
  .regex(/^(\+?[1-9]\d{7,31}|0\d{7,31})$/)
  .transform(normalizePhoneNumber);
const passwordSchema = z.string().min(6).max(128);

const wrapBody = (value: unknown) => {
  if (value && typeof value === "object" && "body" in value) {
    return value;
  }
  return { body: value };
};

const registerBodySchema = z
  .object({
    fullName: z.string().min(2).max(120).optional(),
    name: z.string().min(2).max(120).optional(),
    email: z.string().email().max(180).optional(),
	    phone: phoneSchema,
	    password: passwordSchema,
	    referralCode: z.string().min(4).max(24).optional(),
	    deviceId: z.string().min(8).max(200).optional(),
	    deviceFingerprint: z.string().min(8).max(200).optional(),
	    // Registrasi publik TIDAK boleh memilih role. Server selalu menetapkan
	    // USER. z.never() membuat permintaan yang MEMUAT "role" gagal tertutup
	    // dengan 400 (bukan diam-diam diabaikan), sementara perilaku field tak
	    // dikenal lain tidak berubah — klien Release 1 tidak mengirim "role".
	    role: z
	      .never({
	        invalid_type_error:
	          "Role tidak dapat ditentukan oleh klien. Registrasi publik selalu membuat akun USER."
	      })
	      .optional()
	  })
  .superRefine((value, context) => {
    if (!value.fullName && !value.name) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: "Name is required"
      });
    }
  })
  .transform((value) => ({
    ...value,
    fullName: value.fullName ?? value.name ?? ""
  }));

export const registerSchema = z.preprocess(
  wrapBody,
  z.object({
    body: registerBodySchema
  })
);

export const loginSchema = z.preprocess(
  wrapBody,
  z.object({
    body: z.object({
      phone: phoneSchema,
      password: passwordSchema
    })
  })
);

export const otpRequestSchema = z.preprocess(
  wrapBody,
  z.object({
    body: z.object({
      phone: phoneSchema,
      purpose: z.enum(["LOGIN", "REGISTER"])
    })
  })
);

export const refreshSchema = z.preprocess(
  wrapBody,
  z.object({
    body: z.object({
      refreshToken: z.string().min(32)
    })
  })
);
