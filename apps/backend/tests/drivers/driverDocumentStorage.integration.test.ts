import { User, UserRole } from "@prisma/client";
import crypto from "node:crypto";
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
 * Penyimpanan sementara dokumen mitra driver.
 *
 * Keputusan Owner: kebijakan 24 jam untuk dokumen membership berlaku juga di
 * sini. Berkas disimpan di database maksimal 24 jam, lalu admin mencetaknya
 * sebagai berkas administrasi dan isinya dihapus.
 *
 * Yang dijaga berkas ini, berurut dari yang paling berbahaya bila gagal:
 * 1. Isi berkas tidak pernah tersimpan mentah di database.
 * 2. Kunci dokumen driver BUKAN kunci dokumen membership.
 * 3. Dokumen yang lewat masa simpan tidak pernah disajikan, walau penyapunya
 *    belum berjalan. Waktu yang menentukan, bukan pekerjaan latar.
 * 4. Driver hanya menyentuh dokumennya sendiri; admin tidak mengunggah atas
 *    namanya.
 * 5. Berkas non-gambar tertolak berdasarkan isinya, bukan keterangan klien.
 * 6. Setiap admin membuka dokumen, kejadiannya tercatat.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("isi-ktp-driver-yang-tidak-boleh-tersimpan-mentah", "utf8")
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("isi-sim-driver-contoh", "utf8")
]);
const PDF_MENYAMAR = Buffer.from("%PDF-1.7 ini berkas pdf yang mengaku gambar", "utf8");

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let documentService: InstanceType<
  typeof import("../../src/modules/drivers/application/DriverDocumentService.js").DriverDocumentService
>;
let restore: () => void = () => {};
let sequence = 0;

describe.skipIf(!runIntegration)("Penyimpanan dokumen mitra driver", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-driver-documents";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-driver-documents";

    const [{ createApp }, tokenService, envModule, documentModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js"),
      import("../../src/modules/drivers/application/DriverDocumentService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    backendEnv = envModule.env;
    documentService = new documentModule.DriverDocumentService(prisma);

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

  it("tidak pernah menyimpan isi dokumen dalam bentuk mentah", async () => {
    const driver = await createDriver();
    expect((await upload(driver, "ktp", PNG)).status).toBe(201);

    const stored = await prisma.driverDocument.findFirstOrThrow({
      where: { driverId: driver.driverId, type: "KTP" }
    });

    // Inilah pemeriksaan terpenting di berkas ini: byte yang benar-benar berada
    // di dalam kolom database tidak boleh memuat isi aslinya.
    expect(stored.cipherText).not.toBeNull();
    expect(stored.cipherText!.includes(Buffer.from("isi-ktp-driver", "utf8"))).toBe(false);
    expect(stored.cipherText!.equals(PNG)).toBe(false);
    expect(stored.cipherIv).not.toBeNull();
    expect(stored.cipherTag).not.toBeNull();
    expect(stored.keyVersion).toBe(1);

    // Checksum dihitung dari isi ASLI supaya hasil cetak dapat dibuktikan sama.
    expect(stored.checksum).toBe(crypto.createHash("sha256").update(PNG).digest("hex"));
    expect(stored.contentType).toBe("image/png");
    expect(stored.sizeBytes).toBe(PNG.byteLength);
  });

  it("memakai kunci yang berbeda dari dokumen membership", async () => {
    const driver = await createDriver();
    await upload(driver, "ktp", PNG);
    const stored = await prisma.driverDocument.findFirstOrThrow({
      where: { driverId: driver.driverId, type: "KTP" }
    });

    const cipher = await import("../../src/core/security/documentCipher.js");
    // Dokumen driver TIDAK boleh terbuka dengan kunci domain membership.
    expect(() =>
      cipher.decryptDocument(
        {
          cipherText: stored.cipherText!,
          cipherIv: stored.cipherIv!,
          cipherTag: stored.cipherTag!,
          keyVersion: stored.keyVersion
        },
        "membership"
      )
    ).toThrowError(/tidak dapat dibuka/i);

    // Dan tetap terbuka dengan kunci domainnya sendiri.
    const dibuka = cipher.decryptDocument(
      {
        cipherText: stored.cipherText!,
        cipherIv: stored.cipherIv!,
        cipherTag: stored.cipherTag!,
        keyVersion: stored.keyVersion
      },
      "driver"
    );
    expect(dibuka.equals(PNG)).toBe(true);
  });

  it("mengembalikan isi asli utuh kepada admin dan mencatat pembukaannya", async () => {
    const driver = await createDriver();
    await upload(driver, "sim", JPEG);
    const admin = await createAdmin();

    const response = await fetch(
      `${baseUrl}/api/v1/admin/drivers/${driver.driverId}/documents/sim`,
      { headers: { authorization: `Bearer ${admin.token}` } }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.equals(JPEG)).toBe(true);

    // Membuka dokumen identitas orang lain wajib meninggalkan jejak.
    const jejak = await prisma.auditLog.findMany({
      where: { action: "DRIVER_DOCUMENT_VIEWED" }
    });
    expect(jejak).toHaveLength(1);
    expect(jejak[0]!.actorId).toBe(admin.user.id);
    expect((jejak[0]!.metadata as Record<string, unknown>).documentType).toBe("SIM");
  });

  it("menolak berkas yang bukan gambar walau content-type-nya mengaku gambar", async () => {
    const driver = await createDriver();
    const response = await upload(driver, "ktp", PDF_MENYAMAR);

    expect(response.status).toBe(415);
    // Tidak boleh ada baris yang tersimpan dari percobaan yang ditolak.
    expect(
      await prisma.driverDocument.count({ where: { driverId: driver.driverId } })
    ).toBe(0);
  });

  it("menolak jenis dokumen yang tidak dikenal", async () => {
    const driver = await createDriver();
    const response = await upload(driver, "paspor-luar-angkasa", PNG);

    expect(response.status).toBe(400);
    expect(
      await prisma.driverDocument.count({ where: { driverId: driver.driverId } })
    ).toBe(0);
  });

  it("pengguna tanpa profil driver tidak dapat mengunggah", async () => {
    const bukanDriver = await createUserOnly("NODRV");
    const response = await fetch(`${baseUrl}/api/v1/driver/documents/ktp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bukanDriver.token}`,
        "content-type": "image/png"
      },
      body: PNG
    });

    expect(response.status).toBe(404);
    expect(await prisma.driverDocument.count()).toBe(0);
  });

  it("driver hanya melihat dokumennya sendiri", async () => {
    const satu = await createDriver();
    const dua = await createDriver();
    await upload(satu, "ktp", PNG);

    const response = await fetch(`${baseUrl}/api/v1/driver/documents`, {
      headers: { authorization: `Bearer ${dua.token}` }
    });
    const body = (await response.json()) as { data: unknown[] };

    expect(response.status).toBe(200);
    // Driver kedua belum mengunggah apa pun, jadi daftarnya wajib kosong.
    expect(body.data).toHaveLength(0);
  });

  it("menolak menyajikan dokumen yang sudah lewat masa simpan", async () => {
    const driver = await createDriver();
    await upload(driver, "ktp", PNG);
    const admin = await createAdmin();

    // Masa simpan dimundurkan langsung di database. Penyapunya SENGAJA tidak
    // dijalankan: yang diuji adalah bahwa waktu sudah cukup untuk menolak,
    // tanpa bergantung pada pekerjaan latar yang mungkin tertunda.
    await prisma.driverDocument.updateMany({
      where: { driverId: driver.driverId },
      data: { expiresAt: new Date(Date.now() - 60_000) }
    });

    const response = await fetch(
      `${baseUrl}/api/v1/admin/drivers/${driver.driverId}/documents/ktp`,
      { headers: { authorization: `Bearer ${admin.token}` } }
    );

    // 410, bukan 404: dokumennya pernah ada dan sengaja dihapus.
    expect(response.status).toBe(410);
    // Isinya masih di database, tetapi tetap tidak boleh disajikan.
    const stored = await prisma.driverDocument.findFirstOrThrow({
      where: { driverId: driver.driverId }
    });
    expect(stored.cipherText).not.toBeNull();
    // Percobaan yang ditolak bukan pembacaan, jadi tidak boleh tercatat.
    expect(await prisma.auditLog.count({ where: { action: "DRIVER_DOCUMENT_VIEWED" } })).toBe(0);
  });

  it("penyapu mengosongkan isi tetapi mempertahankan barisnya untuk audit", async () => {
    const driver = await createDriver();
    await upload(driver, "ktp", PNG);
    await prisma.driverDocument.updateMany({
      where: { driverId: driver.driverId },
      data: { expiresAt: new Date(Date.now() - 60_000) }
    });

    const jumlah = await documentService.purgeExpired();
    expect(jumlah).toBe(1);

    const stored = await prisma.driverDocument.findFirstOrThrow({
      where: { driverId: driver.driverId }
    });
    expect(stored.cipherText).toBeNull();
    expect(stored.cipherIv).toBeNull();
    expect(stored.cipherTag).toBeNull();
    expect(stored.keyVersion).toBeNull();
    expect(stored.purgedAt).not.toBeNull();
    // Jejak yang masih dibutuhkan untuk membuktikan dokumen pernah ada.
    expect(stored.checksum).not.toBeNull();
    expect(stored.uploadedAt).not.toBeNull();
  });

  it("menetapkan masa simpan tepat 24 jam sesuai keputusan Owner", async () => {
    const driver = await createDriver();
    const sebelum = Date.now();
    await upload(driver, "ktp", PNG);

    const stored = await prisma.driverDocument.findFirstOrThrow({
      where: { driverId: driver.driverId }
    });
    const selisihJam = (stored.expiresAt!.getTime() - sebelum) / (60 * 60 * 1000);
    expect(selisihJam).toBeGreaterThan(23.9);
    expect(selisihJam).toBeLessThanOrEqual(24.1);
  });

  it("unggah ulang menimpa dokumen lama, bukan menumpuk salinan", async () => {
    const driver = await createDriver();
    await upload(driver, "ktp", PNG);
    await upload(driver, "ktp", JPEG);

    const rows = await prisma.driverDocument.findMany({
      where: { driverId: driver.driverId, type: "KTP" }
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contentType).toBe("image/jpeg");
  });

  it("mengembalikan status KYC ke antrean pemeriksaan setelah unggah ulang", async () => {
    const driver = await createDriver();
    await prisma.driver.update({
      where: { id: driver.driverId },
      data: { kycStatus: "REJECTED" }
    });

    await upload(driver, "ktp", PNG);

    const setelah = await prisma.driver.findUniqueOrThrow({
      where: { id: driver.driverId }
    });
    // Tanpa ini, driver memperbaiki berkasnya lalu akunnya tetap tertulis
    // DITOLAK dan tidak pernah masuk antrean admin lagi.
    expect(setelah.kycStatus).toBe("PENDING");
  });

  it("menolak mengubah dokumen setelah verifikasi disetujui", async () => {
    const driver = await createDriver();
    await upload(driver, "ktp", PNG);
    await prisma.driver.update({
      where: { id: driver.driverId },
      data: { kycStatus: "APPROVED" }
    });

    const response = await upload(driver, "ktp", JPEG);

    expect(response.status).toBe(409);
    // Dokumen yang sudah diperiksa tidak boleh tertukar setelah persetujuan.
    const stored = await prisma.driverDocument.findFirstOrThrow({
      where: { driverId: driver.driverId, type: "KTP" }
    });
    expect(stored.contentType).toBe("image/png");
  });

  it("pengguna biasa tidak dapat membuka dokumen driver lewat jalur admin", async () => {
    const driver = await createDriver();
    await upload(driver, "ktp", PNG);
    const orangLain = await createUserOnly("BUKANADMIN");

    const response = await fetch(
      `${baseUrl}/api/v1/admin/drivers/${driver.driverId}/documents/ktp`,
      { headers: { authorization: `Bearer ${orangLain.token}` } }
    );

    expect(response.status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: "DRIVER_DOCUMENT_VIEWED" } })).toBe(0);
  });

  /* ── Pembantu ────────────────────────────────────────────────────────── */

  async function createUserOnly(prefix: string, role: UserRole = "USER") {
    sequence += 1;
    const suffix = String(sequence).padStart(3, "0");
    const user: User = await prisma.user.create({
      data: {
        fullName: `Uji ${prefix} ${suffix}`,
        phone: `62811${prefix.slice(0, 3)}${suffix}`,
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

  function upload(
    account: { token: string },
    type: string,
    bytes: Buffer
  ) {
    return fetch(`${baseUrl}/api/v1/driver/documents/${type}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${account.token}`,
        // Keterangan dari klien SELALU mengaku PNG. Yang menentukan tetap byte
        // pertama berkasnya, dan itulah yang diuji.
        "content-type": "image/png"
      },
      body: bytes
    });
  }
});
