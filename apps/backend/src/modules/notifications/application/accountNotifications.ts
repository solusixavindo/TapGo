import type { PushNotifier } from "./rideNotifications.js";

/**
 * Isi notifikasi untuk peristiwa akun. Sengaja tanpa nominal, nama, atau nomor
 * pengirim: teks tampil di layar kunci. Rinciannya dibaca di aplikasi.
 */
export const accountPushMessages = {
  topUpSuccess: { title: "Top up berhasil", body: "Saldo TapGoPay Anda sudah bertambah." },
  transferReceived: { title: "Saldo masuk", body: "Anda menerima transfer TapGoPay. Buka aplikasi untuk melihat rinciannya." },
  membershipUnderReview: { title: "Pembayaran diterima", body: "Dokumen Anda sedang diverifikasi. Kami kabari setelah selesai." },
  membershipActive: { title: "Membership aktif", body: "Paket membership Anda sudah aktif." },
  membershipCorrection: { title: "Dokumen membership perlu diperbaiki", body: "Buka tapgolion.id/upgrade untuk melihat catatan dan mengunggah ulang dokumen." },
  membershipRejected: { title: "Dokumen membership ditolak", body: "Dana Anda akan dikembalikan. Buka aplikasi untuk detailnya." }
} as const;

/**
 * Kirim tanpa menunggu dan tanpa pernah melempar. Dipanggil HANYA setelah
 * transaksi yang menyebabkannya commit.
 */
export function pushQuietly(
  push: PushNotifier,
  userId: string,
  message: { title: string; body: string },
  data: Record<string, string>
): void {
  if (!push.enabled) return;
  try {
    void push.notifyUser(userId, { ...message, data }).catch(() => undefined);
  } catch {
    // notifier sinkron yang melempar: tetap tidak boleh memengaruhi pemanggil
  }
}
