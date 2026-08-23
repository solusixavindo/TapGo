import { User, UserRole } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
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
 * Penegakan klaim kanal token (R2.9 / K1c + K2a + K3a).
 *
 * Kontrak yang dijaga:
 * - `/api/v1/auth/login` menerbitkan token ber-klaim "APP"; `/api/v1/web/auth/login`
 *   menerbitkan token ber-klaim "WEB".
 * - Rute `/api/v1/web/membership/*` menolak token ber-klaim "APP" dengan 403, dan
 *   sebaliknya `/api/v1/membership/*` menolak token ber-klaim "WEB".
 * - Token TANPA klaim kanal (diterbitkan sebelum R2.9) masih diterima di kedua
 *   kanal selama masa transisi (K2a), agar pengguna yang sedang login tidak
 *   terputus. Seluruh token baru ber-klaim kanal.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
  channel?: "WEB" | "APP" | "ADMIN";
}) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let restoreFlags: () => void = () => {};

describe.skipIf(!runIntegration)("Channel claim enforcement (R2.9)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-channel-enforcement";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-channel-enforcement";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    signAccessToken = tokenService.signAccessToken as SignAccessToken;
    backendEnv = envModule.env;

    const before = {
      master: backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED,
      web: backendEnv.MEMBERSHIP_PURCHASE_WEB_ENABLED,
      app: backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED
    };
    restoreFlags = () => {
      backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = before.master;
      backendEnv.MEMBERSHIP_PURCHASE_WEB_ENABLED = before.web;
      backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED = before.app;
    };

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    // Kedua kanal dibuka agar yang diuji murni penegakan kanal token, bukan
    // flag pembelian.
    backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = true;
    backendEnv.MEMBERSHIP_PURCHASE_WEB_ENABLED = true;
    backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED = true;
  });

  afterAll(async () => {
    restoreFlags();
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  function tokenFor(user: User, channel?: "WEB" | "APP") {
    return signAccessToken({
      sub: user.id,
      role: user.role,
      sessionId: `session-${user.id}`,
      ...(channel !== undefined ? { channel } : {})
    });
  }

  async function call(path: string, token: string) {
    return fetch(`${baseUrl}/api/v1${path}`, {
      headers: { authorization: `Bearer ${token}` }
    });
  }

  // User dengan password NYATA agar dapat login lewat endpoint (bukan sekadar
  // token tempel). Harness createUser memakai passwordHash placeholder yang
  // tidak akan lolos verifikasi.
  const LOGIN_PASSWORD = "password123";
  async function createLoginUser(referralCode: string): Promise<User> {
    const { hashPassword } = await import("../../src/core/security/passwordHasher.js");
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    return prisma.user.create({
      data: {
        fullName: `User ${referralCode}`,
        phone: `+628${referralCode.replace(/\D/g, "").padStart(9, "0").slice(-9)}`,
        passwordHash: await hashPassword(LOGIN_PASSWORD),
        status: "ACTIVE",
        role: "USER",
        referralCode,
        membershipId: basic.id
      }
    });
  }

  async function loginChannel(path: string, user: User) {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: user.phone, password: LOGIN_PASSWORD })
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { accessToken: string } };
    const payloadSegment = body.data.accessToken.split(".")[1];
    expect(typeof payloadSegment).toBe("string");
    return JSON.parse(
      Buffer.from(payloadSegment!, "base64url").toString()
    ) as { channel?: string };
  }

  it("login kanal app menerbitkan token ber-klaim APP", async () => {
    const user = await createLoginUser("CHAPP001");
    const decoded = await loginChannel("/auth/login", user);
    expect(decoded.channel).toBe("APP");
  });

  it("login kanal web menerbitkan token ber-klaim WEB", async () => {
    const user = await createLoginUser("CHWEB001");
    const decoded = await loginChannel("/web/auth/login", user);
    expect(decoded.channel).toBe("WEB");
  });

  it("web tidak mengekspos register", async () => {
    const response = await fetch(`${baseUrl}/api/v1/web/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: "X", phone: "+628000000000", password: "password123" })
    });
    // Router web tidak memasang /register — 404, bukan 201.
    expect(response.status).toBe(404);
  });

  it("token APP ditolak dari rute web membership dengan 403", async () => {
    const user = await createLoginUser("CH-X1");
    const response = await call("/web/membership/me", tokenFor(user, "APP"));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("AUTH_CHANNEL_FORBIDDEN");
  });

  it("token WEB ditolak dari rute app membership dengan 403", async () => {
    const user = await createLoginUser("CH-X2");
    const response = await call("/membership/me", tokenFor(user, "WEB"));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("AUTH_CHANNEL_FORBIDDEN");
  });

  it("token WEB diterima di rute web membership", async () => {
    const user = await createLoginUser("CH-OK1");
    const response = await call("/web/membership/me", tokenFor(user, "WEB"));
    expect(response.status).toBe(200);
  });

  it("token APP diterima di rute app membership", async () => {
    const user = await createLoginUser("CH-OK2");
    const response = await call("/membership/me", tokenFor(user, "APP"));
    expect(response.status).toBe(200);
  });

  it("token TANPA klaim kanal masih diterima di kedua kanal (K2a)", async () => {
    const user = await createLoginUser("CH-LEGACY");
    const web = await call("/web/membership/me", tokenFor(user));
    const app = await call("/membership/me", tokenFor(user));
    expect(web.status).toBe(200);
    expect(app.status).toBe(200);
  });
});
