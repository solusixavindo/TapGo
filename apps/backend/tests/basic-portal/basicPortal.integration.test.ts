import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authRepository,
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl,
} from "../helpers/referralWalletHarness.js";

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;

describe.skipIf(!runIntegration)("Basic member portal", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-basic-portal";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-basic-portal";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";
    process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = "false";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
    ]);
    signAccessToken = tokenService.signAccessToken;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("creates new registered users as Basic members", async () => {
    const user = await registerUser("Basic Member", "081222000001");

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { membership: true },
    });

    expect(persisted.membership?.tier).toBe("BASIC");
    expect(await prisma.membershipOrder.count()).toBe(0);
    expect(await prisma.invoice.count()).toBe(0);
    expect(await prisma.membershipPayment.count()).toBe(0);
  });

  it("creates stable non-sequential public member identity idempotently", async () => {
    const user = await registerUser("Identity Member", "081222000002");

    const [first, second] = await Promise.all([
      api("/api/v1/member-identity/me", { token: tokenFor(user) }),
      api("/api/v1/member-identity/me", { token: tokenFor(user) }),
    ]);
    const firstBody = await first.json() as { data: { memberId: string; membershipTier: string } };
    const secondBody = await second.json() as { data: { memberId: string; membershipTier: string } };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody.data.memberId).toBe(secondBody.data.memberId);
    expect(firstBody.data.memberId).toMatch(/^TGM-[A-Z2-9]{10}$/);
    expect(firstBody.data.memberId).not.toMatch(/^[0-9a-f-]{36}$/i);
    expect(firstBody.data.membershipTier).toBe("BASIC");
    expect(await prisma.memberIdentity.count({ where: { userId: user.id } })).toBe(1);
  });

  it("keeps support tickets private to their owner", async () => {
    const owner = await registerUser("Support Owner", "081222000003");
    const other = await registerUser("Support Other", "081222000004");

    const createResponse = await api("/api/v1/support/tickets", {
      method: "POST",
      token: tokenFor(owner),
      body: {
        category: "ACCOUNT",
        subject: "Bantuan akun",
        message: "Saya membutuhkan bantuan akun.",
      },
    });
    const createBody = await createResponse.json() as { data: { id: string; messages: unknown[] } };

    expect(createResponse.status).toBe(201);
    expect(createBody.data.messages).toHaveLength(1);

    const ownerDetail = await api(`/api/v1/support/tickets/${createBody.data.id}`, {
      token: tokenFor(owner),
    });
    const otherDetail = await api(`/api/v1/support/tickets/${createBody.data.id}`, {
      token: tokenFor(other),
    });
    const unauthenticated = await api("/api/v1/support/tickets");

    expect(ownerDetail.status).toBe(200);
    expect(otherDetail.status).toBe(404);
    expect(unauthenticated.status).toBe(401);
  });

  it("allows admin response and status update with immutable message history", async () => {
    const user = await registerUser("Ticket User", "081222000005");
    const admin = await registerUser("Ticket Admin", "081222000006", "ADMIN");

    const created = await api("/api/v1/support/tickets", {
      method: "POST",
      token: tokenFor(user),
      body: {
        category: "TECHNICAL",
        subject: "Kendala aplikasi",
        message: "Saya membutuhkan bantuan teknis.",
      },
    });
    const createdBody = await created.json() as { data: { id: string } };

    const updated = await api(`/api/v1/admin/support/tickets/${createdBody.data.id}`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: {
        status: "IN_PROGRESS",
        message: "Terima kasih, tim TapGo sedang memeriksa.",
      },
    });
    const updatedBody = await updated.json() as {
      data: { status: string; messages: Array<{ authorRole: string }> };
    };

    expect(updated.status).toBe(200);
    expect(updatedBody.data.status).toBe("IN_PROGRESS");
    expect(updatedBody.data.messages).toHaveLength(2);
    expect(updatedBody.data.messages.map((message) => message.authorRole)).toEqual([
      "USER",
      "ADMIN",
    ]);
    expect(await prisma.auditLog.count({ where: { entityType: "SupportTicket" } })).toBe(2);
  });

  it("rejects unsafe support input and non-admin access", async () => {
    const user = await registerUser("Unsafe User", "081222000007");

    const unsafe = await api("/api/v1/support/tickets", {
      method: "POST",
      token: tokenFor(user),
      body: {
        category: "OTHER",
        subject: "Halo <b>",
        message: "Script tidak boleh masuk.",
      },
    });
    const forbiddenAdmin = await api("/api/v1/admin/support/tickets", {
      token: tokenFor(user),
    });

    expect(unsafe.status).toBe(400);
    expect(forbiddenAdmin.status).toBe(403);
  });

  it("rate limits support ticket creation", async () => {
    const user = await registerUser("Rate Limited User", "081222000008");
    const token = tokenFor(user);
    const responses = [];
    for (let index = 0; index < 13; index += 1) {
      responses.push(await api("/api/v1/support/tickets", {
        method: "POST",
        token,
        body: {
          category: "OTHER",
          subject: `Bantuan ${index}`,
          message: "Mohon bantuan dari tim TapGo.",
        },
      }));
    }

    expect(responses.some((response) => response.status === 429)).toBe(true);
  });
});

async function registerUser(
  fullName: string,
  phone: string,
  role: UserRole = "USER",
): Promise<User> {
  return authRepository.createUser({
    fullName,
    phone,
    passwordHash: "hashed-password",
    role,
    referralCode: `QA${phone.slice(-8)}`,
  });
}

async function api(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH";
    token?: string;
    body?: Record<string, unknown>;
  } = {},
) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`,
  });
}
