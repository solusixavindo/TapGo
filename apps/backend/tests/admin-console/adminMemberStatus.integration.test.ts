import { Prisma, User, UserRole } from "@prisma/client";
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

/** Menonaktifkan / mengaktifkan akun member: hanya SUPER_ADMIN_VIP. */

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let seq = 0;

describe.skipIf(!runIntegration)("Admin member account status", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-admin-member-status";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-admin-member-status";

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

  it("hanya SUPER_ADMIN_VIP yang dapat mengubah status akun member", async () => {
    const member = await createUser("USER");
    for (const role of ["ADMIN", "SUPER_ADMIN"] as const) {
      const actor = await createUser(role);
      const res = await call(actor, `/api/v1/admin/members/${member.id}/status`, "PUT", { status: "SUSPENDED", reason: "uji" });
      expect(res.status, role).toBe(403);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).status).toBe("ACTIVE");
  });

  it("VIP menonaktifkan: status, token lama gugur, sesi dicabut, audit tercatat; lalu aktifkan kembali", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const member = await createUser("USER");
    const session = await prisma.session.create({
      data: { userId: member.id, refreshTokenHash: "h", expiresAt: new Date(Date.now() + 86_400_000) }
    });

    const off = await call(vip, `/api/v1/admin/members/${member.id}/status`, "PUT", { status: "SUSPENDED", reason: "Penipuan referral" });
    expect(off.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(after.status).toBe("SUSPENDED");
    expect(after.authVersion).toBe(member.authVersion + 1);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "MEMBER_ACCOUNT_SUSPENDED", entityId: member.id, actorId: vip.id } })).toBe(1);

    // Token lama member tidak lagi berlaku.
    expect((await call(member, "/api/v1/wallet")).status).toBeGreaterThanOrEqual(401);

    const again = await call(vip, `/api/v1/admin/members/${member.id}/status`, "PUT", { status: "SUSPENDED", reason: "ulang" });
    expect(((await again.json()) as { data: { changed: boolean } }).data.changed).toBe(false);

    const on = await call(vip, `/api/v1/admin/members/${member.id}/status`, "PUT", { status: "ACTIVE", reason: "Sudah diklarifikasi" });
    expect(on.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).status).toBe("ACTIVE");
    expect(await prisma.auditLog.count({ where: { action: "MEMBER_ACCOUNT_REACTIVATED", entityId: member.id } })).toBe(1);
  });

  it("menolak: alasan kosong, diri sendiri, dan akun admin", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const member = await createUser("USER");
    const admin = await createUser("ADMIN");

    expect((await call(vip, `/api/v1/admin/members/${member.id}/status`, "PUT", { status: "SUSPENDED", reason: " " })).status).toBe(400);
    expect((await call(vip, `/api/v1/admin/members/${vip.id}/status`, "PUT", { status: "SUSPENDED", reason: "uji" })).status).toBe(409);
    expect((await call(vip, `/api/v1/admin/members/${admin.id}/status`, "PUT", { status: "SUSPENDED", reason: "uji" })).status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).status).toBe("ACTIVE");
  });
});

async function createUser(role: UserRole, overrides: { phone?: string } = {}): Promise<User> {
  seq += 1;
  return prisma.user.create({
    data: {
      fullName: `Peran ${role} ${seq}`,
      phone: overrides.phone ?? `+6281${String(seq).padStart(9, "0")}`,
      referralCode: `ROL${String(seq).padStart(6, "0")}`,
      role
    }
  });
}

function call(user: User, path: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` })}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}
