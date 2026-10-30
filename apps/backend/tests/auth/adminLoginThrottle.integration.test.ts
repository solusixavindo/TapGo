import { UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/core/security/passwordHasher.js";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * Pembatas tebak password per AKUN untuk akun admin (temuan audit 30 Okt 2026): pembatas per IP saja tidak
 * menahan penyerang dengan banyak IP, dan server menerima password 6 karakter untuk akun admin.
 *
 * Yang dijaga: (1) 5 kegagalan dari satu IP mengunci IP itu untuk akun tersebut, bahkan bila password benar;
 * (2) pemilik dari IP lain tidak ikut terkunci; (3) serangan terdistribusi (30 kegagalan lintas IP) mengunci akun;
 * (4) login berhasil menghapus hitungan; (5) akun non-admin tidak terkena pembatas ini; (6) password akun admin
 * minimal 12 karakter di SERVER, bukan hanya di layar konsol.
 */

const PASSWORD = "KataSandiAdmin#2026";
let server: Server | undefined;
let baseUrl = "";
let sequence = 0;
let signAccessToken: (payload: { sub: string; role: UserRole; sessionId: string }) => string;

async function createAccount(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Throttle ${role} ${sequence}`,
      phone: `08123450${String(1000 + sequence)}`,
      referralCode: `THR${String(sequence).padStart(6, "0")}`,
      role,
      status: "ACTIVE",
      passwordHash: await hashPassword(PASSWORD)
    }
  });
}

async function login(phone: string, password: string, ip = "198.51.100.10") {
  const response = await fetch(`${baseUrl}/api/v1/web/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ phone, password })
  });
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  return { status: response.status, code: body.code };
}

const failures = (userId: string) =>
  prisma.auditLog.count({ where: { action: "AUTH_LOGIN_FAILED", entityType: "USER", entityId: userId } });

describe.skipIf(!runIntegration)("Pembatas login per akun untuk akun admin", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-admin-throttle";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-admin-throttle";
    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["198.51.100.10", "198.51.100.20", "203.0.113.7", "127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.authRateLimiter.resetKey(key);
      limiters.apiRateLimiter.resetKey(key);
    }
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("5 kegagalan dari satu IP mengunci IP itu, meski percobaan berikutnya memakai password benar", async () => {
    const admin = await createAccount("SUPER_ADMIN");
    for (let i = 0; i < 5; i += 1) {
      expect((await login(admin.phone, "salah-salah")).status).toBe(401);
    }
    const locked = await login(admin.phone, PASSWORD);
    expect(locked).toEqual({ status: 429, code: "LOGIN_TEMPORARILY_LOCKED" });
    expect(await failures(admin.id)).toBe(5);
  });

  it("pemilik dari IP lain tidak ikut terkunci", async () => {
    const admin = await createAccount("SUPER_ADMIN_VIP");
    for (let i = 0; i < 5; i += 1) await login(admin.phone, "salah-salah", "198.51.100.10");
    expect((await login(admin.phone, PASSWORD, "198.51.100.20")).status).toBe(200);
  });

  it("30 kegagalan lintas IP mengunci akun bagi semua IP (serangan terdistribusi)", async () => {
    const admin = await createAccount("ADMIN");
    await prisma.auditLog.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        action: "AUTH_LOGIN_FAILED",
        entityType: "USER",
        entityId: admin.id,
        ipAddress: `192.0.2.${i + 1}`
      }))
    });
    expect(await login(admin.phone, PASSWORD, "203.0.113.7")).toEqual({ status: 429, code: "LOGIN_TEMPORARILY_LOCKED" });
  });

  it("login berhasil menghapus hitungan kegagalan sebelumnya", async () => {
    const admin = await createAccount("ADMIN");
    for (let i = 0; i < 4; i += 1) await login(admin.phone, "salah-salah");
    expect((await login(admin.phone, PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i += 1) await login(admin.phone, "salah-salah");
    expect((await login(admin.phone, PASSWORD)).status).toBe(200);
  });

  it("kegagalan lebih lama dari 15 menit tidak dihitung", async () => {
    const admin = await createAccount("ADMIN");
    await prisma.auditLog.createMany({
      data: Array.from({ length: 5 }, () => ({
        action: "AUTH_LOGIN_FAILED",
        entityType: "USER",
        entityId: admin.id,
        ipAddress: "198.51.100.10",
        createdAt: new Date(Date.now() - 16 * 60 * 1000)
      }))
    });
    expect((await login(admin.phone, PASSWORD)).status).toBe(200);
  });

  it("akun non-admin tidak terkena pembatas ini dan tidak mencatat kegagalan", async () => {
    const member = await createAccount("USER");
    for (let i = 0; i < 7; i += 1) expect((await login(member.phone, "salah-salah")).status).toBe(401);
    expect((await login(member.phone, PASSWORD)).status).toBe(200);
    expect(await failures(member.id)).toBe(0);
  });

  it("nomor yang tidak terdaftar tetap 401 dan tidak membuat catatan apa pun", async () => {
    expect((await login("081299990000", "salah-salah")).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: "AUTH_LOGIN_FAILED" } })).toBe(0);
  });

  it("password baru akun admin kurang dari 12 karakter ditolak server; 12 karakter diterima", async () => {
    const admin = await createAccount("SUPER_ADMIN");
    const token = signAccessToken({ sub: admin.id, role: "SUPER_ADMIN", sessionId: `s-${admin.id}` });
    const change = (newPassword: string) =>
      fetch(`${baseUrl}/api/v1/auth/change-password`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: PASSWORD, newPassword })
      });
    const tooShort = await change("Pendek#1234");
    expect(tooShort.status).toBe(400);
    expect(((await tooShort.json()) as { code?: string }).code).toBe("PASSWORD_TOO_SHORT_FOR_ADMIN");
    expect((await change("Cukup#123456")).status).toBeLessThan(300);
  });
});
