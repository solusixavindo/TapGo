import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration } from "../helpers/referralWalletHarness.js";
import { hashPassword } from "../../src/core/security/passwordHasher.js";

/**
 * Regresi produksi — temuan Owner 28 Sep 2026: akun driver ("febrina") bisa
 * aktif BERSAMAAN di 2 HP berbeda. Root cause: login tidak pernah mencabut
 * sesi lama akun yang sama — setiap login berhasil hanya MENAMBAH baris
 * Session baru, sehingga token lama di HP lain tetap sah selamanya.
 *
 * Untuk akun DRIVER khususnya ini serius: identitas driver (dan rantai
 * kepercayaan verifikasi wajah, lihat D4.1) mengasumsikan satu akun = satu
 * orang yang benar-benar mengemudi. Login di HP kedua sekarang mencabut
 * SELURUH sesi lama akun itu — persis pola industri (WhatsApp per nomor,
 * Gojek/Grab driver app), bukan pendekatan baru yang belum teruji.
 *
 * Sengaja HANYA untuk role DRIVER dan kanal APP (lihat AuthService.
 * issueTokenPair) — test di bawah juga membuktikan USER tidak terdampak,
 * supaya perubahan ini tidak diam-diam meluas ke akun yang tidak dilaporkan.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";
let sequence = 0;

const PASSWORD = "PasswordDriver12";

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

async function createAccount(role: "DRIVER" | "USER") {
  sequence += 1;
  const phone = `08${String(500000000 + sequence)}`;
  const user = await prisma.user.create({
    data: {
      fullName: `Single Session ${role} ${sequence}`,
      phone,
      role,
      referralCode: `SGL${String(sequence).padStart(6, "0")}`,
      passwordHash: await hashPassword(PASSWORD)
    }
  });
  return { user, phone };
}

/** Login lewat kanal APP (authRouter, bukan webAuthRouter). */
async function loginApp(phone: string) {
  const response = await api("POST", "/api/v1/auth/login", { phone, password: PASSWORD });
  expect(response.status).toBe(200);
  return {
    accessToken: response.body.data?.accessToken as string,
    refreshToken: response.body.data?.refreshToken as string
  };
}

async function loginWeb(phone: string) {
  const response = await api("POST", "/api/v1/web/auth/login", { phone, password: PASSWORD });
  expect(response.status).toBe(200);
  return { accessToken: response.body.data?.accessToken as string };
}

describeIntegration("Regresi produksi — satu sesi aktif per akun DRIVER (kanal APP)", () => {
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
      limiters.apiRateLimiter.resetKey(key);
    }
  });

  it("HP kedua login: HP pertama LANGSUNG ditolak pada request berikutnya (bukan hanya saat refresh)", async () => {
    const { phone } = await createAccount("DRIVER");

    const phoneA = await loginApp(phone);
    const before = await api("GET", "/api/v1/auth/me", undefined, phoneA.accessToken);
    expect(before.status).toBe(200);

    const phoneB = await loginApp(phone);

    // Akses token HP A ditolak SEKETIKA — bukan setelah TTL 15 menitnya
    // habis. Ini membuktikan penegakan lewat authVersion (dibaca ulang setiap
    // request oleh requireAuth), bukan hanya Session.revokedAt yang baru
    // terlihat saat refresh token dipakai.
    const afterA = await api("GET", "/api/v1/auth/me", undefined, phoneA.accessToken);
    expect(afterA.status).toBe(401);
    expect(afterA.body.code).toBe("AUTH_SESSION_REVOKED");

    // HP B (yang baru login) tetap sah.
    const afterB = await api("GET", "/api/v1/auth/me", undefined, phoneB.accessToken);
    expect(afterB.status).toBe(200);
  });

  it("refresh token HP pertama juga dicabut, tidak bisa dipakai menukar token baru", async () => {
    const { phone } = await createAccount("DRIVER");
    const phoneA = await loginApp(phone);
    await loginApp(phone);

    const refreshed = await api("POST", "/api/v1/auth/refresh", {
      refreshToken: phoneA.refreshToken
    });
    expect(refreshed.status).toBe(401);
  });

  it("akun USER tidak terdampak: login kedua TIDAK mencabut sesi pertama", async () => {
    const { phone } = await createAccount("USER");

    const deviceA = await loginApp(phone);
    await loginApp(phone);

    const stillValid = await api("GET", "/api/v1/auth/me", undefined, deviceA.accessToken);
    expect(stillValid.status).toBe(200);
  });

  it("login DRIVER lewat kanal WEB (dashboard mitra) tidak mencabut sesi APP", async () => {
    const { phone } = await createAccount("DRIVER");

    const appSession = await loginApp(phone);
    await loginWeb(phone);

    const stillValid = await api("GET", "/api/v1/auth/me", undefined, appSession.accessToken);
    expect(stillValid.status).toBe(200);
  });
});
