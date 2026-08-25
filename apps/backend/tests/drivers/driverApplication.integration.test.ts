import crypto from "node:crypto";
import { AdminScope, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * H1 — pengajuan mandiri mitra driver (keputusan Owner K1-A..K4-A + D1).
 *
 * Yang diuji pada PostgreSQL nyata, tanpa mock:
 * - K1-A: submit tanpa keempat dokumen lengkap DITOLAK.
 * - D1: dokumen bisa diunggah sebelum profil driver ada; pradataur dibuat
 *   otomatis, dan dokumen pengajuan terbuka kebal penyapuan retensi.
 * - K2-A: plat tersimpan hanya sebagai hash SHA-256 + bentuk ter-mask.
 * - K3-A: hanya admin pemegang klaim aktif yang dapat approve/reject.
 * - K4-A: approve menciptakan RideDriverProfile + RideVehicle.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  crypto.randomFillSync(Buffer.alloc(48))
]);

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let restore: () => void = () => {};
let sequence = 0;

async function api(
  path: string,
  options: { token?: string; method?: string; body?: unknown; raw?: Buffer } = {}
): Promise<{ status: number; body: { code?: string; data?: any } }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body !== undefined || options.raw ? "POST" : "GET"),
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.raw ? { "content-type": "image/png" } : { "content-type": "application/json" })
    },
    ...(options.raw
      ? { body: new Uint8Array(options.raw) }
      : options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {})
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

async function createAccount(prefix: string, role: UserRole = "USER") {
  sequence += 1;
  const suffix = String(sequence).padStart(4, "0");
  const user: User = await prisma.user.create({
    data: {
      fullName: `Uji ${prefix} ${suffix}`,
      phone: `62819${suffix}${String(sequence + 500)}`,
      passwordHash: "hash-uji",
      referralCode: `${prefix}${suffix}`,
      role
    }
  });
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: `hash-${user.id}`,
      expiresAt: new Date(Date.now() + 3_600_000)
    }
  });
  return { user, token: signAccessToken({ sub: user.id, role, sessionId: session.id }) };
}

/** Mengunggah keempat dokumen wajib lewat HTTP nyata. */
async function uploadAllDocuments(account: { token: string }) {
  for (const type of ["ktp", "sim", "stnk", "selfie"]) {
    const res = await api(`/api/v1/driver/documents/${type}`, {
      token: account.token,
      raw: PNG
    });
    expect(res.status).toBe(201);
  }
}

const REVIEW_SCOPES: AdminScope[] = [
  "DRIVER_APPLICATION_QUEUE_READ",
  "DRIVER_APPLICATION_CLAIM",
  "DRIVER_APPLICATION_RENEW",
  "DRIVER_APPLICATION_RELEASE",
  "DRIVER_APPLICATION_REASSIGN"
];

async function createReviewer(scopes: AdminScope[] = REVIEW_SCOPES) {
  const grantor = await createAccount("GRANT", "SUPER_ADMIN");
  const admin = await createAccount("REVW", "ADMIN");
  for (const scope of scopes) {
    await prisma.adminScopeGrant.create({
      data: { userId: admin.user.id, scope, grantedById: grantor.user.id, status: "ACTIVE" }
    });
  }
  return admin;
}

async function submitApplication(account: { token: string }, plate = "B 1234 UJI") {
  return api("/api/v1/driver/applications", {
    token: account.token,
    body: { serviceType: "MOTORCYCLE", plateNumber: plate, brand: "Honda", model: "Vario", color: "Hitam" }
  });
}

describe.skipIf(!runIntegration)("H1 — pengajuan mandiri mitra driver", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-driver-application";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-driver-application";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    backendEnv = envModule.env;

    const before = { secret: backendEnv.MEMBERSHIP_DOCUMENT_SECRET };
    restore = () => {
      backendEnv.MEMBERSHIP_DOCUMENT_SECRET = before.secret;
    };

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    backendEnv.MEMBERSHIP_DOCUMENT_SECRET = "kunci-uji-dokumen-tapgo-minimal-32-karakter";
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.adminRateLimiter.resetKey(key);
      limiters.apiRateLimiter.resetKey(key);
      limiters.rideWriteRateLimiter.resetKey(key);
    }
  });

  afterAll(async () => {
    restore();
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("D1: pengguna biasa dapat mengunggah dokumen; pradataur dibuat otomatis", async () => {
    const calon = await createAccount("CALON");
    expect((await api(`/api/v1/driver/documents/ktp`, { token: calon.token, raw: PNG })).status).toBe(201);

    const driver = await prisma.driver.findUniqueOrThrow({ where: { userId: calon.user.id } });
    expect(driver.kycStatus).toBe("PENDING");
    expect(driver.status).toBe("OFFLINE");
  });

  it("K1-A: submit tanpa dokumen lengkap ditolak", async () => {
    const calon = await createAccount("CALON");
    await api(`/api/v1/driver/documents/ktp`, { token: calon.token, raw: PNG });

    const res = await submitApplication(calon);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DRIVER_APPLICATION_DOCUMENTS_INCOMPLETE");
  });

  it("submit lengkap → SUBMITTED; plat tersimpan hanya hash + masked (K2-A)", async () => {
    const calon = await createAccount("CALON");
    await uploadAllDocuments(calon);

    const res = await submitApplication(calon);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("SUBMITTED");
    expect(res.body.data.cycleNumber).toBe(1);

    const driver = await prisma.driver.findUniqueOrThrow({ where: { userId: calon.user.id } });
    expect(driver.vehiclePlate).toBe("B 1234 ***");
    expect(driver.licenseNumber).toMatch(/^[a-f0-9]{64}$/);
    expect(driver.licenseNumber).not.toContain("B 1234");
  });

  it("dua pengajuan terbuka sekaligus ditolak", async () => {
    const calon = await createAccount("CALON");
    await uploadAllDocuments(calon);
    expect((await submitApplication(calon)).status).toBe(201);

    const kedua = await submitApplication(calon, "B 9999 XYZ");
    expect(kedua.status).toBe(409);
  });

  it("mine menampilkan pengajuan terbuka milik sendiri", async () => {
    const calon = await createAccount("CALON");
    await uploadAllDocuments(calon);
    await submitApplication(calon);

    const mine = await api("/api/v1/driver/applications/mine", { token: calon.token });
    expect(mine.status).toBe(200);
    expect(mine.body.data.application.status).toBe("SUBMITTED");
    expect(mine.body.data.documentsComplete).toBe(true);
    expect(mine.body.data.vehicle.serviceType).toBe("MOTORCYCLE");
  });

  it("withdraw mengakhiri pengajuan terbuka; pengajuan baru bisa dibuat lagi", async () => {
    const calon = await createAccount("CALON");
    await uploadAllDocuments(calon);
    await submitApplication(calon);

    const wd = await api("/api/v1/driver/applications/withdraw", { token: calon.token, body: {} });
    expect(wd.status).toBe(200);
    expect(wd.body.data.status).toBe("WITHDRAWN");

    const ulang = await submitApplication(calon);
    expect(ulang.status).toBe(201);
    expect(ulang.body.data.cycleNumber).toBe(2);
  });

  it("D1: dokumen pengajuan terbuka kebal penyapuan retensi; setelah withdraw tersapu", async () => {
    const calon = await createAccount("CALON");
    await uploadAllDocuments(calon);
    await submitApplication(calon);

    // Paksa seluruh dokumen seolah sudah lewat masa simpan.
    await prisma.driverDocument.updateMany({ data: { expiresAt: new Date(Date.now() - 60_000) } });

    const { DriverDocumentService } = await import(
      "../../src/modules/drivers/application/DriverDocumentService.js"
    );
    const docs = new DriverDocumentService(prisma);

    const sweptWhileOpen = await docs.purgeExpired();
    expect(sweptWhileOpen).toBe(0);

    await api("/api/v1/driver/applications/withdraw", { token: calon.token, body: {} });
    const sweptAfterTerminal = await docs.purgeExpired();
    expect(sweptAfterTerminal).toBe(4);
  });

  it("K3-A: approve tanpa klaim aktif ditolak; dengan klaim → APPROVED + profil + kendaraan (K4-A)", async () => {
    const calon = await createAccount("CALON");
    await uploadAllDocuments(calon);
    const submitted = await submitApplication(calon);
    const applicationId = submitted.body.data.id as string;

    const reviewer = await createReviewer();
    const lainnya = await createReviewer();

    // Reviewer lain belum mengklaim — keputusan langsung harus gagal.
    const tanpaKlaim = await api(`/api/v1/admin/driver-review/applications/${applicationId}/approve`, {
      token: lainnya.token,
      body: {}
    });
    expect(tanpaKlaim.status).toBe(409);

    const klaim = await api(`/api/v1/admin/driver-review/applications/${applicationId}/claim`, {
      token: reviewer.token,
      body: {}
    });
    expect(klaim.status).toBe(200);

    const approved = await api(`/api/v1/admin/driver-review/applications/${applicationId}/approve`, {
      token: reviewer.token,
      body: {}
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("APPROVED");

    const profile = await prisma.rideDriverProfile.findUniqueOrThrow({
      where: { userId: calon.user.id }
    });
    expect(profile.status).toBe("PENDING");

    const vehicle = await prisma.rideVehicle.findFirstOrThrow({
      where: { driverProfileId: profile.id }
    });
    expect(vehicle.type).toBe("MOTORCYCLE");
    expect(vehicle.plateNumberMasked).toBe("B 1234 ***");
    expect(vehicle.plateNumberHash).toMatch(/^[a-f0-9]{64}$/);
    expect(vehicle.verificationStatus).toBe("VERIFIED");

    const driver = await prisma.driver.findUniqueOrThrow({ where: { userId: calon.user.id } });
    expect(driver.kycStatus).toBe("APPROVED");

    const docs = await prisma.driverDocument.findMany({ where: { driverId: driver.id } });
    expect(docs.every((d) => d.status === "APPROVED")).toBe(true);

    const audits = await prisma.auditLog.count({
      where: { action: "DRIVER_APPLICATION_APPROVED", entityId: applicationId }
    });
    expect(audits).toBe(1);
  });

  it("K3-A: reject oleh pemegang klaim → REJECTED dengan kode alasan; siklus baru boleh diajukan", async () => {
    const calon = await createAccount("CALON");
    await uploadAllDocuments(calon);
    const submitted = await submitApplication(calon);
    const applicationId = submitted.body.data.id as string;

    const reviewer = await createReviewer();
    await api(`/api/v1/admin/driver-review/applications/${applicationId}/claim`, {
      token: reviewer.token,
      body: {}
    });

    const rejected = await api(`/api/v1/admin/driver-review/applications/${applicationId}/reject`, {
      token: reviewer.token,
      body: { reasonCode: "DOCUMENTS_UNREADABLE" }
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("REJECTED");
    expect(rejected.body.data.decisionReasonCode).toBe("DOCUMENTS_UNREADABLE");

    const driver = await prisma.driver.findUniqueOrThrow({ where: { userId: calon.user.id } });
    expect(driver.kycStatus).toBe("REJECTED");

    // Unggah ulang dokumen (kycStatus kembali PENDING) lalu ajukan lagi.
    await uploadAllDocuments(calon);
    const ulang = await submitApplication(calon);
    expect(ulang.status).toBe(201);
    expect(ulang.body.data.cycleNumber).toBe(2);
  });

  it("approve pada pengajuan yang tidak UNDER_REVIEW ditolak", async () => {
    const calon = await createAccount("CALON");
    await uploadAllDocuments(calon);
    const submitted = await submitApplication(calon);
    const applicationId = submitted.body.data.id as string;

    const reviewer = await createReviewer();
    // SUBMITTED, belum diklaim siapa pun → status bukan UNDER_REVIEW.
    const res = await api(`/api/v1/admin/driver-review/applications/${applicationId}/approve`, {
      token: reviewer.token,
      body: {}
    });
    expect(res.status).toBe(409);
  });

  it("kode alasan reject di luar daftar ditolak validator", async () => {
    const calon = await createAccount("CALON");
    await uploadAllDocuments(calon);
    const submitted = await submitApplication(calon);
    const applicationId = submitted.body.data.id as string;

    const reviewer = await createReviewer();
    await api(`/api/v1/admin/driver-review/applications/${applicationId}/claim`, {
      token: reviewer.token,
      body: {}
    });

    const res = await api(`/api/v1/admin/driver-review/applications/${applicationId}/reject`, {
      token: reviewer.token,
      body: { reasonCode: "ALASAN_NGASAL" }
    });
    expect(res.status).toBe(400);
  });
});
