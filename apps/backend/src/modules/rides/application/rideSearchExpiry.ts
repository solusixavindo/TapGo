import type { PrismaClient } from "@prisma/client";
import { env } from "../../../config/env.js";
import { lazyPushNotifier } from "../../notifications/application/pushServiceFactory.js";
import type { PushNotifier } from "../../notifications/application/rideNotifications.js";

const BATCH_SIZE = 100;

/**
 * Pesanan yang belum mendapat driver setelah RIDE_SEARCH_TIMEOUT_SECONDS menjadi
 * NO_DRIVER (status terminal), sehingga tawaran basi hilang dari driver dan
 * penumpang tahu harus memesan ulang.
 *
 * - Idempoten dan aman terhadap balapan: pembaruan bersyarat (status masih
 *   SEARCHING_DRIVER dan belum ada driver). Driver yang menerima lebih dulu menang.
 * - Hanya pesanan tunai. Pembayaran DIGITAL fail-closed di createOrder sehingga
 *   tidak ada pesanan digital; bila kelak diaktifkan, penyapu ini WAJIB ikut
 *   mengembalikan dana terlebih dahulu, jadi sengaja tidak menyentuhnya.
 * - Notifikasi ke penumpang dikirim setelah commit dan tidak pernah menahan penyapuan.
 */
export async function expireStaleRideSearches(
  prisma: PrismaClient,
  push: PushNotifier = lazyPushNotifier,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - env.RIDE_SEARCH_TIMEOUT_SECONDS * 1000);
  const stale = await prisma.rideOrder.findMany({
    where: {
      status: "SEARCHING_DRIVER",
      driverProfileId: null,
      paymentMethod: "CASH",
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true, publicReference: true, passengerId: true },
  });

  let expired = 0;
  for (const order of stale) {
    const changed = await prisma.$transaction(async (tx) => {
      const result = await tx.rideOrder.updateMany({
        where: { id: order.id, status: "SEARCHING_DRIVER", driverProfileId: null },
        data: { status: "NO_DRIVER" },
      });
      if (result.count !== 1) return false;
      await tx.rideEvent.create({
        data: {
          rideOrderId: order.id,
          type: "NO_DRIVER",
          actorRole: "SYSTEM",
          previousStatus: "SEARCHING_DRIVER",
          newStatus: "NO_DRIVER",
          metadata: { reason: "SEARCH_TIMEOUT", timeoutSeconds: env.RIDE_SEARCH_TIMEOUT_SECONDS },
          eventKey: `${order.id}:NO_DRIVER:NO_DRIVER:`,
        },
      });
      return true;
    });
    if (!changed) continue;
    expired += 1;
    if (push.enabled) {
      void push
        .notifyUser(order.passengerId, {
          title: "Driver belum ditemukan",
          body: "Belum ada driver di sekitar Anda. Coba pesan lagi sebentar lagi.",
          data: { type: "ride_status", rideReference: order.publicReference, status: "NO_DRIVER" },
        })
        .catch(() => undefined);
    }
  }
  return expired;
}
