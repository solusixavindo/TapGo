import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { paymentRateLimiter } from "../../../core/security/rateLimit.js";
import { PpobCatalogService } from "../application/PpobCatalogService.js";
import { PpobOrderService } from "../application/PpobOrderService.js";
import { NoPpobProviderGateway } from "../infrastructure/NoPpobProviderGateway.js";
import { PrismaPpobRepository } from "../infrastructure/PrismaPpobRepository.js";
import { PpobController } from "./ppob.controller.js";
import {
  ppobCreateOrderSchema,
  ppobInquirySchema,
  ppobOrderDetailSchema,
  ppobOrderListSchema
} from "./ppob.validators.js";

// Stage R2.7: provider gateway fail-closed. Stage R2.8 menukar
// NoPpobProviderGateway dengan gateway biller nyata di titik ini saja.
const repository = new PrismaPpobRepository(prisma);
const providerGateway = new NoPpobProviderGateway();
const catalogService = new PpobCatalogService(repository);
const orderService = new PpobOrderService(repository, providerGateway);
const controller = new PpobController(catalogService, orderService);

export const ppobRouter = Router();

ppobRouter.use(requireAuth);
ppobRouter.get("/catalog", asyncHandler(controller.catalog));
ppobRouter.get("/orders", validateRequest(ppobOrderListSchema), asyncHandler(controller.orders));
ppobRouter.get("/orders/:orderId", validateRequest(ppobOrderDetailSchema), asyncHandler(controller.order));
ppobRouter.post("/orders/inquiry", paymentRateLimiter, validateRequest(ppobInquirySchema), asyncHandler(controller.inquiry));
ppobRouter.post("/orders", paymentRateLimiter, validateRequest(ppobCreateOrderSchema), asyncHandler(controller.createOrder));
