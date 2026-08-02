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
 * Production hotfix — pemulihan akun dan verifikasi kontak.
 *
 * Seluruh test memakai PostgreSQL nyata. Provider OTP disuntik dengan test
 * adapter yang merekam pengiriman; TIDAK ada provider palsu yang mengaku
 * berhasil mengirim di jalur kode produksi.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";
const provider = new RecordingOtpProvider();
let sequence = 0;

const EXISTING_PASSWORD = "LamaSekali123";
const NEW_PASSWORD = "PasswordBaru99";

type ApiResponse = {
  status: number;
  body: { success?: boolean; code?: string; message?: string; data?: Record<string, unknown> };
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

async function createAccount(options?: {
  email?: string;
  phoneVerified?: boolean;
  emailVerified?: boolean;
}) {
  sequence += 1;
  const phone = `08${String(sequence).padStart(10, "0")}`;
  return prisma.user.create({
    data: {
      fullName: `Recovery User ${sequence}`,
      phone,
      referralCode: `REC${String(sequence).padStart(6, "0")}`,
      passwordHash: await hashPassword(EXISTING_PASSWORD),
      ...(options?.email ? { email: options.email } : {}),
      ...(options?.phoneVerified ? { phoneVerifiedAt: new Date() } : {}),
      ...(options?.emailVerified ? { emailVerifiedAt: new Date() } : {})
    }
  });
}

/** Menjalankan alur lengkap sampai reset token di tangan. */
async function runRecoveryUntilToken(identifier: string) {
  provider.reset();
  const requested = await api("POST", "/api/v1/auth/recovery/request", { identifier });
  expect(requested.status).toBe(202);
  const code = provider.lastCode();
  const verified = await api("POST", "/api/v1/auth/recovery/verify", { identifier, code });
  expect(verified.status).toBe(200);
  return { code, resetToken: verified.body.data?.resetToken as string };
}

describeIntegration("Production hotfix — account recovery", () => {
  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-please-change-000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-please-change-00000";
    // Secret sintetis khusus test. Bukan nilai produksi.
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
    await resetRateLimits();
  });

  async function resetRateLimits() {
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.authRateLimiter.resetKey(key);
      limiters.recoveryIpRateLimiter.resetKey(key);
      limiters.apiRateLimiter.resetKey(key);
    }
  }

  // -----------------------------------------------------------------
  // 1-2 — tidak ada account enumeration
  // -----------------------------------------------------------------

  it("1. akun yang ada dan tidak ada memberi respons publik identik", async () => {
    const user = await createAccount();

    const existing = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: user.phone
    });
    const missing = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: "081999999999"
    });

    expect(existing.status).toBe(missing.status);
    expect(existing.status).toBe(202);
    // Perbandingan struktural penuh: tidak ada satu pun field yang berbeda.
    expect(existing.body).toEqual(missing.body);
    expect(existing.body.data?.message).toBe(
      "Jika akun ditemukan, instruksi pemulihan telah dikirim."
    );
  });

  it("2. selisih waktu respons tidak ekstrem antara akun ada dan tidak ada", async () => {
    const user = await createAccount();

    const timeOf = async (identifier: string) => {
      const started = Date.now();
      await api("POST", "/api/v1/auth/recovery/request", { identifier });
      return Date.now() - started;
    };

    const existing = await timeOf(user.phone);
    const missing = await timeOf("081888888888");

    // Lantai waktu seragam membuat keduanya berada pada orde yang sama.
    // Ambang longgar dipakai sengaja: yang diuji adalah tidak adanya oracle
    // yang jelas, bukan kesamaan sempurna yang mustahil dijamin.
    const ratio = Math.max(existing, missing) / Math.max(Math.min(existing, missing), 1);
    expect(ratio).toBeLessThan(3);
  });

  // -----------------------------------------------------------------
  // 3 — kanal belum terverifikasi
  // -----------------------------------------------------------------

  it("3. email yang belum diverifikasi tidak dipakai sebagai recovery channel", async () => {
    await createAccount({ email: "belum@contoh.test", emailVerified: false });

    const response = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: "belum@contoh.test"
    });

    // Respons tetap generik supaya tidak bocor, tetapi tidak ada kode dikirim.
    expect(response.status).toBe(202);
    expect(provider.count()).toBe(0);

    await createAccount({ email: "sudah@contoh.test", emailVerified: true });
    await api("POST", "/api/v1/auth/recovery/request", { identifier: "sudah@contoh.test" });
    expect(provider.count()).toBe(1);
  });

  // -----------------------------------------------------------------
  // 4-9 — perilaku OTP
  // -----------------------------------------------------------------

  it("4. OTP valid diterima dan menerbitkan reset token", async () => {
    const user = await createAccount();
    const { resetToken } = await runRecoveryUntilToken(user.phone);

    expect(resetToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("5. OTP salah ditolak", async () => {
    const user = await createAccount();
    await api("POST", "/api/v1/auth/recovery/request", { identifier: user.phone });
    const realCode = provider.lastCode();
    const wrongCode = realCode === "111111" ? "222222" : "111111";

    const response = await api("POST", "/api/v1/auth/recovery/verify", {
      identifier: user.phone,
      code: wrongCode
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("AUTH_RECOVERY_INVALID_OR_EXPIRED");
  });

  it("6. OTP kedaluwarsa ditolak", async () => {
    const user = await createAccount();
    await api("POST", "/api/v1/auth/recovery/request", { identifier: user.phone });
    const code = provider.lastCode();

    // Memundurkan expiry lewat database, bukan lewat menunggu nyata.
    await prisma.authChallenge.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const response = await api("POST", "/api/v1/auth/recovery/verify", {
      identifier: user.phone,
      code
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("AUTH_RECOVERY_INVALID_OR_EXPIRED");
  });

  it("7. OTP hanya dapat dipakai sekali", async () => {
    const user = await createAccount();
    const { code } = await runRecoveryUntilToken(user.phone);

    const second = await api("POST", "/api/v1/auth/recovery/verify", {
      identifier: user.phone,
      code
    });

    expect(second.status).toBe(400);
    expect(second.body.code).toBe("AUTH_RECOVERY_INVALID_OR_EXPIRED");
  });

  it("8. konsumsi reset token serentak hanya menghasilkan satu pemenang", async () => {
    const user = await createAccount();
    const { resetToken } = await runRecoveryUntilToken(user.phone);

    const results = await Promise.all([
      api("POST", "/api/v1/auth/recovery/reset", { resetToken, newPassword: NEW_PASSWORD }),
      api("POST", "/api/v1/auth/recovery/reset", { resetToken, newPassword: "PasswordLain88" })
    ]);

    const ok = results.filter((result) => result.status === 200);
    const rejected = results.filter((result) => result.status === 400);

    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.body.code).toBe("AUTH_RECOVERY_INVALID_OR_EXPIRED");
  });

  it("9. batas percobaan maksimum bekerja", async () => {
    const user = await createAccount();
    await api("POST", "/api/v1/auth/recovery/request", { identifier: user.phone });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await api("POST", "/api/v1/auth/recovery/verify", {
        identifier: user.phone,
        code: "000000"
      });
      statuses.push(response.status);
      if (response.body.code === "AUTH_RECOVERY_ATTEMPTS_EXCEEDED") {
        break;
      }
    }

    const challenge = await prisma.authChallenge.findFirstOrThrow({
      where: { userId: user.id }
    });
    expect(challenge.attempts).toBe(challenge.maxAttempts);

    const blocked = await api("POST", "/api/v1/auth/recovery/verify", {
      identifier: user.phone,
      code: "000000"
    });
    expect(blocked.body.code).toBe("AUTH_RECOVERY_ATTEMPTS_EXCEEDED");
    expect(statuses.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------
  // 10-11 — cooldown dan rate limit
  // -----------------------------------------------------------------

  it("10. cooldown kirim ulang bekerja", async () => {
    const user = await createAccount();

    await api("POST", "/api/v1/auth/recovery/request", { identifier: user.phone });
    expect(provider.count()).toBe(1);

    // Permintaan kedua dalam cooldown: respons tetap generik, tetapi tidak
    // ada kode kedua yang dikirim.
    const second = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: user.phone
    });
    expect(second.status).toBe(202);
    expect(provider.count()).toBe(1);

    // Setelah cooldown lewat, pengiriman diizinkan lagi.
    await prisma.authChallenge.updateMany({
      where: { userId: user.id },
      data: { lastSentAt: new Date(Date.now() - 61 * 1000) }
    });
    await api("POST", "/api/v1/auth/recovery/request", { identifier: user.phone });
    expect(provider.count()).toBe(2);
  });

  it("11. rate limit per akun target bekerja", async () => {
    const user = await createAccount();

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await api("POST", "/api/v1/auth/recovery/request", {
        identifier: user.phone
      });
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
    const limited = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: user.phone
    });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("AUTH_RECOVERY_RATE_LIMITED");
  });

  // -----------------------------------------------------------------
  // 12-15 — password dan sesi
  // -----------------------------------------------------------------

  it("12. kebijakan password baru ditegakkan", async () => {
    const user = await createAccount();
    const { resetToken } = await runRecoveryUntilToken(user.phone);

    for (const weak of ["pendek1", "tanpaangkasamasekali", "123456789"]) {
      const response = await api("POST", "/api/v1/auth/recovery/reset", {
        resetToken,
        newPassword: weak
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("AUTH_PASSWORD_POLICY_FAILED");
    }

    // Token tetap dapat dipakai setelah penolakan kebijakan: kegagalan
    // kebijakan tidak boleh menghanguskan tantangan yang sah.
    const accepted = await api("POST", "/api/v1/auth/recovery/reset", {
      resetToken,
      newPassword: NEW_PASSWORD
    });
    expect(accepted.status).toBe(200);
  });

  it("13. sesi lama tidak berlaku setelah reset", async () => {
    const user = await createAccount();

    const loggedIn = await api("POST", "/api/v1/auth/login", {
      phone: user.phone,
      password: EXISTING_PASSWORD
    });
    expect(loggedIn.status).toBe(200);
    const oldAccessToken = loggedIn.body.data?.accessToken as string;
    const oldRefreshToken = loggedIn.body.data?.refreshToken as string;

    const before = await api("GET", "/api/v1/auth/me", undefined, oldAccessToken);
    expect(before.status).toBe(200);

    // Detik penuh dilewati agar `iat` token benar-benar mendahului epoch
    // pencabutan; `iat` hanya berpresisi detik.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const { resetToken } = await runRecoveryUntilToken(user.phone);
    const reset = await api("POST", "/api/v1/auth/recovery/reset", {
      resetToken,
      newPassword: NEW_PASSWORD
    });
    expect(reset.status).toBe(200);

    const afterAccess = await api("GET", "/api/v1/auth/me", undefined, oldAccessToken);
    expect(afterAccess.status).toBe(401);
    expect(afterAccess.body.code).toBe("AUTH_SESSION_REVOKED");

    const afterRefresh = await api("POST", "/api/v1/auth/refresh", {
      refreshToken: oldRefreshToken
    });
    expect(afterRefresh.status).toBe(401);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it("14. password lama gagal setelah reset", async () => {
    const user = await createAccount();
    const { resetToken } = await runRecoveryUntilToken(user.phone);
    await api("POST", "/api/v1/auth/recovery/reset", { resetToken, newPassword: NEW_PASSWORD });

    const response = await api("POST", "/api/v1/auth/login", {
      phone: user.phone,
      password: EXISTING_PASSWORD
    });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("15. password baru berhasil dan reset tidak otomatis login", async () => {
    const user = await createAccount();
    const { resetToken } = await runRecoveryUntilToken(user.phone);

    const reset = await api("POST", "/api/v1/auth/recovery/reset", {
      resetToken,
      newPassword: NEW_PASSWORD
    });
    expect(reset.status).toBe(200);
    // Tidak ada token sesi apa pun pada respons reset.
    expect(reset.body.data?.accessToken).toBeUndefined();
    expect(reset.body.data?.refreshToken).toBeUndefined();

    const login = await api("POST", "/api/v1/auth/login", {
      phone: user.phone,
      password: NEW_PASSWORD
    });
    expect(login.status).toBe(200);
    expect(login.body.data?.accessToken).toBeDefined();
  });

  // -----------------------------------------------------------------
  // 16 — tidak ada kebocoran material sensitif
  // -----------------------------------------------------------------

  it("16. OTP, reset token, dan PII tidak muncul pada respons maupun database", async () => {
    const user = await createAccount({ email: "bocor@contoh.test", emailVerified: true });

    const requested = await api("POST", "/api/v1/auth/recovery/request", {
      identifier: user.phone
    });
    const code = provider.lastCode();

    const requestedJson = JSON.stringify(requested.body);
    expect(requestedJson).not.toContain(code);
    expect(requestedJson).not.toContain(user.phone);
    expect(requestedJson).not.toContain("bocor@contoh.test");

    const verified = await api("POST", "/api/v1/auth/recovery/verify", {
      identifier: user.phone,
      code
    });
    const verifiedJson = JSON.stringify(verified.body);
    expect(verifiedJson).not.toContain(code);
    // Destination hanya boleh tampil dalam bentuk tersamarkan.
    expect(verifiedJson).not.toContain(user.phone);
    expect(verified.body.data?.maskedDestination).toMatch(/^\*+\d{4}$/);

    // Database tidak menyimpan kode, nomor, maupun email mentah.
    const challenge = await prisma.authChallenge.findFirstOrThrow({
      where: { userId: user.id }
    });
    const stored = JSON.stringify(challenge);
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(user.phone);
    expect(stored).not.toContain("bocor@contoh.test");
    expect(challenge.codeDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.destinationDigest).toMatch(/^[0-9a-f]{64}$/);

    const resetToken = verified.body.data?.resetToken as string;
    expect(challenge.resetTokenDigest).not.toBe(resetToken);
  });

  // -----------------------------------------------------------------
  // 17-18 — verifikasi kontak dan akun legacy
  // -----------------------------------------------------------------

  it("18. akun legacy tidak auto-verified dan terverifikasi hanya lewat bukti OTP", async () => {
    const legacy = await createAccount();

    // Migration tidak melakukan backfill: akun lama mulai tanpa status.
    expect(legacy.phoneVerifiedAt).toBeNull();
    expect(legacy.emailVerifiedAt).toBeNull();

    const { resetToken } = await runRecoveryUntilToken(legacy.phone);
    await api("POST", "/api/v1/auth/recovery/reset", { resetToken, newPassword: NEW_PASSWORD });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
    // Kepemilikan nomor baru saja dibuktikan lewat OTP, jadi sekarang terisi.
    expect(after.phoneVerifiedAt).not.toBeNull();
  });

  // -----------------------------------------------------------------
  // 19-20 — tidak ada kerusakan sampingan
  // -----------------------------------------------------------------

  it("19. data penumpang tetap utuh setelah pemulihan", async () => {
    const user = await createAccount();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    const { resetToken } = await runRecoveryUntilToken(user.phone);
    await api("POST", "/api/v1/auth/recovery/reset", { resetToken, newPassword: NEW_PASSWORD });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // Identitas akun tidak berubah: tidak ada akun duplikat, tidak ada
    // penggantian id, referral code, nomor, maupun role.
    expect(after.id).toBe(before.id);
    expect(after.referralCode).toBe(before.referralCode);
    expect(after.phone).toBe(before.phone);
    expect(after.role).toBe(before.role);
    expect(after.status).toBe(before.status);
    expect(after.fullName).toBe(before.fullName);
    expect(await prisma.user.count()).toBe(1);
  });

  it("20. pemulihan tidak menyentuh state finansial maupun Business Engine", async () => {
    const user = await createAccount();

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
      profitSharingDistributions: await prisma.profitSharingDistribution.count(),
      referrals: await prisma.referral.count()
    });

    const before = await snapshot();
    const { resetToken } = await runRecoveryUntilToken(user.phone);
    await api("POST", "/api/v1/auth/recovery/reset", { resetToken, newPassword: NEW_PASSWORD });
    const after = await snapshot();

    expect(after).toEqual(before);
  });

  // -----------------------------------------------------------------
  // 21 — provider fail-closed (bukan bagian daftar wajib, tetapi inti
  //      dari keputusan Owner 8: dilarang ada fake-success provider)
  // -----------------------------------------------------------------

  it("21. tanpa provider nyata, pengiriman gagal terbuka dan tidak pernah palsu", async () => {
    const user = await createAccount();
    resetOtpDeliveryProvider();

    try {
      const requested = await api("POST", "/api/v1/auth/recovery/request", {
        identifier: user.phone
      });
      // Respons publik tetap generik agar tidak bocor.
      expect(requested.status).toBe(202);

      // Tetapi tidak ada kode yang beredar, dan verifikasi mustahil berhasil.
      const verify = await api("POST", "/api/v1/auth/recovery/verify", {
        identifier: user.phone,
        code: "123456"
      });
      expect(verify.status).toBe(400);
      expect(verify.body.code).toBe("AUTH_RECOVERY_INVALID_OR_EXPIRED");
    } finally {
      setOtpDeliveryProvider(provider);
    }
  });
});
