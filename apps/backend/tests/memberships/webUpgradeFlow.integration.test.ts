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
 * Kontrak HTTP yang dipakai halaman web /upgrade (Stage R2.6 jalur A).
 *
 * Halaman upgrade adalah klien terpisah yang tidak ikut dikompilasi bersama
 * backend, jadi tidak ada pemeriksa tipe yang menjaga kecocokan keduanya. Berkas
 * ini yang menjaganya: setiap kolom yang dibaca halaman disebut namanya di sini,
 * sehingga mengubah bentuk respons backend akan menggagalkan test, bukan
 * mematahkan halaman secara diam-diam.
 *
 * Urutan yang diuji sama persis dengan urutan langkah pengguna:
 * masuk, pilih paket, buat pengajuan, bayar, tunggu verifikasi, aktif.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let restoreFlags: () => void = () => {};

const DEMO_PHONE = "+6281234500001";
const DEMO_PASSWORD = "rahasia-contoh";

describe.skipIf(!runIntegration)("Web upgrade flow contract", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-web-upgrade-flow";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-web-upgrade-flow";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    backendEnv = envModule.env;

    // Seluruh berkas test berjalan dalam satu proses, jadi modul env dipakai
    // bersama. Nilai awal disimpan agar berkas ini tidak mewariskan flag-nya ke
    // berkas berikutnya.
    const before = {
      master: backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED,
      web: backendEnv.MEMBERSHIP_PURCHASE_WEB_ENABLED,
      app: backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED,
      doku: backendEnv.DOKU_ENABLED,
      midtransProduction: backendEnv.MIDTRANS_IS_PRODUCTION,
      midtransKey: backendEnv.MIDTRANS_SERVER_KEY
    };
    restoreFlags = () => {
      backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = before.master;
      backendEnv.MEMBERSHIP_PURCHASE_WEB_ENABLED = before.web;
      backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED = before.app;
      backendEnv.DOKU_ENABLED = before.doku;
      backendEnv.MIDTRANS_IS_PRODUCTION = before.midtransProduction;
      backendEnv.MIDTRANS_SERVER_KEY = before.midtransKey;
    };

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    // Kanal web dibuka; kanal aplikasi tetap tertutup. Flag penyedia pembayaran
    // ikut disetel eksplisit karena berkas test lain mengubahnya, dan alur di
    // sini bergantung pada jalur sandbox Midtrans.
    backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = true;
    backendEnv.MEMBERSHIP_PURCHASE_WEB_ENABLED = true;
    backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED = false;
    backendEnv.DOKU_ENABLED = false;
    backendEnv.MIDTRANS_IS_PRODUCTION = false;
    backendEnv.MIDTRANS_SERVER_KEY = undefined;
  });

  afterAll(async () => {
    restoreFlags();
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("mengembalikan token yang dipakai halaman saat pengguna masuk", async () => {
    await createDemoUser();

    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: DEMO_PHONE, password: DEMO_PASSWORD })
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; data: { accessToken?: string } };
    expect(body.success).toBe(true);
    expect(typeof body.data.accessToken).toBe("string");
    expect(body.data.accessToken!.length).toBeGreaterThan(20);
  });

  it("menyediakan seluruh kolom paket yang dibaca halaman pilih paket", async () => {
    const response = await fetch(`${baseUrl}/api/v1/web/membership/packages`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: Array<Record<string, unknown>> };
    const silver = body.data.find((item) => item.tier === "SILVER");
    expect(silver, "paket Silver harus terlihat pada kanal web").toBeDefined();

    // Halaman membangun daftar manfaat dari kolom-kolom ini.
    expect(silver).toMatchObject({ tier: "SILVER", name: expect.any(String) });
    expect(Number(silver!.price)).toBe(500000);
    expect(Number(silver!.ppobBalance)).toBe(100000);
    expect(typeof silver!.activeLevels).toBe("number");
    expect(typeof silver!.id).toBe("string");

    // Basic disaring di sisi halaman, tetapi tetap dikirim server. Yang penting
    // paket berbayar benar-benar terlihat pada kanal ini.
    expect(body.data.map((item) => item.tier)).toContain("GOLD");
  });

  it("menjalankan seluruh langkah sampai membership aktif", async () => {
    const user = await createDemoUser();
    const token = tokenFor(user);
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });

    // Langkah 3: data dan dokumen menjadi satu pengajuan.
    const created = await api("/web/membership/orders", token, {
      method: "POST",
      body: JSON.stringify({
        packageId: silver.id,
        registrationData: {
          fullName: "Demo Upgrade",
          address: "Jl. Merdeka No. 12, Serang",
          consentAt: new Date().toISOString(),
          documentsUploaded: false
        }
      })
    });
    expect(created.status).toBe(201);
    const order = created.body.data as Record<string, any>;
    expect(order.status).toBe("PENDING");
    expect(Number(order.totalAmount)).toBe(500000);
    expect(order.membership.name).toBe("Silver");
    expect(order.invoice.number).toMatch(/^INV-MBR-/);
    expect(order.user.fullName).toBe("Demo Upgrade");
    expect(order.channel).toBe("WEB");

    // Langkah 4: pembayaran. Tanpa kredensial penyedia, jalur sandbox menandai
    // lunas — dan justru itu yang membuktikan aturan barunya bekerja.
    const paid = await api(`/web/membership/orders/${order.id}/pay`, token, {
      method: "POST",
      body: JSON.stringify({})
    });
    expect(paid.status).toBe(200);
    const handoff = paid.body.data as Record<string, unknown>;
    expect(handoff).toHaveProperty("redirectUrl");
    expect(handoff).toHaveProperty("orderId");

    // Langkah 5: lunas, tetapi BELUM aktif.
    const awaiting = await api(`/web/membership/orders/${order.id}`, token);
    expect(awaiting.status).toBe(200);
    const awaitingOrder = awaiting.body.data as Record<string, any>;
    expect(awaitingOrder.status).toBe("PAID");
    // Inilah satu-satunya penanda yang membedakan "menunggu verifikasi" dari
    // "aktif" pada halaman status.
    expect(awaitingOrder.userMembership).toBeNull();

    // Admin memverifikasi dokumen.
    const admin = await createUser("FLOWADMIN", "ADMIN");
    const verified = await fetch(
      `${baseUrl}/api/v1/admin/member-requests/${order.id}/verify-documents`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${tokenFor(admin)}`
        },
        body: "{}"
      }
    );
    expect(verified.status).toBe(200);

    // Halaman status kini menampilkan "aktif" tanpa perlu bertanya ke endpoint lain.
    const active = await api(`/web/membership/orders/${order.id}`, token);
    const activeOrder = active.body.data as Record<string, any>;
    expect(activeOrder.status).toBe("PAID");
    expect(activeOrder.userMembership?.status).toBe("ACTIVE");
  });

  it("menandai pengajuan yang dokumennya ditolak agar halaman dapat menampilkan pengembalian dana", async () => {
    const user = await createDemoUser();
    const token = tokenFor(user);
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });

    const created = await api("/web/membership/orders", token, {
      method: "POST",
      body: JSON.stringify({ packageId: silver.id, registrationData: { fullName: "Demo Upgrade" } })
    });
    const orderId = (created.body.data as { id: string }).id;
    await api(`/web/membership/orders/${orderId}/pay`, token, { method: "POST", body: "{}" });

    const admin = await createUser("FLOWREJECT", "ADMIN");
    const rejected = await fetch(
      `${baseUrl}/api/v1/admin/member-requests/${orderId}/reject-documents`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${tokenFor(admin)}`
        },
        body: JSON.stringify({ reason: "KTP tidak terbaca" })
      }
    );
    expect(rejected.status).toBe(200);

    const final = await api(`/web/membership/orders/${orderId}`, token);
    const finalOrder = final.body.data as Record<string, any>;
    // Dua kolom inilah yang dipakai halaman untuk memilih pesan "dana
    // dikembalikan" alih-alih "dibatalkan" biasa.
    expect(finalOrder.status).toBe("CANCELLED");
    expect(finalOrder.registrationData.documentRejection.refund.amount).toBe("500000.00");
  });

  it("tetap menutup kanal aplikasi walau kanal web terbuka", async () => {
    const user = await createDemoUser();
    const token = tokenFor(user);
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });

    const response = await fetch(`${baseUrl}/api/v1/membership/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ packageId: silver.id })
    });

    expect(response.status).toBe(403);
  });
});

async function api(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  return { status: response.status, body: (await response.json()) as { data: unknown } };
}

function tokenFor(user: User) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` });
}

async function createDemoUser() {
  const { hashPassword } = await import("../../src/core/security/passwordHasher.js");
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: "Demo Upgrade",
      phone: DEMO_PHONE,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      status: "ACTIVE",
      role: "USER",
      referralCode: "FLOWDEMO",
      membershipId: basic.id
    }
  });
}

async function createUser(referralCode: string, role: UserRole): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.length}${Date.now().toString().slice(-8)}`,
      referralCode,
      role,
      membershipId: basic.id
    }
  });
}
