import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration } from "../helpers/referralWalletHarness.js";
import { hashPassword } from "../../src/core/security/passwordHasher.js";

/**
 * Regresi produksi — temuan Owner 29 Sep 2026: pesan "too many attempt"
 * (RATE_LIMITED, raw English) muncul saat menguji driver_app di 2 HP.
 *
 * Root cause: /auth/refresh sebelumnya berbagi kuota 20/15 menit per IP yang
 * SAMA dengan /login, /google, /register — padahal refresh adalah trafik
 * latar belakang otomatis (dipicu app setiap access token kedaluwarsa dan
 * setiap 401), bukan permukaan tebak-kredensial. Dua HP polling tawaran
 * tiap 12 detik dari satu IP rumah yang sama dengan mudah menghabiskan
 * kuota bersama itu sebelum sempat login sama sekali.
 *
 * Perbaikan: /auth/refresh (mobile & web) pindah ke refreshRateLimiter
 * terpisah (100/15 menit) — test ini membuktikan kuota LOGIN yang habis
 * TIDAK ikut memblokir refresh yang sah.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";

const PASSWORD = "PasswordRefresh12";

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

describeIntegration("Regresi produksi — /auth/refresh punya kuota rate limit terpisah dari /auth/login", () => {
  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-please-change-000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-please-change-00000";

    const { createApp } = await import("../../src/app.js");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
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
    await cleanDatabase();
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.authRateLimiter.resetKey(key);
      limiters.refreshRateLimiter.resetKey(key);
      limiters.apiRateLimiter.resetKey(key);
    }
  });

  it("kuota /login yang habis TIDAK memblokir /auth/refresh yang sah", async () => {
    const phone = "081700000001";
    await prisma.user.create({
      data: {
        fullName: "Refresh Quota Driver",
        phone,
        role: "DRIVER",
        referralCode: "RFQ000001",
        passwordHash: await hashPassword(PASSWORD)
      }
    });

    // Login sungguhan dulu untuk mendapat refreshToken yang sah, SEBELUM
    // kuota /login dihabiskan di bawah.
    const login = await api("POST", "/api/v1/auth/login", { phone, password: PASSWORD });
    expect(login.status).toBe(200);
    const refreshToken = login.body.data?.refreshToken as string;

    // Habiskan kuota authRateLimiter (30/15 menit) dengan percobaan login
    // salah — meniru dua HP menguji berulang kali dari IP yang sama.
    let sawRateLimited = false;
    for (let i = 0; i < 35; i += 1) {
      const attempt = await api("POST", "/api/v1/auth/login", {
        phone,
        password: "PasswordSalahSengaja"
      });
      if (attempt.status === 429) {
        sawRateLimited = true;
        expect(attempt.body.code).toBe("RATE_LIMITED");
        break;
      }
    }
    expect(sawRateLimited).toBe(true);

    // Refresh yang SAH tetap berhasil walau kuota /login sudah habis —
    // membuktikan keduanya kini kuota terpisah, bukan kebetulan lolos.
    const refreshed = await api("POST", "/api/v1/auth/refresh", { refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data?.accessToken).toBeTruthy();
  });

  it("/auth/refresh sendiri punya kuota jauh lebih longgar (>30) untuk trafik latar belakang normal", async () => {
    const phone = "081700000002";
    await prisma.user.create({
      data: {
        fullName: "Refresh Volume Driver",
        phone,
        role: "DRIVER",
        referralCode: "RFQ000002",
        passwordHash: await hashPassword(PASSWORD)
      }
    });

    const login = await api("POST", "/api/v1/auth/login", { phone, password: PASSWORD });
    expect(login.status).toBe(200);
    let refreshToken = login.body.data?.refreshToken as string;

    // 25 refresh berantai (tiap sukses merotasi token) — melebihi kuota LAMA
    // (20/15 menit) yang dulu dibagi dengan /login, tanpa satu pun 429.
    for (let i = 0; i < 25; i += 1) {
      const refreshed = await api("POST", "/api/v1/auth/refresh", { refreshToken });
      expect(refreshed.status).toBe(200);
      refreshToken = refreshed.body.data?.refreshToken as string;
    }
  });
});
