import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration } from "../helpers/referralWalletHarness.js";
import { RecordingOtpProvider } from "../../src/modules/auth/infrastructure/RecordingOtpProvider.js";
import {
  resetOtpDeliveryProvider,
  setOtpDeliveryProvider
} from "../../src/modules/auth/infrastructure/otpProviderRegistry.js";
import { hashPassword } from "../../src/core/security/passwordHasher.js";

/**
 * Stage R2.1 — kontrak respons pemulihan (Owner Decision).
 *
 *  1. Ketidaktersediaan GLOBAL (secret/provider) → 503 seragam, diperiksa
 *     sebelum account lookup, identik untuk identifier mana pun.
 *  2. Provider tersedia → kegagalan spesifik target tetap 202 generik.
 *  3. Endpoint verification yang terautentikasi boleh 503.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";
const provider = new RecordingOtpProvider();
let sequence = 0;

const PASSWORD = "PasswordKontrak12";
const REGISTERED = "081700000001";
const UNREGISTERED = "081799999999";

type ApiResponse = { status: number; body: unknown };

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

async function seedRegisteredAccount() {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: "Kontrak User",
      phone: REGISTERED,
      referralCode: `KTR${String(sequence).padStart(6, "0")}`,
      passwordHash: await hashPassword(PASSWORD)
    }
  });
}

describeIntegration("Stage R2.1 — recovery response contract", () => {
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
    // Limiter per-identifier memakai kunci hash. Tanpa reset ini, test yang
    // berjalan lebih dulu menghabiskan kuota identifier yang sama dan test
    // berikutnya menerima 429 alih-alih status yang sedang diuji.
    for (const identifier of [REGISTERED, UNREGISTERED]) {
      const hashed = crypto.createHash("sha256").update(identifier).digest("hex");
      limiters.recoveryAccountRateLimiter.resetKey(`recovery-id:${hashed}`);
      limiters.recoveryVerifyRateLimiter.resetKey(`recovery-id:${hashed}`);
    }
  });

  // -----------------------------------------------------------------
  // 1 — provider TIDAK tersedia
  // -----------------------------------------------------------------

  it("provider unavailable menghasilkan 503 identik untuk identifier terdaftar dan tidak", async () => {
    await seedRegisteredAccount();
    resetOtpDeliveryProvider(); // kembali ke UnavailableOtpProvider

    const registered = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: REGISTERED
    });
    const unregistered = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: UNREGISTERED
    });

    expect(registered.status).toBe(503);
    expect(unregistered.status).toBe(503);
    // Body dibandingkan utuh: tidak boleh ada satu pun field yang berbeda.
    expect(registered.body).toEqual(unregistered.body);
    expect((registered.body as { code?: string }).code).toBe(
      "AUTH_RECOVERY_CHANNEL_UNAVAILABLE"
    );
  });

  it("provider unavailable tidak membocorkan keberadaan akun lewat waktu respons", async () => {
    await seedRegisteredAccount();
    resetOtpDeliveryProvider();

    const timeOf = async (identifier: string) => {
      const started = Date.now();
      await api("POST", "/api/v1/auth/recovery/request", { identifier });
      return Date.now() - started;
    };

    // Beberapa kali pengukuran agar noise satu permintaan tidak menentukan.
    const registeredTimes: number[] = [];
    const unregisteredTimes: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      registeredTimes.push(await timeOf(REGISTERED));
      unregisteredTimes.push(await timeOf(UNREGISTERED));
    }

    const median = (values: number[]) => [...values].sort((a, b) => a - b)[1] ?? 0;
    const registered = median(registeredTimes);
    const unregistered = median(unregisteredTimes);
    const ratio = Math.max(registered, unregistered) / Math.max(Math.min(registered, unregistered), 1);

    // Karena pemeriksaan global terjadi SEBELUM account lookup, tidak ada
    // pekerjaan tambahan apa pun untuk identifier terdaftar.
    expect(ratio).toBeLessThan(4);
  });

  it("provider unavailable tidak membuat tantangan apa pun di database", async () => {
    const user = await seedRegisteredAccount();
    resetOtpDeliveryProvider();

    await api("POST", "/api/v1/auth/recovery/request", { identifier: REGISTERED });

    expect(await prisma.authChallenge.count({ where: { userId: user.id } })).toBe(0);
  });

  // -----------------------------------------------------------------
  // 2 — provider TERSEDIA: kegagalan spesifik target tetap 202
  // -----------------------------------------------------------------

  it("provider tersedia: akun tidak ada dan akun ada sama-sama 202 generik", async () => {
    await seedRegisteredAccount();
    setOtpDeliveryProvider(provider);

    const registered = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: REGISTERED
    });
    const unregistered = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: UNREGISTERED
    });

    expect(registered.status).toBe(202);
    expect(unregistered.status).toBe(202);
    expect(registered.body).toEqual(unregistered.body);
    // Hanya akun yang benar-benar ada yang menerima kode.
    expect(provider.count()).toBe(1);
  });

  it("provider tersedia: cooldown tetap menghasilkan 202 generik", async () => {
    await seedRegisteredAccount();
    setOtpDeliveryProvider(provider);

    const first = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: REGISTERED
    });
    const second = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: REGISTERED
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body).toEqual(first.body);
    // Cooldown menahan pengiriman kedua, tetapi tidak terlihat dari respons.
    expect(provider.count()).toBe(1);
  });

  // -----------------------------------------------------------------
  // 3 — endpoint terautentikasi BOLEH 503
  // -----------------------------------------------------------------

  it("verification terautentikasi boleh mengembalikan 503 saat provider tidak tersedia", async () => {
    await seedRegisteredAccount();
    const login = await api("POST", "/api/v1/auth/login", {
      phone: REGISTERED,
      password: PASSWORD
    });
    expect(login.status).toBe(200);
    const token = (login.body as { data?: { accessToken?: string } }).data?.accessToken;

    resetOtpDeliveryProvider();
    const response = await api(
      "POST",
      "/api/v1/auth/verification/request",
      { channel: "PHONE" },
      token
    );

    // Identitas pemanggil sudah pasti di sini, sehingga 503 tidak membocorkan
    // apa pun yang belum diketahui pemanggil.
    expect(response.status).toBe(503);
    expect((response.body as { code?: string }).code).toBe(
      "AUTH_RECOVERY_CHANNEL_UNAVAILABLE"
    );
  });

  // -----------------------------------------------------------------
  // Endpoint legacy yang dipensiunkan
  // -----------------------------------------------------------------

  it("POST /auth/otp/request sudah dipensiunkan dan tidak lagi terdaftar", async () => {
    const response = await api("POST", "/api/v1/auth/otp/request", {
      phone: REGISTERED,
      purpose: "LOGIN"
    });

    // Route dilepas dari router, sehingga jatuh ke handler not-found aplikasi.
    expect(response.status).toBe(404);
    // Tidak boleh ada kode OTP maupun developmentCode pada respons apa pun.
    expect(JSON.stringify(response.body)).not.toContain("developmentCode");
  });
});
