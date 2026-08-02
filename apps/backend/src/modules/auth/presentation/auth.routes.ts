import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import {
  authRateLimiter,
  recoveryAccountRateLimiter,
  recoveryIpRateLimiter,
  recoveryVerifyRateLimiter,
  registerPhoneRateLimiter,
  verificationRateLimiter
} from "../../../core/security/rateLimit.js";
import { AccountRecoveryService } from "../application/AccountRecoveryService.js";
import { AuthService } from "../application/AuthService.js";
import { PrismaAuthRepository } from "../infrastructure/PrismaAuthRepository.js";
import { otpDeliveryProvider } from "../infrastructure/otpProviderRegistry.js";
import { AuthController } from "./auth.controller.js";
import { RecoveryController } from "./recovery.controller.js";
import { loginSchema, otpRequestSchema, refreshSchema, registerSchema } from "./auth.validators.js";
import {
  recoveryRequestSchema,
  recoveryResetSchema,
  recoveryVerifySchema,
  verificationConfirmSchema,
  verificationRequestSchema
} from "./recovery.validators.js";

const repository = new PrismaAuthRepository(prisma);
const service = new AuthService(repository);
const controller = new AuthController(service);

/**
 * Provider pengiriman OTP.
 *
 * Delegate default registry adalah UnavailableOtpProvider, yang SELALU
 * menolak. TapGo belum punya provider SMS/email produksi, sehingga alur
 * pemulihan gagal secara terbuka alih-alih berpura-pura berhasil. Tidak ada
 * pemilihan provider berdasarkan NODE_ENV di jalur kode mana pun.
 */
const recoveryService = new AccountRecoveryService(prisma, otpDeliveryProvider);
const recoveryController = new RecoveryController(recoveryService);

export const authRouter = Router();

authRouter.post("/otp/request", authRateLimiter, validateRequest(otpRequestSchema), asyncHandler(controller.requestOtp));
authRouter.post(
  "/register",
  authRateLimiter,
  validateRequest(registerSchema),
  registerPhoneRateLimiter,
  asyncHandler(controller.register)
);
authRouter.post("/login", authRateLimiter, validateRequest(loginSchema), asyncHandler(controller.login));
authRouter.post("/refresh", authRateLimiter, validateRequest(refreshSchema), asyncHandler(controller.refresh));
authRouter.post("/logout", requireAuth, asyncHandler(controller.logout));
authRouter.get("/me", requireAuth, asyncHandler(controller.me));

// --- Pemulihan password (tanpa autentikasi) ---------------------------------
// Dua rate limiter dipasang berurutan: per akun target dan per IP. Keduanya
// diperlukan — batas per akun saja dapat dilewati dengan berpindah target,
// batas per IP saja dapat dilewati dengan berpindah IP.
authRouter.post(
  "/recovery/request",
  recoveryIpRateLimiter,
  recoveryAccountRateLimiter,
  validateRequest(recoveryRequestSchema),
  asyncHandler(recoveryController.requestRecovery)
);
authRouter.post(
  "/recovery/verify",
  recoveryIpRateLimiter,
  recoveryVerifyRateLimiter,
  validateRequest(recoveryVerifySchema),
  asyncHandler(recoveryController.verifyRecovery)
);
authRouter.post(
  "/recovery/reset",
  recoveryIpRateLimiter,
  validateRequest(recoveryResetSchema),
  asyncHandler(recoveryController.resetPassword)
);

// --- Verifikasi kontak (wajib login) ----------------------------------------
authRouter.get(
  "/verification/status",
  requireAuth,
  asyncHandler(recoveryController.verificationStatus)
);
authRouter.post(
  "/verification/request",
  requireAuth,
  verificationRateLimiter,
  validateRequest(verificationRequestSchema),
  asyncHandler(recoveryController.requestVerification)
);
authRouter.post(
  "/verification/confirm",
  requireAuth,
  verificationRateLimiter,
  validateRequest(verificationConfirmSchema),
  asyncHandler(recoveryController.confirmVerification)
);
