import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { adminRateLimiter } from "../../../core/security/rateLimit.js";
import { DriverReviewScopeService } from "../application/DriverReviewScopeService.js";
import {
  DriverReviewLeaseService,
  REASSIGN_REASON_CODES,
  RELEASE_REASON_CODES
} from "../application/DriverReviewLeaseService.js";
import {
  DriverApplicationService,
  REJECT_REASON_CODES
} from "../../drivers/application/DriverApplicationService.js";

/**
 * Route admin untuk antrian dan claim/lease review driver.
 *
 * Pertahanan berlapis, dan lapisannya sengaja tidak saling menggantikan:
 *   1. requireAuth        — token sah dan versi otorisasi cocok;
 *   2. requireRoles       — ADMIN/SUPER_ADMIN, syarat kasar;
 *   3. scope service      — grant aktif di database, diperiksa ulang di
 *                           dalam setiap method service.
 *
 * Lapisan 3 dievaluasi di service, bukan sebagai middleware, supaya
 * pemanggilan service dari jalur lain tidak dapat melewatinya. requireRoles
 * di sini hanya menutup pintu lebih awal; ia tidak pernah memberi kewenangan.
 *
 * Keputusan (approve/reject) hanya dapat dilakukan admin yang SEDANG memegang
 * klaim aktif atas pengajuan itu — divalidasi ulang di dalam transaksi oleh
 * DriverApplicationService, bukan hanya saat endpoint dipanggil.
 */

const scopeService = new DriverReviewScopeService(prisma);
const leaseService = new DriverReviewLeaseService(prisma, scopeService);
const applicationService = new DriverApplicationService(prisma, scopeService);

const wrapBody = (value: unknown) => {
  if (value && typeof value === "object" && "body" in value) {
    return value;
  }
  return { body: value };
};

const uuid = z.string().uuid();

const claimSchema = z.preprocess(
  wrapBody,
  z.object({ body: z.object({ expectedVersion: z.number().int().nonnegative().optional() }) })
);

const releaseSchema = z.preprocess(
  wrapBody,
  z.object({ body: z.object({ reasonCode: z.enum(RELEASE_REASON_CODES) }) })
);

const reassignSchema = z.preprocess(
  wrapBody,
  z.object({
    body: z.object({
      targetUserId: uuid,
      reasonCode: z.enum(REASSIGN_REASON_CODES)
    })
  })
);

export const driverReviewRouter = Router();

driverReviewRouter.use(requireAuth, adminRateLimiter, requireRoles("ADMIN", "SUPER_ADMIN"));

driverReviewRouter.get(
  "/applications",
  asyncHandler(async (req, res) => {
    const data = await leaseService.listReviewQueue(req.auth!.userId);
    res.json({ success: true, data });
  })
);

driverReviewRouter.post(
  "/applications/:id/claim",
  validateRequest(claimSchema),
  asyncHandler(async (req, res) => {
    const data = await leaseService.claimApplication({
      actorId: req.auth!.userId,
      applicationId: req.params.id as string,
      ...(req.body.expectedVersion !== undefined
        ? { expectedVersion: req.body.expectedVersion }
        : {})
    });
    res.json({ success: true, data });
  })
);

driverReviewRouter.post(
  "/applications/:id/renew",
  asyncHandler(async (req, res) => {
    const data = await leaseService.renewClaim({
      actorId: req.auth!.userId,
      applicationId: req.params.id as string
    });
    res.json({ success: true, data });
  })
);

driverReviewRouter.post(
  "/applications/:id/release",
  validateRequest(releaseSchema),
  asyncHandler(async (req, res) => {
    const data = await leaseService.releaseClaim({
      actorId: req.auth!.userId,
      applicationId: req.params.id as string,
      reasonCode: req.body.reasonCode
    });
    res.json({ success: true, data });
  })
);

driverReviewRouter.post(
  "/applications/:id/reassign",
  validateRequest(reassignSchema),
  asyncHandler(async (req, res) => {
    const data = await leaseService.reassignClaim({
      actorId: req.auth!.userId,
      applicationId: req.params.id as string,
      targetUserId: req.body.targetUserId,
      reasonCode: req.body.reasonCode
    });
    res.json({ success: true, data });
  })
);

const rejectSchema = z.preprocess(
  wrapBody,
  z.object({ body: z.object({ reasonCode: z.enum(REJECT_REASON_CODES) }) })
);

driverReviewRouter.post(
  "/applications/:id/approve",
  asyncHandler(async (req, res) => {
    const data = await applicationService.approve({
      actorId: req.auth!.userId,
      applicationId: req.params.id as string
    });
    res.json({ success: true, data });
  })
);

driverReviewRouter.post(
  "/applications/:id/reject",
  validateRequest(rejectSchema),
  asyncHandler(async (req, res) => {
    const data = await applicationService.reject({
      actorId: req.auth!.userId,
      applicationId: req.params.id as string,
      reasonCode: req.body.reasonCode
    });
    res.json({ success: true, data });
  })
);
