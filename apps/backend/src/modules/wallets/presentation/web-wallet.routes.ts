import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireChannel } from "../../../core/security/authContext.js";
import { paymentRateLimiter } from "../../../core/security/rateLimit.js";
import { WalletService } from "../application/WalletService.js";
import { WalletTopUpPaymentService } from "../application/WalletTopUpPaymentService.js";
import { PrismaWalletRepository } from "../infrastructure/PrismaWalletRepository.js";
import { WebWalletController } from "./web-wallet.controller.js";
import { topUpCreateSchema, topUpOrderParamSchema } from "./wallet.validators.js";

/**
 * Kanal web untuk top up TapGoPay (Stage R2.10).
 *
 * Pola identik dengan web-membership.routes.ts: top up terjadi di web, bukan
 * di dalam aplikasi mobile Play — pembayaran eksternal in-app menuntut Play
 * Billing (lihat WALLET_TOPUP_ENABLED di config/env.ts). requireChannel("WEB")
 * menutupnya di batas keamanan, bukan hanya di UI.
 */
const repository = new PrismaWalletRepository(prisma);
const service = new WalletService(repository);
const topUpPaymentService = new WalletTopUpPaymentService(prisma, repository);
const controller = new WebWalletController(service, topUpPaymentService);

export const webWalletRouter = Router();

webWalletRouter.use(requireAuth, requireChannel("WEB"));
webWalletRouter.post(
  "/topup/orders",
  paymentRateLimiter,
  validateRequest(topUpCreateSchema),
  asyncHandler(controller.createOrder)
);
webWalletRouter.get(
  "/topup/orders/:orderId",
  validateRequest(topUpOrderParamSchema),
  asyncHandler(controller.order)
);
webWalletRouter.post(
  "/topup/orders/:orderId/pay",
  paymentRateLimiter,
  validateRequest(topUpOrderParamSchema),
  asyncHandler(controller.pay)
);
