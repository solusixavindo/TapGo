import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { adminRateLimiter } from "../../../core/security/rateLimit.js";
import {
  AdminScopeGovernanceService,
  SCOPE_REASON_CODES
} from "../application/AdminScopeGovernanceService.js";

/**
 * Route tata kelola scope admin.
 *
 * Pertahanan berlapis, dan lapisannya tidak saling menggantikan:
 *   1. requireAuth   — token sah dan versi otorisasi cocok;
 *   2. requireRoles  — ADMIN/SUPER_ADMIN, penyaring kasar berbasis klaim;
 *   3. service       — status dan role dibaca ulang dari DATABASE, lalu grant
 *                      ADMIN_SCOPE_MANAGE diperiksa.
 *
 * Lapisan 3 berada di service, bukan middleware, supaya pemanggilan dari jalur
 * lain tidak dapat melewatinya. Nol route delete: pencabutan mengubah status,
 * tidak pernah menghapus baris.
 */

const service = new AdminScopeGovernanceService(prisma);

const wrapBody = (value: unknown) => {
  if (value && typeof value === "object" && "body" in value) {
    return value;
  }
  return { body: value };
};

/**
 * Scope divalidasi sebagai enum tertutup di lapisan transport juga.
 * Wildcard maupun nilai tak dikenal tidak akan pernah mencapai service.
 */
const scopeEnum = z.enum([
  "DRIVER_APPLICATION_QUEUE_READ",
  "DRIVER_APPLICATION_CLAIM",
  "DRIVER_APPLICATION_RENEW",
  "DRIVER_APPLICATION_RELEASE",
  "DRIVER_APPLICATION_REASSIGN",
  "ADMIN_SCOPE_MANAGE"
]);

const grantSchema = z.preprocess(
  wrapBody,
  z.object({
    body: z.object({
      targetUserId: z.string().uuid(),
      scope: scopeEnum,
      // Alasan ikut divalidasi service agar kegagalannya selalu memakai satu
      // kode stabil, tetapi ditolak lebih awal di sini bila jelas salah.
      reasonCode: z.enum(SCOPE_REASON_CODES)
    })
  })
);

const revokeSchema = z.preprocess(
  wrapBody,
  z.object({ body: z.object({ reasonCode: z.enum(SCOPE_REASON_CODES) }) })
);

export const adminScopeRouter = Router();

adminScopeRouter.use(requireAuth, adminRateLimiter, requireRoles("ADMIN", "SUPER_ADMIN"));

/** Scope milik pemanggil sendiri. Tidak memerlukan ADMIN_SCOPE_MANAGE. */
adminScopeRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const data = await service.listOwnScopes(req.auth!.userId);
    res.json({ success: true, data });
  })
);

/** Daftar seluruh grant. Hanya untuk SUPER_ADMIN aktif dengan manage scope. */
adminScopeRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsePositive = (value: unknown) => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    };
    const scope = scopeEnum.safeParse(req.query.scope);
    const status = z.enum(["ACTIVE", "REVOKED"]).safeParse(req.query.status);
    const userId = z.string().uuid().safeParse(req.query.userId);

    const data = await service.listGrants(req.auth!.userId, {
      ...(userId.success ? { userId: userId.data } : {}),
      ...(scope.success ? { scope: scope.data } : {}),
      ...(status.success ? { status: status.data } : {}),
      ...(parsePositive(req.query.page) !== undefined
        ? { page: parsePositive(req.query.page)! }
        : {}),
      ...(parsePositive(req.query.pageSize) !== undefined
        ? { pageSize: parsePositive(req.query.pageSize)! }
        : {})
    });
    res.json({ success: true, data });
  })
);

adminScopeRouter.post(
  "/",
  validateRequest(grantSchema),
  asyncHandler(async (req, res) => {
    const result = await service.grantScope({
      actorId: req.auth!.userId,
      targetUserId: req.body.targetUserId,
      scope: req.body.scope,
      reasonCode: req.body.reasonCode
    });
    // Grant yang sudah aktif mengembalikan 200 dengan alreadyActive: true.
    // Grant baru mengembalikan 201. Keduanya stabil dan terdokumentasi.
    res.status(result.alreadyActive ? 200 : 201).json({ success: true, data: result });
  })
);

adminScopeRouter.post(
  "/:grantId/revoke",
  validateRequest(revokeSchema),
  asyncHandler(async (req, res) => {
    const data = await service.revokeScope({
      actorId: req.auth!.userId,
      grantId: req.params.grantId as string,
      reasonCode: req.body.reasonCode
    });
    res.json({ success: true, data });
  })
);
