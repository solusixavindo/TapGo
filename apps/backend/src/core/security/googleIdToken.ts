import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../errors/AppError.js";

/**
 * Verifikasi ID token Google TANPA paket `google-auth-library`.
 *
 * `google-auth-library` versi terbaru mensyaratkan Node >=22 (lihat catatan
 * yang sama persis di FcmClient.ts — ServiceAccountTokenProvider di sana
 * dibangun dengan alasan ini juga), sedangkan produksi TapGo memakai Node 20
 * (lihat `engines` di package.json root). Menambahkannya sebagai dependency
 * auth akan lolos build lokal tetapi berisiko gagal/berperilaku tak terduga
 * di VPS. Sebagai gantinya, verifikasi tanda tangan dilakukan dengan
 * `jsonwebtoken` (sudah dipakai untuk access/refresh token TapGo sendiri,
 * lihat core/security/tokenService.ts) terhadap kunci publik Google yang
 * diambil dari JWKS resminya — pola yang sama dengan cara ServiceAccount
 * FCM menandatangani (node:crypto), hanya arahnya terbalik (verify, bukan
 * sign).
 */

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
/// Google merotasi kuncinya berkala tetapi jarang (biasanya harian); 6 jam
/// cukup untuk mengurangi permintaan berulang tanpa memakai kunci yang sudah
/// lama dicabut. `kid` yang tidak ditemukan di cache tetap memicu satu kali
/// pengambilan ulang paksa (lihat di bawah), jadi rotasi tak terduga tetap
/// tertangani tanpa menunggu TTL habis.
const JWKS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GOOGLE_ISSUERS: [string, string] = ["accounts.google.com", "https://accounts.google.com"];

type GoogleJwk = { kid: string; kty: string; n: string; e: string };

async function fetchGoogleJwksFromNetwork(): Promise<GoogleJwk[]> {
  const response = await fetch(GOOGLE_JWKS_URL);
  if (!response.ok) {
    throw new Error(`Google JWKS fetch failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { keys?: GoogleJwk[] };
  return body.keys ?? [];
}

/**
 * Seam uji: satu-satunya jalan mengganti sumber JWKS tanpa jaringan
 * sungguhan, dan mengosongkan cache in-memory antar uji. Mengikuti pola yang
 * sama dengan `backendEnv.SOME_FLAG = value` di tempat lain pada test suite
 * ini — properti pada objek yang diekspor, bukan binding modul langsung
 * (ESM tidak mengizinkan reassignment binding dari luar modul).
 */
export const googleAuthTestHooks = {
  fetchJwks: fetchGoogleJwksFromNetwork as () => Promise<GoogleJwk[]>,
  resetCache(): void {
    jwksCache = null;
  }
};

let jwksCache: { fetchedAt: number; keys: GoogleJwk[] } | null = null;

async function getGoogleJwks(forceRefresh: boolean): Promise<GoogleJwk[]> {
  const now = Date.now();
  if (!forceRefresh && jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  const keys = await googleAuthTestHooks.fetchJwks();
  jwksCache = { fetchedAt: now, keys };
  return keys;
}

export type GoogleIdTokenPayload = {
  email: string;
  name?: string;
};

function invalidToken(): never {
  throw new AppError("Token Google tidak valid.", StatusCodes.UNAUTHORIZED, "GOOGLE_TOKEN_INVALID");
}

/**
 * Memverifikasi tanda tangan RS256, `iss`, `aud`, dan masa berlaku ID token
 * Google, lalu memastikan emailnya sudah diverifikasi Google sendiri.
 *
 * `audience` HARUS sama dengan Web OAuth client ID yang didaftarkan sebagai
 * `serverClientId` di klien Android (lihat komentar di driver_app), supaya
 * token yang diverifikasi di sini benar-benar audience yang sama dengan yang
 * diminta backend — bukan audience client Android yang berbeda.
 */
export async function verifyGoogleIdToken(idToken: string, audience: string): Promise<GoogleIdTokenPayload> {
  const decoded = jwt.decode(idToken, { complete: true });
  const kid =
    decoded && typeof decoded === "object" && decoded.header && typeof decoded.header.kid === "string"
      ? decoded.header.kid
      : undefined;
  if (!kid) invalidToken();

  let jwk = (await getGoogleJwks(false)).find((k) => k.kid === kid);
  if (!jwk) {
    // kid tidak dikenal: mungkin Google baru saja merotasi kuncinya di luar
    // jadwal TTL cache kita. Satu kali paksa ambil ulang sebelum menyerah.
    jwk = (await getGoogleJwks(true)).find((k) => k.kid === kid);
  }
  if (!jwk) invalidToken();

  let publicKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
  } catch {
    invalidToken();
  }

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(idToken, publicKey, {
      algorithms: ["RS256"],
      audience,
      issuer: GOOGLE_ISSUERS
    });
  } catch {
    invalidToken();
  }
  if (typeof payload !== "object" || payload === null) invalidToken();

  const claims = payload as Record<string, unknown>;
  const email = typeof claims.email === "string" ? claims.email : undefined;
  if (!email || claims.email_verified !== true) {
    throw new AppError(
      "Akun Google tidak memiliki email terverifikasi.",
      StatusCodes.BAD_REQUEST,
      "GOOGLE_EMAIL_NOT_VERIFIED"
    );
  }
  return { email, ...(typeof claims.name === "string" ? { name: claims.name } : {}) };
}
