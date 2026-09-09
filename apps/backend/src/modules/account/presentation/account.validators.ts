import { z } from "zod";
import { emailSchema, passwordSchema, phoneSchema } from "../../auth/presentation/auth.validators.js";

export const accountDeletionRequestSchema = z.object({
  body: z.object({
    reason: z.string().trim().max(1000).optional()
  }).default({})
});

export const updatePhoneSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    currentPassword: passwordSchema
  })
});

export const updateEmailSchema = z.object({
  body: z.object({
    email: emailSchema,
    currentPassword: passwordSchema
  })
});

