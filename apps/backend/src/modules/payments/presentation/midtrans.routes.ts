import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { MembershipOrderService } from "../../memberships/application/MembershipOrderService.js";
import { MidtransPaymentService } from "../application/MidtransPaymentService.js";
import { MidtransController } from "./midtrans.controller.js";
import { midtransNotificationSchema } from "./midtrans.validators.js";

const membershipOrderService = new MembershipOrderService(prisma);
const midtransPaymentService = new MidtransPaymentService(prisma, membershipOrderService);
const controller = new MidtransController(midtransPaymentService);

export const midtransRouter = Router();

midtransRouter.post(
  "/midtrans/notification",
  validateRequest(midtransNotificationSchema),
  asyncHandler(controller.notification)
);
