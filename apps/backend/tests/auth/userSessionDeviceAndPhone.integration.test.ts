import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";
import { hashPassword } from "../../src/core/security/passwordHasher.js";
import { PrismaAuthRepository } from "../../src/modules/auth/infrastructure/PrismaAuthRepository.js";

/**
 * Regresi produksi — laporan Owner 9 Okt 2026 (aplikasi tapgo-user 2.0.5+43 di Play):
 *   (2) satu akun USER aktif di beberapa HP sekaligus;
 *   (3) satu HP mendaftarkan banyak akun;
 *   (4) pendaftaran dengan nomor telepon sembarangan.
 *
 * Akar masalah:
 *   (2) penegakan satu sesi aktif di issueTokenPair hanya untuk role DRIVER;
 *   (3) sinyal DEVICE_ALREADY_REGISTERED hanya menandai registrasi "suspicious",
 *       tidak pernah menolaknya, sehingga bonus registrasi tetap cair;
 *   (4) validator pendaftaran menerima deretan digit apa pun (8-32 karakter).
 */

const describeIntegration = runIntegration ? describe : describe.skip;
const repo = new PrismaAuthRepository(prisma);

let server: Server | undefined;
let baseUrl = "";
let sequence = 0;

const PASSWORD = "PasswordUser12";

type ApiResponse = {
  status: number;
  body: { success?: boolean; code?: string; message?: string; data?: Record<string, any> };
};

async function api(method: string, path: string, body?: unknown, token?: string): Promise<ApiResponse> {
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

async function createAccount(role: "USER" | "ADMIN" = "USER") {
  sequence += 1;
  const phone = `0812${String(30000000 + sequence * 7919)}`;
  const user = await prisma.user.create({
    data: {
      fullName: `Sesi ${role} ${sequence}`,
      phone,
      role,
      referralCode: `USS${String(sequence).padStart(6, "0")}`,
      passwordHash: await hashPassword(PASSWORD)
    }
  });
  return { user, phone };
}

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

function registerPayload(overrides: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    name: "Calon Pengguna",
    phone: `0813${String(55000000 + sequence * 4093)}`,
    password: PASSWORD,
    deviceFingerprint: `tapgo:android:device-${sequence}`,
    ...overrides
  };
}

describeIntegration("Satu sesi aktif per akun USER (kanal APP)", () => {
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
    await prisma.registrationEvent.deleteMany();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await cleanDatabase();
    await prisma.abuseFlag.deleteMany();
    await prisma.registrationEvent.deleteMany();
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.authRateLimiter.resetKey(key);
      limiters.apiRateLimiter.resetKey(key);
      limiters.registerPhoneRateLimiter.resetKey(key);
    }
  });

  it("HP kedua login: HP pertama ditolak SEKETIKA (AUTH_SESSION_REVOKED), HP kedua sah", async () => {
    const { phone } = await createAccount("USER");
    const phoneA = await loginApp(phone);
    expect((await api("GET", "/api/v1/auth/me", undefined, phoneA.accessToken)).status).toBe(200);

    const phoneB = await loginApp(phone);

    const afterA = await api("GET", "/api/v1/auth/me", undefined, phoneA.accessToken);
    expect(afterA.status).toBe(401);
    expect(afterA.body.code).toBe("AUTH_SESSION_REVOKED");
    expect((await api("GET", "/api/v1/auth/me", undefined, phoneB.accessToken)).status).toBe(200);
  });

  it("refresh token HP pertama tidak bisa menukar token baru", async () => {
    const { phone } = await createAccount("USER");
    const phoneA = await loginApp(phone);
    await loginApp(phone);
    const refreshed = await api("POST", "/api/v1/auth/refresh", { refreshToken: phoneA.refreshToken });
    expect(refreshed.status).toBe(401);
  });

  it("token push HP lama dihapus; token akun lain tidak tersentuh", async () => {
    const { user, phone } = await createAccount("USER");
    const other = await createAccount("USER");
    await prisma.pushToken.create({ data: { userId: user.id, token: "fcm-old-phone-token", platform: "android" } });
    await prisma.pushToken.create({ data: { userId: other.user.id, token: "fcm-other-user-token", platform: "android" } });

    await loginApp(phone);

    expect(await prisma.pushToken.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.pushToken.count({ where: { userId: other.user.id } })).toBe(1);
  });

  it("login lewat kanal WEB (halaman /upgrade) tidak mencabut sesi APP dan tidak menghapus token push", async () => {
    const { user, phone } = await createAccount("USER");
    const app = await loginApp(phone);
    await prisma.pushToken.create({ data: { userId: user.id, token: "fcm-current-phone", platform: "android" } });

    await loginWeb(phone);

    expect((await api("GET", "/api/v1/auth/me", undefined, app.accessToken)).status).toBe(200);
    expect(await prisma.pushToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it("akun ADMIN tetap tidak terdampak (hanya DRIVER dan USER)", async () => {
    const { phone } = await createAccount("ADMIN");
    const first = await loginApp(phone);
    await loginApp(phone);
    expect((await api("GET", "/api/v1/auth/me", undefined, first.accessToken)).status).toBe(200);
  });

  it("refresh pada sesi yang SAMA tidak mencabut dirinya sendiri (HP yang sama tetap masuk)", async () => {
    const { phone } = await createAccount("USER");
    const session = await loginApp(phone);
    const refreshed = await api("POST", "/api/v1/auth/refresh", { refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(200);
    const newAccess = refreshed.body.data?.accessToken as string;
    expect((await api("GET", "/api/v1/auth/me", undefined, newAccess)).status).toBe(200);
  });

  it("pendaftaran akun baru langsung masuk dengan token sah dan tidak menaikkan authVersion", async () => {
    const payload = registerPayload();
    const created = await api("POST", "/api/v1/auth/register", payload);
    expect(created.status).toBe(201);
    const me = await api("GET", "/api/v1/auth/me", undefined, created.body.data?.accessToken as string);
    expect(me.status).toBe(200);
    const user = await prisma.user.findFirstOrThrow({ where: { role: "USER" } });
    expect(user.authVersion).toBe(0);
  });
});

describeIntegration("Satu HP satu akun saat mendaftar", () => {
  setupReferralWalletIntegration();

  beforeEach(async () => {
    await prisma.abuseFlag.deleteMany();
    await prisma.registrationEvent.deleteMany();
  });

  function registerOnDevice(seq: number, device: string, max?: number) {
    return repo.createUser({
      fullName: `Perangkat ${seq}`,
      phone: `08139${String(100000 + seq)}`,
      passwordHash: "hashed-password",
      role: "USER",
      referralCode: `DEV${String(seq).padStart(6, "0")}`,
      ...(max !== undefined ? { maxAccountsPerDevice: max } : {}),
      registrationEvent: { deviceFingerprintHash: device }
    });
  }

  it("akun kedua dari perangkat yang sama ditolak 409 DEVICE_ACCOUNT_LIMIT dan tidak membuat akun maupun bonus", async () => {
    await registerOnDevice(1, "hash-device-a", 1);
    await expect(registerOnDevice(2, "hash-device-a", 1)).rejects.toMatchObject({
      statusCode: 409,
      code: "DEVICE_ACCOUNT_LIMIT"
    });
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.wallet.count()).toBe(1);
    const quota = await prisma.registrationQuota.findFirst();
    expect(quota?.granted).toBe(1);
  });

  it("perangkat lain bebas mendaftar", async () => {
    await registerOnDevice(1, "hash-device-a", 1);
    await registerOnDevice(2, "hash-device-b", 1);
    expect(await prisma.user.count()).toBe(2);
  });

  it("batas dapat dinaikkan (2 akun) dan 0 / tanpa nilai = tanpa batas", async () => {
    await registerOnDevice(1, "hash-device-c", 2);
    await registerOnDevice(2, "hash-device-c", 2);
    await expect(registerOnDevice(3, "hash-device-c", 2)).rejects.toMatchObject({ code: "DEVICE_ACCOUNT_LIMIT" });

    await registerOnDevice(4, "hash-device-d", 0);
    await registerOnDevice(5, "hash-device-d", 0);
    await registerOnDevice(6, "hash-device-d");
    expect(await prisma.registrationEvent.count({ where: { deviceFingerprintHash: "hash-device-d" } })).toBe(3);
  });

  it("akun berstatus DELETED tetap memakai jatah perangkat (tidak bisa daftar-hapus-daftar untuk bonus)", async () => {
    const first = await registerOnDevice(1, "hash-device-e", 1);
    await prisma.user.update({ where: { id: first.id }, data: { status: "DELETED" } });
    await expect(registerOnDevice(2, "hash-device-e", 1)).rejects.toMatchObject({ code: "DEVICE_ACCOUNT_LIMIT" });
  });

  it("lima pendaftaran BERSAMAAN dari satu perangkat: tepat satu lolos", async () => {
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((seq) => registerOnDevice(seq, "hash-device-race", 1))
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected).toHaveLength(4);
    for (const result of rejected) expect(result.reason).toMatchObject({ code: "DEVICE_ACCOUNT_LIMIT" });
    expect(await prisma.user.count()).toBe(1);
    const quota = await prisma.registrationQuota.findFirst();
    expect(quota?.granted).toBe(1);
  });

  it("tanpa sidik perangkat (klien lama/web) pendaftaran tidak dibatasi perangkat", async () => {
    await repo.createUser({
      fullName: "Tanpa Perangkat 1", phone: "081391000001", passwordHash: "h", role: "USER",
      referralCode: "NDV000001", maxAccountsPerDevice: 1
    });
    await repo.createUser({
      fullName: "Tanpa Perangkat 2", phone: "081391000002", passwordHash: "h", role: "USER",
      referralCode: "NDV000002", maxAccountsPerDevice: 1
    });
    expect(await prisma.user.count()).toBe(2);
  });
});

describeIntegration("Pendaftaran lewat API: batas perangkat dan nomor HP", () => {
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
    await prisma.registrationEvent.deleteMany();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await cleanDatabase();
    await prisma.abuseFlag.deleteMany();
    await prisma.registrationEvent.deleteMany();
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.authRateLimiter.resetKey(key);
      limiters.registerPhoneRateLimiter.resetKey(key);
    }
  });

  it("HP yang sama mendaftar akun kedua: 409 DEVICE_ACCOUNT_LIMIT; HP lain boleh", async () => {
    const first = await api("POST", "/api/v1/auth/register", registerPayload({ deviceFingerprint: "tapgo:android:same-phone" }));
    expect(first.status).toBe(201);

    const second = await api("POST", "/api/v1/auth/register", registerPayload({ deviceFingerprint: "tapgo:android:same-phone" }));
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("DEVICE_ACCOUNT_LIMIT");

    const otherPhone = await api("POST", "/api/v1/auth/register", registerPayload({ deviceFingerprint: "tapgo:android:another-phone" }));
    expect(otherPhone.status).toBe(201);
  });

  const invalidPhones = [
    ["terlalu pendek", "0812345"],
    ["deretan angka sama", "081111111111"],
    ["deretan berurutan naik", "081234567890"],
    ["deretan berurutan turun", "089876543210"],
    ["bukan awalan seluler (0800)", "080012345678"],
    ["telepon rumah/kode area", "0211234567"],
    ["terlalu panjang", "0813555032171234"],
    ["nomor luar negeri", "+14155550123"],
    ["bukan angka", "08ABCDEFGHIJ"]
  ] as const;

  for (const [label, phone] of invalidPhones) {
    it(`nomor ditolak 400 VALIDATION_ERROR: ${label}`, async () => {
      const response = await api("POST", "/api/v1/auth/register", registerPayload({ phone }));
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(await prisma.user.count()).toBe(0);
    });
  }

  const validPhones = [
    ["format 08", "081355503217"],
    ["format +62", "+6281355503218"],
    ["format 62", "6281355503219"],
    ["13 digit", "0895123450987"]
  ] as const;

  for (const [label, phone] of validPhones) {
    it(`nomor diterima dan disimpan ternormalisasi: ${label}`, async () => {
      const response = await api("POST", "/api/v1/auth/register", registerPayload({ phone }));
      expect(response.status).toBe(201);
      const stored = await prisma.user.findFirstOrThrow({});
      expect(stored.phone).toMatch(/^08[1-9]\d{8,11}$/);
    });
  }

  it("login akun lama dengan nomor di luar pola pendaftaran tetap berhasil", async () => {
    const legacy = await prisma.user.create({
      data: {
        fullName: "Akun Lama", phone: "08500000001", role: "USER",
        referralCode: "LEG000001", passwordHash: await hashPassword(PASSWORD)
      }
    });
    const response = await api("POST", "/api/v1/auth/login", { phone: legacy.phone, password: PASSWORD });
    expect(response.status).toBe(200);
  });
});
