import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { prisma } from "../../../config/prisma.js";
import { AppError } from "../../../core/errors/AppError.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { verifyPassword } from "../../../core/security/passwordHasher.js";
import { AccountDeletionService } from "../application/AccountDeletionService.js";

/**
 * Pemrosesan permintaan hapus akun, KHUSUS SUPER_ADMIN_VIP: tindakannya tidak dapat dibatalkan dan menyentuh data
 * pribadi. Menyelesaikan penghapusan menuntut kalimat konfirmasi yang diketik DAN password akun yang sedang masuk.
 * Daftar permintaan (GET /) tetap dilayani router konsol.
 */
export const CONFIRM_DELETE_ACCOUNT = "HAPUS AKUN";

const service = new AccountDeletionService(prisma);

const idParams = z.object({ id: z.string().uuid() });

const previewSchema = z.object({ params: idParams });
const rejectSchema = z.object({
  params: idParams,
  body: z.object({ reason: z.string().trim().min(3).max(300) })
});
const completeSchema = z.object({
  params: idParams,
  body: z.object({
    confirm: z.string().trim().min(1).max(40),
    password: z.string().min(1).max(200)
  })
});

export const accountDeletionAdminRouter = Router();

accountDeletionAdminRouter.use(requireAuth);

accountDeletionAdminRouter.get(
  "/:id/preview",
  requireRoles("SUPER_ADMIN_VIP"),
  validateRequest(previewSchema),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.preview(String(req.params.id)) });
  })
);

accountDeletionAdminRouter.post(
  "/:id/reject",
  requireRoles("SUPER_ADMIN_VIP"),
  validateRequest(rejectSchema),
  asyncHandler(async (req, res) => {
    const data = await service.reject({
      requestId: String(req.params.id),
      actorId: req.auth!.userId,
      reason: req.body.reason
    });
    res.json({ success: true, data });
  })
);

accountDeletionAdminRouter.post(
  "/:id/complete",
  requireRoles("SUPER_ADMIN_VIP"),
  validateRequest(completeSchema),
  asyncHandler(async (req, res) => {
    const { confirm, password } = req.body as z.infer<typeof completeSchema>["body"];
    if (confirm.toUpperCase() !== CONFIRM_DELETE_ACCOUNT) {
      throw new AppError(
        `Ketik ${CONFIRM_DELETE_ACCOUNT} untuk melanjutkan.`,
        StatusCodes.BAD_REQUEST,
        "ACCOUNT_DELETION_CONFIRM_MISMATCH"
      );
    }
    const actor = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { passwordHash: true }
    });
    const passwordOk = actor?.passwordHash ? await verifyPassword(actor.passwordHash, password) : false;
    if (!passwordOk) {
      throw new AppError("Password tidak sesuai.", StatusCodes.FORBIDDEN, "ACCOUNT_DELETION_PASSWORD_INVALID");
    }
    const data = await service.complete({ requestId: String(req.params.id), actorId: req.auth!.userId });
    res.json({ success: true, data });
  })
);
