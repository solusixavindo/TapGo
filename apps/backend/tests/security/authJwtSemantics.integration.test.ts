import { UserRole } from "@prisma/client";
import jwt from "jsonwebtoken";
import http, { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  prisma,
  runIntegration,
  testDatabaseUrl,
} from "../helpers/referralWalletHarness.js";
import {
  adminRateLimiter,
  apiRateLimiter,
} from "../../src/core/security/rateLimit.js";

/**
 * Stage 5.4 — semantik kegagalan JWT dan batas router admin ride.
 *
 * Menutup temuan I-1 (token invalid mengembalikan 500) dan I-2 (path admin ride
 * yang tidak dikenal dijawab sebagai error validasi, bukan 404 terkontrol),
 * serta membuktikan I-3 (userId internal tidak lagi diekspos).
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

const ISSUER = "tapgo-api";
const AUDIENCE = "tapgo-apps";

let appServer: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    adminRateLimiter.resetKey(key);
    apiRateLimiter.resetKey(key);
  }
}

describe.skipIf(!runIntegration)("Stage 5.4 — semantik JWT & batas router admin", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "auth-semantics-access-secret-00000000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "auth-semantics-refresh-secret-0000000000";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
    ]);
    signAccessToken = tokenService.signAccessToken;
    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    resetRateLimits();
    await cleanTables();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  // --- I-1: semantik kegagalan JWT ---------------------------------------

  it("token tidak ada -> 401 AUTH_TOKEN_MISSING", async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/rides`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe("AUTH_TOKEN_MISSING");
  });

  it("token malformed -> 401 AUTH_TOKEN_INVALID", async () => {
    const res = await authed("/api/v1/admin/rides", "bukan.jwt.valid");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe("AUTH_TOKEN_INVALID");
  });

  it("signature salah -> 401 AUTH_TOKEN_INVALID", async () => {
    const token = jwt.sign(
      { sub: randomUUID(), role: "ADMIN", sessionId: "s" },
      "secret-lain-yang-panjang-0123456789-aman",
      { expiresIn: "15m", issuer: ISSUER, audience: AUDIENCE },
    );
    const res = await authed("/api/v1/admin/rides", token);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe("AUTH_TOKEN_INVALID");
  });

  it("token kedaluwarsa -> 401 AUTH_TOKEN_EXPIRED", async () => {
    const token = jwt.sign(
      { sub: randomUUID(), role: "ADMIN", sessionId: "s" },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: "-10s", issuer: ISSUER, audience: AUDIENCE },
    );
    const res = await authed("/api/v1/admin/rides", token);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe("AUTH_TOKEN_EXPIRED");
  });

  it("audience salah -> 401 AUTH_TOKEN_INVALID", async () => {
    const token = jwt.sign(
      { sub: randomUUID(), role: "ADMIN", sessionId: "s" },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: "15m", issuer: ISSUER, audience: "audience-salah" },
    );
    const res = await authed("/api/v1/admin/rides", token);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe("AUTH_TOKEN_INVALID");
  });

  it("issuer salah -> 401 AUTH_TOKEN_INVALID", async () => {
    const token = jwt.sign(
      { sub: randomUUID(), role: "ADMIN", sessionId: "s" },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: "15m", issuer: "issuer-salah", audience: AUDIENCE },
    );
    const res = await authed("/api/v1/admin/rides", token);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe("AUTH_TOKEN_INVALID");
  });

  it("respons kegagalan JWT tidak membocorkan detail internal", async () => {
    for (const token of ["bukan.jwt.valid", jwt.sign({ sub: randomUUID() }, "x".repeat(40))]) {
      const body = await (await authed("/api/v1/admin/rides", token)).text();
      expect(body.toLowerCase()).not.toContain("jwt malformed");
      expect(body.toLowerCase()).not.toContain("jsonwebtoken");
      expect(body.toLowerCase()).not.toContain("invalid signature");
      expect(body.toLowerCase()).not.toContain("stack");
      expect(body.toLowerCase()).not.toContain("prisma");
      expect(body).not.toContain(token);
    }
  });

  it("refresh token yang tidak valid juga 401, bukan 500", async () => {
    // Panjang >= 32 agar lolos validator body dan benar-benar mencapai
    // verifikasi JWT (signature salah).
    const wrongSecretToken = jwt.sign(
      { sub: randomUUID(), role: "USER", sessionId: "s" },
      "refresh-secret-lain-0123456789-aman-sekali",
      { expiresIn: "30d", issuer: ISSUER, audience: AUDIENCE },
    );
    const res = await postJson("/api/v1/auth/refresh", { refreshToken: wrongSecretToken });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe("AUTH_TOKEN_INVALID");
  });

  it("refresh token kedaluwarsa -> 401 AUTH_TOKEN_EXPIRED", async () => {
    const expired = jwt.sign(
      { sub: randomUUID(), role: "USER", sessionId: "s" },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: "-10s", issuer: ISSUER, audience: AUDIENCE },
    );
    const res = await postJson("/api/v1/auth/refresh", { refreshToken: expired });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe("AUTH_TOKEN_EXPIRED");
  });

  it("refresh token terlalu pendek tetap ditolak validator (400) sebelum verifikasi JWT", async () => {
    const res = await postJson("/api/v1/auth/refresh", { refreshToken: "pendek" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("VALIDATION_ERROR");
  });

  // --- RBAC tidak berubah -------------------------------------------------

  it("token valid dan RBAC berperilaku seperti sebelumnya", async () => {
    const passenger = await createUser("USER");
    const driver = await createUser("DRIVER");
    const admin = await createUser("ADMIN");
    const superAdmin = await createUser("SUPER_ADMIN");

    expect((await authed("/api/v1/admin/rides", tokenFor(passenger))).status).toBe(403);
    expect((await authed("/api/v1/admin/rides", tokenFor(driver))).status).toBe(403);
    expect((await authed("/api/v1/admin/rides", tokenFor(admin))).status).toBe(200);
    expect((await authed("/api/v1/admin/rides", tokenFor(superAdmin))).status).toBe(200);
  });

  it("kegagalan internal/database tetap 500, tidak dikonversi menjadi 401", async () => {
    // Token valid secara kriptografis, tetapi sub-nya user yang tidak ada.
    // Penulisan AuditLog akan melanggar foreign key -> kegagalan internal.
    const driver = await createDriverProfile();
    const ghostAdmin = randomUUID();
    const res = await authed(
      `/api/v1/admin/rides/drivers/${driver.id}/status`,
      signAccessToken({ sub: ghostAdmin, role: "ADMIN", sessionId: "s" }),
      "PATCH",
      { status: "SUSPENDED", reason: "uji kegagalan internal" },
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("INTERNAL_SERVER_ERROR");
    // Bukan 401: perbaikan auth tidak melebar menelan error non-JWT.
    expect(res.status).not.toBe(401);
    // Rollback tetap terjadi.
    const after = await prisma.rideDriverProfile.findUniqueOrThrow({
      where: { id: driver.id },
    });
    expect(after.status).toBe("ACTIVE");
    expect(await prisma.auditLog.count()).toBe(0);
  });

  // --- I-2: batas router admin ride --------------------------------------

  it("path tak dikenal di bawah /api/v1/admin/rides/** -> 404 terkontrol", async () => {
    const admin = await createUser("ADMIN");
    const unknownPaths = [
      "/api/v1/admin/rides/tidak-ada-endpoint",
      "/api/v1/admin/rides/members",
      "/api/v1/admin/rides/dashboard/summary",
      "/api/v1/admin/rides/drivers/extra/segment",
      "/api/v1/admin/rides/vehicles/extra/segment",
    ];
    for (const path of unknownPaths) {
      const res = await authed(path, tokenFor(admin));
      expect(res.status).toBe(404);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("RIDE_ADMIN_ROUTE_NOT_FOUND");
    }
  });

  it("path tak dikenal tidak merembes ke modul admin lain", async () => {
    const admin = await createUser("ADMIN");
    // "members" adalah endpoint milik adminConsoleRouter; di bawah /admin/rides
    // ia harus tetap 404 milik router ride, bukan hasil dari admin console.
    const res = await authed("/api/v1/admin/rides/members", tokenFor(admin));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("RIDE_ADMIN_ROUTE_NOT_FOUND");
    expect(text).not.toContain("\"data\"");
  });

  it("referensi ride malformed -> 404 terkontrol tanpa membocorkan format", async () => {
    const admin = await createUser("ADMIN");
    for (const bad of ["RID-lowercase", "RID-SHORT", "RID-01234567890", "bukan-ref"]) {
      const res = await authed(`/api/v1/admin/rides/${bad}`, tokenFor(admin));
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text.toLowerCase()).not.toContain("prisma");
      expect(text.toLowerCase()).not.toContain("regex");
    }
  });

  it("delapan route admin sah tetap mencapai handler yang benar", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriverProfile();
    const vehicle = await prisma.rideVehicle.findFirstOrThrow({
      where: { driverProfileId: driver.id },
    });

    // 1 & 2: daftar ride dan daftar driver (array)
    for (const path of ["/api/v1/admin/rides", "/api/v1/admin/rides/drivers"]) {
      const res = await authed(path, tokenFor(admin));
      expect(res.status).toBe(200);
      expect(Array.isArray(((await res.json()) as { data: unknown[] }).data)).toBe(true);
    }

    // 3 & 4: detail driver dan detail kendaraan (objek spesifik)
    const drv = await authed(`/api/v1/admin/rides/drivers/${driver.id}`, tokenFor(admin));
    expect(drv.status).toBe(200);
    expect(((await drv.json()) as { data: { profileId: string } }).data.profileId).toBe(driver.id);

    const veh = await authed(`/api/v1/admin/rides/vehicles/${vehicle.id}`, tokenFor(admin));
    expect(veh.status).toBe(200);
    expect(((await veh.json()) as { data: { id: string } }).data.id).toBe(vehicle.id);

    // 5 & 6: moderasi driver dan kendaraan (PATCH)
    const drvPatch = await authed(
      `/api/v1/admin/rides/drivers/${driver.id}/status`,
      tokenFor(admin),
      "PATCH",
      { status: "SUSPENDED", reason: "uji routing 5.4" },
    );
    expect(drvPatch.status).toBe(200);

    const vehPatch = await authed(
      `/api/v1/admin/rides/vehicles/${vehicle.id}/verification`,
      tokenFor(admin),
      "PATCH",
      { verificationStatus: "REJECTED", reason: "uji routing 5.4" },
    );
    expect(vehPatch.status).toBe(200);

    // 7 & 8: detail ride + koreksi status ride
    const ride = await seedSearchingRide();
    const detail = await authed(`/api/v1/admin/rides/${ride.publicReference}`, tokenFor(admin));
    expect(detail.status).toBe(200);
    expect(
      ((await detail.json()) as { data: { reference: string } }).data.reference,
    ).toBe(ride.publicReference);

    const correction = await authed(
      `/api/v1/admin/rides/${ride.publicReference}/status`,
      tokenFor(admin),
      "PATCH",
      { status: "NO_DRIVER", reason: "uji routing 5.4" },
    );
    expect(correction.status).toBe(200);
    expect(
      ((await correction.json()) as { data: { status: string } }).data.status,
    ).toBe("NO_DRIVER");
  });

  // --- I-3: userId internal tidak diekspos -------------------------------

  it("respons driver admin tidak memuat userId internal", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriverProfile();

    const detail = await authed(`/api/v1/admin/rides/drivers/${driver.id}`, tokenFor(admin));
    const list = await authed("/api/v1/admin/rides/drivers", tokenFor(admin));
    const detailBody = (await detail.json()) as { data: Record<string, unknown> };
    const listText = await list.text();

    expect(Object.keys(detailBody.data)).not.toContain("userId");
    expect(detailBody.data.profileId).toBe(driver.id);
    expect(listText).not.toContain("\"userId\"");
    expect(listText).not.toContain(driver.userId);
    // Field tersanitasi tetap tersedia.
    expect(detailBody.data).toHaveProperty("phoneMasked");
    expect(detailBody.data).toHaveProperty("name");
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function cleanTables() {
  await prisma.auditLog.deleteMany();
  await prisma.rideEvent.deleteMany();
  await prisma.rideDriverLocation.deleteMany();
  await prisma.rideOrder.deleteMany();
  await prisma.rideQuote.deleteMany();
  await prisma.rideVehicle.deleteMany();
  await prisma.rideDriverProfile.deleteMany();
  await prisma.rideIdempotencyRecord.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
}

function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authed(path: string, token: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Auth Test ${sequence}`,
      phone: `+6281${String(sequence).padStart(9, "0")}`,
      referralCode: `AUTH${String(sequence).padStart(6, "0")}`,
      role,
    },
  });
}

async function createDriverProfile() {
  const user = await createUser("DRIVER");
  const profile = await prisma.rideDriverProfile.create({
    data: { userId: user.id, status: "ACTIVE", availability: "OFFLINE" },
  });
  await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: "MOTORCYCLE",
      plateNumberHash: "a".repeat(64),
      plateNumberMasked: "D 4321 ***",
      verificationStatus: "VERIFIED",
      isActive: true,
    },
  });
  return profile;
}

/** Ride pada status SEARCHING_DRIVER, dibuat langsung via Prisma. */
async function seedSearchingRide() {
  const passenger = await createUser("USER");
  const quote = await prisma.rideQuote.create({
    data: {
      userId: passenger.id,
      serviceType: "MOTORCYCLE",
      pickupLat: -6.12,
      pickupLng: 106.15,
      pickupAddress: "Titik jemput uji",
      dropoffLat: -6.131,
      dropoffLng: 106.141,
      dropoffAddress: "Titik tujuan uji",
      distanceMeters: 2200,
      durationSeconds: 300,
      etaSeconds: 120,
      baseFare: 5000,
      distanceFare: 5500,
      serviceFee: 1000,
      subtotalFare: 11500,
      totalFare: 11500,
      fareRuleVersion: "RIDE_FARE_RULE_V1",
      roundingRule: "ROUND_TO_NEAREST_100_HALF_UP",
      distanceSource: "HAVERSINE_LOCAL_V1",
      expiresAt: new Date(Date.now() + 120_000),
    },
  });
  return prisma.rideOrder.create({
    data: {
      publicReference: `RID-${"AB23456789"}`,
      passengerId: passenger.id,
      quoteId: quote.id,
      serviceType: "MOTORCYCLE",
      status: "SEARCHING_DRIVER",
      pickupLat: quote.pickupLat,
      pickupLng: quote.pickupLng,
      pickupAddress: quote.pickupAddress,
      dropoffLat: quote.dropoffLat,
      dropoffLng: quote.dropoffLng,
      dropoffAddress: quote.dropoffAddress,
      distanceMeters: quote.distanceMeters,
      durationSeconds: quote.durationSeconds,
      baseFare: quote.baseFare,
      distanceFare: quote.distanceFare,
      serviceFee: quote.serviceFee,
      subtotalFare: quote.subtotalFare,
      totalFare: quote.totalFare,
      fareRuleVersion: quote.fareRuleVersion,
      paymentMethod: "CASH",
      paymentState: "CASH_EXPECTED",
    },
  });
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`,
  });
}
