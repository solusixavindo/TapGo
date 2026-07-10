import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { MembershipOrderService } from "../../memberships/application/MembershipOrderService.js";
import { DokuPaymentService } from "../application/DokuPaymentService.js";
import { DokuController } from "./doku.controller.js";
import {
  dokuCreatePaymentSchema,
  dokuNotificationSchema,
  dokuStatusSchema,
} from "./doku.validators.js";

const membershipOrderService = new MembershipOrderService(prisma);
const dokuPaymentService = new DokuPaymentService(prisma, membershipOrderService);
const controller = new DokuController(dokuPaymentService);

export const dokuPaymentRouter = Router();
export const dokuWebhookRouter = Router();

dokuPaymentRouter.post(
  "/doku/create",
  requireAuth,
  validateRequest(dokuCreatePaymentSchema),
  asyncHandler(controller.create),
);

dokuPaymentRouter.get(
  "/doku/status/:referenceId",
  requireAuth,
  requireRoles("ADMIN", "SUPER_ADMIN"),
  validateRequest(dokuStatusSchema),
  asyncHandler(controller.status),
);

dokuPaymentRouter.post(
  "/doku/notification",
  validateRequest(dokuNotificationSchema),
  asyncHandler(controller.notification),
);

dokuWebhookRouter.post(
  "/doku",
  validateRequest(dokuNotificationSchema),
  asyncHandler(controller.notification),
);
