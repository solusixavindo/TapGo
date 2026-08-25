import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { rideWriteRateLimiter } from "../../../core/security/rateLimit.js";
import { DriverApplicationService } from "../application/DriverApplicationService.js";
import { DriverReviewScopeService } from "../../rides/application/DriverReviewScopeService.js";

/**
 * Pengajuan mandiri mitra driver (H1).
 *
 * Tidak ada requireRoles: siapa pun yang sudah masuk boleh memulai pengajuan.
 * Yang membatasi adalah isi pengajuannya sendiri — dokumen lengkap (K1-A) dan
 * satu pengajuan terbuka per akun, ditegakkan di service dan database.
 */

const service = new DriverApplicationService(
  prisma,
  new DriverReviewScopeService(prisma)
);

const submitSchema = z.object({
  body: z.object({
    serviceType: z.enum(["MOTORCYCLE", "CAR"]),
    plateNumber: z.string().trim().min(4).max(12),
    brand: z.string().trim().max(60).optional(),
    model: z.string().trim().max(60).optional(),
    color: z.string().trim().max(30).optional()
  })
});

export const driverApplicationRouter = Router();

driverApplicationRouter.use(requireAuth);

driverApplicationRouter.get(
  "/mine",
  asyncHandler(async (req, res) => {
    const data = await service.myApplication(req.auth!.userId);
    res.json({ success: true, data });
  })
);

driverApplicationRouter.post(
  "/",
  rideWriteRateLimiter,
  validateRequest(submitSchema),
  asyncHandler(async (req, res) => {
    const data = await service.submit({
      userId: req.auth!.userId,
      serviceType: req.body.serviceType,
      plateNumber: req.body.plateNumber,
      ...(req.body.brand !== undefined ? { brand: req.body.brand } : {}),
      ...(req.body.model !== undefined ? { model: req.body.model } : {}),
      ...(req.body.color !== undefined ? { color: req.body.color } : {})
    });
    res.status(201).json({ success: true, data });
  })
);

driverApplicationRouter.post(
  "/withdraw",
  rideWriteRateLimiter,
  asyncHandler(async (req, res) => {
    const data = await service.withdraw(req.auth!.userId);
    res.json({ success: true, data });
  })
);
