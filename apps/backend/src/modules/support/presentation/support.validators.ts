import { SupportTicketCategory, SupportTicketStatus } from "@prisma/client";
import { z } from "zod";

const safeText = (field: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${field} wajib diisi.`)
    .max(max, `${field} terlalu panjang.`)
    .refine((value) => !/[<>]/.test(value), `${field} tidak boleh berisi HTML.`)
    .refine(
      (value) => !/script/i.test(value),
      `${field} tidak boleh berisi script.`,
    );

export const createSupportTicketSchema = z.object({
  body: z.object({
    category: z.nativeEnum(SupportTicketCategory).default("OTHER"),
    subject: safeText("Judul", 140),
    message: safeText("Pesan", 2000),
  }),
});

export const supportTicketIdSchema = z.object({
  params: z.object({
    id: z.string().uuid("ID tiket tidak valid."),
  }),
});

export const adminSupportListSchema = z.object({
  query: z.object({
    status: z.nativeEnum(SupportTicketStatus).optional(),
  }),
});

export const adminSupportUpdateSchema = z.object({
  params: z.object({
    id: z.string().uuid("ID tiket tidak valid."),
  }),
  body: z.object({
    status: z.nativeEnum(SupportTicketStatus).optional(),
    message: safeText("Respons", 2000).optional(),
  }).refine(
    (value) => value.status !== undefined || value.message !== undefined,
    "Status atau respons wajib diisi.",
  ),
});
