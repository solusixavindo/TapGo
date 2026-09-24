import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Program Founder Chairman & Platinum dimatikan sementara (keputusan Owner,
 * 2026-09-24) lewat FOUNDER_PROGRAM_ENABLED yang fail closed. Berkas ini
 * membuktikan: tanpa flag, tidak ada grant/perubahan status yang bisa terjadi
 * — bahkan oleh SUPER_ADMIN — sementara pembacaan untuk audit tetap terbuka.
 */

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

describe.skipIf(!runIntegration)("Admin console — program Founder dimatikan", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-founder-disabled";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-founder-disabled";
    // Pastikan default sungguhan diuji, bukan sisa env dari berkas tes lain.
    delete process.env.FOUNDER_PROGRAM_ENABLED;

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  async function createUser(role: UserRole) {
    sequence += 1;
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    return prisma.user.create({
      data: {
        fullName: `Pengguna Founder ${sequence}`,
        phone: `+628${String(800000000 + sequence)}`,
        referralCode: `FDR${String(sequence).padStart(6, "0")}`,
        role,
        membershipId: basic.id
      }
    });
  }

  function call(actor: User, path: string, method = "GET", body?: unknown) {
    return fetch(`${baseUrl}/api/v1/admin${path}`, {
      method,
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: actor.id, role: actor.role, sessionId: `sess-${actor.id}` })}`,
        "content-type": "application/json"
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }

  const MUTATIONS: Array<{ method: string; path: string }> = [
    { method: "POST", path: "/founder-platinum/grants" },
    { method: "POST", path: "/founder-chairman/grant" },
    { method: "PATCH", path: "/founder-platinum/FP-001/status" },
    { method: "PATCH", path: "/founder-chairman/FCH-001/status" }
  ];

  it("menolak grant dan perubahan status Founder — bahkan untuk SUPER_ADMIN — dengan kode FOUNDER_PROGRAM_DISABLED", async () => {
    const superAdmin = await createUser("SUPER_ADMIN");
    for (const mutation of MUTATIONS) {
      const response = await call(superAdmin, mutation.path, mutation.method, {});
      expect(response.status, `${mutation.method} ${mutation.path}`).toBe(403);
      const body = (await response.json()) as { code?: string };
      expect(body.code, `${mutation.method} ${mutation.path}`).toBe("FOUNDER_PROGRAM_DISABLED");
    }
    expect(await prisma.founderProgramGrant.count()).toBe(0);
  });

  it("SUPER_ADMIN_VIP juga tidak bisa melewati saklar", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const response = await call(vip, "/founder-platinum/grants", "POST", {});
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code?: string }).code).toBe("FOUNDER_PROGRAM_DISABLED");
  });

  it("jalur non-HTTP (service dipanggil langsung, seperti scripts/seed-founder-*.ts) juga ditolak", async () => {
    const { AdminConsoleService } = await import("../../src/modules/admin-console/application/AdminConsoleService.js");
    const service = new AdminConsoleService(prisma);
    const calls: Array<[string, () => Promise<unknown>]> = [
      ["grantFounderPlatinum", () => service.grantFounderPlatinum({} as never)],
      ["grantFounderChairman", () => service.grantFounderChairman({} as never)],
      ["updateFounderPlatinumStatus", () => service.updateFounderPlatinumStatus({} as never)],
      ["updateFounderChairmanStatus", () => service.updateFounderChairmanStatus({} as never)]
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toMatchObject({ code: "FOUNDER_PROGRAM_DISABLED", statusCode: 403 });
    }
    expect(await prisma.founderProgramGrant.count()).toBe(0);
  });

  it("pembacaan untuk audit tetap terbuka bagi SUPER_ADMIN", async () => {
    const superAdmin = await createUser("SUPER_ADMIN");
    expect((await call(superAdmin, "/founder-platinum")).status).toBe(200);
    expect((await call(superAdmin, "/founder-chairman")).status).toBe(200);
  });
});
