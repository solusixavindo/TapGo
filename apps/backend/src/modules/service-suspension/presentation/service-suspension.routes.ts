import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { prisma } from "../../../config/prisma.js";
import { AppError } from "../../../core/errors/AppError.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { verifyPassword } from "../../../core/security/passwordHasher.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { ServiceSuspensionService } from "../application/ServiceSuspensionService.js";

/**
 * Pengendali penghentian layanan, KHUSUS SUPER_ADMIN_VIP (role puncak pemilik
 * sistem, hanya dapat dibuat lewat CLI bootstrap). Mengubah status menuntut:
 * (1) role VIP, (2) kalimat konfirmasi yang diketik, (3) password akun yang
 * sedang masuk. Setiap perubahan tercatat di audit_logs.
 */
export const CONFIRM_SUSPEND = "HENTIKAN";
export const CONFIRM_RESUME = "PULIHKAN";

/** Satu instans bersama: gerbang di app.ts membaca dari cache yang sama. */
export const serviceSuspensionService = new ServiceSuspensionService(prisma);

const setSchema = z.object({
  body: z.object({
    suspended: z.boolean(),
    message: z.string().trim().max(300).optional(),
    confirm: z.string().trim().min(1).max(40),
    password: z.string().min(1).max(200)
  })
});

export const serviceSuspensionRouter = Router();

serviceSuspensionRouter.use(requireAuth, requireRoles("SUPER_ADMIN_VIP"));

serviceSuspensionRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const status = await serviceSuspensionService.status();
    const changedBy = status.changedById
      ? await prisma.user.findUnique({ where: { id: status.changedById }, select: { fullName: true } })
      : null;
    res.json({ success: true, data: { ...status, changedByName: changedBy?.fullName ?? null } });
  })
);

serviceSuspensionRouter.put(
  "/",
  validateRequest(setSchema),
  asyncHandler(async (req, res) => {
    const { suspended, message, confirm, password } = req.body as z.infer<typeof setSchema>["body"];
    const expected = suspended ? CONFIRM_SUSPEND : CONFIRM_RESUME;
    if (confirm.toUpperCase() !== expected) {
      throw new AppError(
        `Ketik ${expected} untuk melanjutkan.`,
        StatusCodes.BAD_REQUEST,
        "SERVICE_SUSPENSION_CONFIRM_MISMATCH"
      );
    }

    const actor = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { passwordHash: true, role: true }
    });
    const passwordOk = actor?.passwordHash ? await verifyPassword(actor.passwordHash, password) : false;
    if (!actor || !passwordOk) {
      throw new AppError("Password tidak sesuai.", StatusCodes.FORBIDDEN, "SERVICE_SUSPENSION_PASSWORD_INVALID");
    }

    const status = await serviceSuspensionService.set({
      actorId: req.auth!.userId,
      actorRole: actor.role,
      suspended,
      message
    });
    res.json({ success: true, data: status });
  })
);
