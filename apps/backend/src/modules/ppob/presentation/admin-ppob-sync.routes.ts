import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma.js";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { PpobPriceSyncService } from "../application/PpobPriceSyncService.js";
import { PpobProviderGateway } from "../domain/ppobProvider.js";
import { PrismaPpobRepository } from "../infrastructure/PrismaPpobRepository.js";
import { DigiflazzPpobProvider } from "../infrastructure/DigiflazzPpobProvider.js";

/**
 * Sinkronisasi harga PPOB, khusus SUPER_ADMIN_VIP: harga jual adalah
 * keputusan bisnis (margin di atas Digiflazz), setara sensitivitasnya dengan
 * pengelolaan role — bukan tindakan operasional admin/finance sehari-hari.
 *
 * Endpoint ini menjalankan SATU siklus yang SAMA PERSIS dengan worker
 * berkala di server.ts (kelas yang sama, kunci lock yang sama) — dipakai
 * untuk menyinkronkan segera setelah katalog diubah, tanpa menunggu jadwal
 * berikutnya, dan agar hasilnya terlihat langsung di respons (bukan hanya di
 * log server).
 */
function resolvePpobProviderForSync(): PpobProviderGateway | null {
  if (env.PPOB_PROVIDER !== "digiflazz") {
    return null;
  }
  return DigiflazzPpobProvider.fromEnv();
}

export const adminPpobSyncRouter = Router();

adminPpobSyncRouter.use(requireAuth, requireRoles("SUPER_ADMIN_VIP"));

adminPpobSyncRouter.post(
  "/sync-prices",
  asyncHandler(async (_req, res) => {
    const provider = resolvePpobProviderForSync();
    if (!provider) {
      throw new AppError(
        "Sinkronisasi harga hanya tersedia saat PPOB_PROVIDER=digiflazz",
        StatusCodes.SERVICE_UNAVAILABLE,
        "PPOB_PRICE_SYNC_UNAVAILABLE"
      );
    }
    const service = new PpobPriceSyncService(new PrismaPpobRepository(prisma), provider);
    const result = await service.runSyncCycle();
    res.json({ success: true, data: result });
  })
);
