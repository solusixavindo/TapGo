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

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let appServer: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;

describe.skipIf(!runIntegration)("Push token registration", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "push-token-test-access-secret-000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "push-token-test-refresh-secret-00000";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;

    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!appServer) {
        resolve();
        return;
      }
      appServer.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const T1 = "fcm-token-device-one-" + "a".repeat(30);
  const T2 = "fcm-token-device-two-" + "b".repeat(30);

  it("menolak permintaan tanpa login", async () => {
    const response = await api("/api/v1/notifications/push-token", {
      method: "POST",
      body: { token: T1, platform: "android" }
    });
    expect(response.status).toBe(401);
  });

  it("menolak token pendek dan platform tak dikenal", async () => {
    const user = await createUser("PSHA");
    const short = await api("/api/v1/notifications/push-token", {
      method: "POST", token: tokenFor(user), body: { token: "pendek", platform: "android" }
    });
    const badPlatform = await api("/api/v1/notifications/push-token", {
      method: "POST", token: tokenFor(user), body: { token: T1, platform: "windows" }
    });
    expect(short.status).toBe(400);
    expect(badPlatform.status).toBe(400);
  });

  it("mendaftarkan token untuk akun yang login dan idempoten", async () => {
    const user = await createUser("PSHB");
    for (let i = 0; i < 2; i += 1) {
      const response = await api("/api/v1/notifications/push-token", {
        method: "POST", token: tokenFor(user), body: { token: T1, platform: "android", deviceId: "hp-1" }
      });
      expect(response.status).toBe(204);
    }
    const rows = await prisma.pushToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deviceId).toBe("hp-1");
  });

  it("memindahkan token ke akun yang baru login di perangkat yang sama", async () => {
    const first = await createUser("PSHC");
    const second = await createUser("PSHD");
    await api("/api/v1/notifications/push-token", {
      method: "POST", token: tokenFor(first), body: { token: T1, platform: "android" }
    });
    await api("/api/v1/notifications/push-token", {
      method: "POST", token: tokenFor(second), body: { token: T1, platform: "android" }
    });
    expect(await prisma.pushToken.count({ where: { userId: first.id } })).toBe(0);
    expect(await prisma.pushToken.count({ where: { userId: second.id } })).toBe(1);
  });

  it("hapus hanya menghapus token milik sendiri", async () => {
    const owner = await createUser("PSHE");
    const other = await createUser("PSHF");
    await api("/api/v1/notifications/push-token", {
      method: "POST", token: tokenFor(owner), body: { token: T1, platform: "android" }
    });
    await api("/api/v1/notifications/push-token", {
      method: "POST", token: tokenFor(other), body: { token: T2, platform: "android" }
    });
    const foreign = await api("/api/v1/notifications/push-token", {
      method: "DELETE", token: tokenFor(other), body: { token: T1 }
    });
    expect(foreign.status).toBe(204);
    expect(await prisma.pushToken.count({ where: { userId: owner.id } })).toBe(1);
    const own = await api("/api/v1/notifications/push-token", {
      method: "DELETE", token: tokenFor(owner), body: { token: T1 }
    });
    expect(own.status).toBe(204);
    expect(await prisma.pushToken.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("membatasi 10 perangkat per akun dan membuang yang terlama", async () => {
    const user = await createUser("PSHG");
    for (let i = 0; i < 12; i += 1) {
      await api("/api/v1/notifications/push-token", {
        method: "POST", token: tokenFor(user),
        body: { token: `fcm-token-many-${String(i).padStart(2, "0")}-` + "c".repeat(30), platform: "android" }
      });
    }
    expect(await prisma.pushToken.count({ where: { userId: user.id } })).toBe(10);
  });
});

async function api(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
}

async function createUser(referralCode: string, role: UserRole = "USER"): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.padStart(9, "0")}`,
      referralCode,
      role,
      membershipId: basic.id
    }
  });
}

function tokenFor(user: User) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` });
}
