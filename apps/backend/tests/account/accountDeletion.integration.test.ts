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

describe.skipIf(!runIntegration)("P1-5 account deletion request ownership", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "account-deletion-test-access-secret-000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "account-deletion-test-refresh-secret-00000";

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

  it("rejects an unauthenticated delete request", async () => {
    const response = await api("/api/v1/account/delete-request", { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("creates a pending request scoped to the authenticated user", async () => {
    const user = await createUser("DELA");

    const response = await api("/api/v1/account/delete-request", {
      method: "POST",
      token: tokenFor(user),
      body: { reason: "sudah tidak dipakai" }
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { userId: string; status: string } };
    expect(body.data.userId).toBe(user.id);
    expect(body.data.status).toBe("PENDING");
  });

  it("is idempotent while a request is still pending", async () => {
    const user = await createUser("DELB");

    const first = await api("/api/v1/account/delete-request", { method: "POST", token: tokenFor(user), body: {} });
    const second = await api("/api/v1/account/delete-request", { method: "POST", token: tokenFor(user), body: {} });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const count = await prisma.accountDeletionRequest.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it("does not expose another user's deletion request", async () => {
    const owner = await createUser("DELC");
    const other = await createUser("DELD");

    await api("/api/v1/account/delete-request", { method: "POST", token: tokenFor(owner), body: {} });

    // User lain tidak melihat request milik owner.
    const otherView = await api("/api/v1/account/delete-request", { method: "GET", token: tokenFor(other) });
    const otherBody = (await otherView.json()) as { data: unknown };
    expect(otherBody.data).toBeNull();

    // Owner hanya melihat request miliknya sendiri.
    const ownerView = await api("/api/v1/account/delete-request", { method: "GET", token: tokenFor(owner) });
    const ownerBody = (await ownerView.json()) as { data: { userId: string } };
    expect(ownerBody.data.userId).toBe(owner.id);
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
