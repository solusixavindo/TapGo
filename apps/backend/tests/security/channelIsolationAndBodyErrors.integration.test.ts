import { UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { apiRateLimiter } from "../../src/core/security/rateLimit.js";

/**
 * (1) Token kanal WEB (peramban, sessionStorage) tidak boleh menjalankan fitur yang memindahkan uang di aplikasi:
 *     transfer P2P, penarikan/rekening lewat jalur aplikasi, PPOB, perjalanan. Token APP dan token lama tanpa klaim kanal tetap diterima.
 * (2) Badan permintaan rusak/terlalu besar dijawab 400/413 (bukan 500 yang memenuhi Sentry).
 */
type Sign = (payload: { sub: string; role: UserRole; sessionId: string; authVersion?: number; channel?: "APP" | "WEB" }) => string;
let server: Server | undefined;
let baseUrl = "";
let sign: Sign;
let sequence = 0;

describe.skipIf(!runIntegration)("isolasi kanal token + galat badan permintaan", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "channel-isolation-access-secret-0000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "channel-isolation-refresh-secret-000000";
    const [{ createApp }, tokens] = await Promise.all([import("../../src/app.js"), import("../../src/core/security/tokenService.js")]);
    sign = tokens.signAccessToken as Sign;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(() => {
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) apiRateLimiter.resetKey(key);
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => (server ? server.close((e) => (e ? reject(e) : resolve())) : resolve()));
  });

  async function user() {
    sequence += 1;
    return prisma.user.create({
      data: { fullName: `Kanal ${sequence}`, phone: `+6282${String(sequence).padStart(9, "0")}`, referralCode: `CHN${String(sequence).padStart(6, "0")}` }
    });
  }
  const tokenOf = (u: { id: string }, channel?: "APP" | "WEB") => sign({ sub: u.id, role: "USER", sessionId: `s-${u.id}`, ...(channel ? { channel } : {}) });
  const call = (path: string, token: string, method = "POST", body: unknown = {}) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) })
    });

  const MONEY_ROUTES: Array<[string, string]> = [
    ["POST", "/api/v1/wallet/transfer"],
    ["POST", "/api/v1/wallet/withdrawals"],
    ["POST", "/api/v1/wallet/withdraw"],
    ["PUT", "/api/v1/wallet/bank-account"],
    ["POST", "/api/v1/ppob/orders"],
    ["POST", "/api/v1/ppob/bills/pay"],
    ["POST", "/api/v1/rides/quotes"],
    ["POST", "/api/v1/rides"],
  ];

  it("token WEB ditolak 403 AUTH_CHANNEL_FORBIDDEN di rute pemindah uang aplikasi", async () => {
    const u = await user();
    for (const [method, path] of MONEY_ROUTES) {
      const res = await call(path, tokenOf(u, "WEB"), method);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe("AUTH_CHANNEL_FORBIDDEN");
    }
  });

  it("token APP dan token lama tanpa klaim kanal lolos pemeriksaan kanal (ditolak validasi, bukan kanal)", async () => {
    const u = await user();
    for (const channel of ["APP", undefined] as const) {
      for (const [method, path] of MONEY_ROUTES) {
        const res = await call(path, tokenOf(u, channel), method);
        expect(res.status, `${channel ?? "tanpa-kanal"} ${method} ${path}`).not.toBe(403);
        const body = (await res.json()) as { code?: string };
        expect(body.code).not.toBe("AUTH_CHANNEL_FORBIDDEN");
      }
    }
  });

  it("rute web yang sah tetap menerima token WEB", async () => {
    const u = await user();
    expect((await call("/api/v1/web/wallet/topup/options", tokenOf(u, "WEB"), "GET")).status).toBe(200);
    expect((await call("/api/v1/referrals/summary", tokenOf(u, "WEB"), "GET")).status).not.toBe(403);
  });

  it("JSON rusak dijawab 400, bukan 500", async () => {
    const res = await fetch(`${baseUrl}/api/v1/web/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"phone": ' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; code: string; message: string };
    expect(body).toMatchObject({ success: false, code: "BAD_REQUEST" });
    expect(JSON.stringify(body)).not.toMatch(/Unexpected|SyntaxError|JSON at position/);
  });

  it("badan terlalu besar dijawab 413, bukan 500", async () => {
    const res = await fetch(`${baseUrl}/api/v1/web/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "a".repeat(2_000_000) })
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe("PAYLOAD_TOO_LARGE");
  });
});
