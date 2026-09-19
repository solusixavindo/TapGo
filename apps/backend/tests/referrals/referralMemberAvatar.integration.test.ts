import { User } from "@prisma/client";
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
 * Foto anggota referral. Foto profil bersifat pribadi, jadi satu-satunya
 * orang selain pemiliknya yang boleh melihat adalah atasannya di pohon
 * referral — bukan sesama anggota, bukan bawahan, bukan pengguna lain.
 */

type SignAccessToken = (payload: {
  sub: string;
  role: User["role"];
  sessionId: string;
  channel?: "WEB" | "APP" | "ADMIN";
}) => string;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64"
);

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let seq = 0;

describe.skipIf(!runIntegration)("Referral member avatar", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-referral-avatar";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-referral-avatar";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken as SignAccessToken;
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

  it("atasan melihat foto bawahan, dan pohon menandai siapa yang punya foto", async () => {
    const upline = await createUser();
    const withPhoto = await createUser({ avatar: true });
    const withoutPhoto = await createUser();
    await link(upline, withPhoto, 1);
    await link(upline, withoutPhoto, 2);

    const photo = await get(upline, `/api/v1/referrals/members/${withPhoto.id}/avatar`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/png");
    expect(photo.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await photo.arrayBuffer()).equals(PNG)).toBe(true);

    const tree = await get(upline, "/api/v1/referrals/tree?maxLevel=10");
    const nodes = ((await tree.json()) as { data: Array<{ userId: string; hasAvatar: boolean }> }).data;
    expect(nodes.find((node) => node.userId === withPhoto.id)?.hasAvatar).toBe(true);
    expect(nodes.find((node) => node.userId === withoutPhoto.id)?.hasAvatar).toBe(false);
  });

  it("menolak orang yang bukan atasan: sesama, bawahan, dan pengguna lain", async () => {
    const upline = await createUser();
    const member = await createUser({ avatar: true });
    const peer = await createUser({ avatar: true });
    const stranger = await createUser();
    await link(upline, member, 1);
    await link(upline, peer, 1);

    for (const requester of [stranger, peer, member]) {
      const response = await get(requester, `/api/v1/referrals/members/${member.id}/avatar`);
      // Pemilik foto sendiri pun tidak lewat rute ini (ada /account/avatar).
      expect(response.status).toBe(404);
    }
    const bawahanMelihatAtasan = await get(member, `/api/v1/referrals/members/${upline.id}/avatar`);
    expect(bawahanMelihatAtasan.status).toBe(404);
  });

  it("jawaban sama untuk anggota tanpa foto dan bukan anggota (tidak bocor)", async () => {
    const upline = await createUser();
    const noPhoto = await createUser();
    const stranger = await createUser({ avatar: true });
    await link(upline, noPhoto, 1);

    const a = await get(upline, `/api/v1/referrals/members/${noPhoto.id}/avatar`);
    const b = await get(upline, `/api/v1/referrals/members/${stranger.id}/avatar`);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(((await a.json()) as { code?: string }).code).toBe(
      ((await b.json()) as { code?: string }).code
    );
  });

  it("menolak id yang bukan UUID", async () => {
    const upline = await createUser();
    const response = await get(upline, "/api/v1/referrals/members/bukan-uuid/avatar");
    expect(response.status).toBe(400);
  });
});

function get(user: User, path: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${signAccessToken({
        sub: user.id,
        role: user.role,
        sessionId: `session-${user.id}`,
        channel: "WEB"
      })}`
    }
  });
}

async function link(ancestor: User, descendant: User, level: number) {
  await prisma.referralLevel.create({
    data: { ancestorId: ancestor.id, descendantId: descendant.id, level }
  });
}

async function createUser(options: { avatar?: boolean } = {}): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  seq += 1;
  const user = await prisma.user.create({
    data: {
      fullName: `Anggota ${seq}`,
      phone: `+6286${String(seq).padStart(9, "0")}`,
      referralCode: `RAV${String(seq).padStart(5, "0")}`,
      role: "USER",
      membershipId: basic.id,
      ...(options.avatar ? { avatarUrl: "/account/avatar" } : {})
    }
  });
  if (options.avatar) {
    await prisma.userAvatar.create({
      data: { userId: user.id, bytes: PNG, contentType: "image/png", checksum: `sum-${seq}` }
    });
  }
  return user;
}
