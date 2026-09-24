import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Rute /api/v1/admin/* hanya untuk konsol web. Build lama aplikasi user yang
 * masih beredar (mis. Android v1.0.3+4) memanggil /admin/members; server
 * menolaknya berdasarkan header X-TapGo-Platform yang dikirim klien mobile.
 */

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

describe.skipIf(!runIntegration)("Admin console — hanya untuk web", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-admin-web-only";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-admin-web-only";

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
        fullName: `Admin Web ${sequence}`,
        phone: `+628${String(900000000 + sequence)}`,
        referralCode: `WEB${String(sequence).padStart(6, "0")}`,
        role,
        membershipId: basic.id
      }
    });
  }

  function call(actor: User, path: string, platform?: string) {
    return fetch(`${baseUrl}/api/v1/admin${path}`, {
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: actor.id, role: actor.role, sessionId: `sess-${actor.id}` })}`,
        ...(platform === undefined ? {} : { "x-tapgo-platform": platform })
      }
    });
  }

  it("menolak klien mobile (android/ios, tanpa peduli huruf besar-kecil) bahkan untuk SUPER_ADMIN_VIP", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    for (const platform of ["android", "ios", "Android", " IOS "]) {
      const response = await call(vip, "/members", platform);
      expect(response.status, platform).toBe(403);
      expect(((await response.json()) as { code?: string }).code, platform).toBe("ADMIN_WEB_ONLY");
    }
  });

  it("berlaku untuk router admin yang dipasang terpisah (rides, support), bukan hanya admin console", async () => {
    const superAdmin = await createUser("SUPER_ADMIN");
    for (const path of ["/rides", "/support/tickets"]) {
      const response = await call(superAdmin, path, "android");
      expect(response.status, path).toBe(403);
      expect(((await response.json()) as { code?: string }).code, path).toBe("ADMIN_WEB_ONLY");
    }
  });

  it("konsol web tetap berfungsi: tanpa header platform, atau platform selain mobile", async () => {
    const superAdmin = await createUser("SUPER_ADMIN");
    expect((await call(superAdmin, "/members")).status).toBe(200);
    expect((await call(superAdmin, "/members", "web")).status).toBe(200);
  });
});
