import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { AnnouncementService } from "../application/AnnouncementService.js";

/**
 * Pengumuman pemilik untuk aplikasi user (ikon bel). Hanya membaca dan menandai sudah dibuka; penulisan ada di
 * konsol admin dan khusus Super Admin VIP.
 */
export const announcementRouter = Router();
const service = new AnnouncementService(prisma);

announcementRouter.use(requireAuth);

announcementRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.json({ success: true, data: await service.listForUser(req.auth!.userId) });
  })
);

announcementRouter.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.json({ success: true, data: await service.unreadCount(req.auth!.userId) });
  })
);

announcementRouter.post(
  "/seen",
  asyncHandler(async (req, res) => {
    await service.markSeen(req.auth!.userId);
    res.status(204).end();
  })
);
