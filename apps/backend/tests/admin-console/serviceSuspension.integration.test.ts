import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isSuspensionExempt } from "../../src/core/http/serviceSuspensionGate.js";

/**
 * Saklar penghentian layanan (SERVICE_SUSPENDED): dapat dibalik, tidak
 * menyentuh data, dan tidak mengunci pemilik dari konsol admin.
 */
async function startApp(suspended: boolean) {
  process.env.NODE_ENV = "test";
  if (suspended) process.env.SERVICE_SUSPENDED = "true";
  else delete process.env.SERVICE_SUSPENDED;
  const { vi } = await import("vitest");
  vi.resetModules();
  const { createApp } = await import("../../src/app.js");
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function stop(server: Server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("isSuspensionExempt", () => {
  it("membuka admin, webhook penyedia, dan jalur akun", () => {
    for (const path of ["/admin", "/admin/overview", "/webhooks/ppob", "/payments/midtrans/notification", "/account/delete-request"]) {
      expect(isSuspensionExempt(path), path).toBe(true);
    }
  });

  it("membuka /auth hanya untuk klien non-HP", () => {
    expect(isSuspensionExempt("/auth/login", false)).toBe(true);
    expect(isSuspensionExempt("/auth/login", true)).toBe(false);
  });

  it("menutup semua jalur layanan lain", () => {
    for (const path of ["/rides/quotes", "/driver/rides/offers", "/ppob/checkout", "/wallet/transfer", "/payments/other", "/adminx"]) {
      expect(isSuspensionExempt(path), path).toBe(false);
    }
  });
});

describe("Layanan dihentikan (SERVICE_SUSPENDED=true)", () => {
  let server: Server;
  let baseUrl = "";
  beforeAll(async () => ({ server, baseUrl } = await startApp(true)));
  afterAll(async () => {
    delete process.env.SERVICE_SUSPENDED;
    await stop(server);
  });

  it("aplikasi HP mendapat 503 SERVICE_SUSPENDED dengan pesan jelas", async () => {
    for (const headers of [
      { "x-tapgo-app": "driver", "x-tapgo-platform": "android" },
      { "x-tapgo-platform": "android", "x-tapgo-distribution": "play" }
    ]) {
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ phone: "081200000000", password: "x" })
      });
      expect(response.status).toBe(503);
      const body = (await response.json()) as { code?: string; message?: string };
      expect(body.code).toBe("SERVICE_SUSPENDED");
      expect(body.message).toContain("dihentikan");
    }
  });

  it("jalur layanan ditolak 503 untuk semua klien", async () => {
    const response = await fetch(`${baseUrl}/api/v1/rides/quotes`, { method: "POST" });
    expect(response.status).toBe(503);
  });

  it("health tetap hidup", async () => {
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/v1/health`)).status).toBe(200);
  });

  it("login klien web (konsol admin) tidak diblokir gerbang suspend", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "081200000000", password: "x" })
    });
    expect(response.status).not.toBe(503);
  });
});

describe("Layanan normal (saklar mati)", () => {
  let server: Server;
  let baseUrl = "";
  beforeAll(async () => ({ server, baseUrl } = await startApp(false)));
  afterAll(async () => stop(server));

  it("tidak mengubah perilaku apa pun", async () => {
    const response = await fetch(`${baseUrl}/api/v1/rides/quotes`, {
      method: "POST",
      headers: { "x-tapgo-platform": "android" }
    });
    expect(response.status).not.toBe(503);
  });
});
