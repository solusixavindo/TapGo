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
 * Akun admin/super admin tidak boleh memakai aplikasi mobile (APK lama maupun
 * baru). Konsol web tidak mengirim X-TapGo-Platform dan tidak terpengaruh.
 */
type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

describe.skipIf(!runIntegration)("Akun admin di klien mobile", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "admin-mobile-block-access-secret-00";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "admin-mobile-block-refresh-secret-0";
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
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  const call = (user: User, headers: Record<string, string>) =>
    fetch(`${baseUrl}/api/v1/wallet`, {
      headers: {
        authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, sessionId: `s-${user.id}` })}`,
        ...headers
      }
    });

  for (const role of ["ADMIN", "SUPER_ADMIN", "SUPER_ADMIN_VIP"] as const) {
    it(`${role} ditolak 403 ADMIN_WEB_ONLY dari android/ios, tetapi tidak dari konsol web`, async () => {
      const admin = await createUser(role);
      for (const platform of ["android", "ios", " Android "]) {
        const response = await call(admin, { "x-tapgo-platform": platform });
        expect(response.status, `${role}/${platform}`).toBe(403);
        expect(((await response.json()) as { code?: string }).code).toBe("ADMIN_WEB_ONLY");
      }
      const web = await call(admin, {});
      expect(web.status).not.toBe(403);
    });
  }

  it("USER biasa tetap dapat memakai klien mobile", async () => {
    const user = await createUser("USER");
    const response = await call(user, { "x-tapgo-platform": "android", "x-tapgo-distribution": "play" });
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(401);
  });
});

async function createUser(role: UserRole): Promise<User> {
  sequence += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${sequence}`,
      phone: `+628${String(700000000 + sequence)}`,
      referralCode: `AMB${String(sequence).padStart(6, "0")}`,
      role,
      membershipId: basic.id
    }
  });
}
