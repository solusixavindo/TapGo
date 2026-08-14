import { Router } from "express";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { MemberIdentityService } from "../application/MemberIdentityService.js";

export const memberIdentityRouter = Router();

const memberIdentityService = new MemberIdentityService();

memberIdentityRouter.use(requireAuth);

memberIdentityRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const data = await memberIdentityService.getOrCreateForUser(req.auth!.userId);
    res.json({ success: true, data });
  }),
);
