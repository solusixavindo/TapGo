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
 * Stage R2.1A — pencabutan sesi berbasis VERSI.
 *
 * Pendekatan lama membandingkan `iat` token dengan sessions_revoked_at. Karena
 * `iat` hanya berpresisi detik, token yang diterbitkan pada detik yang sama
 * dengan pencabutan lolos — dan begitu lolos, ia tetap sah sampai TTL 15
 * menitnya habis. Berkas ini mengunci perilaku pengganti yang berbasis
 * bilangan bulat dan bebas dari presisi jam.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";
const provider = new RecordingOtpProvider();
let sequence = 0;

const OLD_PASSWORD = "PasswordLama12";
const NEW_PASSWORD = "PasswordBaru99";
const SECOND_PASSWORD = "PasswordKetiga77";

type ApiResponse = {
  status: number;
  body: { code?: string; data?: Record<string, unknown> };
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
 * Merakit JWT HS256 manual agar claim versi dapat dibuat dalam bentuk apa pun
 * — termasuk bentuk yang ditolak `jwt.sign`. Penyerang tidak terikat library.
 */
function signRawJwt(payload: Record<string, unknown>, secret: string): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    iss: "tapgo-api",
    aud: "tapgo-apps",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
    ...payload
  });
  const signature = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${signature}`;
}

async function createAccount() {
  sequence += 1;
  const phone = `08${String(500000000 + sequence)}`;
  const user = await prisma.user.create({
    data: {
      fullName: `Version User ${sequence}`,
      phone,
      referralCode: `VRS${String(sequence).padStart(6, "0")}`,
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

async function resetPasswordVia(phone: string, newPassword: string) {
  provider.reset();
  const requested = await api("POST", "/api/v1/auth/recovery/request", { identifier: phone });
  expect(requested.status).toBe(202);
  const verified = await api("POST", "/api/v1/auth/recovery/verify", {
    identifier: phone,
    code: provider.lastCode()
  });
  expect(verified.status).toBe(200);
  const reset = await api("POST", "/api/v1/auth/recovery/reset", {
    resetToken: verified.body.data?.resetToken,
    newPassword
  });
  expect(reset.status).toBe(200);
}

function decodeVersion(token: string): unknown {
  return (jwt.decode(token) as Record<string, unknown>).authVersion;
}

describeIntegration("Stage R2.1A — versioned session revocation", () => {
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

  it("1. token version 0 valid saat database version 0", async () => {
    const { user, phone } = await createAccount();
    expect(user.authVersion).toBe(0);

    const { accessToken } = await login(phone, OLD_PASSWORD);
    expect(decodeVersion(accessToken)).toBe(0);

    expect((await api("GET", "/api/v1/auth/me", undefined, accessToken)).status).toBe(200);
  });

  it("2. reset menaikkan version 0 -> 1", async () => {
    const { user, phone } = await createAccount();

    await resetPasswordVia(phone, NEW_PASSWORD);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.authVersion).toBe(1);
  });

  it("3. token version 0 ditolak setelah increment", async () => {
    const { phone } = await createAccount();
    const { accessToken } = await login(phone, OLD_PASSWORD);
    expect(decodeVersion(accessToken)).toBe(0);

    await resetPasswordVia(phone, NEW_PASSWORD);

    const response = await api("GET", "/api/v1/auth/me", undefined, accessToken);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTH_SESSION_REVOKED");
  });

  it("4. token TANPA version ditolak setelah increment, diterima saat version 0", async () => {
    const { user, phone } = await createAccount();
    const secret = process.env.JWT_ACCESS_SECRET!;
    const legacy = signRawJwt(
      { sub: user.id, role: "USER", sessionId: crypto.randomUUID() },
      secret
    );

    // Kompatibilitas: selama akun masih pada versi awal, token lama diterima.
    expect((await api("GET", "/api/v1/auth/me", undefined, legacy)).status).toBe(200);

    await resetPasswordVia(phone, NEW_PASSWORD);

    // Setelah pencabutan pertama, token tanpa versi tidak lagi diterima.
    const response = await api("GET", "/api/v1/auth/me", undefined, legacy);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTH_SESSION_REVOKED");
  });

  it("5. version malformed ditolak fail-closed", async () => {
    const { user } = await createAccount();
    const secret = process.env.JWT_ACCESS_SECRET!;
    const base = { sub: user.id, role: "USER", sessionId: crypto.randomUUID() };

    // Seluruh bentuk ini harus ditolak meski akun masih pada versi 0, karena
    // claim-nya ADA tetapi tidak sah. Tidak ada koersi, tidak ada fallback.
    const malformedVersions: unknown[] = ["0", "satu", 0.5, -1, null, true, [], {}];

    for (const value of malformedVersions) {
      const token = signRawJwt({ ...base, authVersion: value }, secret);
      const response = await api("GET", "/api/v1/auth/me", undefined, token);
      expect(response.status, `authVersion=${JSON.stringify(value)}`).toBe(401);
    }

    // NaN dan Infinity tidak dapat direpresentasikan JSON; keduanya menjadi
    // null saat serialisasi dan sudah tercakup di atas.
    const nanToken = signRawJwt({ ...base, authVersion: Number.NaN }, secret);
    expect((await api("GET", "/api/v1/auth/me", undefined, nanToken)).status).toBe(401);
  });

  it("6. token version 1 langsung valid setelah reset, termasuk detik yang sama", async () => {
    const { phone } = await createAccount();
    await login(phone, OLD_PASSWORD);

    // Sengaja TANPA jeda apa pun: login dilakukan sesegera mungkin setelah
    // reset. Inilah kasus yang gagal pada pendekatan berbasis waktu.
    await resetPasswordVia(phone, NEW_PASSWORD);
    const fresh = await login(phone, NEW_PASSWORD);

    expect(decodeVersion(fresh.accessToken)).toBe(1);
    expect((await api("GET", "/api/v1/auth/me", undefined, fresh.accessToken)).status).toBe(200);
  });

  it("7. refresh token lama ditolak setelah reset", async () => {
    const { phone } = await createAccount();
    const { refreshToken } = await login(phone, OLD_PASSWORD);

    await resetPasswordVia(phone, NEW_PASSWORD);

    const response = await api("POST", "/api/v1/auth/refresh", { refreshToken });
    expect(response.status).toBe(401);
  });

  it("8. reset serentak hanya menghasilkan state yang konsisten", async () => {
    const { user, phone } = await createAccount();

    // Dua reset token sah diterbitkan lebih dulu, lalu dikonsumsi bersamaan.
    provider.reset();
    await api("POST", "/api/v1/auth/recovery/request", { identifier: phone });
    const verified = await api("POST", "/api/v1/auth/recovery/verify", {
      identifier: phone,
      code: provider.lastCode()
    });
    const token = verified.body.data?.resetToken as string;

    const results = await Promise.all([
      api("POST", "/api/v1/auth/recovery/reset", { resetToken: token, newPassword: NEW_PASSWORD }),
      api("POST", "/api/v1/auth/recovery/reset", { resetToken: token, newPassword: SECOND_PASSWORD })
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // Tepat satu increment: konsumsi atomik mencegah versi melompat dua.
    expect(after.authVersion).toBe(1);
  });

  it("9. reset kedua menaikkan 1 -> 2 dan menolak seluruh token version 1", async () => {
    const { user, phone } = await createAccount();

    await resetPasswordVia(phone, NEW_PASSWORD);
    const afterFirst = await login(phone, NEW_PASSWORD);
    expect(decodeVersion(afterFirst.accessToken)).toBe(1);

    await resetPasswordVia(phone, SECOND_PASSWORD);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.authVersion).toBe(2);

    const response = await api("GET", "/api/v1/auth/me", undefined, afterFirst.accessToken);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTH_SESSION_REVOKED");

    const afterSecond = await login(phone, SECOND_PASSWORD);
    expect(decodeVersion(afterSecond.accessToken)).toBe(2);
    expect((await api("GET", "/api/v1/auth/me", undefined, afterSecond.accessToken)).status).toBe(200);
  });

  it("10. password, session, challenge, dan version diperbarui atomik", async () => {
    const { user, phone } = await createAccount();
    await login(phone, OLD_PASSWORD);

    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await resetPasswordVia(phone, NEW_PASSWORD);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    // Keempatnya berubah bersama-sama.
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.authVersion).toBe(before.authVersion + 1);
    expect(after.sessionsRevokedAt).not.toBeNull();

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);

    const openChallenges = await prisma.authChallenge.count({
      where: { userId: user.id, consumedAt: null }
    });
    expect(openChallenges).toBe(0);

    // Password lama benar-benar tidak berlaku lagi.
    const oldLogin = await api("POST", "/api/v1/auth/login", {
      phone,
      password: OLD_PASSWORD
    });
    expect(oldLogin.status).toBe(401);
  });

  it("11. state finansial identik sebelum dan sesudah pencabutan berversi", async () => {
    const { phone } = await createAccount();

    const snapshot = async () => ({
      wallets: await prisma.wallet.count(),
      walletTransactions: await prisma.walletTransaction.count(),
      commissions: await prisma.commission.count(),
      withdrawals: await prisma.withdrawal.count(),
      invoices: await prisma.invoice.count(),
      membershipPayments: await prisma.membershipPayment.count(),
      membershipOrders: await prisma.membershipOrder.count(),
      userMemberships: await prisma.userMembership.count(),
      rewardTransactions: await prisma.rewardTransaction.count(),
      profitSharingDistributions: await prisma.profitSharingDistribution.count()
    });

    const before = await snapshot();
    await resetPasswordVia(phone, NEW_PASSWORD);
    const after = await snapshot();

    expect(after).toEqual(before);
  });
});
