import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { accountDeletionRequestSchema } from "./account.validators.js";

export const accountRouter = Router();

accountRouter.use(requireAuth);

accountRouter.get("/delete-request", asyncHandler(async (req, res) => {
  const request = await prisma.accountDeletionRequest.findFirst({
    where: { userId: req.auth!.userId },
    orderBy: { createdAt: "desc" }
  });

  res.json({ success: true, data: request });
}));

accountRouter.post(
  "/delete-request",
  validateRequest(accountDeletionRequestSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.accountDeletionRequest.findFirst({
      where: {
        userId: req.auth!.userId,
        status: "PENDING"
      }
    });

    if (existing) {
      res.status(200).json({ success: true, data: existing });
      return;
    }

    const request = await prisma.accountDeletionRequest.create({
      data: {
        userId: req.auth!.userId,
        ...(typeof req.body.reason === "string" ? { reason: req.body.reason } : {})
      }
    });

    res.status(201).json({ success: true, data: request });
  })
);

