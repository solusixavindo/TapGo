import crypto from "node:crypto";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { authRateLimiter, registerPhoneRateLimiter } from "../../src/core/security/rateLimit.js";
import { googleAuthTestHooks } from "../../src/core/security/googleIdToken.js";
import { normalizePhoneNumber } from "../../src/core/security/phone.js";

/**
 * Daftar/masuk dengan Google (driver_app), endpoint POST /auth/google dan
 * /auth/google/complete.
 *
 * Ini fitur yang SUDAH DIPAKAI klien driver_app (lib/features/driver/data/
 * api_driver_repository.dart memanggil kedua path ini persis) tetapi belum
 * pernah punya endpoint server sampai berkas ini ditulis — sebelumnya kedua
 * panggilan itu selalu 404. Yang dijaga di sini, berurut dari yang paling
 * berbahaya bila gagal:
 * 1. Identitas HANYA dari ID token yang lolos verifikasi kriptografis —
 *    body permintaan tidak pernah dipercaya untuk email.
 * 2. Akun baru selalu USER (role tidak pernah diperoleh dari klien).
 * 3. Akun yang statusnya bukan ACTIVE tidak bisa masuk lewat jalur ini.
 * 4. Registrasi tahap 2 menolak email/nomor HP yang sudah dipakai.
 */

const AUDIENCE = "test-google-client.apps.googleusercontent.com";

let appServer: Server | undefined;
let baseUrl = "";
let sequence = 0;

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    authRateLimiter.resetKey(key);
    registerPhoneRateLimiter.resetKey(key);
  }
}

function nextPhone() {
  sequence += 1;
  return `+62813${String(sequence).padStart(8, "0")}`;
}

/** Cocok dengan bentuk tersimpan di DB (normalizePhoneNumber mengubah +62 -> 0). */
function storedPhone(phone: string) {
  return normalizePhoneNumber(phone);
}

function makeGoogleKeypair(kid: string) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string; kty: string };
  return { privateKey, jwk: { kid, kty: jwk.kty, n: jwk.n, e: jwk.e } };
}

let googleKeys: ReturnType<typeof makeGoogleKeypair>;

function googleIdToken(overrides: Record<string, unknown> = {}) {
  return jwt.sign(
    { email: "sandikanur404@gmail.com", email_verified: true, name: "Sandika Nur", ...overrides },
    googleKeys.privateKey,
    {
      algorithm: "RS256",
      keyid: googleKeys.jwk.kid,
      issuer: "https://accounts.google.com",
      audience: AUDIENCE,
      expiresIn: "1h"
    }
  );
}

async function postGoogleAuth(idToken: string) {
  const res = await fetch(`${baseUrl}/api/v1/auth/google`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function postGoogleComplete(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/v1/auth/google/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe.skipIf(!runIntegration)("Daftar/masuk dengan Google (driver_app)", () => {
  let backendEnv: typeof import("../../src/config/env.js").env;
  let previousClientId: string | undefined;

  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "google-auth-access-secret-000000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "google-auth-refresh-secret-00000000";

    const [{ createApp }, envModule] = await Promise.all([import("../../src/app.js"), import("../../src/config/env.js")]);
    backendEnv = envModule.env;
    previousClientId = backendEnv.GOOGLE_OAUTH_CLIENT_ID;
    backendEnv.GOOGLE_OAUTH_CLIENT_ID = AUDIENCE;

    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    resetRateLimits();
    googleKeys = makeGoogleKeypair(`kid-${++sequence}`);
    googleAuthTestHooks.resetCache();
    googleAuthTestHooks.fetchJwks = async () => [googleKeys.jwk];
    await prisma.registrationEvent.deleteMany();
    await prisma.session.deleteMany();
    await prisma.walletTransaction.deleteMany();
    await prisma.wallet.deleteMany();
    await prisma.referralLevel.deleteMany();
    await prisma.referral.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    googleAuthTestHooks.resetCache();
    googleAuthTestHooks.fetchJwks = async () => [];
  });

  afterAll(async () => {
    backendEnv.GOOGLE_OAUTH_CLIENT_ID = previousClientId;
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  it("email Google belum terdaftar: needsPhone true, tidak membuat akun apa pun", async () => {
    const res = await postGoogleAuth(googleIdToken());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ needsPhone: true, suggestedFullName: "Sandika Nur" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("lengkapi nomor HP: akun USER baru dibuat, email langsung terverifikasi, sesi terbit", async () => {
    const phone = nextPhone();
    const res = await postGoogleComplete({ idToken: googleIdToken(), phone });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty("accessToken");

    const created = await prisma.user.findFirstOrThrow({ where: { phone: storedPhone(phone) } });
    expect(created.role).toBe("USER");
    expect(created.email).toBe("sandikanur404@gmail.com");
    expect(created.emailVerifiedAt).not.toBeNull();
    expect(created.passwordHash).not.toBeNull();
  });

  it("akun sudah ada (email cocok): googleAuth langsung login, TIDAK membuat akun baru maupun mengubah passwordnya", async () => {
    const phone = nextPhone();
    await postGoogleComplete({ idToken: googleIdToken(), phone });
    const before = await prisma.user.findFirstOrThrow({ where: { phone: storedPhone(phone) } });

    // Sesi Google BERBEDA (kid/keypair baru) tetapi email sama, seperti login
    // ulang hari lain — bukan token yang sama dipakai ulang.
    googleKeys = makeGoogleKeypair(`kid-relogin-${sequence}`);
    googleAuthTestHooks.resetCache();
    googleAuthTestHooks.fetchJwks = async () => [googleKeys.jwk];

    const res = await postGoogleAuth(googleIdToken());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ needsPhone: false });
    expect(res.body.data).toHaveProperty("accessToken");

    expect(await prisma.user.count({ where: { phone: storedPhone(phone) } })).toBe(1);
    const after = await prisma.user.findFirstOrThrow({ where: { phone: storedPhone(phone) } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("akun berstatus bukan ACTIVE: ditolak walau ID token sah", async () => {
    const phone = nextPhone();
    await postGoogleComplete({ idToken: googleIdToken(), phone });
    await prisma.user.updateMany({ where: { phone: storedPhone(phone) }, data: { status: "SUSPENDED" } });

    googleKeys = makeGoogleKeypair(`kid-suspended-${sequence}`);
    googleAuthTestHooks.resetCache();
    googleAuthTestHooks.fetchJwks = async () => [googleKeys.jwk];

    const res = await postGoogleAuth(googleIdToken());
    expect(res.status).toBe(403);
  });

  it("email sudah dipakai akun lain: registrasi tahap 2 ditolak 409, tidak membuat akun kedua", async () => {
    const phone1 = nextPhone();
    await postGoogleComplete({ idToken: googleIdToken(), phone: phone1 });

    googleKeys = makeGoogleKeypair(`kid-dup-${sequence}`);
    googleAuthTestHooks.resetCache();
    googleAuthTestHooks.fetchJwks = async () => [googleKeys.jwk];

    const res = await postGoogleComplete({ idToken: googleIdToken(), phone: nextPhone() });
    expect(res.status).toBe(409);
    expect(await prisma.user.count()).toBe(1);
  });

  it("nomor HP sudah dipakai akun lain: registrasi tahap 2 ditolak 409", async () => {
    const takenPhone = nextPhone();
    await prisma.user.create({
      data: {
        fullName: "Pemilik Nomor",
        // Disimpan dalam bentuk ternormalisasi, persis seperti registrasi
        // sungguhan (phoneSchema selalu mentransformasi sebelum menyentuh DB)
        // — memakai bentuk mentah di sini akan membuat pengecekan duplikat di
        // bawah gagal mencocokkan, dan pengujian ini kehilangan maknanya.
        phone: storedPhone(takenPhone),
        referralCode: `TAKEN${sequence}`,
        passwordHash: "irrelevant"
      }
    });

    const res = await postGoogleComplete({ idToken: googleIdToken({ email: "lain@gmail.com" }), phone: takenPhone });
    expect(res.status).toBe(409);
  });

  it("ID token dengan tanda tangan tidak sah: ditolak 401, tidak membuat akun", async () => {
    const forged = makeGoogleKeypair("kid-lain").privateKey;
    const token = jwt.sign(
      { email: "penipu@gmail.com", email_verified: true },
      forged,
      { algorithm: "RS256", keyid: googleKeys.jwk.kid, issuer: "https://accounts.google.com", audience: AUDIENCE, expiresIn: "1h" }
    );
    const res = await postGoogleAuth(token);
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(0);
  });

  it("body permintaan tidak dapat memalsukan email: field email di body diabaikan, hanya ID token yang dipercaya", async () => {
    const phone = nextPhone();
    const res = await fetch(`${baseUrl}/api/v1/auth/google/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // "email" bukan field yang dikenal skema, tetapi bahkan bila lolos
      // validasi, service tidak pernah membacanya dari body.
      body: JSON.stringify({ idToken: googleIdToken(), phone, email: "palsu@evil.com" })
    });
    expect(res.status).toBe(201);
    const created = await prisma.user.findFirstOrThrow({ where: { phone: storedPhone(phone) } });
    expect(created.email).toBe("sandikanur404@gmail.com");
  });

  it("GOOGLE_OAUTH_CLIENT_ID belum diisi di server: 503 fail-closed, bukan lolos tanpa verifikasi", async () => {
    backendEnv.GOOGLE_OAUTH_CLIENT_ID = undefined;
    try {
      const res = await postGoogleAuth(googleIdToken());
      expect(res.status).toBe(503);
    } finally {
      backendEnv.GOOGLE_OAUTH_CLIENT_ID = AUDIENCE;
    }
  });
});
