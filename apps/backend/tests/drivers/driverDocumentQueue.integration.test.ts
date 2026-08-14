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
 * Antrian dokumen mitra driver untuk admin.
 *
 * Endpoint dokumen yang sudah ada menuntut driverId, sedangkan antrian
 * peninjauan pengajuan SENGAJA tidak membawa identitas maupun driverId. Tanpa
 * jembatan ini admin tidak punya jalan sampai ke dokumen yang harus dicetak.
 *
 * Yang dijaga berkas ini, berurut dari yang paling berbahaya bila gagal:
 * 1. Antrian tidak pernah membawa isi dokumen — hanya metadata.
 * 2. Hanya peran admin yang boleh membacanya.
 * 3. Driver tanpa dokumen tidak muncul, supaya antrian tidak berisi baris
 *    yang tidak ada pekerjaannya.
 * 4. Ketersediaan berkas dihitung dari WAKTU, bukan dari kolom purged, supaya
 *    jawabannya tetap benar walau penyapu berkala tertunda.
 * 5. Membuka antrian BUKAN membuka dokumen, jadi tidak boleh mencatat audit
 *    pembukaan dokumen.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("isi-dokumen-driver-yang-tidak-boleh-bocor", "utf8")
]);

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let restore: () => void = () => {};
let sequence = 0;

describe.skipIf(!runIntegration)("Antrian dokumen mitra driver", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-driver-queue";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-driver-queue";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    backendEnv = envModule.env;

    const before = {
      secret: backendEnv.MEMBERSHIP_DOCUMENT_SECRET,
      retention: backendEnv.DRIVER_DOCUMENT_RETENTION_HOURS
    };
    restore = () => {
      backendEnv.MEMBERSHIP_DOCUMENT_SECRET = before.secret;
      backendEnv.DRIVER_DOCUMENT_RETENTION_HOURS = before.retention;
    };

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    backendEnv.MEMBERSHIP_DOCUMENT_SECRET = "kunci-uji-dokumen-tapgo-minimal-32-karakter";
    backendEnv.DRIVER_DOCUMENT_RETENTION_HOURS = 24;
  });

  afterAll(async () => {
    restore();
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("tidak pernah membawa isi dokumen di dalam antrian", async () => {
    const driver = await createDriver();
    expect((await upload(driver, "ktp", PNG)).status).toBe(201);
    const admin = await createAdmin();

    const response = await fetch(`${baseUrl}/api/v1/admin/driver-documents`, {
      headers: { authorization: `Bearer ${admin.token}` }
    });
    expect(response.status).toBe(200);

    // Pemeriksaan terpenting: seluruh badan respons tidak boleh memuat isi
    // dokumen dalam bentuk apa pun, termasuk sisa base64.
    const mentah = await response.text();
    expect(mentah).not.toContain("isi-dokumen-driver");
    expect(mentah).not.toContain(PNG.toString("base64"));
    expect(mentah.toLowerCase()).not.toContain("ciphertext");
  });

  it("hanya peran admin yang boleh membaca antrian", async () => {
    const driver = await createDriver();
    await upload(driver, "ktp", PNG);

    const respons = await fetch(`${baseUrl}/api/v1/admin/driver-documents`, {
      headers: { authorization: `Bearer ${driver.token}` }
    });
    expect(respons.status).toBe(403);
  });

  it("hanya menampilkan driver yang benar-benar punya dokumen", async () => {
    const berdokumen = await createDriver();
    await upload(berdokumen, "ktp", PNG);
    // Driver kedua tidak mengunggah apa pun; tidak ada pekerjaan untuk admin.
    const kosong = await createDriver();
    const admin = await createAdmin();

    const data = await ambilAntrian(admin.token);
    const ids = data.map((row) => row.driverId);
    expect(ids).toContain(berdokumen.driverId);
    expect(ids).not.toContain(kosong.driverId);
  });

  it("membawa identitas secukupnya untuk mencocokkan berkas cetak", async () => {
    const driver = await createDriver();
    await upload(driver, "ktp", PNG);
    const admin = await createAdmin();

    const row = (await ambilAntrian(admin.token))[0]!;
    expect(row.driverId).toBe(driver.driverId);
    // Nama dan nomor diperlukan admin untuk mencocokkan hasil cetak dengan
    // pemiliknya. Tanpa itu berkas administrasi tidak dapat dipertanggungjawabkan.
    expect(row.fullName).toBe(driver.user.fullName);
    expect(row.phone).toBe(driver.user.phone);
    expect(row.kycStatus).toBe("PENDING");
    expect(row.documents).toHaveLength(1);
    expect(row.documents[0]!.type).toBe("KTP");
    expect(row.documents[0]!.available).toBe(true);
  });

  it("menandai berkas kedaluwarsa memakai waktu, bukan kolom purged", async () => {
    const driver = await createDriver();
    await upload(driver, "ktp", PNG);
    const admin = await createAdmin();

    // Masa simpan dimundurkan TANPA menyentuh purgedAt: inilah keadaan ketika
    // penyapu berkala belum sempat berjalan.
    await prisma.driverDocument.updateMany({
      where: { driverId: driver.driverId, type: "KTP" },
      data: { expiresAt: new Date(Date.now() - 60_000) }
    });

    const row = (await ambilAntrian(admin.token))[0]!;
    expect(row.documents[0]!.available).toBe(false);
  });

  it("membuka antrian tidak dicatat sebagai membuka dokumen", async () => {
    const driver = await createDriver();
    await upload(driver, "ktp", PNG);
    const admin = await createAdmin();

    await ambilAntrian(admin.token);

    // Audit DRIVER_DOCUMENT_VIEWED hanya untuk pembukaan isi berkas. Mencatat
    // daftar sebagai pembukaan akan membanjiri jejak audit dan membuat catatan
    // yang benar-benar penting sulit ditemukan.
    expect(
      await prisma.auditLog.count({ where: { action: "DRIVER_DOCUMENT_VIEWED" } })
    ).toBe(0);
  });

  /* ── Pembantu ────────────────────────────────────────────────────────── */

  type BarisAntrian = {
    driverId: string;
    fullName: string;
    phone: string;
    kycStatus: string;
    documents: { type: string; available: boolean }[];
  };

  async function ambilAntrian(token: string): Promise<BarisAntrian[]> {
    const response = await fetch(`${baseUrl}/api/v1/admin/driver-documents`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data?: { items?: BarisAntrian[] } };
    return body.data?.items ?? [];
  }

  async function createUserOnly(prefix: string, role: UserRole = "USER") {
    sequence += 1;
    const suffix = String(sequence).padStart(3, "0");
    const user: User = await prisma.user.create({
      data: {
        fullName: `Uji ${prefix} ${suffix}`,
        phone: `62812${prefix.slice(0, 3)}${suffix}`,
        passwordHash: "hash-uji",
        referralCode: `Q${prefix}${suffix}`,
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
    return {
      user,
      token: signAccessToken({ sub: user.id, role, sessionId: session.id })
    };
  }

  async function createDriver() {
    const account = await createUserOnly("DRV", "DRIVER");
    const driver = await prisma.driver.create({
      data: { userId: account.user.id, kycStatus: "NOT_SUBMITTED" }
    });
    return { ...account, driverId: driver.id };
  }

  async function createAdmin() {
    return createUserOnly("ADM", "ADMIN");
  }

  function upload(account: { token: string }, type: string, bytes: Buffer) {
    return fetch(`${baseUrl}/api/v1/driver/documents/${type}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${account.token}`,
        "content-type": "image/png"
      },
      body: bytes
    });
  }
});
