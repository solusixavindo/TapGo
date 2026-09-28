import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { googleAuthTestHooks, verifyGoogleIdToken } from "../../src/core/security/googleIdToken.js";
import { AppError } from "../../src/core/errors/AppError.js";

/**
 * Verifikasi ID token Google TANPA jaringan sungguhan: kunci RSA dibuat di
 * tempat, dan `googleAuthTestHooks.fetchJwks` diganti agar berperilaku
 * seperti endpoint JWKS Google tanpa pernah memanggilnya. Ini juga yang
 * membuktikan modul ini TIDAK bergantung pada `google-auth-library` (yang
 * mensyaratkan Node >=22, tidak cocok dengan produksi Node 20 — lihat
 * komentar di berkas sumbernya).
 */

const AUDIENCE = "test-client-id.apps.googleusercontent.com";

function makeKeypair(kid: string) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string; kty: string };
  return {
    privateKey,
    jwk: { kid, kty: jwk.kty, n: jwk.n, e: jwk.e }
  };
}

function signToken(
  privateKey: crypto.KeyObject,
  kid: string,
  overrides: Record<string, unknown> = {},
  options: jwt.SignOptions = {}
) {
  return jwt.sign(
    {
      email: "sandikanur404@gmail.com",
      email_verified: true,
      name: "Sandika Nur",
      ...overrides
    },
    privateKey,
    {
      algorithm: "RS256",
      keyid: kid,
      issuer: "https://accounts.google.com",
      audience: AUDIENCE,
      expiresIn: "1h",
      ...options
    }
  );
}

describe("verifyGoogleIdToken (tanpa google-auth-library)", () => {
  beforeEach(() => {
    googleAuthTestHooks.resetCache();
  });
  afterEach(() => {
    googleAuthTestHooks.resetCache();
    googleAuthTestHooks.fetchJwks = async () => [];
  });

  it("token sah dari kunci yang cocok di JWKS: lolos dan mengembalikan email + name", async () => {
    const { privateKey, jwk } = makeKeypair("kid-1");
    googleAuthTestHooks.fetchJwks = async () => [jwk];
    const token = signToken(privateKey, "kid-1");

    const result = await verifyGoogleIdToken(token, AUDIENCE);
    expect(result).toEqual({ email: "sandikanur404@gmail.com", name: "Sandika Nur" });
  });

  it("kid tidak ada di cache: satu kali paksa ambil ulang JWKS sebelum menyerah", async () => {
    const { privateKey, jwk } = makeKeypair("kid-baru");
    let calls = 0;
    googleAuthTestHooks.fetchJwks = async () => {
      calls += 1;
      // Panggilan pertama (memenuhi cache awal) belum tahu kunci baru;
      // panggilan kedua (dipicu kid tak dikenal) mensimulasikan rotasi
      // kunci Google yang baru saja terjadi.
      return calls === 1 ? [] : [jwk];
    };
    const token = signToken(privateKey, "kid-baru");

    const result = await verifyGoogleIdToken(token, AUDIENCE);
    expect(result.email).toBe("sandikanur404@gmail.com");
    expect(calls).toBe(2);
  });

  it("tanda tangan dipalsukan (kunci privat lain, kid mengklaim kunci sah): ditolak", async () => {
    const { jwk } = makeKeypair("kid-1");
    const forged = makeKeypair("kid-lain").privateKey;
    googleAuthTestHooks.fetchJwks = async () => [jwk];
    // Token ditandatangani kunci LAIN tetapi header kid mengklaim "kid-1".
    const token = jwt.sign(
      { email: "korban@gmail.com", email_verified: true },
      forged,
      { algorithm: "RS256", keyid: "kid-1", issuer: "https://accounts.google.com", audience: AUDIENCE, expiresIn: "1h" }
    );

    await expect(verifyGoogleIdToken(token, AUDIENCE)).rejects.toMatchObject({ code: "GOOGLE_TOKEN_INVALID" });
  });

  it("audience tidak cocok: ditolak (idToken untuk client lain tidak boleh diterima)", async () => {
    const { privateKey, jwk } = makeKeypair("kid-1");
    googleAuthTestHooks.fetchJwks = async () => [jwk];
    const token = signToken(privateKey, "kid-1", {}, { audience: "client-lain.apps.googleusercontent.com" });

    await expect(verifyGoogleIdToken(token, AUDIENCE)).rejects.toMatchObject({ code: "GOOGLE_TOKEN_INVALID" });
  });

  it("issuer bukan Google: ditolak", async () => {
    const { privateKey, jwk } = makeKeypair("kid-1");
    googleAuthTestHooks.fetchJwks = async () => [jwk];
    const token = signToken(privateKey, "kid-1", {}, { issuer: "https://evil.example.com" });

    await expect(verifyGoogleIdToken(token, AUDIENCE)).rejects.toMatchObject({ code: "GOOGLE_TOKEN_INVALID" });
  });

  it("token kedaluwarsa: ditolak", async () => {
    const { privateKey, jwk } = makeKeypair("kid-1");
    googleAuthTestHooks.fetchJwks = async () => [jwk];
    const token = signToken(privateKey, "kid-1", {}, { expiresIn: "-1h" });

    await expect(verifyGoogleIdToken(token, AUDIENCE)).rejects.toMatchObject({ code: "GOOGLE_TOKEN_INVALID" });
  });

  it("email belum diverifikasi Google: ditolak dengan kode berbeda (bukan token invalid)", async () => {
    const { privateKey, jwk } = makeKeypair("kid-1");
    googleAuthTestHooks.fetchJwks = async () => [jwk];
    const token = signToken(privateKey, "kid-1", { email_verified: false });

    await expect(verifyGoogleIdToken(token, AUDIENCE)).rejects.toMatchObject({ code: "GOOGLE_EMAIL_NOT_VERIFIED" });
  });

  it("kid sama sekali tidak dikenal walau setelah retry: ditolak, bukan crash", async () => {
    const { privateKey, jwk } = makeKeypair("kid-1");
    googleAuthTestHooks.fetchJwks = async () => [jwk];
    const token = signToken(privateKey, "kid-tidak-pernah-ada");

    const error = await verifyGoogleIdToken(token, AUDIENCE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("GOOGLE_TOKEN_INVALID");
  });

  it("token bukan JWT sama sekali: ditolak, bukan crash", async () => {
    await expect(verifyGoogleIdToken("bukan-jwt-sama-sekali", AUDIENCE)).rejects.toMatchObject({
      code: "GOOGLE_TOKEN_INVALID"
    });
  });
});
