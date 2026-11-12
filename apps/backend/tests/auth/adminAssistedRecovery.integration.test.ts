import { UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/core/security/passwordHasher.js";
import { RecordingOtpProvider } from "../../src/modules/auth/infrastructure/RecordingOtpProvider.js";
import { resetOtpDeliveryProvider, setOtpDeliveryProvider } from "../../src/modules/auth/infrastructure/otpProviderRegistry.js";
import { cleanDatabase, prisma, runIntegration } from "../helpers/referralWalletHarness.js";

/**
 * Akun tanpa jalur pemulihan otomatis (kasus akun Jumadi, 12 Nov 2026): lupa password, email belum terverifikasi, dan
 * penyedia OTP produksi hanya mengirim ke email. Sebelum perbaikan, "Lupa password" lewat nomor HP tidak mengirim apa pun
 * dan tidak ada jalan keluar. Kini VIP dapat menerbitkan kode pemulihan setelah memastikan identitas pemilik.
 *
 * Yang dijaga: hanya VIP; password VIP + pernyataan identitas; akun admin/nonaktif ditolak; pemilik memilih password
 * barunya sendiri lewat layar "Lupa password" biasa; kode sekali pakai, 5 percobaan, 30 menit; sesi lama dicabut;
 * permintaan "Kirim kode" biasa tidak menimpa kode admin; audit tidak memuat kode.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

/** Meniru penyedia produksi: hanya EMAIL yang benar-benar terkirim. */
class EmailOnlyProvider extends RecordingOtpProvider {
  override supports(channel: "PHONE" | "EMAIL"): boolean {
    return channel === "EMAIL";
  }
}

const provider = new EmailOnlyProvider();
const OLD_PASSWORD = "PasswordLama123";
const NEW_PASSWORD = "PasswordBaru456";
const VIP_PASSWORD = "PasswordPemilik#2026";

let server: Server | undefined;
let baseUrl = "";
let sequence = 0;
let signAccessToken: (payload: { sub: string; role: UserRole; sessionId: string }) => string;

async function api(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : {}) as { code?: string; data?: any } };
}

async function createUser(role: UserRole, extra: Record<string, unknown> = {}) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Bantuan ${role} ${sequence}`,
      phone: `08127890${String(1000 + sequence)}`,
      referralCode: `AST${String(sequence).padStart(6, "0")}`,
      role,
      status: "ACTIVE",
      passwordHash: await hashPassword(role === "SUPER_ADMIN_VIP" ? VIP_PASSWORD : OLD_PASSWORD),
      ...extra
    }
  });
}

const tokenOf = (user: { id: string; role: UserRole }) => signAccessToken({ sub: user.id, role: user.role, sessionId: `s-${user.id}` });

const issue = (token: string, userId: string, body: Record<string, unknown> = {}) =>
  api("POST", `/api/v1/admin/account-assist/${userId}/recovery-code`, {
    reasonCode: "NO_VERIFIED_EMAIL",
    identityChecked: true,
    password: VIP_PASSWORD,
    ...body
  }, token);

describeIntegration("Pemulihan akun dibantu admin (akun tanpa email terverifikasi)", () => {
  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-please-change-000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-please-change-00000";
    process.env.AUTH_RECOVERY_HMAC_SECRET = "PUBLIC SYNTHETIC TEST SECRET - NEVER USE IN PRODUCTION - TAPGO RECOVERY";
    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    setOtpDeliveryProvider(provider);
  });

  afterAll(async () => {
    resetOtpDeliveryProvider();
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    provider.reset();
    await cleanDatabase();
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      for (const name of ["adminRateLimiter", "apiRateLimiter", "authRateLimiter", "recoveryIpRateLimiter", "recoveryAccountRateLimiter", "recoveryVerifyRateLimiter"] as const) {
        (limiters as any)[name]?.resetKey?.(key);
      }
    }
  });

  it("MASALAH ASLI: tanpa email terverifikasi, 'Lupa password' tidak mengirim apa pun dan tidak menyisakan kode", async () => {
    const member = await createUser("USER", { email: "jumadi@example.test" }); // email ada tetapi belum terverifikasi

    const byPhone = await api("POST", "/api/v1/auth/recovery/request", { identifier: member.phone });
    const byEmail = await api("POST", "/api/v1/auth/recovery/request", { identifier: "jumadi@example.test" });

    expect(byPhone.status).toBe(202);
    expect(byEmail.status).toBe(202);
    expect(provider.count()).toBe(0); // tidak ada kode yang terkirim ke mana pun
    expect(await prisma.authChallenge.count({ where: { userId: member.id } })).toBe(0);
  });

  it("hanya VIP yang dapat mencari akun dan menerbitkan kode", async () => {
    const member = await createUser("USER");
    for (const role of ["ADMIN", "SUPER_ADMIN"] as UserRole[]) {
      const actor = await createUser(role);
      expect((await api("GET", `/api/v1/admin/account-assist?phone=${member.phone}`, undefined, tokenOf(actor))).status).toBe(403);
      expect((await issue(tokenOf(actor), member.id)).status).toBe(403);
    }
    expect(await prisma.authChallenge.count({ where: { userId: member.id } })).toBe(0);
  });

  it("pencarian menjelaskan keadaan akun: email belum terverifikasi berarti tidak ada pemulihan otomatis", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const member = await createUser("USER", { email: "jumadi@example.test", lastLoginAt: new Date("2026-11-01T00:00:00Z") });

    const found = await api("GET", `/api/v1/admin/account-assist?phone=${member.phone}`, undefined, tokenOf(vip));
    expect(found.status).toBe(200);
    expect(found.body.data.account).toMatchObject({ id: member.id, status: "ACTIVE", emailVerified: false, hasPassword: true });
    expect(found.body.data.account.emailMasked).toBe("j*****@example.test");
    expect(found.body.data.recovery).toMatchObject({ automaticViaEmail: false, canIssueAssistedCode: true, activeCodeUntil: null });

    expect((await api("GET", "/api/v1/admin/account-assist?phone=0811111111", undefined, tokenOf(vip))).status).toBe(404);

    await prisma.user.update({ where: { id: member.id }, data: { emailVerifiedAt: new Date() } });
    const verified = await api("GET", `/api/v1/admin/account-assist?phone=${member.phone}`, undefined, tokenOf(vip));
    expect(verified.body.data.recovery.automaticViaEmail).toBe(true);
  });

  it("alur lengkap: VIP menerbitkan kode -> pemilik memakai 'Lupa password' biasa -> password baru berlaku, sesi lama mati", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const member = await createUser("USER", { email: "jumadi@example.test" });
    await prisma.session.create({ data: { userId: member.id, refreshTokenHash: `h-${member.id}`, expiresAt: new Date(Date.now() + 86_400_000) } });

    const issued = await issue(tokenOf(vip), member.id);
    expect(issued.status).toBe(201);
    expect(issued.headers.get("cache-control")).toBe("no-store");
    const code = issued.body.data.code as string;
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(issued.body.data.ttlMinutes).toBe(30);

    // Pemilik menekan "Kirim kode" lebih dulu (seperti di aplikasi): tidak boleh menimpa kode admin.
    expect((await api("POST", "/api/v1/auth/recovery/request", { identifier: member.phone })).status).toBe(202);
    expect(provider.count()).toBe(0);

    const verified = await api("POST", "/api/v1/auth/recovery/verify", { identifier: member.phone, code });
    expect(verified.status).toBe(200);
    const reset = await api("POST", "/api/v1/auth/recovery/reset", { resetToken: verified.body.data.resetToken, newPassword: NEW_PASSWORD });
    expect(reset.status).toBeLessThan(300);

    const login = (password: string) => api("POST", "/api/v1/web/auth/login", { phone: member.phone, password });
    expect((await login(NEW_PASSWORD)).status).toBe(200);
    expect((await login(OLD_PASSWORD)).status).toBe(401);
    expect((await prisma.session.findFirstOrThrow({ where: { refreshTokenHash: `h-${member.id}` } })).revokedAt).not.toBeNull();

    // Sekali pakai.
    expect((await api("POST", "/api/v1/auth/recovery/verify", { identifier: member.phone, code })).status).toBe(400);

    // Audit: tercatat, tanpa kode.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "ACCOUNT_RECOVERY_CODE_ISSUED", entityId: member.id } });
    expect(audit.actorId).toBe(vip.id);
    expect(JSON.stringify(audit.metadata)).not.toContain(code);
  });

  it("kode salah 5 kali mengunci kode itu; menerbitkan ulang mengganti kode lama", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const member = await createUser("USER");
    const first = (await issue(tokenOf(vip), member.id)).body.data.code as string;
    const second = (await issue(tokenOf(vip), member.id)).body.data.code as string;
    expect(await prisma.authChallenge.count({ where: { userId: member.id, purpose: "PASSWORD_RECOVERY" } })).toBe(1);

    if (first !== second) {
      expect((await api("POST", "/api/v1/auth/recovery/verify", { identifier: member.phone, code: first })).status).toBe(400);
    }
    const wrong = second === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i += 1) await api("POST", "/api/v1/auth/recovery/verify", { identifier: member.phone, code: wrong });
    expect((await api("POST", "/api/v1/auth/recovery/verify", { identifier: member.phone, code: second })).status).toBeGreaterThanOrEqual(400);
  });

  it("kode kedaluwarsa tidak dapat dipakai", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const member = await createUser("USER");
    const code = (await issue(tokenOf(vip), member.id)).body.data.code as string;
    await prisma.authChallenge.updateMany({ where: { userId: member.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api("POST", "/api/v1/auth/recovery/verify", { identifier: member.phone, code })).status).toBe(400);
  });

  it("penjagaan: password VIP salah, pernyataan identitas tidak ada, alasan tak dikenal, akun admin atau nonaktif", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const member = await createUser("USER");
    const admin = await createUser("ADMIN");
    const suspended = await createUser("USER", { status: "SUSPENDED" });
    const token = tokenOf(vip);

    expect((await issue(token, member.id, { password: "salah-salah-1234" })).status).toBe(403);
    expect((await issue(token, member.id, { identityChecked: false })).status).toBe(400);
    expect((await issue(token, member.id, { identityChecked: undefined })).status).toBe(400);
    expect((await issue(token, member.id, { reasonCode: "SEMBARANG" })).status).toBe(400);
    expect((await issue(token, admin.id)).body.code).toBe("AUTH_ASSIST_TARGET_INVALID");
    expect((await issue(token, vip.id)).status).toBe(409);
    expect((await issue(token, suspended.id)).status).toBe(409);
    expect((await issue(token, "00000000-0000-4000-8000-000000000999")).status).toBe(409);
    expect(await prisma.authChallenge.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "ACCOUNT_RECOVERY_CODE_ISSUED" } })).toBe(0);
  });
});
