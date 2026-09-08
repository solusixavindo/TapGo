import { createHash } from "node:crypto";
import express, { Router } from "express";
import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma.js";
import { AppError } from "../../../core/errors/AppError.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { verifyPassword } from "../../../core/security/passwordHasher.js";
import { accountDeletionRequestSchema, updatePhoneSchema } from "./account.validators.js";

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

/**
 * Ubah nomor HP akun sendiri (Stage R2.11).
 *
 * Nomor HP adalah identifier login utama, jadi diperlakukan setara dengan
 * ganti password — WAJIB membuktikan kepemilikan akun lewat password saat ini
 * sebelum diizinkan, pola yang sama dengan AuthService.changePassword. Tanpa
 * ini, siapa pun yang berhasil mencuri satu access token (mis. lewat device
 * yang lupa logout) dapat diam-diam mengganti nomor HP korban.
 */
accountRouter.put(
  "/phone",
  validateRequest(updatePhoneSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { passwordHash: true }
    });
    if (!user?.passwordHash) {
      throw new AppError("User not found", StatusCodes.NOT_FOUND, "USER_NOT_FOUND");
    }

    const matches = await verifyPassword(user.passwordHash, req.body.currentPassword);
    if (!matches) {
      throw new AppError("Password saat ini tidak cocok.", StatusCodes.UNAUTHORIZED, "INVALID_CREDENTIALS");
    }

    try {
      const updated = await prisma.user.update({
        where: { id: req.auth!.userId },
        // Nomor baru belum tentu terbukti milik pengguna (tidak ada OTP di
        // sini) — turunkan status verifikasi, sama seperti alur ganti kontak
        // lain di AccountRecoveryService.
        data: { phone: req.body.phone, phoneVerifiedAt: null },
        select: { id: true, phone: true }
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("Nomor HP sudah dipakai akun lain.", StatusCodes.CONFLICT, "PHONE_ALREADY_IN_USE");
      }
      throw error;
    }
  })
);

const rawAvatarBody = express.raw({
  type: ["image/png", "image/jpeg"],
  limit: "4mb"
});

/**
 * Foto profil (Stage R2.11).
 *
 * Berkas dikirim mentah, bukan base64 di dalam JSON — pola sama dengan
 * unggahan dokumen KYC (membership-document.controller.ts) dan dokumen
 * driver: base64 membengkakkan muatan sekitar sepertiga tanpa memberi
 * keuntungan apa pun di sini.
 */
accountRouter.post(
  "/avatar",
  rawAvatarBody,
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
      throw new AppError(
        "Foto profil harus dikirim sebagai berkas gambar JPG atau PNG.",
        StatusCodes.UNSUPPORTED_MEDIA_TYPE,
        "ACCOUNT_AVATAR_TYPE_INVALID"
      );
    }

    const contentType = String(req.headers["content-type"] ?? "");
    const checksum = createHash("sha256").update(req.body).digest("hex");
    const avatarUrl = "/account/avatar";

    await prisma.$transaction([
      prisma.userAvatar.upsert({
        where: { userId: req.auth!.userId },
        create: { userId: req.auth!.userId, bytes: req.body, contentType, checksum },
        update: { bytes: req.body, contentType, checksum }
      }),
      prisma.user.update({
        where: { id: req.auth!.userId },
        data: { avatarUrl }
      })
    ]);

    res.status(StatusCodes.CREATED).json({ success: true, data: { avatarUrl } });
  })
);

accountRouter.get(
  "/avatar",
  asyncHandler(async (req, res) => {
    const avatar = await prisma.userAvatar.findUnique({
      where: { userId: req.auth!.userId }
    });
    if (!avatar) {
      throw new AppError("Foto profil belum diunggah.", StatusCodes.NOT_FOUND, "ACCOUNT_AVATAR_NOT_FOUND");
    }

    // Foto identitas tidak boleh singgah di cache mana pun — pola sama
    // dengan penyajian dokumen KYC ke admin.
    res.setHeader("cache-control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("pragma", "no-cache");
    res.setHeader("content-type", avatar.contentType);
    res.setHeader("x-content-type-options", "nosniff");
    res.send(avatar.bytes);
  })
);
