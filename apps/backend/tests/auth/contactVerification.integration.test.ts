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
 * Production hotfix — verifikasi nomor telepon dan email.
 *
 * Nomor telepon adalah primary identifier dan wajib terbukti. Email opsional,
 * tetapi bila diisi harus terbukti sebelum boleh menjadi recovery channel.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";
const provider = new RecordingOtpProvider();
let sequence = 0;

const PASSWORD = "PasswordAwal12";

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

async function createAccountAndLogin(options?: { email?: string }) {
  sequence += 1;
  const phone = `08${String(700000000 + sequence)}`;
  const user = await prisma.user.create({
    data: {
      fullName: `Verify User ${sequence}`,
      phone,
      referralCode: `VER${String(sequence).padStart(6, "0")}`,
      passwordHash: await hashPassword(PASSWORD),
      ...(options?.email ? { email: options.email } : {})
    }
  });

  const login = await api("POST", "/api/v1/auth/login", { phone, password: PASSWORD });
  expect(login.status).toBe(200);
  return { user, token: login.body.data?.accessToken as string };
}

describeIntegration("Production hotfix — contact verification", () => {
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
    // cleanDatabase() dipakai, bukan user.deleteMany() langsung: beberapa
    // tabel finansial (withdrawals, referrals) memakai FK RESTRICT ke users,
    // sehingga penghapusan harus mengikuti urutan lengkap milik harness.
    // Session dan AuthChallenge ikut terhapus lewat cascade.
    await cleanDatabase();
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.authRateLimiter.resetKey(key);
      limiters.recoveryIpRateLimiter.resetKey(key);
      limiters.apiRateLimiter.resetKey(key);
    }
  });

  it("akun baru belum terverifikasi dan verification gate menyala", async () => {
    const { token } = await createAccountAndLogin();

    const status = await api("GET", "/api/v1/auth/verification/status", undefined, token);

    expect(status.status).toBe(200);
    const phone = status.body.data?.phone as Record<string, unknown>;
    expect(phone.verified).toBe(false);
    expect(status.body.data?.requiresVerification).toBe(true);
    // Nomor hanya tampil tersamarkan, bahkan untuk pemilik akun sendiri.
    expect(String(phone.masked)).toMatch(/^\*+\d{4}$/);
    expect(status.body.data?.email).toBeNull();
  });

  it("verifikasi nomor telepon berhasil lewat OTP dan mematikan gate", async () => {
    const { user, token } = await createAccountAndLogin();

    const requested = await api(
      "POST",
      "/api/v1/auth/verification/request",
      { channel: "PHONE" },
      token
    );
    expect(requested.status).toBe(202);
    expect(String(requested.body.data?.maskedDestination)).toMatch(/^\*+\d{4}$/);

    const confirmed = await api(
      "POST",
      "/api/v1/auth/verification/confirm",
      { channel: "PHONE", code: provider.lastCode() },
      token
    );
    expect(confirmed.status).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.phoneVerifiedAt).not.toBeNull();

    const status = await api("GET", "/api/v1/auth/verification/status", undefined, token);
    expect(status.body.data?.requiresVerification).toBe(false);
  });

  it("OTP verifikasi salah ditolak dan tidak menandai apa pun", async () => {
    const { user, token } = await createAccountAndLogin();
    await api("POST", "/api/v1/auth/verification/request", { channel: "PHONE" }, token);

    const wrong = provider.lastCode() === "111111" ? "222222" : "111111";
    const confirmed = await api(
      "POST",
      "/api/v1/auth/verification/confirm",
      { channel: "PHONE", code: wrong },
      token
    );

    expect(confirmed.status).toBe(400);
    expect(confirmed.body.code).toBe("AUTH_RECOVERY_INVALID_OR_EXPIRED");
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.phoneVerifiedAt).toBeNull();
  });

  it("OTP verifikasi hanya sekali pakai", async () => {
    const { token } = await createAccountAndLogin();
    await api("POST", "/api/v1/auth/verification/request", { channel: "PHONE" }, token);
    const code = provider.lastCode();

    const first = await api(
      "POST",
      "/api/v1/auth/verification/confirm",
      { channel: "PHONE", code },
      token
    );
    expect(first.status).toBe(200);

    const second = await api(
      "POST",
      "/api/v1/auth/verification/confirm",
      { channel: "PHONE", code },
      token
    );
    expect(second.status).toBe(400);
  });

  it("verifikasi email opsional bekerja dan email kosong ditolak", async () => {
    const withoutEmail = await createAccountAndLogin();
    const rejected = await api(
      "POST",
      "/api/v1/auth/verification/request",
      { channel: "EMAIL" },
      withoutEmail.token
    );
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("AUTH_CONTACT_NOT_VERIFIED");

    const withEmail = await createAccountAndLogin({ email: "opsional@contoh.test" });
    const requested = await api(
      "POST",
      "/api/v1/auth/verification/request",
      { channel: "EMAIL" },
      withEmail.token
    );
    expect(requested.status).toBe(202);
    expect(requested.body.data?.maskedDestination).toBe("o*******@contoh.test");

    const confirmed = await api(
      "POST",
      "/api/v1/auth/verification/confirm",
      { channel: "EMAIL", code: provider.lastCode() },
      withEmail.token
    );
    expect(confirmed.status).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: withEmail.user.id } });
    expect(stored.emailVerifiedAt).not.toBeNull();
    // Verifikasi email TIDAK ikut memverifikasi nomor telepon.
    expect(stored.phoneVerifiedAt).toBeNull();
  });

  it("cooldown kirim ulang berlaku pada verifikasi", async () => {
    const { user, token } = await createAccountAndLogin();

    await api("POST", "/api/v1/auth/verification/request", { channel: "PHONE" }, token);
    expect(provider.count()).toBe(1);

    const tooSoon = await api(
      "POST",
      "/api/v1/auth/verification/request",
      { channel: "PHONE" },
      token
    );
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.code).toBe("AUTH_RECOVERY_RATE_LIMITED");
    expect(provider.count()).toBe(1);

    await prisma.authChallenge.updateMany({
      where: { userId: user.id },
      data: { lastSentAt: new Date(Date.now() - 61 * 1000) }
    });
    const allowed = await api(
      "POST",
      "/api/v1/auth/verification/request",
      { channel: "PHONE" },
      token
    );
    expect(allowed.status).toBe(202);
    expect(provider.count()).toBe(2);
  });

  it("hanya satu tantangan aktif per purpose, ditegakkan database", async () => {
    const { user, token } = await createAccountAndLogin();

    await api("POST", "/api/v1/auth/verification/request", { channel: "PHONE" }, token);
    await prisma.authChallenge.updateMany({
      where: { userId: user.id },
      data: { lastSentAt: new Date(Date.now() - 61 * 1000) }
    });
    await api("POST", "/api/v1/auth/verification/request", { channel: "PHONE" }, token);

    // Kirim ulang memperbarui baris yang sama, bukan menambah baris baru.
    const active = await prisma.authChallenge.count({
      where: { userId: user.id, purpose: "PHONE_VERIFICATION", consumedAt: null }
    });
    expect(active).toBe(1);

    // Partial unique index membuat baris aktif kedua mustahil disisipkan.
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'auth_challenges_one_active_per_purpose_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("WHERE (consumed_at IS NULL)");
  });

  it("perubahan nomor atau email menghapus status verifikasi", async () => {
    const { user } = await createAccountAndLogin({ email: "awal@contoh.test" });
    await prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: new Date(), emailVerifiedAt: new Date() }
    });

    const afterPhoneChange = await prisma.user.update({
      where: { id: user.id },
      data: { phone: "089999000111" }
    });
    expect(afterPhoneChange.phoneVerifiedAt).toBeNull();
    // Email tidak ikut tercabut karena tidak berubah.
    expect(afterPhoneChange.emailVerifiedAt).not.toBeNull();

    const afterEmailChange = await prisma.user.update({
      where: { id: user.id },
      data: { email: "baru@contoh.test" }
    });
    expect(afterEmailChange.emailVerifiedAt).toBeNull();

    // Update yang tidak menyentuh kontak tidak mencabut apa pun.
    await prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: new Date() }
    });
    const afterUnrelated = await prisma.user.update({
      where: { id: user.id },
      data: { fullName: "Nama Berubah" }
    });
    expect(afterUnrelated.phoneVerifiedAt).not.toBeNull();
  });

  it("endpoint verifikasi menolak permintaan tanpa autentikasi", async () => {
    for (const [method, path] of [
      ["GET", "/api/v1/auth/verification/status"],
      ["POST", "/api/v1/auth/verification/request"],
      ["POST", "/api/v1/auth/verification/confirm"]
    ] as const) {
      const response = await api(method, path, method === "GET" ? undefined : { channel: "PHONE" });
      expect(response.status).toBe(401);
    }
  });

  it("verifikasi kontak tidak mengubah role maupun state finansial", async () => {
    const { user, token } = await createAccountAndLogin();

    const snapshot = async () => ({
      wallets: await prisma.wallet.count(),
      walletTransactions: await prisma.walletTransaction.count(),
      commissions: await prisma.commission.count(),
      invoices: await prisma.invoice.count(),
      membershipPayments: await prisma.membershipPayment.count(),
      userMemberships: await prisma.userMembership.count(),
      rewardTransactions: await prisma.rewardTransaction.count()
    });

    const before = await snapshot();
    await api("POST", "/api/v1/auth/verification/request", { channel: "PHONE" }, token);
    await api(
      "POST",
      "/api/v1/auth/verification/confirm",
      { channel: "PHONE", code: provider.lastCode() },
      token
    );
    const after = await snapshot();

    expect(after).toEqual(before);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.role).toBe("USER");
    expect(stored.status).toBe("ACTIVE");
  });
});
