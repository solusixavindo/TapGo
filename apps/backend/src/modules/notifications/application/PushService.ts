import { logger } from "../../../core/logger/logger.js";
import type { PushMessage, PushSender } from "../infrastructure/FcmClient.js";

/** Bagian Prisma yang dipakai; memudahkan uji tanpa database. */
export interface PushTokenStore {
  listTokens(userId: string): Promise<Array<{ id: string; token: string }>>;
  deleteTokens(ids: string[]): Promise<void>;
}

/**
 * Mengirim notifikasi ke semua perangkat milik satu pengguna.
 *
 * Kontrak keras: TIDAK PERNAH melempar dan tidak pernah menahan alur bisnis
 * (transaksi, perubahan status). Pemanggil cukup `void push.notifyUser(...)`.
 * Token yang ditolak FCM dihapus agar tabel tidak menumpuk token mati.
 */
export class PushService {
  constructor(
    private readonly store: PushTokenStore,
    private readonly sender: PushSender | null
  ) {}

  get enabled(): boolean {
    return this.sender !== null;
  }

  async notifyUser(userId: string, message: PushMessage): Promise<void> {
    if (!this.sender) return;
    try {
      const tokens = await this.store.listTokens(userId);
      if (tokens.length === 0) return;
      const dead: string[] = [];
      await Promise.all(
        tokens.map(async ({ id, token }) => {
          const result = await this.sender!.send(token, message);
          if (result === "invalid_token") dead.push(id);
        })
      );
      if (dead.length > 0) await this.store.deleteTokens(dead);
    } catch (error) {
      // Isi pesan tidak dicatat: bisa memuat nominal atau nama.
      logger.warn({ err: error, userId }, "Push notification gagal diproses");
    }
  }
}
