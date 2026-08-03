import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
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

/**
 * Merakit JWT HS256 secara manual.
 *
 * Diperlukan karena `jwt.sign` menolak membuat token dengan `iat` non-numerik,
 * sedangkan penyerang tidak terikat batasan library. Tanpa ini, jalur
 * fail-closed untuk `iat` malformed tidak dapat diuji sama sekali.
 */
function signRawJwt(payload: Record<string, unknown>, secret: string): string {
  const b64 = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${signature}`;
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

  it("6. token tanpa iat atau dengan iat malformed ditolak (fail-closed)", async () => {
    const { user, phone } = await createAccount();
    const { accessToken } = await login(phone, OLD_PASSWORD);

    // Satu detik penuh dilewati sebelum epoch diaktifkan. Perbandingan
    // pencabutan bekerja pada granularitas detik, sehingga tanpa jeda ini
    // token lama berada pada detik yang SAMA dengan epoch dan memang sah
    // diterima — itu perilaku yang benar, bukan yang sedang diuji di sini.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await prisma.user.update({
      where: { id: user.id },
      data: { sessionsRevokedAt: new Date() }
    });

    const secret = process.env.JWT_ACCESS_SECRET!;
    const claims = { sub: user.id, role: "USER", sessionId: "00000000-0000-4000-8000-000000000000" };
    const signOptions = { issuer: "tapgo-api", audience: "tapgo-apps" } as const;

    // (a) tanpa iat sama sekali — jsonwebtoken menghilangkannya dengan noTimestamp
    const withoutIat = jwt.sign(claims, secret, { ...signOptions, noTimestamp: true });
    const decodedWithoutIat = jwt.decode(withoutIat) as Record<string, unknown>;
    expect(decodedWithoutIat.iat).toBeUndefined();

    const noIatResponse = await api("GET", "/api/v1/auth/me", undefined, withoutIat);
    expect(noIatResponse.status).toBe(401);
    expect(noIatResponse.body.code).toBe("AUTH_SESSION_REVOKED");

    // (b) iat bukan angka. `jwt.sign` menolak membuatnya, sehingga token
    // dirakit manual — persis seperti yang akan dilakukan penyerang.
    const malformed = signRawJwt({ ...claims, iat: "bukan-angka", iss: "tapgo-api", aud: "tapgo-apps" }, secret);
    const malformedResponse = await api("GET", "/api/v1/auth/me", undefined, malformed);
    expect(malformedResponse.status).toBe(401);

    // Token lama yang sah pun tetap ditolak — epoch aktif.
    const oldResponse = await api("GET", "/api/v1/auth/me", undefined, accessToken);
    expect(oldResponse.status).toBe(401);
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
});
