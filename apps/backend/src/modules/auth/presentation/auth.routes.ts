import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { authRateLimiter, registerPhoneRateLimiter } from "../../../core/security/rateLimit.js";
import { AuthService } from "../application/AuthService.js";
import { PrismaAuthRepository } from "../infrastructure/PrismaAuthRepository.js";
import { AuthController } from "./auth.controller.js";
import { loginSchema, otpRequestSchema, refreshSchema, registerSchema } from "./auth.validators.js";

const repository = new PrismaAuthRepository(prisma);
const service = new AuthService(repository);
const controller = new AuthController(service);

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
