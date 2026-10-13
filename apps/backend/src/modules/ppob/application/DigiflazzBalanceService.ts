import { createHash } from "node:crypto";
import { env } from "../../../config/env.js";
import { logger } from "../../../core/logger/logger.js";

const DEFAULT_BASE_URL = "https://api.digiflazz.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;
/** Saldo dianggap segar selama ini; pemantauan tidak boleh membebani batas permintaan Digiflazz. */
const CACHE_MS = 60_000;
/** Muat ulang manual pun dibatasi supaya tombol yang ditekan berulang tidak menembus batas permintaan. */
const FORCE_MIN_INTERVAL_MS = 15_000;

export type DigiflazzBalanceReading = {
  /** Penyedia PPOB yang aktif; saldo hanya tersedia untuk "digiflazz". */
  provider: string;
  configured: boolean;
  balance: number | null;
  /** ISO waktu saldo terakhir berhasil dibaca; null bila belum pernah. */
  checkedAt: string | null;
  /** True bila yang ditampilkan adalah bacaan lama (cache atau bacaan terakhir saat permintaan baru gagal). */
  stale: boolean;
  error: string | null;
};

type PriceCache = { at: number; balance: number };

/**
 * Membaca saldo deposit akun Digiflazz (POST /cek-saldo, sign = md5(username + apiKey + "depo")).
 *
 * Hanya baca. Kredensial tidak pernah keluar dari proses ini, dan pesan galat dibersihkan sebelum dikirim ke
 * konsol admin. Hasil di-cache 60 detik dan permintaan serentak digabung menjadi satu.
 */
export class DigiflazzBalanceService {
  private cache: PriceCache | null = null;
  private lastAttemptAt = 0;
  private inflight: Promise<DigiflazzBalanceReading> | null = null;

  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = () => Date.now()
  ) {}

  async read(options: { force?: boolean } = {}): Promise<DigiflazzBalanceReading> {
    const username = env.DIGIFLAZZ_USERNAME;
    const apiKey = env.DIGIFLAZZ_API_KEY;
    if (env.PPOB_PROVIDER !== "digiflazz" || !username || !apiKey) {
      return { provider: env.PPOB_PROVIDER, configured: false, balance: null, checkedAt: null, stale: false, error: null };
    }

    const age = this.cache ? this.now() - this.cache.at : Number.POSITIVE_INFINITY;
    const sinceAttempt = this.now() - this.lastAttemptAt;
    const fresh = age < CACHE_MS && !options.force;
    const forcedTooSoon = options.force === true && sinceAttempt < FORCE_MIN_INTERVAL_MS;
    if (this.cache && (fresh || forcedTooSoon)) {
      return this.reading(this.cache, true, null);
    }
    if (this.inflight) return this.inflight;

    this.inflight = this.request(username, apiKey).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private reading(cache: PriceCache | null, stale: boolean, error: string | null): DigiflazzBalanceReading {
    return {
      provider: "digiflazz",
      configured: true,
      balance: cache ? cache.balance : null,
      checkedAt: cache ? new Date(cache.at).toISOString() : null,
      stale,
      error
    };
  }

  private async request(username: string, apiKey: string): Promise<DigiflazzBalanceReading> {
    this.lastAttemptAt = this.now();
    const url = `${(env.DIGIFLAZZ_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "")}/cek-saldo`;
    const sign = createHash("md5").update(`${username}${apiKey}depo`).digest("hex");
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "deposit", username, sign }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: { deposit?: unknown; message?: unknown; rc?: unknown };
      } | null;
      const deposit = payload?.data?.deposit;
      if (response.ok && typeof deposit === "number" && Number.isFinite(deposit)) {
        this.cache = { at: this.now(), balance: deposit };
        return this.reading(this.cache, false, null);
      }
      const rc = typeof payload?.data?.rc === "string" ? payload.data.rc : null;
      const message = typeof payload?.data?.message === "string" ? payload.data.message.slice(0, 120) : null;
      logger.warn({ status: response.status, rc }, "Digiflazz cek-saldo ditolak");
      return this.reading(
        this.cache,
        true,
        `Digiflazz menolak permintaan saldo${rc ? ` (rc=${rc})` : ""}${message ? `: ${message}` : ""}`
      );
    } catch (error) {
      logger.warn({ err: error }, "Digiflazz cek-saldo gagal");
      return this.reading(this.cache, true, "Saldo Digiflazz belum dapat dibaca (koneksi ke Digiflazz gagal atau terlalu lama).");
    }
  }
}

export const digiflazzBalanceService = new DigiflazzBalanceService();
