import { describe, expect, it } from "vitest";
import { accountPushMessages } from "../../src/modules/notifications/application/accountNotifications.js";
import { ridePushMessage } from "../../src/modules/notifications/application/rideNotifications.js";

/**
 * Notifikasi dikirim dengan visibility PUBLIC (tampil penuh di layar kunci, keputusan 15 Nov 2026 agar driver melihat
 * "Pesanan baru di dekat Anda"). Itu hanya aman bila SEMUA teks sengaja bebas data pribadi. Tes ini menjaga asumsi itu:
 * tidak ada nominal rupiah, angka panjang (nomor telepon/rekening), alamat surel, atau tautan di teks bawaan.
 */
const PERSONAL = [
  { name: "nominal rupiah", pattern: /\bRp\.?\s?\d|\d[\d.,]{3,}/i },
  { name: "angka panjang (nomor)", pattern: /\d{6,}/ },
  { name: "alamat surel", pattern: /\S+@\S+\.\S+/ },
  { name: "tautan http", pattern: /https?:\/\//i }
];

const ALL_STATUSES = [
  "SEARCHING", "DRIVER_ASSIGNED", "DRIVER_TO_PICKUP", "DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED", "NO_DRIVER"
] as const;

function allMessages(): Array<{ source: string; title: string; body: string }> {
  const out: Array<{ source: string; title: string; body: string }> = [];
  for (const [key, message] of Object.entries(accountPushMessages)) out.push({ source: `akun.${key}`, ...message });
  for (const status of ALL_STATUSES) {
    const message = ridePushMessage(status as never);
    if (message) out.push({ source: `perjalanan.${status}`, ...message });
  }
  return out;
}

describe("teks push aman untuk layar kunci", () => {
  it("ada pesan yang diperiksa (tes tidak kosong)", () => {
    expect(allMessages().length).toBeGreaterThanOrEqual(8);
  });

  it.each(allMessages().map((m) => [m.source, m] as const))("%s tidak memuat data pribadi", (_source, message) => {
    for (const { name, pattern } of PERSONAL) {
      expect(`${message.title} ${message.body}`, `memuat ${name}`).not.toMatch(pattern);
    }
  });
});
