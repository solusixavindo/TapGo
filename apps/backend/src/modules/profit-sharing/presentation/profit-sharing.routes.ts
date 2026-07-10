import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { ProfitSharingService } from "../application/ProfitSharingService.js";
import { ProfitSharingController } from "./profit-sharing.controller.js";
import {
  createProfitSharingPeriodSchema,
  profitSharingPeriodParamsSchema
} from "./profit-sharing.validators.js";

const service = new ProfitSharingService(prisma);
const controller = new ProfitSharingController(service);

export const profitSharingRouter = Router();

profitSharingRouter.use(requireAuth, requireRoles("ADMIN", "SUPER_ADMIN"));
profitSharingRouter.post("/periods", validateRequest(createProfitSharingPeriodSchema), asyncHandler(controller.createPeriod));
profitSharingRouter.get("/periods", asyncHandler(controller.periods));
profitSharingRouter.get("/periods/:id", validateRequest(profitSharingPeriodParamsSchema), asyncHandler(controller.period));
profitSharingRouter.post(
  "/periods/:id/approve",
  requireRoles("SUPER_ADMIN"),
  validateRequest(profitSharingPeriodParamsSchema),
  asyncHandler(controller.approve)
);
profitSharingRouter.post(
  "/periods/:id/distribute",
  requireRoles("SUPER_ADMIN"),
  validateRequest(profitSharingPeriodParamsSchema),
  asyncHandler(controller.distribute)
);
