import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { MembershipOrderService } from "../application/MembershipOrderService.js";
import { MidtransPaymentService } from "../../payments/application/MidtransPaymentService.js";
import { DokuPaymentService } from "../../payments/application/DokuPaymentService.js";
import { MembershipOrderController } from "./membership-order.controller.js";
import {
  createMembershipOrderSchema,
  membershipOrderDetailSchema,
  membershipPaymentSuccessSchema,
  payMembershipOrderSchema
} from "./membership.validators.js";

const service = new MembershipOrderService(prisma);
const controller = new MembershipOrderController(
  service,
  () => new MidtransPaymentService(prisma, service),
  () => new DokuPaymentService(prisma, service),
);

export const membershipOrderRouter = Router();

membershipOrderRouter.get("/packages", asyncHandler(controller.packages));

membershipOrderRouter.use(requireAuth);
membershipOrderRouter.get("/me", asyncHandler(controller.me));
membershipOrderRouter.get("/orders/me", asyncHandler(controller.myOrders));
membershipOrderRouter.post("/orders", validateRequest(createMembershipOrderSchema), asyncHandler(controller.createOrder));
membershipOrderRouter.post(
  "/orders/:id/pay",
  validateRequest(payMembershipOrderSchema),
  asyncHandler(controller.pay)
);
membershipOrderRouter.post(
  "/orders/:id/payment-success",
  validateRequest(membershipPaymentSuccessSchema),
  asyncHandler(controller.paymentSuccess)
);
membershipOrderRouter.get("/orders/:id", validateRequest(membershipOrderDetailSchema), asyncHandler(controller.order));
