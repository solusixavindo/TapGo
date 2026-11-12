import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { prisma } from "../../../config/prisma.js";
import { AppError } from "../../../core/errors/AppError.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { verifyPassword } from "../../../core/security/passwordHasher.js";
import { otpDeliveryProvider } from "../../auth/infrastructure/otpProviderRegistry.js";
import { ASSISTED_RECOVERY_REASONS, AccountRecoveryService } from "../../auth/application/AccountRecoveryService.js";
import { AccountAssistService } from "../application/AccountAssistService.js";

/**
 * Bantuan akun, KHUSUS SUPER_ADMIN_VIP. Menerbitkan kode pemulihan menuntut: (1) role VIP, (2) pernyataan bahwa
 * identitas pemilik sudah dipastikan beserta catatan buktinya, (3) password VIP sendiri. Setiap penerbitan tercatat di audit_logs (tanpa kode).
 */
const assist = new AccountAssistService(prisma);
const recovery = new AccountRecoveryService(prisma, otpDeliveryProvider);

const lookupSchema = z.object({
  query: z.object({ phone: z.string().trim().min(6).max(32) })
});

const codeSchema = z.object({
  params: z.object({ userId: z.string().uuid() }),
  body: z.object({
    reasonCode: z.enum(ASSISTED_RECOVERY_REASONS),
    identityChecked: z.literal(true),
    /** Bukti pemeriksaan identitas (mis. ringkasan percakapan WhatsApp). Wajib, disimpan di audit. */
    evidenceNote: z.string().trim().min(10).max(500),
    password: z.string().min(1).max(200)
  })
});

export const accountAssistRouter = Router();

accountAssistRouter.use(requireAuth, requireRoles("SUPER_ADMIN_VIP"));

accountAssistRouter.get(
  "/",
  validateRequest(lookupSchema),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await assist.lookupByPhone(String(req.query.phone)) });
  })
);

accountAssistRouter.post(
  "/:userId/recovery-code",
  validateRequest(codeSchema),
  asyncHandler(async (req, res) => {
    const { reasonCode, evidenceNote, password } = req.body as z.infer<typeof codeSchema>["body"];
    const actor = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { passwordHash: true } });
    const passwordOk = actor?.passwordHash ? await verifyPassword(actor.passwordHash, password) : false;
    if (!passwordOk) {
      throw new AppError("Password tidak sesuai.", StatusCodes.FORBIDDEN, "ACCOUNT_ASSIST_PASSWORD_INVALID");
    }
    const data = await recovery.issueAssistedCode({
      targetUserId: String(req.params.userId),
      actorId: req.auth!.userId,
      reasonCode,
      evidenceNote
    });
    // Kode hanya muncul di respons ini. Jangan di-cache.
    res.setHeader("cache-control", "no-store");
    res.status(StatusCodes.CREATED).json({ success: true, data });
  })
);
