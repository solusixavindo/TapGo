import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { ReferralService } from "../application/ReferralService.js";
import { PrismaReferralRepository } from "../infrastructure/PrismaReferralRepository.js";
import { ReferralController } from "./referral.controller.js";
import {
  claimReferralSchema,
  commissionHistorySchema,
  referralDepthSchema,
  referralDownlineSchema,
  referralTreeSchema,
  referralUplinkSchema
} from "./referral.validators.js";

const repository = new PrismaReferralRepository(prisma);
const service = new ReferralService(repository);
const controller = new ReferralController(service);

export const referralRouter = Router();

referralRouter.use(requireAuth);
referralRouter.get("/summary", asyncHandler(controller.summary));
referralRouter.get("/tree", validateRequest(referralTreeSchema), asyncHandler(controller.tree));
referralRouter.get("/uplink", validateRequest(referralUplinkSchema), asyncHandler(controller.uplink));
referralRouter.get("/downlines", validateRequest(referralDownlineSchema), asyncHandler(controller.downlines));
referralRouter.get("/depth", validateRequest(referralDepthSchema), asyncHandler(controller.depth));
referralRouter.get("/commissions", validateRequest(commissionHistorySchema), asyncHandler(controller.commissions));
referralRouter.post("/claim", validateRequest(claimReferralSchema), asyncHandler(controller.claimReferral));
