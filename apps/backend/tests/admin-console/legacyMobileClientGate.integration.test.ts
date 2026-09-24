import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Build user_app sebelum 2026-09-19 tidak mengirim X-TapGo-Distribution.
 * Gerbang ini tidak butuh database: ditolak sebelum router mana pun.
 */
async function startApp(flag: "true" | undefined) {
  process.env.NODE_ENV = "test";
  if (flag) process.env.MOBILE_LEGACY_CLIENT_BLOCK_ENABLED = flag;
  else delete process.env.MOBILE_LEGACY_CLIENT_BLOCK_ENABLED;
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

describe("Gerbang klien mobile lama — aktif", () => {
  let server: Server;
  let baseUrl = "";
  beforeAll(async () => ({ server, baseUrl } = await startApp("true")));
  afterAll(async () => {
    delete process.env.MOBILE_LEGACY_CLIENT_BLOCK_ENABLED;
    await stop(server);
  });

  const get = (headers: Record<string, string>) => fetch(`${baseUrl}/api/v1/membership/current`, { headers });

  it("menolak android/ios tanpa X-TapGo-Distribution dengan 426 APP_UPDATE_REQUIRED", async () => {
    for (const platform of ["android", "ios", " Android "]) {
      const response = await get({ "x-tapgo-platform": platform, "x-tapgo-app-version": "1.0.3+4" });
      expect(response.status, platform).toBe(426);
      expect(((await response.json()) as { code?: string }).code, platform).toBe("APP_UPDATE_REQUIRED");
    }
  });

  it("melewatkan build baru (ada X-TapGo-Distribution)", async () => {
    for (const distribution of ["play", "direct"]) {
      const response = await get({ "x-tapgo-platform": "android", "x-tapgo-distribution": distribution });
      expect(response.status, distribution).not.toBe(426);
    }
  });

  it("tidak menyentuh web, driver_app (tanpa header platform), dan health", async () => {
    expect((await get({})).status).not.toBe(426);
    expect((await get({ "x-tapgo-platform": "web" })).status).not.toBe(426);
    const health = await fetch(`${baseUrl}/health`, { headers: { "x-tapgo-platform": "android" } });
    expect(health.status).toBe(200);
    const apiHealth = await fetch(`${baseUrl}/api/v1/health`, { headers: { "x-tapgo-platform": "android" } });
    expect(apiHealth.status).toBe(200);
  });
});

describe("Gerbang klien mobile lama — default mati", () => {
  let server: Server;
  let baseUrl = "";
  beforeAll(async () => ({ server, baseUrl } = await startApp(undefined)));
  afterAll(async () => stop(server));

  it("tidak menolak build lama saat saklar tidak dinyalakan", async () => {
    const response = await fetch(`${baseUrl}/api/v1/membership/current`, {
      headers: { "x-tapgo-platform": "android" }
    });
    expect(response.status).not.toBe(426);
  });
});
