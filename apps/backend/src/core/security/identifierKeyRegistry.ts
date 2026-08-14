import { StatusCodes } from "http-status-codes";
import { AppError } from "../errors/AppError.js";

/**
 * Registry kunci HMAC untuk identifier blind index.
 *
 * Kunci bersifat BACKEND-ONLY: tidak pernah dikirim ke klien, tidak disimpan di
 * database, tidak masuk log, dan tidak masuk audit metadata. Registry ini hanya
 * memegang material kunci di memori proses backend.
 *
 * Fail-closed: seluruh konfigurasi yang tidak valid ditolak saat registry
 * dibangun, bukan dibiarkan lolos dengan perilaku diam-diam. Tidak ada fallback
 * implisit ke kunci lain.
 *
 * Batas dua kunci aktif berasal dari Owner Decision D-06 (Stage 5.12): maksimal
 * dua versi aktif selama transition window.
 */

/** Kode error stabil untuk kegagalan konfigurasi/ketersediaan kunci. */
export const IDENTIFIER_KEY_UNAVAILABLE = "RIDE_IDENTIFIER_KEY_UNAVAILABLE";

/** Batas versi kunci aktif secara bersamaan (D-06). */
export const MAX_ACTIVE_IDENTIFIER_KEYS = 2;

/** Panjang minimum material kunci, konsisten dengan pola secret lain di env. */
export const MIN_IDENTIFIER_KEY_LENGTH = 32;

export type IdentifierKeyInput = {
  version: number;
  material: string;
};

export type IdentifierKeyRegistryInput = {
  currentVersion: number;
  keys: readonly IdentifierKeyInput[];
};

function keyError(message: string): AppError {
  // Pesan sengaja hanya menjelaskan BENTUK kesalahan. Material kunci, panjang
  // sebenarnya, dan potongan nilai tidak pernah disertakan.
  return new AppError(message, StatusCodes.SERVICE_UNAVAILABLE, IDENTIFIER_KEY_UNAVAILABLE);
}

export class IdentifierKeyRegistry {
  private readonly keys: ReadonlyMap<number, Buffer>;

  /** Versi kunci yang dipakai untuk seluruh penulisan index baru. */
  readonly currentVersion: number;

  /** Versi aktif, terurut menaik agar hasil lookup deterministik. */
  readonly activeVersions: readonly number[];

  constructor(input: IdentifierKeyRegistryInput) {
    if (!Number.isInteger(input.currentVersion) || input.currentVersion < 1) {
      throw keyError("Konfigurasi identifier key tidak valid: current version malformed.");
    }
    if (!Array.isArray(input.keys) || input.keys.length === 0) {
      throw keyError("Konfigurasi identifier key tidak valid: tidak ada kunci aktif.");
    }
    if (input.keys.length > MAX_ACTIVE_IDENTIFIER_KEYS) {
      throw keyError(
        `Konfigurasi identifier key tidak valid: melebihi ${MAX_ACTIVE_IDENTIFIER_KEYS} kunci aktif.`
      );
    }

    const keys = new Map<number, Buffer>();
    for (const entry of input.keys) {
      if (!Number.isInteger(entry.version) || entry.version < 1) {
        throw keyError("Konfigurasi identifier key tidak valid: version malformed.");
      }
      if (keys.has(entry.version)) {
        throw keyError("Konfigurasi identifier key tidak valid: version duplikat.");
      }
      if (typeof entry.material !== "string" || entry.material.trim().length === 0) {
        throw keyError("Konfigurasi identifier key tidak valid: material kosong.");
      }
      if (entry.material.length < MIN_IDENTIFIER_KEY_LENGTH) {
        throw keyError("Konfigurasi identifier key tidak valid: material terlalu pendek.");
      }
      keys.set(entry.version, Buffer.from(entry.material, "utf8"));
    }

    if (!keys.has(input.currentVersion)) {
      throw keyError(
        "Konfigurasi identifier key tidak valid: current version tidak ada di daftar kunci aktif."
      );
    }

    this.keys = keys;
    this.currentVersion = input.currentVersion;
    this.activeVersions = [...keys.keys()].sort((left, right) => left - right);
  }

  /** True bila versi tersebut termasuk kunci aktif. */
  has(version: number): boolean {
    return this.keys.has(version);
  }

  /**
   * Material kunci untuk satu versi. Fail-closed pada versi tak dikenal —
   * pemanggil tidak boleh melanjutkan dengan kunci lain.
   */
  materialFor(version: number): Buffer {
    const material = this.keys.get(version);
    if (!material) {
      throw keyError("Versi identifier key tidak dikenal.");
    }
    return material;
  }
}

/**
 * Bangun registry dari konfigurasi environment.
 *
 * Sengaja TIDAK dipanggil saat modul dimuat: kegagalan terjadi ketika fitur
 * identifier benar-benar diaktifkan, bukan saat proses boot untuk kebutuhan
 * lain. Tidak ada nilai default dan tidak ada kunci yang di-hard-code.
 */
export function createIdentifierKeyRegistryFromEnv(source: {
  currentVersion?: number | undefined;
  v1?: string | undefined;
  v2?: string | undefined;
}): IdentifierKeyRegistry {
  if (source.currentVersion === undefined) {
    throw keyError("Konfigurasi identifier key tidak lengkap: current version belum diset.");
  }

  const keys: IdentifierKeyInput[] = [];
  if (source.v1 !== undefined) keys.push({ version: 1, material: source.v1 });
  if (source.v2 !== undefined) keys.push({ version: 2, material: source.v2 });

  return new IdentifierKeyRegistry({ currentVersion: source.currentVersion, keys });
}
