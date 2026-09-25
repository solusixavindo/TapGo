import type { RideOrderStatus } from "@prisma/client";
import type { PushMessage } from "../infrastructure/FcmClient.js";

/** Bagian PushService yang dipakai layanan lain; memudahkan uji dan menjaga arah dependensi. */
export interface PushNotifier {
  readonly enabled: boolean;
  notifyUser(userId: string, message: PushMessage): Promise<void>;
}

/**
 * Isi notifikasi untuk penumpang pada tiap perubahan status perjalanan.
 * Sengaja tanpa alamat, nama driver, atau nominal: teks tampil di layar kunci.
 * Status yang tidak tercantum tidak memicu notifikasi.
 */
export function ridePushMessage(status: RideOrderStatus): { title: string; body: string } | null {
  switch (status) {
    case "DRIVER_ASSIGNED":
      return { title: "Driver ditemukan", body: "Driver sedang menuju lokasi jemput Anda." };
    case "DRIVER_ARRIVED":
      return { title: "Driver sudah tiba", body: "Driver menunggu Anda di titik jemput." };
    case "COMPLETED":
      return { title: "Perjalanan selesai", body: "Terima kasih telah menggunakan TapGo." };
    case "CANCELLED_BY_DRIVER":
      return { title: "Perjalanan dibatalkan", body: "Driver membatalkan perjalanan. Silakan pesan ulang." };
    default:
      return null;
  }
}
