import { User, UserRole } from "@prisma/client";
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
 * Authorization menyeluruh untuk seluruh permukaan admin console.
 *
 * adminConsole.integration.test.ts sudah menguji perilaku bisnisnya (Founder
 * Platinum, Chairman, reward, laporan finansial), tetapi guard-nya hanya
 * disampel pada dua endpoint. Console ini memiliki puluhan endpoint; satu saja
 * yang lupa dipasangi guard berarti data seluruh member terbuka.
 *
 * Berkas ini menguji SETIAP endpoint secara tabel — bukan sampel — untuk tiga
 * pertanyaan: tanpa token ditolak, role USER ditolak, dan endpoint yang
 * seharusnya khusus SUPER_ADMIN tidak dapat ditembus ADMIN biasa.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

type Endpoint = { method: string; path: string };

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let resetAdminRateLimit: () => void = () => {};

/** Endpoint yang cukup ADMIN. */
const ADMIN_ENDPOINTS: ReadonlyArray<Endpoint> = [
  { method: "GET", path: "/api/v1/admin/dashboard" },
  { method: "GET", path: "/api/v1/admin/dashboard/summary" },
  { method: "GET", path: "/api/v1/admin/members" },
  { method: "GET", path: "/api/v1/admin/member-requests" },
  // Verifikasi dokumen KYC melepas pembayaran bonus sponsor dan bonus level,
  // jadi guard-nya ikut diuji di tabel ini. Dengan id yang tidak ada, ADMIN sah
  // menerima 404 — bukan 401/403 — sehingga kontrol negatif tetap berlaku.
  {
    method: "POST",
    path: "/api/v1/admin/member-requests/00000000-0000-4000-8000-000000000000/verify-documents"
  },
  { method: "GET", path: "/api/v1/admin/invoices" },
  { method: "GET", path: "/api/v1/admin/payments" },
  { method: "GET", path: "/api/v1/admin/commissions" },
  { method: "GET", path: "/api/v1/admin/wallets" },
  { method: "GET", path: "/api/v1/admin/withdrawals" },
  { method: "GET", path: "/api/v1/admin/withdraw-requests" },
  { method: "GET", path: "/api/v1/admin/rewards" },
  { method: "GET", path: "/api/v1/admin/delete-requests" },
  { method: "GET", path: "/api/v1/admin/contact-messages" },
  { method: "GET", path: "/api/v1/admin/reports/bonus" },
  { method: "GET", path: "/api/v1/admin/reports/bonus.csv" },
  { method: "GET", path: "/api/v1/admin/reports/ppob" },
  { method: "GET", path: "/api/v1/admin/reports/ppob.csv" },
  { method: "GET", path: "/api/v1/admin/reports/reward" },
  { method: "GET", path: "/api/v1/admin/reports/reward.csv" }
];

/** Endpoint yang wajib SUPER_ADMIN. */
const SUPER_ADMIN_ENDPOINTS: ReadonlyArray<Endpoint> = [
  { method: "GET", path: "/api/v1/admin/commission-settings" },
  { method: "POST", path: "/api/v1/admin/roles" },
  { method: "PUT", path: "/api/v1/admin/roles/00000000-0000-4000-8000-000000000000" },
  { method: "PUT", path: "/api/v1/admin/app-settings" }
];

const ALL_ENDPOINTS = [...ADMIN_ENDPOINTS, ...SUPER_ADMIN_ENDPOINTS];

describe.skipIf(!runIntegration)("Admin console authorization", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error(
        "TAPGO_TEST_DATABASE_URL must point to a dedicated test database."
      );
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-admin-authz";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-admin-authz";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";

    const [{ createApp }, tokenService, rateLimitModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/core/security/rateLimit.js")
    ]);
    signAccessToken = tokenService.signAccessToken;

    // Test tabel ini menembakkan lebih banyak permintaan daripada batas admin
    // (80/menit) maupun batas API global (120/menit). Yang direset hanya
    // PENGHITUNG antar test — batas produksi tidak dilemahkan sama sekali, dan
    // justru diuji tersendiri di bawah.
    const limiters = [
      rateLimitModule.adminRateLimiter,
      rateLimitModule.apiRateLimiter
    ] as unknown as Array<{ resetKey?: (key: string) => void }>;
    resetAdminRateLimit = () => {
      for (const limiter of limiters) {
        for (const key of ["127.0.0.1", "::ffff:127.0.0.1", "::1"]) {
          limiter.resetKey?.(key);
        }
      }
    };

    server = http.createServer(createApp());
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    resetAdminRateLimit();
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

  it("menolak SELURUH endpoint admin tanpa token", async () => {
    const leaked: string[] = [];
    for (const endpoint of ALL_ENDPOINTS) {
      const response = await call(endpoint);
      if (response.status !== 401) {
        leaked.push(`${endpoint.method} ${endpoint.path} → ${response.status}`);
      }
    }
    expect(leaked, "endpoint admin tanpa guard autentikasi").toEqual([]);
  });

  it("menolak SELURUH endpoint admin untuk role USER", async () => {
    const user = await createAdminUser("AUTHZUSR", "USER");
    const leaked: string[] = [];
    for (const endpoint of ALL_ENDPOINTS) {
      const response = await call(endpoint, user);
      // Harus TEPAT 403. Sejumlah endpoint mengembalikan 501 ketika guard-nya
      // lolos, jadi memeriksa "bukan 2xx" saja tidak dapat membedakan
      // penolakan role dari stub yang belum diaktifkan.
      if (response.status !== 403) {
        leaked.push(`${endpoint.method} ${endpoint.path} → ${response.status}`);
      }
    }
    expect(leaked, "endpoint admin terbuka untuk role USER").toEqual([]);
  });

  it("menolak token yang tanda tangannya dirusak", async () => {
    const admin = await createAdminUser("AUTHZADM", "ADMIN");
    const valid = tokenFor(admin);
    const tampered = `${valid.slice(0, valid.length - 4)}AAAA`;

    const leaked: string[] = [];
    for (const endpoint of ALL_ENDPOINTS) {
      const response = await fetch(`${baseUrl}${endpoint.path}`, {
        method: endpoint.method,
        headers: {
          authorization: `Bearer ${tampered}`,
          "content-type": "application/json"
        },
        // body hanya disertakan untuk metode non-GET: konfigurasi TypeScript
        // proyek ini menolak properti opsional bernilai undefined.
        ...(endpoint.method === "GET" ? {} : { body: "{}" })
      });
      if (response.status !== 401) {
        leaked.push(`${endpoint.method} ${endpoint.path} → ${response.status}`);
      }
    }
    expect(leaked, "endpoint admin menerima token palsu").toEqual([]);
  });

  it("menolak ADMIN biasa pada endpoint khusus SUPER_ADMIN", async () => {
    const admin = await createAdminUser("AUTHZAD2", "ADMIN");
    const leaked: string[] = [];
    for (const endpoint of SUPER_ADMIN_ENDPOINTS) {
      const response = await call(endpoint, admin);
      // Keempat endpoint ini menjawab 501 PRODUCTION_APPROVAL_REQUIRED begitu
      // guard-nya lolos. Karena itu yang ditegaskan adalah 403 persis: bila
      // guard dilonggarkan menjadi ADMIN, statusnya berubah ke 501 dan test
      // ini gagal — sebagaimana seharusnya.
      if (response.status !== 403) {
        leaked.push(`${endpoint.method} ${endpoint.path} → ${response.status}`);
      }
    }
    expect(
      leaked,
      "endpoint SUPER_ADMIN dapat ditembus ADMIN biasa"
    ).toEqual([]);
  });

  it("mengizinkan ADMIN membaca endpoint admin biasa", async () => {
    const admin = await createAdminUser("AUTHZAD3", "ADMIN");
    const blocked: string[] = [];
    for (const endpoint of ADMIN_ENDPOINTS) {
      const response = await call(endpoint, admin);
      // Test ini adalah kontrol negatif: memastikan test penolakan di atas
      // bukan lulus semata karena semua endpoint memang rusak.
      if (response.status === 401 || response.status === 403) {
        blocked.push(`${endpoint.method} ${endpoint.path} → ${response.status}`);
      }
    }
    expect(blocked, "ADMIN sah justru tertolak").toEqual([]);
  });

  it("menerapkan rate limit pada permukaan admin", async () => {
    const admin = await createAdminUser("AUTHZRL1", "ADMIN");
    const endpoint: Endpoint = {
      method: "GET",
      path: "/api/v1/admin/dashboard/summary"
    };

    let limited = false;
    // Batas admin adalah 80 per menit; 90 permintaan harus menabraknya.
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const response = await call(endpoint, admin);
      if (response.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited, "permukaan admin harus dibatasi rate limit").toBe(true);
    resetAdminRateLimit();
  });

  it("tidak membocorkan nomor rekening penuh pada ekspor CSV", async () => {
    const superAdmin = await createAdminUser("AUTHZSA1", "SUPER_ADMIN");
    const member = await createAdminUser("AUTHZMEM", "USER");
    await prisma.user.update({
      where: { id: member.id },
      data: {
        bankAccount: {
          bankName: "BCA",
          accountNumber: "1234567890",
          accountHolderName: "Member Sah"
        }
      }
    });

    for (const path of [
      "/api/v1/admin/reports/bonus.csv",
      "/api/v1/admin/reports/ppob.csv",
      "/api/v1/admin/reports/reward.csv"
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { authorization: `Bearer ${tokenFor(superAdmin)}` }
      });
      expect(response.status).toBeLessThan(400);
      const body = await response.text();
      expect(
        body,
        `${path} tidak boleh memuat nomor rekening penuh`
      ).not.toContain("1234567890");
    }
  });

  it("tidak membocorkan hash password atau rahasia pada respons admin", async () => {
    const superAdmin = await createAdminUser("AUTHZSA2", "SUPER_ADMIN");
    const member = await createAdminUser("AUTHZMM2", "USER");
    await prisma.user.update({
      where: { id: member.id },
      data: { passwordHash: "$2b$10$notarealhashvaluefortestsonly000000000000000000" }
    });

    for (const path of [
      "/api/v1/admin/members",
      `/api/v1/admin/members/${member.id}`,
      "/api/v1/admin/wallets"
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { authorization: `Bearer ${tokenFor(superAdmin)}` }
      });
      if (response.status >= 400) continue;
      const body = await response.text();
      for (const forbidden of ["passwordHash", "$2b$10$", "refreshToken"]) {
        expect(
          body,
          `${path} membocorkan ${forbidden}`
        ).not.toContain(forbidden);
      }
    }
  });
});

function tokenFor(user: User): string {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`
  });
}

async function call(endpoint: Endpoint, user?: User): Promise<Response> {
  return fetch(`${baseUrl}${endpoint.path}`, {
    method: endpoint.method,
    headers: {
      "content-type": "application/json",
      ...(user ? { authorization: `Bearer ${tokenFor(user)}` } : {})
    },
    ...(endpoint.method === "GET" ? {} : { body: "{}" })
  });
}

async function createAdminUser(
  referralCode: string,
  role: UserRole
): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({
    where: { tier: "BASIC" }
  });
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.padStart(9, "0")}`,
      referralCode,
      role,
      membershipId: basic.id
    }
  });
}
