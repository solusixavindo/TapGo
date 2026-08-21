import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma.js";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { logger } from "../../../core/logger/logger.js";
import { PpobService } from "../application/PpobService.js";
import { PrismaPpobRepository } from "../infrastructure/PrismaPpobRepository.js";
import { DigiflazzPpobProvider } from "../infrastructure/DigiflazzPpobProvider.js";

/**
 * Webhook Digiflazz (Stage R2.8) — POST /api/v1/webhooks/ppob/digiflazz.
 *
 * Keaslian: X-Hub-Signature = "sha1=" + HMAC-SHA1(rawBody, webhookSecret).
 * Persis pola GitHub yang didokumentasikan Digiflazz. Verifikasi memakai
 * rawBody yang ditangkap parser JSON global di app.ts — bukan serialisasi
 * ulang, karena perbedaan spasi/urutan key akan mengubah HMAC.
 *
 * Jawaban SELALU 200 untuk payload yang lolos verifikasi (termasuk referensi
 * tak dikenal / transaksi sudah final): status 4xx/5xx memicu retry provider
 * tanpa batas untuk kondisi yang memang sudah selesai. 401 hanya untuk
 * signature salah/hilang; 503 bila secret belum dikonfigurasi (fail-closed).
 */

const repository = new PrismaPpobRepository(prisma);

function resolveService(): PpobService {
  return new PpobService(repository, DigiflazzPpobProvider.fromEnv());
}

function verifyHubSignature(rawBody: string, header: unknown, secret: string): boolean {
  if (typeof header !== "string" || !header.startsWith("sha1=")) {
    return false;
  }
  const expected = createHmac("sha1", secret).update(rawBody, "utf8").digest("hex");
  const provided = header.slice("sha1=".length);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

interface DigiflazzWebhookData {
  ref_id?: string;
  status?: string;
  rc?: string;
  message?: string;
  sn?: string | null;
}

export const digiflazzWebhookRouter = Router();

digiflazzWebhookRouter.post(
  "/digiflazz",
  asyncHandler(async (req, res) => {
    const secret = env.DIGIFLAZZ_WEBHOOK_SECRET;
    if (!secret) {
      throw new AppError(
        "Digiflazz webhook secret is not configured",
        StatusCodes.SERVICE_UNAVAILABLE,
        "PPOB_WEBHOOK_NOT_CONFIGURED"
      );
    }

    const rawBody = (req as typeof req & { rawBody?: string }).rawBody;
    if (!rawBody || !verifyHubSignature(rawBody, req.headers["x-hub-signature"], secret)) {
      throw new AppError(
        "Digiflazz webhook signature is invalid",
        StatusCodes.UNAUTHORIZED,
        "PPOB_WEBHOOK_SIGNATURE_INVALID"
      );
    }

    const data = (req.body as { data?: DigiflazzWebhookData } | undefined)?.data;
    if (!data?.ref_id || typeof data.status !== "string") {
      // Payload valid secara signature tetapi bukan event transaksi yang kita
      // kenali (mis. ping). Jawab 200 agar konfigurasi webhook terverifikasi.
      res.json({ success: true, data: { state: "ignored" } });
      return;
    }

    const status = data.status.trim().toLowerCase();
    let outcome:
      | { kind: "SUCCESS"; providerReference: string; serialNumber: string | null }
      | {
          kind: "FAILED";
          providerReference: string | null;
          failureCode: string;
          failureReason: string;
        };

    if (status === "sukses") {
      outcome = {
        kind: "SUCCESS",
        providerReference: data.ref_id,
        serialNumber: data.sn && data.sn.trim().length > 0 ? data.sn : null
      };
    } else if (status === "gagal") {
      outcome = {
        kind: "FAILED",
        providerReference: data.ref_id,
        failureCode: data.rc ? `DIGIFLAZZ_RC_${data.rc}` : "DIGIFLAZZ_FAILED",
        failureReason: data.message ?? "Transaksi gagal di provider"
      };
    } else {
      // "Pending" dan status asing lain tidak mengubah apa pun — finalisasi
      // hanya pada status terminal.
      res.json({ success: true, data: { state: "ignored" } });
      return;
    }

    const service = resolveService();
    const result = await service.finalizeFromProviderNotification({
      publicReference: data.ref_id,
      outcome
    });

    logger.info(
      { reference: data.ref_id, state: result.state },
      "Digiflazz webhook processed"
    );
    res.json({ success: true, data: result });
  })
);
