import { User, UserRole } from "@prisma/client";
import crypto from "node:crypto";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * Penyimpanan sementara dokumen identitas (Stage R2.6 jalur A).
 *
 * Keputusan Owner: KTP dan swafoto disimpan di database aplikasi maksimal 24
 * jam, lalu admin mencetaknya sebagai berkas administrasi.
 *
 * Yang dijaga berkas ini, berurut dari yang paling berbahaya bila gagal:
 * 1. Isi berkas tidak pernah tersimpan mentah di database.
 * 2. Dokumen yang lewat masa simpan tidak pernah disajikan, walau penyapunya
 *    belum berjalan. Waktu yang menentukan, bukan pekerjaan latar.
 * 3. Hanya pemiliknya yang boleh mengunggah, hanya admin yang boleh membuka.
 * 4. Berkas non-gambar tertolak berdasarkan isinya, bukan keterangan klien.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("isi-ktp-contoh-yang-tidak-boleh-tersimpan-mentah", "utf8")
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("isi-swafoto-contoh", "utf8")
]);

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let orderService: MembershipOrderService;
// Diimpor dinamis di beforeAll: modulnya membaca config/env.js saat dimuat,
// sedangkan secret JWT baru disetel di dalam beforeAll.
let documentService: InstanceType<
  typeof import("../../src/modules/memberships/application/MembershipDocumentService.js").MembershipDocumentService
>;
let restore: () => void = () => {};
let sequence = 0;

describe.skipIf(!runIntegration)("Membership document storage", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-document-storage";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-document-storage";

    const [{ createApp }, tokenService, envModule, documentModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js"),
      import("../../src/modules/memberships/application/MembershipDocumentService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    backendEnv = envModule.env;
    orderService = new MembershipOrderService(prisma);
    documentService = new documentModule.MembershipDocumentService(prisma);

    const before = {
      secret: backendEnv.MEMBERSHIP_DOCUMENT_SECRET,
      retention: backendEnv.MEMBERSHIP_DOCUMENT_RETENTION_HOURS
    };
    restore = () => {
      backendEnv.MEMBERSHIP_DOCUMENT_SECRET = before.secret;
      backendEnv.MEMBERSHIP_DOCUMENT_RETENTION_HOURS = before.retention;
    };

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    backendEnv.MEMBERSHIP_DOCUMENT_SECRET = "kunci-uji-dokumen-tapgo-minimal-32-karakter";
    backendEnv.MEMBERSHIP_DOCUMENT_RETENTION_HOURS = 24;
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
    const scenario = await createScenario();
    expect((await upload(scenario, "ktp", PNG)).status).toBe(201);

    const stored = await prisma.membershipDocument.findFirstOrThrow({
      where: { orderId: scenario.orderId, type: "KTP" }
    });

    // Inilah pemeriksaan terpenting di berkas ini: byte yang benar-benar berada
    // di dalam kolom database tidak boleh memuat isi aslinya.
    expect(stored.cipherText).not.toBeNull();
    expect(stored.cipherText!.includes(Buffer.from("isi-ktp-contoh", "utf8"))).toBe(false);
    expect(stored.cipherText!.equals(PNG)).toBe(false);
    expect(stored.cipherIv).not.toBeNull();
    expect(stored.cipherTag).not.toBeNull();
    expect(stored.keyVersion).toBe(1);

    // Checksum dihitung dari isi ASLI supaya hasil cetak dapat dibuktikan sama.
    expect(stored.checksum).toBe(crypto.createHash("sha256").update(PNG).digest("hex"));
    expect(stored.contentType).toBe("image/png");
    expect(stored.sizeBytes).toBe(PNG.byteLength);
  });

  it("mengembalikan isi asli utuh kepada admin", async () => {
    const scenario = await createScenario();
    await upload(scenario, "ktp", PNG);

    const response = await fetch(
      `${baseUrl}/api/v1/admin/member-requests/${scenario.orderId}/documents/ktp`,
      { headers: { authorization: `Bearer ${tokenFor(scenario.admin)}` } }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-tapgo-document-checksum")).toBe(
      crypto.createHash("sha256").update(PNG).digest("hex")
    );
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("menolak membuka dokumen yang sudah lewat masa simpan walau penyapu belum berjalan", async () => {
    const scenario = await createScenario();
    await upload(scenario, "ktp", PNG);

    // Majukan batas waktunya, JANGAN jalankan penyapu. Isinya masih utuh di
    // database, jadi test ini membuktikan penegakannya ada pada pembacaan.
    await prisma.membershipDocument.updateMany({
      where: { orderId: scenario.orderId, type: "KTP" },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });
    const stillStored = await prisma.membershipDocument.findFirstOrThrow({
      where: { orderId: scenario.orderId, type: "KTP" }
    });
    expect(stillStored.cipherText).not.toBeNull();

    const response = await fetch(
      `${baseUrl}/api/v1/admin/member-requests/${scenario.orderId}/documents/ktp`,
      { headers: { authorization: `Bearer ${tokenFor(scenario.admin)}` } }
    );

    expect(response.status).toBe(410);
    expect(await codeOf(response)).toBe("MEMBERSHIP_DOCUMENT_EXPIRED");
  });

  it("menghapus isi dokumen kedaluwarsa tetapi mempertahankan jejak auditnya", async () => {
    const scenario = await createScenario();
    await upload(scenario, "ktp", PNG);
    await upload(scenario, "selfie", JPEG);

    // Hanya KTP yang kedaluwarsa; swafoto harus selamat.
    await prisma.membershipDocument.updateMany({
      where: { orderId: scenario.orderId, type: "KTP" },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    expect(await documentService.purgeExpired()).toBe(1);

    const ktp = await prisma.membershipDocument.findFirstOrThrow({
      where: { orderId: scenario.orderId, type: "KTP" }
    });
    expect(ktp.cipherText).toBeNull();
    expect(ktp.cipherIv).toBeNull();
    expect(ktp.cipherTag).toBeNull();
    expect(ktp.purgedAt).not.toBeNull();
    // Jejak audit bertahan: barisnya, checksum, dan waktu unggahnya tetap ada.
    expect(ktp.checksum).not.toBeNull();
    expect(ktp.uploadedAt).not.toBeNull();

    const selfie = await prisma.membershipDocument.findFirstOrThrow({
      where: { orderId: scenario.orderId, type: "SELFIE" }
    });
    expect(selfie.cipherText).not.toBeNull();

    // Penyapuan kedua tidak menemukan apa pun lagi.
    expect(await documentService.purgeExpired()).toBe(0);
  });

  it("mencatat siapa yang membuka dokumen identitas", async () => {
    const scenario = await createScenario();
    await upload(scenario, "ktp", PNG);

    const response = await fetch(
      `${baseUrl}/api/v1/admin/member-requests/${scenario.orderId}/documents/ktp`,
      { headers: { authorization: `Bearer ${tokenFor(scenario.admin)}` } }
    );
    expect(response.status).toBe(200);

    // Membuka KTP orang lain harus meninggalkan jejak. Tanpa ini, tidak ada
    // cara membuktikan siapa saja yang pernah melihat identitas seorang pemohon.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "MEMBERSHIP_DOCUMENT_VIEWED" }
    });
    const metadata = audit.metadata as Record<string, unknown>;
    expect(audit.actorId).toBe(scenario.admin.id);
    expect(audit.entityType).toBe("MEMBERSHIP_DOCUMENT");
    expect(metadata.orderId).toBe(scenario.orderId);
    expect(metadata.targetUserId).toBe(scenario.buyer.id);
    expect(metadata.documentType).toBe("KTP");
  });

  it("mencatat setiap pembukaan, bukan hanya yang pertama", async () => {
    const scenario = await createScenario();
    await upload(scenario, "ktp", PNG);
    await upload(scenario, "selfie", JPEG);

    for (const type of ["ktp", "selfie", "ktp"]) {
      const response = await fetch(
        `${baseUrl}/api/v1/admin/member-requests/${scenario.orderId}/documents/${type}`,
        { headers: { authorization: `Bearer ${tokenFor(scenario.admin)}` } }
      );
      expect(response.status).toBe(200);
    }

    expect(
      await prisma.auditLog.count({ where: { action: "MEMBERSHIP_DOCUMENT_VIEWED" } })
    ).toBe(3);
  });

  it("tidak mencatat pembukaan yang gagal", async () => {
    const scenario = await createScenario();
    await upload(scenario, "ktp", PNG);
    await prisma.membershipDocument.updateMany({
      where: { orderId: scenario.orderId, type: "KTP" },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const expired = await fetch(
      `${baseUrl}/api/v1/admin/member-requests/${scenario.orderId}/documents/ktp`,
      { headers: { authorization: `Bearer ${tokenFor(scenario.admin)}` } }
    );
    expect(expired.status).toBe(410);

    const forbidden = await fetch(
      `${baseUrl}/api/v1/admin/member-requests/${scenario.orderId}/documents/selfie`,
      { headers: { authorization: `Bearer ${tokenFor(scenario.buyer)}` } }
    );
    expect(forbidden.status).toBe(403);

    // Tidak ada isi dokumen yang keluar, jadi tidak ada yang "dilihat".
    expect(
      await prisma.auditLog.count({ where: { action: "MEMBERSHIP_DOCUMENT_VIEWED" } })
    ).toBe(0);
  });

  it("menolak berkas yang bukan gambar walau content-type-nya mengaku gambar", async () => {
    const scenario = await createScenario();
    const disguised = Buffer.from("%PDF-1.7 ini sebenarnya PDF", "utf8");

    const response = await fetch(
      `${baseUrl}/api/v1/web/membership/orders/${scenario.orderId}/documents/ktp`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenFor(scenario.buyer)}`,
          "content-type": "image/png"
        },
        body: disguised
      }
    );

    expect(response.status).toBe(415);
    expect(await codeOf(response)).toBe("MEMBERSHIP_DOCUMENT_TYPE_INVALID");
    expect(await prisma.membershipDocument.count({ where: { orderId: scenario.orderId } })).toBe(0);
  });

  it("menolak content-type yang tidak diizinkan", async () => {
    const scenario = await createScenario();

    const response = await fetch(
      `${baseUrl}/api/v1/web/membership/orders/${scenario.orderId}/documents/ktp`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokenFor(scenario.buyer)}`,
          "content-type": "application/pdf"
        },
        body: PNG
      }
    );

    expect(response.status).toBe(415);
    expect(await prisma.membershipDocument.count({ where: { orderId: scenario.orderId } })).toBe(0);
  });

  it("menolak unggahan tanpa token", async () => {
    const scenario = await createScenario();

    const response = await fetch(
      `${baseUrl}/api/v1/web/membership/orders/${scenario.orderId}/documents/ktp`,
      { method: "POST", headers: { "content-type": "image/png" }, body: PNG }
    );

    expect(response.status).toBe(401);
    expect(await prisma.membershipDocument.count({ where: { orderId: scenario.orderId } })).toBe(0);
  });

  it("menolak unggahan atas pengajuan milik orang lain", async () => {
    const scenario = await createScenario();
    const outsider = await createUser("DOCOUTSIDER", "USER");

    const response = await fetch(
      `${baseUrl}/api/v1/web/membership/orders/${scenario.orderId}/documents/ktp`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${tokenFor(outsider)}`, "content-type": "image/png" },
        body: PNG
      }
    );

    expect(response.status).toBe(403);
    expect(await prisma.membershipDocument.count({ where: { orderId: scenario.orderId } })).toBe(0);
  });

  it("menolak pengguna biasa membuka isi dokumen", async () => {
    const scenario = await createScenario();
    await upload(scenario, "ktp", PNG);

    // Pemiliknya sendiri pun tidak boleh menarik ulang isi berkasnya lewat
    // permukaan admin. Isi dokumen hanya keluar untuk admin yang mencetaknya.
    const response = await fetch(
      `${baseUrl}/api/v1/admin/member-requests/${scenario.orderId}/documents/ktp`,
      { headers: { authorization: `Bearer ${tokenFor(scenario.buyer)}` } }
    );

    expect(response.status).toBe(403);
  });

  it("memberi pemohon ringkasan dokumennya tanpa isi berkas", async () => {
    const scenario = await createScenario();
    await upload(scenario, "ktp", PNG);

    const response = await fetch(
      `${baseUrl}/api/v1/web/membership/orders/${scenario.orderId}/documents`,
      { headers: { authorization: `Bearer ${tokenFor(scenario.buyer)}` } }
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    const data = JSON.parse(body).data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ type: "KTP", status: "PENDING", available: true });
    // Tidak ada satu pun kolom ciphertext yang bocor lewat ringkasan.
    expect(body).not.toContain("cipher");
  });

  it("menolak unggahan setelah pengajuan aktif", async () => {
    const scenario = await createScenario();
    await orderService.markPaymentSuccess({
      userId: scenario.buyer.id,
      role: "USER",
      orderId: scenario.orderId,
      paymentReference: "dokumen-setelah-aktif"
    });
    await orderService.activateVerifiedOrder({
      orderId: scenario.orderId,
      adminId: scenario.admin.id
    });

    const response = await upload(scenario, "ktp", PNG);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("MEMBERSHIP_ALREADY_ACTIVATED");
  });

  it("menolak unggahan bila kunci enkripsi belum disetel", async () => {
    const scenario = await createScenario();
    backendEnv.MEMBERSHIP_DOCUMENT_SECRET = undefined;

    const response = await upload(scenario, "ktp", PNG);

    // Fail closed: gagal terang-terangan, bukan diam-diam menyimpan mentah.
    expect(response.status).toBe(503);
    expect(await codeOf(response)).toBe("MEMBERSHIP_DOCUMENT_SECRET_UNAVAILABLE");
    expect(await prisma.membershipDocument.count({ where: { orderId: scenario.orderId } })).toBe(0);
  });

  it("menolak dokumen yang ciphertext-nya diubah di database", async () => {
    const scenario = await createScenario();
    await upload(scenario, "ktp", PNG);

    const stored = await prisma.membershipDocument.findFirstOrThrow({
      where: { orderId: scenario.orderId, type: "KTP" }
    });
    const tampered = Buffer.from(stored.cipherText!);
    tampered[0] = tampered[0]! ^ 0xff;
    await prisma.membershipDocument.update({
      where: { id: stored.id },
      data: { cipherText: tampered }
    });

    const response = await fetch(
      `${baseUrl}/api/v1/admin/member-requests/${scenario.orderId}/documents/ktp`,
      { headers: { authorization: `Bearer ${tokenFor(scenario.admin)}` } }
    );

    // GCM menolak, jadi yang keluar bukan gambar rusak melainkan penolakan.
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("MEMBERSHIP_DOCUMENT_CORRUPT");
  });

  it("menggantikan dokumen lama saat pemohon mengunggah ulang", async () => {
    const scenario = await createScenario();
    await upload(scenario, "ktp", PNG);
    const revised = Buffer.concat([PNG, Buffer.from("-revisi", "utf8")]);
    expect((await upload(scenario, "ktp", revised)).status).toBe(201);

    const documents = await prisma.membershipDocument.findMany({
      where: { orderId: scenario.orderId, type: "KTP" }
    });
    expect(documents).toHaveLength(1);
    expect(documents[0]!.checksum).toBe(
      crypto.createHash("sha256").update(revised).digest("hex")
    );
  });
});

type Scenario = { buyer: User; admin: User; orderId: string };

async function createScenario(): Promise<Scenario> {
  const buyer = await createUser("DOCBUYER", "USER");
  const admin = await createUser("DOCADMIN", "ADMIN");
  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  const order = await orderService.createOrder({
    userId: buyer.id,
    packageId: silver.id,
    channel: "WEB"
  });
  return { buyer, admin, orderId: order.id };
}

async function upload(scenario: Scenario, type: "ktp" | "selfie", bytes: Buffer) {
  return fetch(`${baseUrl}/api/v1/web/membership/orders/${scenario.orderId}/documents/${type}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokenFor(scenario.buyer)}`,
      "content-type": bytes[0] === 0xff ? "image/jpeg" : "image/png"
    },
    body: bytes
  });
}

async function codeOf(response: Response) {
  const body = (await response.json()) as { code?: string };
  return body.code;
}

function tokenFor(user: User) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` });
}

async function createUser(label: string, role: UserRole): Promise<User> {
  sequence += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${label}`,
      phone: `+6288${String(sequence).padStart(8, "0")}`,
      referralCode: `${label}${sequence}`.slice(0, 24),
      role,
      membershipId: basic.id
    }
  });
}
