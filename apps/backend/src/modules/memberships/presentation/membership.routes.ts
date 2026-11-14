import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { MembershipService } from "../application/MembershipService.js";
import { PrismaMembershipRepository } from "../infrastructure/PrismaMembershipRepository.js";
import { MembershipController } from "./membership.controller.js";
import { upgradeMembershipSchema } from "./membership.validators.js";

const repository = new PrismaMembershipRepository(prisma);
const service = new MembershipService(repository);
const controller = new MembershipController(service);

export const membershipRouter = Router();

membershipRouter.use(requireAuth);
membershipRouter.get("/plans", asyncHandler(controller.plans));
membershipRouter.get("/me", asyncHandler(controller.me));
membershipRouter.post("/upgrade", validateRequest(upgradeMembershipSchema), asyncHandler(controller.upgrade));
