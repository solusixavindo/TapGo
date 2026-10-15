import type { PrismaClient } from "@prisma/client";
import { env } from "../../../config/env.js";

const BATCH_SIZE = 5_000;
const MAX_BATCHES_PER_RUN = 40;
const IDLE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Membuang titik lokasi driver yang sudah lewat masa simpan. Tanpa ini tabel ride_driver_locations tumbuh
 * tanpa batas; sejak pembaruan posisi dipercepat (tiap 1-3 detik saat ada perjalanan) pertumbuhannya
 * cukup cepat untuk menjadi masalah disk dan kecepatan kueri "titik terakhir".
 *
 * - Titik yang terkait perjalanan disimpan RIDE_LOCATION_RETENTION_DAYS hari (jejak rute untuk sengketa dan
 *   laporan keselamatan), lalu dihapus.
 * - Titik tanpa perjalanan (driver sekadar online) hanya berguna untuk pencocokan, jadi dibuang setelah 1 hari.
 * - Penghapusan per kelompok agar tidak mengunci tabel; sisa dilanjutkan pada putaran berikutnya.
 */
export async function purgeOldDriverLocations(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const rideCutoff = new Date(now.getTime() - env.RIDE_LOCATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const idleCutoff = new Date(now.getTime() - IDLE_RETENTION_MS);
  let purged = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const rows = await prisma.rideDriverLocation.findMany({
      where: {
        OR: [
          { rideOrderId: null, capturedAt: { lt: idleCutoff } },
          { rideOrderId: { not: null }, capturedAt: { lt: rideCutoff } },
        ],
      },
      orderBy: { capturedAt: "asc" },
      take: BATCH_SIZE,
      select: { id: true },
    });
    if (rows.length === 0) break;
    const result = await prisma.rideDriverLocation.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    purged += result.count;
    if (rows.length < BATCH_SIZE) break;
  }
  return purged;
}
