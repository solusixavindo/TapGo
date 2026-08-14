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
 * Ganti password oleh pengguna yang sedang masuk.
 *
 * Sebelumnya hanya ada pemulihan lewat OTP. Akibatnya pemilik akun admin tidak
 * punya cara mengganti passwordnya sendiri tanpa menunggu OTP — dan password
 * yang pernah dibagikan lewat kanal lain tidak dapat segera diganti.
 *
 * Yang dijaga berkas ini, berurut dari yang paling berbahaya bila gagal:
 * 1. Password lama WAJIB dibuktikan. Tanpa itu, token yang bocor cukup untuk
 *    mengambil alih akun secara permanen.
 * 2. Seluruh sesi lain dicabut setelah penggantian, termasuk token yang sudah
 *    terbit — inilah gunanya authVersion.
 * 3. Password baru benar-benar berlaku, dan yang lama benar-benar mati.
 * 4. Pengguna tanpa token tidak dapat menyentuh endpoint ini sama sekali.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

const LAMA = "SandiLama#2026";
const BARU = "SandiBaru#2026";

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

describe.skipIf(!runIntegration)("Ganti password akun sendiri", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-change-password";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-change-password";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("menolak tanpa token sama sekali", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: LAMA, newPassword: BARU })
    });
    expect(response.status).toBe(401);
  });

  it("menolak bila password lama salah, dan TIDAK mengubah apa pun", async () => {
    const akun = await buatAkun();
    const sebelum = await ambilHash(akun.user.id);

    const response = await ganti(akun.token, "SandiKeliru#9", BARU);
    expect(response.status).toBe(401);

    // Pemeriksaan terpenting di berkas ini: token yang bocor saja tidak boleh
    // cukup untuk mengambil alih akun. Password lama harus dibuktikan.
    expect(await ambilHash(akun.user.id)).toBe(sebelum);
    expect(await loginStatus(akun.user.phone, LAMA)).toBe(200);
  });

  it("mengganti password dan mematikan yang lama", async () => {
    const akun = await buatAkun();

    expect((await ganti(akun.token, LAMA, BARU)).status).toBe(204);

    expect(await loginStatus(akun.user.phone, BARU)).toBe(200);
    expect(await loginStatus(akun.user.phone, LAMA)).toBe(401);
  });

  it("mencabut token yang sudah terbit setelah penggantian", async () => {
    const akun = await buatAkun();
    // Token ini sah sebelum penggantian.
    expect((await me(akun.token)).status).toBe(200);

    expect((await ganti(akun.token, LAMA, BARU)).status).toBe(204);

    // Setelah password berganti, token lama HARUS mati. Tanpa ini, penyerang
    // yang sudah memegang token tetap masuk walau korban sudah mengganti
    // passwordnya — persis skenario yang membuat penggantian jadi sia-sia.
    expect((await me(akun.token)).status).toBe(401);
  });

  it("menaikkan authVersion dan mencabut baris Session", async () => {
    const akun = await buatAkun();
    const sebelum = await prisma.user.findUniqueOrThrow({
      where: { id: akun.user.id },
      select: { authVersion: true }
    });

    expect((await ganti(akun.token, LAMA, BARU)).status).toBe(204);

    const sesudah = await prisma.user.findUniqueOrThrow({
      where: { id: akun.user.id },
      select: { authVersion: true }
    });
    expect(sesudah.authVersion).toBe(sebelum.authVersion + 1);

    const aktif = await prisma.session.count({
      where: { userId: akun.user.id, revokedAt: null }
    });
    expect(aktif).toBe(0);
  });

  it("menolak password baru yang sama dengan yang lama", async () => {
    const akun = await buatAkun();
    const response = await ganti(akun.token, LAMA, LAMA);
    expect(response.status).toBe(400);
    // Password lama harus tetap berlaku setelah penolakan.
    expect(await loginStatus(akun.user.phone, LAMA)).toBe(200);
  });

  it("menolak password baru yang terlalu pendek", async () => {
    const akun = await buatAkun();
    expect((await ganti(akun.token, LAMA, "abc")).status).toBe(400);
    expect(await loginStatus(akun.user.phone, LAMA)).toBe(200);
  });

  /* ── Pembantu ────────────────────────────────────────────────────────── */

  function ganti(token: string, currentPassword: string, newPassword: string) {
    return fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
  }

  function me(token: string) {
    return fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${token}` }
    });
  }

  async function loginStatus(phone: string, password: string) {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, password })
    });
    return response.status;
  }

  async function ambilHash(userId: string) {
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true }
    });
    return row.passwordHash;
  }

  async function buatAkun() {
    sequence += 1;
    const suffix = String(sequence).padStart(3, "0");
    const phone = `0813900${suffix}`;

    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: `Uji Ganti ${suffix}`, phone, password: LAMA })
    });
    expect(response.status).toBe(201);

    const user: User = await prisma.user.findFirstOrThrow({ where: { phone } });
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: `hash-${user.id}`,
        expiresAt: new Date(Date.now() + 3_600_000)
      }
    });

    return {
      user,
      token: signAccessToken({ sub: user.id, role: user.role, sessionId: session.id })
    };
  }
});
