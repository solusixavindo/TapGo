import { UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  prisma,
  runIntegration,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";
import { authRateLimiter, registerPhoneRateLimiter } from "../../src/core/security/rateLimit.js";

/**
 * Batas role registrasi publik.
 *
 * Sebelum Stage 5.8, registerBodySchema menerima role: z.enum(["USER","DRIVER"])
 * dan AuthService memakainya BAIK untuk tx.user.create MAUPUN untuk
 * issueTokenPair — sehingga klien dapat self-register sebagai DRIVER dan
 * langsung memegang access token ber-role DRIVER tanpa persetujuan apa pun.
 *
 * Kontrak sekarang: role adalah keputusan SERVER. Permintaan yang memuat field
 * "role" gagal tertutup dengan 400.
 */

let appServer: Server | undefined;
let baseUrl = "";
let sequence = 0;

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    authRateLimiter.resetKey(key);
    registerPhoneRateLimiter.resetKey(key);
  }
}

function nextPhone() {
  sequence += 1;
  return `+62812${String(sequence).padStart(8, "0")}`;
}

async function postRegister(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Calon Pengguna",
    phone: nextPhone(),
    password: "rahasia123",
    ...overrides
  };
}

describe.skipIf(!runIntegration)("Batas role registrasi publik", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "role-boundary-access-secret-00000000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "role-boundary-refresh-secret-0000000000";

    const { createApp } = await import("../../src/app.js");
    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    resetRateLimits();
    await prisma.abuseFlag.deleteMany();
    await prisma.registrationEvent.deleteMany();
    await prisma.session.deleteMany();
    await prisma.walletTransaction.deleteMany();
    await prisma.wallet.deleteMany();
    await prisma.referralLevel.deleteMany();
    await prisma.referral.deleteMany();
    await prisma.user.deleteMany();
    await prisma.registrationQuota.upsert({
      where: { key: "BASIC_PPOB_FIRST_1000" },
      create: { key: "BASIC_PPOB_FIRST_1000", limit: 1000, granted: 0 },
      update: { granted: 0 }
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  it("1. registrasi publik normal membuat akun USER", async () => {
    const res = await postRegister(validPayload());
    expect(res.status).toBe(201);

    const created = await prisma.user.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(created.role).toBe(UserRole.USER);
  });

  for (const role of ["USER", "DRIVER", "ADMIN", "SUPER_ADMIN"] as const) {
    it(`registrasi publik dengan role ${role} ditolak 400`, async () => {
      const res = await postRegister(validPayload({ role }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      // Tidak ada akun yang terbentuk.
      expect(await prisma.user.count()).toBe(0);
    });
  }

  it("6. tidak ada field permintaan yang dapat menimpa role otoritatif server", async () => {
    // Varian penulisan/pembungkusan yang mungkin dicoba penyerang.
    const attempts: Array<Record<string, unknown>> = [
      { role: "DRIVER" },
      { role: "driver" },
      { role: null },
      { role: ["DRIVER"] },
      { role: { value: "DRIVER" } },
      { userRole: "DRIVER" },
      { authoritativeRole: "DRIVER" },
      { user: { role: "DRIVER" } }
    ];

    let created = 0;
    for (const attempt of attempts) {
      resetRateLimits();
      const res = await postRegister(validPayload(attempt));
      if ("role" in attempt) {
        // Field "role" -> fail closed 400.
        expect(res.status, `payload ${JSON.stringify(attempt)}`).toBe(400);
      } else {
        // Field tak dikenal diabaikan (perilaku lama dipertahankan), tetapi role
        // yang tersimpan tetap USER.
        expect(res.status, `payload ${JSON.stringify(attempt)}`).toBe(201);
        created += 1;
      }
    }

    expect(await prisma.user.count()).toBe(created);
    const roles = await prisma.user.findMany({ select: { role: true } });
    expect(roles.every((r) => r.role === UserRole.USER)).toBe(true);
  });

  it("18. tidak ada rute eskalasi ke ADMIN/SUPER_ADMIN lewat registrasi", async () => {
    for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
      resetRateLimits();
      const res = await postRegister(validPayload({ role }));
      expect(res.status).toBe(400);
    }
    // Nol akun ADMIN/SUPER_ADMIN pernah terbentuk.
    expect(
      await prisma.user.count({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } } })
    ).toBe(0);
    expect(await prisma.user.count({ where: { role: "DRIVER" } })).toBe(0);
  });

  it("20. token hasil registrasi selalu ber-role USER (bukan pilihan klien)", async () => {
    const res = await postRegister(validPayload());
    expect(res.status).toBe(201);

    const data = res.body.data as { accessToken: string; user?: { role?: string } };
    expect(typeof data.accessToken).toBe("string");

    // Decode payload JWT tanpa memverifikasi signature — cukup untuk memastikan
    // klaim role yang dicetak server.
    const payload = JSON.parse(
      Buffer.from(data.accessToken.split(".")[1]!, "base64url").toString("utf8")
    ) as { role: string };
    expect(payload.role).toBe("USER");
  });

  it("19. respons registrasi tidak memuat IP, device identifier, atau password", async () => {
    const res = await postRegister(
      validPayload({ deviceId: "device-id-uji-0001", deviceFingerprint: "fingerprint-uji-0001" })
    );
    expect(res.status).toBe(201);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("device-id-uji-0001");
    expect(serialized).not.toContain("fingerprint-uji-0001");
    expect(serialized).not.toContain("rahasia123");
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toMatch(/passwordHash/i);

    // Device identifier hanya tersimpan dalam bentuk hash, bukan nilai mentah.
    const event = await prisma.registrationEvent.findFirstOrThrow({
      orderBy: { createdAt: "desc" }
    });
    expect(event.deviceFingerprintHash).not.toBe("fingerprint-uji-0001");
    expect(event.deviceFingerprintHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("7. onboarding driver: role DRIVER tidak dapat diperoleh, dan endpoint driver tetap fail-closed", async () => {
    // Audit Stage 5.8 membuktikan tidak ada jalur produksi yang membuat
    // RideDriverProfile (nol rideDriverProfile.create di src/). Jadi tidak ada
    // onboarding driver yang rusak akibat penutupan role publik ini.
    const res = await postRegister(validPayload());
    expect(res.status).toBe(201);
    const token = (res.body.data as { accessToken: string }).accessToken;

    // Akun hasil registrasi publik ber-role USER, sehingga endpoint driver
    // menolaknya pada lapisan RBAC (bukan 500, bukan sukses).
    const driverRes = await fetch(`${baseUrl}/api/v1/driver/availability`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ availability: "ONLINE" })
    });
    expect([401, 403]).toContain(driverRes.status);
    expect(await prisma.rideDriverProfile.count()).toBe(0);
  });
});
