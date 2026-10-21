import { PrismaClient, User, UserRole } from "@prisma/client";
import express from "express";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../src/core/errors/errorHandler.js";
import { createServiceSuspensionGate, isSuspensionExempt } from "../../src/core/http/serviceSuspensionGate.js";
import {
  DEFAULT_SUSPENSION_MESSAGE,
  ServiceSuspensionService,
  SuspensionSnapshot
} from "../../src/modules/service-suspension/application/ServiceSuspensionService.js";
import { hashPassword } from "../../src/core/security/passwordHasher.js";
import { cleanDatabase, prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Penghentian layanan (suspend): dikendalikan HANYA oleh SUPER_ADMIN_VIP,
 * dapat dibalik, tidak menyentuh data, dan tidak mengunci pemilik dari konsol.
 */

describe("isSuspensionExempt", () => {
  it("membuka admin, webhook penyedia, dan jalur akun", () => {
    for (const path of ["/admin", "/admin/overview", "/webhooks/ppob", "/payments/midtrans/notification", "/account/delete-request"]) {
      expect(isSuspensionExempt(path), path).toBe(true);
    }
  });

  it("membuka /auth hanya untuk klien non-HP", () => {
    expect(isSuspensionExempt("/auth/login", false)).toBe(true);
    expect(isSuspensionExempt("/auth/login", true)).toBe(false);
  });

  it("menutup semua jalur layanan lain", () => {
    for (const path of ["/rides/quotes", "/driver/rides/offers", "/ppob/checkout", "/wallet/transfer", "/payments/other", "/adminx"]) {
      expect(isSuspensionExempt(path), path).toBe(false);
    }
  });
});

describe("gerbang suspend (pembaca palsu, tanpa database)", () => {
  let server: Server;
  let baseUrl = "";
  let state: SuspensionSnapshot = { suspended: false, message: "pesan uji" };
  let readerFails = false;

  beforeAll(async () => {
    const app = express();
    app.use(
      "/api/v1",
      createServiceSuspensionGate({
        current: async () => {
          if (readerFails) throw new Error("db mati");
          return state;
        }
      })
    );
    app.all("/api/v1/*", (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    state = { suspended: false, message: "pesan uji" };
    readerFails = false;
  });

  const call = (path: string, headers: Record<string, string> = {}) => fetch(`${baseUrl}/api/v1${path}`, { headers });

  it("saklar mati: semua jalur lewat", async () => {
    expect((await call("/rides/quotes")).status).toBe(200);
  });

  it("saklar nyala: aplikasi HP mendapat 503 SERVICE_SUSPENDED dengan pesan dari status", async () => {
    state = { suspended: true, message: "pesan uji" };
    for (const headers of [
      { "x-tapgo-app": "driver", "x-tapgo-platform": "android" },
      { "x-tapgo-platform": "android", "x-tapgo-distribution": "play" }
    ]) {
      const response = await call("/auth/login", headers);
      expect(response.status).toBe(503);
      const body = (await response.json()) as { code?: string; message?: string };
      expect(body.code).toBe("SERVICE_SUSPENDED");
      expect(body.message).toBe("pesan uji");
    }
  });

  it("saklar nyala: jalur layanan ditolak untuk semua klien, jalur admin/akun/webhook tetap hidup", async () => {
    state = { suspended: true, message: "pesan uji" };
    expect((await call("/rides/quotes")).status).toBe(503);
    expect((await call("/driver/rides/offers", { "x-tapgo-app": "driver" })).status).toBe(503);
    for (const path of ["/admin/service-suspension", "/auth/login", "/account/delete-request", "/webhooks/ppob/digiflazz"]) {
      expect((await call(path)).status, path).toBe(200);
    }
  });

  it("pembaca gagal: error diteruskan (pembaca asli sendiri yang fail-static)", async () => {
    readerFails = true;
    expect((await call("/rides/quotes")).status).toBe(500);
    // Jalur yang dikecualikan tidak pernah menyentuh pembaca.
    expect((await call("/admin/anything")).status).toBe(200);
  });
});

describe("ServiceSuspensionService (Prisma palsu)", () => {
  function fakePrisma(initial: { suspended: boolean; message: string | null } | null) {
    let row = initial ? { id: "GLOBAL", changedById: null, changedAt: new Date("2026-10-22T00:00:00Z"), ...initial } : null;
    const audit: unknown[] = [];
    const findUnique = vi.fn(async () => row);
    const tx = {
      serviceSuspension: {
        findUnique,
        upsert: vi.fn(async ({ update, create }: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
          row = { ...((row ?? create) as NonNullable<typeof row>), ...update } as NonNullable<typeof row>;
          return row!;
        })
      },
      auditLog: { create: vi.fn(async ({ data }: { data: unknown }) => void audit.push(data)) }
    };
    const client = {
      serviceSuspension: { findUnique },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)
    };
    return { client: client as unknown as PrismaClient, audit, findUnique, setRow: (r: typeof row) => (row = r) };
  }

  it("memakai pesan bawaan bila kosong dan menyimpan hasil baca selama TTL", async () => {
    let now = 1_000;
    const { client, findUnique } = fakePrisma({ suspended: true, message: null });
    const service = new ServiceSuspensionService(client, 5_000, () => now);
    expect(await service.current()).toEqual({ suspended: true, message: DEFAULT_SUSPENSION_MESSAGE });
    await service.current();
    expect(findUnique).toHaveBeenCalledTimes(1);
    now += 5_001;
    await service.current();
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("gagal baca: memakai keadaan terakhir yang diketahui, tanpa membuka atau menutup mendadak", async () => {
    let now = 0;
    const { client, findUnique } = fakePrisma({ suspended: true, message: "x" });
    const service = new ServiceSuspensionService(client, 1_000, () => now);
    expect((await service.current()).suspended).toBe(true);
    findUnique.mockRejectedValue(new Error("db mati"));
    now += 2_000;
    expect((await service.current()).suspended).toBe(true);
  });

  it("belum pernah terbaca dan database gagal: layanan tetap dianggap berjalan", async () => {
    const { client, findUnique } = fakePrisma(null);
    findUnique.mockRejectedValue(new Error("db mati"));
    expect((await new ServiceSuspensionService(client).current()).suspended).toBe(false);
  });

  it("hanya SUPER_ADMIN_VIP yang dapat mengubah status", async () => {
    const { client, audit } = fakePrisma({ suspended: false, message: null });
    const service = new ServiceSuspensionService(client);
    for (const role of ["SUPER_ADMIN", "ADMIN", "USER", "DRIVER"] as UserRole[]) {
      await expect(service.set({ actorId: "u1", actorRole: role, suspended: true })).rejects.toMatchObject({
        code: "SERVICE_SUSPENSION_FORBIDDEN"
      });
    }
    expect(audit).toHaveLength(0);
  });

  it("perubahan VIP tercatat di audit dan berlaku seketika di proses ini", async () => {
    const { client, audit } = fakePrisma({ suspended: false, message: null });
    const service = new ServiceSuspensionService(client);
    expect((await service.current()).suspended).toBe(false);
    const status = await service.set({ actorId: "vip1", actorRole: "SUPER_ADMIN_VIP", suspended: true, message: "  Dijeda  " });
    expect(status).toMatchObject({ suspended: true, message: "Dijeda", changedById: "vip1" });
    expect(await service.current()).toEqual({ suspended: true, message: "Dijeda" });
    expect(audit).toEqual([
      expect.objectContaining({
        actorId: "vip1",
        action: "SERVICE_SUSPENDED",
        entityType: "SERVICE_SUSPENSION",
        metadata: { before: false, after: true, message: "Dijeda" }
      })
    ]);
    await service.set({ actorId: "vip1", actorRole: "SUPER_ADMIN_VIP", suspended: false });
    expect((await service.current()).suspended).toBe(false);
    expect(audit[1]).toMatchObject({ action: "SERVICE_RESUMED" });
  });
});

describe.skipIf(!runIntegration)("Rute /admin/service-suspension (database uji)", () => {
  let server: Server | undefined;
  let baseUrl = "";
  let sign: (payload: { sub: string; role: UserRole; sessionId: string }) => string;
  let seq = 0;
  const PASSWORD = "Rahasia-Uji-12345";

  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-suspend-000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-suspend-00";
    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    sign = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await prisma.serviceSuspension.upsert({
      where: { id: "GLOBAL" },
      update: { suspended: false, message: null, changedById: null },
      create: { id: "GLOBAL", suspended: false }
    });
  });

  afterAll(async () => {
    await prisma.serviceSuspension.updateMany({ data: { suspended: false, message: null, changedById: null } });
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function createUser(role: UserRole): Promise<User> {
    seq += 1;
    return prisma.user.create({
      data: {
        fullName: `Pelaku ${role} ${seq}`,
        phone: `+62898${String(seq).padStart(8, "0")}`,
        referralCode: `SUS${String(seq).padStart(6, "0")}`,
        role,
        passwordHash: await hashPassword(PASSWORD)
      }
    });
  }

  const auth = (user: User) => ({
    authorization: `Bearer ${sign({ sub: user.id, role: user.role, sessionId: `session-${user.id}` })}`,
    "content-type": "application/json"
  });

  const put = (user: User, body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/v1/admin/service-suspension`, { method: "PUT", headers: auth(user), body: JSON.stringify(body) });

  it("tanpa token 401; Super Admin, Admin, dan pengguna biasa 403 untuk baca maupun ubah", async () => {
    expect((await fetch(`${baseUrl}/api/v1/admin/service-suspension`)).status).toBe(401);
    for (const role of ["SUPER_ADMIN", "ADMIN", "USER"] as UserRole[]) {
      const user = await createUser(role);
      const read = await fetch(`${baseUrl}/api/v1/admin/service-suspension`, { headers: auth(user) });
      expect(read.status, `GET ${role}`).toBe(403);
      const write = await put(user, { suspended: true, confirm: "HENTIKAN", password: PASSWORD });
      expect(write.status, `PUT ${role}`).toBe(403);
    }
    expect((await prisma.serviceSuspension.findUniqueOrThrow({ where: { id: "GLOBAL" } })).suspended).toBe(false);
  });

  it("VIP: konfirmasi salah 400, password salah 403, keduanya tidak mengubah apa pun", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    expect((await put(vip, { suspended: true, confirm: "ya", password: PASSWORD })).status).toBe(400);
    expect((await put(vip, { suspended: true, confirm: "HENTIKAN", password: "salah-total" })).status).toBe(403);
    expect((await prisma.serviceSuspension.findUniqueOrThrow({ where: { id: "GLOBAL" } })).suspended).toBe(false);
    expect(await prisma.auditLog.count({ where: { entityType: "SERVICE_SUSPENSION" } })).toBe(0);
  });

  it("VIP menghentikan layanan: aplikasi HP 503, konsol tetap bisa, lalu memulihkan", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const driver = await createUser("DRIVER");

    const stop = await put(vip, { suspended: true, message: "Dijeda sementara", confirm: "hentikan", password: PASSWORD });
    expect(stop.status).toBe(200);

    const phone = await fetch(`${baseUrl}/api/v1/rides/quotes`, {
      method: "POST",
      headers: { ...auth(driver), "x-tapgo-platform": "android", "x-tapgo-app": "driver" },
      body: "{}"
    });
    expect(phone.status).toBe(503);
    expect(((await phone.json()) as { code?: string }).code).toBe("SERVICE_SUSPENDED");

    const consoleRes = await fetch(`${baseUrl}/api/v1/admin/service-suspension`, { headers: auth(vip) });
    expect(consoleRes.status).toBe(200);
    expect(((await consoleRes.json()) as { data: { suspended: boolean; changedByName: string } }).data).toMatchObject({
      suspended: true
    });

    expect((await put(vip, { suspended: false, confirm: "PULIHKAN", password: PASSWORD })).status).toBe(200);
    const after = await fetch(`${baseUrl}/api/v1/rides/quotes`, {
      method: "POST",
      headers: { ...auth(driver), "x-tapgo-platform": "android", "x-tapgo-app": "driver" },
      body: "{}"
    });
    expect(after.status).not.toBe(503);

    const actions = (await prisma.auditLog.findMany({ where: { entityType: "SERVICE_SUSPENSION" }, orderBy: { createdAt: "asc" } })).map(
      (row) => row.action
    );
    expect(actions).toEqual(["SERVICE_SUSPENDED", "SERVICE_RESUMED"]);
  });
});
