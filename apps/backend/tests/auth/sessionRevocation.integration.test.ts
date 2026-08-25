import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration } from "../helpers/referralWalletHarness.js";
import { RecordingOtpProvider } from "../../src/modules/auth/infrastructure/RecordingOtpProvider.js";
import {
  resetOtpDeliveryProvider,
  setOtpDeliveryProvider
} from "../../src/modules/auth/infrastructure/otpProviderRegistry.js";
import { hashPassword } from "../../src/core/security/passwordHasher.js";

/**
 * Stage R2.1 — pencabutan sesi harus bertahan melewati integrasi.
 *
 * Integrasi merefaktor verifikasi JWT ke helper verifyToken() yang semula
 * mengembalikan AccessTokenPayload tanpa `iat`. Auth membutuhkan `iat` untuk
 * membandingkan umur token terhadap users.sessions_revoked_at.
 *
 * Bila konflik itu diselesaikan dengan membuang `iat`, seluruh test di bawah
 * akan gagal — dan itulah gunanya berkas ini: mencegah pencabutan sesi
 * berhenti bekerja secara diam-diam pada integrasi berikutnya.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";
const provider = new RecordingOtpProvider();
let sequence = 0;

const OLD_PASSWORD = "PasswordLama12";
const NEW_PASSWORD = "PasswordBaru99";

type ApiResponse = {
  status: number;
  body: { success?: boolean; code?: string; data?: Record<string, unknown> };
};

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

async function createAccount() {
  sequence += 1;
  const phone = `08${String(600000000 + sequence)}`;
  const user = await prisma.user.create({
    data: {
      fullName: `Revocation User ${sequence}`,
      phone,
      referralCode: `REV${String(sequence).padStart(6, "0")}`,
      passwordHash: await hashPassword(OLD_PASSWORD)
    }
  });
  return { user, phone };
}

async function login(phone: string, password: string) {
  const response = await api("POST", "/api/v1/auth/login", { phone, password });
  expect(response.status).toBe(200);
  return {
    accessToken: response.body.data?.accessToken as string,
    refreshToken: response.body.data?.refreshToken as string
  };
}

/** Menjalankan pemulihan sampai password benar-benar berganti. */
async function resetPasswordVia(phone: string) {
  provider.reset();
  await api("POST", "/api/v1/auth/recovery/request", { identifier: phone });
  const code = provider.lastCode();
  const verified = await api("POST", "/api/v1/auth/recovery/verify", {
    identifier: phone,
    code
  });
  expect(verified.status).toBe(200);
  const reset = await api("POST", "/api/v1/auth/recovery/reset", {
    resetToken: verified.body.data?.resetToken,
    newPassword: NEW_PASSWORD
  });
  expect(reset.status).toBe(200);
}

describeIntegration("Stage R2.1 — session revocation survives integration", () => {
  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-please-change-000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-please-change-00000";
    process.env.AUTH_RECOVERY_HMAC_SECRET =
      "PUBLIC SYNTHETIC TEST SECRET - NEVER USE IN PRODUCTION - TAPGO RECOVERY";

    const { createApp } = await import("../../src/app.js");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    setOtpDeliveryProvider(provider);
  });

  afterAll(async () => {
    resetOtpDeliveryProvider();
    // Dibersihkan di kedua ujung. Tanpa ini, baris yang tersisa terbawa ke
    // file test berikutnya dan menggagalkan snapshot finansial di sana.
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    provider.reset();
    await cleanDatabase();
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.authRateLimiter.resetKey(key);
      limiters.recoveryIpRateLimiter.resetKey(key);
      limiters.apiRateLimiter.resetKey(key);
    }
  });

  it("1. token lama valid SEBELUM reset", async () => {
    const { phone } = await createAccount();
    const { accessToken } = await login(phone, OLD_PASSWORD);

    const response = await api("GET", "/api/v1/auth/me", undefined, accessToken);

    expect(response.status).toBe(200);
  });

  it("2. reset password mengubah revocation epoch di database", async () => {
    const { user, phone } = await createAccount();
    expect(user.sessionsRevokedAt).toBeNull();

    await resetPasswordVia(phone);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.sessionsRevokedAt).not.toBeNull();
    expect(after.sessionsRevokedAt!.getTime()).toBeGreaterThan(user.createdAt.getTime() - 1000);
  });

  it("3. token lama ditolak AUTH_SESSION_REVOKED setelah reset", async () => {
    const { phone } = await createAccount();
    const { accessToken } = await login(phone, OLD_PASSWORD);
    expect((await api("GET", "/api/v1/auth/me", undefined, accessToken)).status).toBe(200);

    // `iat` hanya berpresisi detik, jadi satu detik penuh dilewati agar token
    // benar-benar mendahului epoch pencabutan.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await resetPasswordVia(phone);

    const response = await api("GET", "/api/v1/auth/me", undefined, accessToken);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTH_SESSION_REVOKED");
  });

  it("4. refresh token lama ditolak setelah reset", async () => {
    const { phone } = await createAccount();
    const { refreshToken } = await login(phone, OLD_PASSWORD);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await resetPasswordVia(phone);

    const response = await api("POST", "/api/v1/auth/refresh", { refreshToken });
    expect(response.status).toBe(401);
  });

  it("5. token baru setelah reset dapat dipakai", async () => {
    const { phone } = await createAccount();
    await login(phone, OLD_PASSWORD);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await resetPasswordVia(phone);

    const fresh = await login(phone, NEW_PASSWORD);
    const response = await api("GET", "/api/v1/auth/me", undefined, fresh.accessToken);

    expect(response.status).toBe(200);
  });

  it("6. sessionsRevokedAt kini murni audit dan tidak lagi memutuskan otorisasi", async () => {
    const { user, phone } = await createAccount();
    const { accessToken } = await login(phone, OLD_PASSWORD);

    // Sebelum Stage R2.1A, menetapkan kolom ini saja sudah mencabut token.
    // Sekarang kolomnya hanya jejak audit; keputusan otorisasi memakai
    // authVersion, yang sengaja TIDAK diubah di sini.
    await prisma.user.update({
      where: { id: user.id },
      data: { sessionsRevokedAt: new Date(Date.now() + 60_000) }
    });

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.sessionsRevokedAt).not.toBeNull();
    expect(stored.authVersion).toBe(0);

    // Token tetap sah karena versinya masih cocok. Pengujian fail-closed
    // untuk claim versi yang hilang atau malformed berada di
    // versionedRevocation.integration.test.ts.
    expect((await api("GET", "/api/v1/auth/me", undefined, accessToken)).status).toBe(200);
  });

  it("7. epoch pencabutan tidak mengganggu akun yang tidak pernah reset", async () => {
    const { user, phone } = await createAccount();
    const { accessToken } = await login(phone, OLD_PASSWORD);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.sessionsRevokedAt).toBeNull();

    // sessionsRevokedAt NULL berarti tidak ada epoch untuk ditegakkan; token
    // tetap berlaku sampai kedaluwarsa sendiri.
    expect((await api("GET", "/api/v1/auth/me", undefined, accessToken)).status).toBe(200);
  });

  it("8. reuse refresh token lama ditolak walau rotasi terjadi pada detik yang sama", async () => {
    const { phone } = await createAccount();
    const { refreshToken } = await login(phone, OLD_PASSWORD);

    // Tanpa jeda: refresh berikutnya mendarat pada detik yang sama dengan
    // penerbitan token. Tanpa klaim jwtid unik, token hasil rotasi berbunyi
    // byte-identik dengan token lama dan reuse tidak pernah terdeteksi.
    const first = await api("POST", "/api/v1/auth/refresh", { refreshToken });
    expect(first.status).toBe(200);

    const replay = await api("POST", "/api/v1/auth/refresh", { refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe("TOKEN_REUSE_DETECTED");
  });
});
