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

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let hashPassword: (password: string) => Promise<string>;

const TEST_PASSWORD = "correct-horse-battery";

describe.skipIf(!runIntegration)("Account Profile API", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-account-api";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-account-api";

    const [{ createApp }, tokenService, passwordHasher] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/core/security/passwordHasher.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    hashPassword = passwordHasher.hashPassword;

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

  it("updates the phone number when the current password is correct", async () => {
    const user = await createUser("ACCPHN001");

    const response = await api("/api/v1/account/phone", {
      method: "PUT",
      token: tokenFor(user),
      body: { phone: "+6281200000099", currentPassword: TEST_PASSWORD }
    });

    expect(response.status).toBe(200);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // normalizePhoneNumber menyimpan format lokal "0..." bukan "+62...".
    expect(updated.phone).toBe("081200000099");
    // Nomor baru belum terbukti — status verifikasi diturunkan.
    expect(updated.phoneVerifiedAt).toBeNull();
  });

  it("rejects a phone update with the wrong current password", async () => {
    const user = await createUser("ACCPHN002");

    const response = await api("/api/v1/account/phone", {
      method: "PUT",
      token: tokenFor(user),
      body: { phone: "+6281200000098", currentPassword: "wrong-password" }
    });

    expect(response.status).toBe(401);
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unchanged.phone).toBe(user.phone);
  });

  it("rejects a phone number already used by another account", async () => {
    const user = await createUser("ACCPHN003");
    const other = await createUser("ACCPHN004");

    const response = await api("/api/v1/account/phone", {
      method: "PUT",
      token: tokenFor(user),
      body: { phone: other.phone, currentPassword: TEST_PASSWORD }
    });

    expect(response.status).toBe(409);
  });

  it("foto profil satu akun dibagi antara web dan aplikasi (kanal WEB <-> APP)", async () => {
    const user = await createUser("ACCAVT002");
    const withChannel = (channel: "WEB" | "APP") =>
      (signAccessToken as unknown as (p: { sub: string; role: UserRole; sessionId: string; channel: "WEB" | "APP" }) => string)({
        sub: user.id,
        role: user.role,
        sessionId: `session-${channel}-${user.id}`,
        channel
      });

    // Diunggah dari web (dashboard mitra / formulir pendaftaran) ...
    const fromWeb = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x0b, 0x0c]);
    const upload = await api("/api/v1/account/avatar", {
      method: "POST",
      token: withChannel("WEB"),
      rawBody: fromWeb,
      contentType: "image/png"
    });
    expect(upload.status).toBe(201);

    // ... langsung terbaca oleh aplikasi.
    const appView = await api("/api/v1/account/avatar", { token: withChannel("APP") });
    expect(appView.status).toBe(200);
    expect(Buffer.from(await appView.arrayBuffer()).equals(fromWeb)).toBe(true);

    // Diganti dari aplikasi -> web melihat yang terbaru.
    const fromApp = Buffer.from([0xff, 0xd8, 0xff, 0x11, 0x12]);
    const replace = await api("/api/v1/account/avatar", {
      method: "POST",
      token: withChannel("APP"),
      rawBody: fromApp,
      contentType: "image/jpeg"
    });
    expect(replace.status).toBe(201);
    const webView = await api("/api/v1/account/avatar", { token: withChannel("WEB") });
    expect(webView.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await webView.arrayBuffer()).equals(fromApp)).toBe(true);
    expect(await prisma.userAvatar.count({ where: { userId: user.id } })).toBe(1);
  });

  it("uploads, serves, and replaces a profile avatar", async () => {
    const user = await createUser("ACCAVT001");
    const firstImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);

    const upload = await api("/api/v1/account/avatar", {
      method: "POST",
      token: tokenFor(user),
      rawBody: firstImage,
      contentType: "image/png"
    });
    expect(upload.status).toBe(201);

    const fetched = await api("/api/v1/account/avatar", { token: tokenFor(user) });
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toBe("image/png");
    const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
    expect(fetchedBytes.equals(firstImage)).toBe(true);

    const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(me.avatarUrl).toBe("/account/avatar");

    // Unggah kedua menggantikan, bukan menumpuk baris baru.
    const secondImage = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]);
    const reupload = await api("/api/v1/account/avatar", {
      method: "POST",
      token: tokenFor(user),
      rawBody: secondImage,
      contentType: "image/jpeg"
    });
    expect(reupload.status).toBe(201);
    const refetched = await api("/api/v1/account/avatar", { token: tokenFor(user) });
    const refetchedBytes = Buffer.from(await refetched.arrayBuffer());
    expect(refetchedBytes.equals(secondImage)).toBe(true);
    expect(await prisma.userAvatar.count()).toBe(1);
  });

  it("rejects an avatar upload with an unsupported content type", async () => {
    const user = await createUser("ACCAVT002");

    const response = await api("/api/v1/account/avatar", {
      method: "POST",
      token: tokenFor(user),
      rawBody: Buffer.from("not-an-image"),
      contentType: "text/plain"
    });

    expect(response.status).toBe(415);
  });

  it("returns 404 for an account with no avatar uploaded yet", async () => {
    const user = await createUser("ACCAVT003");

    const response = await api("/api/v1/account/avatar", { token: tokenFor(user) });
    expect(response.status).toBe(404);
  });
});

let phoneCounter = 0;

async function createUser(referralCode: string): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  phoneCounter += 1;
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `0812${String(phoneCounter).padStart(8, "0")}`,
      referralCode,
      role: "USER",
      membershipId: basic.id,
      passwordHash: await hashPassword(TEST_PASSWORD)
    }
  });
}

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`
  });
}

async function api(path: string, options: {
  method?: string;
  token?: string;
  body?: unknown;
  rawBody?: Buffer;
  contentType?: string;
} = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.rawBody ? { "content-type": options.contentType ?? "application/octet-stream" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    ...(options.rawBody ? { body: options.rawBody } : {})
  });
}
