import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { registerPushTokenSchema, removePushTokenSchema } from "./notifications.validators.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

/** Batas perangkat per akun; yang terlama dibuang agar tabel tidak menumpuk. */
const MAX_TOKENS_PER_USER = 10;

/**
 * Daftarkan token perangkat milik pengguna yang login. Token bersifat unik
 * global: bila perangkat berpindah tangan (akun lain login di HP yang sama),
 * token dipindahkan ke akun yang baru sehingga notifikasi akun lama tidak
 * lagi tampil di HP itu.
 */
notificationsRouter.post(
  "/push-token",
  validateRequest(registerPushTokenSchema),
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const { token, platform, deviceId } = req.body as {
      token: string;
      platform: string;
      deviceId?: string;
    };

    await prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform, deviceId: deviceId ?? null },
      update: { userId, platform, deviceId: deviceId ?? null }
    });

    const stale = await prisma.pushToken.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      skip: MAX_TOKENS_PER_USER,
      select: { id: true }
    });
    if (stale.length > 0) {
      await prisma.pushToken.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    }

    res.status(204).end();
  })
);

/** Hapus token milik sendiri (dipanggil saat logout). Token orang lain tidak tersentuh. */
notificationsRouter.delete(
  "/push-token",
  validateRequest(removePushTokenSchema),
  asyncHandler(async (req, res) => {
    await prisma.pushToken.deleteMany({
      where: { userId: req.auth!.userId, token: (req.body as { token: string }).token }
    });
    res.status(204).end();
  })
);
