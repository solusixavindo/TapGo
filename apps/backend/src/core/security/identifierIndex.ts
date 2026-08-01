import crypto from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../errors/AppError.js";
import { IdentifierKeyRegistry } from "./identifierKeyRegistry.js";

/**
 * Identifier blind index — deterministic keyed HMAC-SHA256.
 *
 * TUJUAN: memungkinkan lookup dan deduplication identifier sensitif TANPA
 * menyimpan nilai mentahnya.
 *
 * INI BUKAN ENCRYPTION. Blind index bersifat satu arah dan tidak dapat
 * dikembalikan menjadi nilai asli. Tidak ada fungsi decrypt/recover di sini, dan
 * tidak boleh ditambahkan. Bila suatu saat nilai mentah harus dapat dibaca
 * kembali, itu memerlukan encryption terpisah dan keputusan Owner (D-04).
 *
 * Yang TIDAK pernah dilakukan modul ini:
 * - menyimpan canonical raw identifier
 * - menulis raw identifier, canonical value, blind index, atau material kunci ke
 *   log, pesan error, atau audit metadata
 * - melakukan network call
 * - menyentuh database
 */

/** Domain identifier yang dikenal. Aktif/tidaknya diatur terpisah di bawah. */
export type IdentifierDomain = "nik" | "sim" | "plate" | "stnk";

/**
 * Domain yang AKTIF pada Stage 5.14A.
 *
 * `sim` fail-closed: canonical grammar resmi belum tersedia (Stage 5.13 —
 * SIM CANONICALIZATION BLOCKED PENDING AUTHORITATIVE FORMAT RULE). Normalisasi
 * permisif dilarang karena dapat membuat dua SIM berbeda memiliki index sama,
 * atau satu SIM memiliki dua index berbeda.
 *
 * `stnk` fail-closed: domain masa depan, terikat keputusan dokumen/legal.
 */
const ACTIVE_DOMAINS: ReadonlySet<IdentifierDomain> = new Set<IdentifierDomain>(["nik", "plate"]);

/** Prefiks pesan HMAC. Bagian dari kontrak; mengubahnya mengubah seluruh index. */
export const IDENTIFIER_MESSAGE_PREFIX = "tapgo.identifier.v1";

/** Versi aturan canonicalization yang berlaku saat ini. */
export const IDENTIFIER_CANONICALIZATION_VERSION = 1;

/** Panjang blind index dalam karakter hex. */
export const IDENTIFIER_INDEX_LENGTH = 64;

// --- Kode error stabil --------------------------------------------------------

export const IDENTIFIER_FORMAT_INVALID = "RIDE_IDENTIFIER_FORMAT_INVALID";
export const IDENTIFIER_DOMAIN_NOT_ACTIVE = "IDENTIFIER_DOMAIN_NOT_ACTIVE";
export const IDENTIFIER_CANONICALIZATION_UNAVAILABLE = "IDENTIFIER_CANONICALIZATION_UNAVAILABLE";

// --- Tipe hasil ---------------------------------------------------------------

export type BlindIndex = {
  domain: IdentifierDomain;
  /** Lowercase hex, 64 karakter. JANGAN di-log. */
  value: string;
  keyVersion: number;
  canonicalizationVersion: number;
};

export type IdentifierMigrationState =
  | "CURRENT"
  | "LEGACY_PENDING_REVERIFICATION"
  | "LEGACY_UNRECOVERABLE";

export type StoredBlindIndex = {
  value: string;
  keyVersion: number;
  canonicalizationVersion: number;
};

export type LazyMigrationPlan = {
  /** True bila identifier yang diberikan cocok dengan index tersimpan. */
  matched: boolean;
  matchedKeyVersion?: number;
  state: IdentifierMigrationState;
  needsMigration: boolean;
  /** Index dengan kunci tulis saat ini; hanya terisi bila perlu migrasi. */
  next?: BlindIndex;
};

/**
 * Event telemetry/audit. HANYA memuat nama event, domain, dan keyVersion.
 * Tidak pernah memuat raw identifier, canonical value, blind index, maupun
 * material kunci.
 */
export type IdentifierEvent = {
  event: "identifier.legacy_key_lookup" | "identifier.unknown_key_version";
  domain: IdentifierDomain;
  keyVersion: number;
};

export type IdentifierEventSink = (event: IdentifierEvent) => void;

// --- Error helper -------------------------------------------------------------

function formatError(domain: IdentifierDomain): AppError {
  // Pesan hanya menyebut domain. Nilai input TIDAK pernah disertakan, karena
  // pesan error dapat berakhir di log atau response.
  return new AppError(
    `Format identifier tidak valid untuk domain ${domain}.`,
    StatusCodes.BAD_REQUEST,
    IDENTIFIER_FORMAT_INVALID
  );
}

function domainNotActiveError(domain: IdentifierDomain): AppError {
  if (domain === "sim") {
    return new AppError(
      "Canonicalization untuk domain sim belum tersedia.",
      StatusCodes.CONFLICT,
      IDENTIFIER_CANONICALIZATION_UNAVAILABLE
    );
  }
  return new AppError(
    `Domain identifier ${domain} tidak aktif.`,
    StatusCodes.CONFLICT,
    IDENTIFIER_DOMAIN_NOT_ACTIVE
  );
}

// --- Canonicalization ---------------------------------------------------------

/**
 * Tahap bersama: Unicode NFKC lalu trim.
 *
 * NFKC mencegah bentuk karakter yang secara visual sama (mis. digit fullwidth)
 * menghasilkan HMAC berbeda.
 */
function prepare(raw: string): string {
  return raw.normalize("NFKC").trim();
}

/**
 * NIK: tepat 16 digit, leading zero dipertahankan.
 *
 * Pemisah berupa whitespace dibuang karena hanya formatting. Karakter lain yang
 * bukan digit TIDAK dibuang diam-diam — input ditolak, agar kesalahan ketik
 * tidak berubah menjadi identitas orang lain.
 *
 * Nilai TIDAK pernah di-parse sebagai number: `Number("0000000000000001")`
 * kehilangan leading zero dan melampaui presisi aman.
 */
function canonicalizeNik(raw: string): string {
  const prepared = prepare(raw).replace(/\s+/g, "");
  if (!/^[0-9]{16}$/.test(prepared)) {
    throw formatError("nik");
  }
  return prepared;
}

/**
 * PLATE: uppercase, tanpa whitespace dan tanda hubung.
 *
 * Hanya whitespace dan `-` yang diperlakukan sebagai pemisah formatting;
 * karakter lain di luar alfanumerik menyebabkan penolakan, bukan pembuangan
 * diam-diam. Batas 2..20 karakter mengikuti golden vector yang disetujui
 * (contoh terpanjang 16 karakter) dengan margin, dan sengaja tidak mengunci
 * grammar plat regional yang belum diverifikasi.
 *
 * Blind index plat merepresentasikan IDENTIFIER plat saja. Kepemilikan
 * kendaraan adalah domain terpisah dan tidak boleh masuk ke sini.
 */
function canonicalizePlate(raw: string): string {
  const prepared = prepare(raw).toUpperCase().replace(/[\s-]+/g, "");
  if (!/^[A-Z0-9]{2,20}$/.test(prepared)) {
    throw formatError("plate");
  }
  return prepared;
}

// --- Service ------------------------------------------------------------------

export class IdentifierIndexService {
  constructor(
    private readonly registry: IdentifierKeyRegistry,
    private readonly onEvent: IdentifierEventSink = () => undefined
  ) {}

  get canonicalizationVersion(): number {
    return IDENTIFIER_CANONICALIZATION_VERSION;
  }

  /**
   * Canonical value untuk satu domain. Melempar sebelum HMAC bila domain tidak
   * aktif atau format tidak valid.
   */
  normalize(domain: IdentifierDomain, value: string): string {
    if (!ACTIVE_DOMAINS.has(domain)) {
      throw domainNotActiveError(domain);
    }
    if (typeof value !== "string") {
      throw formatError(domain);
    }
    return domain === "nik" ? canonicalizeNik(value) : canonicalizePlate(value);
  }

  /** Index dengan kunci tulis saat ini — dipakai untuk seluruh penulisan baru. */
  createIndex(domain: IdentifierDomain, value: string): BlindIndex {
    return this.indexWithKey(domain, this.normalize(domain, value), this.registry.currentVersion);
  }

  /**
   * Index untuk SELURUH versi kunci aktif, terurut menaik dan tanpa duplikat.
   *
   * Dual lookup hanya sah ketika identifier diberikan kembali melalui alur yang
   * sah — nilai mentah tidak pernah diambil dari database.
   */
  createLookupIndexes(domain: IdentifierDomain, value: string): BlindIndex[] {
    const canonical = this.normalize(domain, value);
    return this.registry.activeVersions.map((version) =>
      this.indexWithKey(domain, canonical, version)
    );
  }

  /** Perbandingan constant-time terhadap index tersimpan. */
  verifyIndex(domain: IdentifierDomain, value: string, stored: StoredBlindIndex): boolean {
    const canonical = this.normalize(domain, value);
    if (!this.registry.has(stored.keyVersion)) {
      this.onEvent({
        event: "identifier.unknown_key_version",
        domain,
        keyVersion: stored.keyVersion
      });
      return false;
    }
    const computed = this.indexWithKey(domain, canonical, stored.keyVersion);
    return timingSafeEqualHex(computed.value, stored.value);
  }

  /**
   * Rencana lazy migration — MURNI perhitungan, tanpa sentuhan database.
   *
   * Blind index lama tidak dapat dikonversi menjadi index baru tanpa canonical
   * raw identifier. Karena itu rencana hanya dapat dihasilkan pada saat
   * identifier diberikan kembali melalui alur yang sah. Tidak ada backfill
   * otomatis dan tidak ada fallback diam-diam.
   */
  planLazyMigration(
    domain: IdentifierDomain,
    value: string,
    stored: StoredBlindIndex
  ): LazyMigrationPlan {
    const canonical = this.normalize(domain, value);

    if (!this.registry.has(stored.keyVersion)) {
      // Kunci untuk baris ini sudah tidak tersedia: baris tidak dapat
      // diverifikasi maupun dimigrasikan.
      this.onEvent({
        event: "identifier.unknown_key_version",
        domain,
        keyVersion: stored.keyVersion
      });
      return { matched: false, state: "LEGACY_UNRECOVERABLE", needsMigration: false };
    }

    const computed = this.indexWithKey(domain, canonical, stored.keyVersion);
    const matched = timingSafeEqualHex(computed.value, stored.value);
    const isCurrentKey = stored.keyVersion === this.registry.currentVersion;
    const isCurrentCanon = stored.canonicalizationVersion === IDENTIFIER_CANONICALIZATION_VERSION;

    if (!matched) {
      return {
        matched: false,
        state: isCurrentKey && isCurrentCanon ? "CURRENT" : "LEGACY_PENDING_REVERIFICATION",
        needsMigration: false
      };
    }

    if (isCurrentKey && isCurrentCanon) {
      return {
        matched: true,
        matchedKeyVersion: stored.keyVersion,
        state: "CURRENT",
        needsMigration: false
      };
    }

    if (!isCurrentKey) {
      this.onEvent({
        event: "identifier.legacy_key_lookup",
        domain,
        keyVersion: stored.keyVersion
      });
    }

    return {
      matched: true,
      matchedKeyVersion: stored.keyVersion,
      state: "LEGACY_PENDING_REVERIFICATION",
      needsMigration: true,
      next: this.indexWithKey(domain, canonical, this.registry.currentVersion)
    };
  }

  private indexWithKey(
    domain: IdentifierDomain,
    canonical: string,
    keyVersion: number
  ): BlindIndex {
    const message = buildMessage(domain, IDENTIFIER_CANONICALIZATION_VERSION, canonical);
    const value = crypto
      .createHmac("sha256", this.registry.materialFor(keyVersion))
      .update(Buffer.from(message, "utf8"))
      .digest("hex");

    return {
      domain,
      value,
      keyVersion,
      canonicalizationVersion: IDENTIFIER_CANONICALIZATION_VERSION
    };
  }
}

/**
 * Pesan HMAC. Domain dan versi canonicalization menjadi bagian pesan sehingga
 * nilai yang sama pada domain atau versi berbeda menghasilkan index berbeda.
 */
export function buildMessage(
  domain: IdentifierDomain,
  canonicalizationVersion: number,
  canonical: string
): string {
  return `${IDENTIFIER_MESSAGE_PREFIX}|domain=${domain}|canonicalizationVersion=${canonicalizationVersion}|value=${canonical}`;
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (
    typeof right !== "string" ||
    left.length !== right.length ||
    left.length !== IDENTIFIER_INDEX_LENGTH
  ) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
