import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * E4 (DRIVER_APP_READINESS_PLAN.md): driver_app mulai mengirim
 * `X-TapGo-App: driver` di build 1.0.0+4. Gerbang ini HARUS pakai env sendiri
 * (DRIVER_MIN_APP_BUILD) — bukan MOBILE_MIN_APP_BUILD milik user_app — karena
 * kedua app bisa mengirim `x-tapgo-platform: android` yang sama persis.
 */
async function startApp(flag: "true" | undefined, minBuild?: string) {
  if (minBuild) process.env.DRIVER_MIN_APP_BUILD = minBuild;
  else delete process.env.DRIVER_MIN_APP_BUILD;
  process.env.NODE_ENV = "test";
  if (flag) process.env.DRIVER_LEGACY_CLIENT_BLOCK_ENABLED = flag;
  else delete process.env.DRIVER_LEGACY_CLIENT_BLOCK_ENABLED;
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

describe("Gerbang versi minimum driver_app — aktif dengan batas", () => {
  let server: Server;
  let baseUrl = "";
  beforeAll(async () => ({ server, baseUrl } = await startApp("true", "4")));
  afterAll(async () => {
    delete process.env.DRIVER_LEGACY_CLIENT_BLOCK_ENABLED;
    delete process.env.DRIVER_MIN_APP_BUILD;
    await stop(server);
  });

  const get = (version: string | undefined) =>
    fetch(`${baseUrl}/api/v1/driver/rides/offers`, {
      headers: {
        "x-tapgo-app": "driver",
        "x-tapgo-platform": "android",
        "x-tapgo-distribution": "play",
        ...(version ? { "x-tapgo-app-version": version } : {})
      }
    });

  it("menolak build driver di bawah batas dengan 426 APP_UPDATE_REQUIRED", async () => {
    for (const version of ["1.0.0+3", "1.0.0+2", "0.9.0+1"]) {
      const response = await get(version);
      expect(response.status, version).toBe(426);
      expect(((await response.json()) as { code?: string }).code, version).toBe("APP_UPDATE_REQUIRED");
    }
  });

  it("menerima build driver pada dan di atas batas", async () => {
    for (const version of ["1.0.0+4", "1.0.0+5", "1.1.0+10"]) {
      expect((await get(version)).status, version).not.toBe(426);
    }
  });

  it("tidak menolak versi tak terbaca (fail-open, bukan salah tolak)", async () => {
    for (const version of ["unknown", "garbage", undefined]) {
      expect((await get(version)).status, String(version)).not.toBe(426);
    }
  });

  it("TIDAK PERNAH memakai ambang batas user_app (MOBILE_MIN_APP_BUILD) untuk driver_app", async () => {
    // Andai gerbang salah cabang, build "1.0.0+4" (>= DRIVER_MIN_APP_BUILD=4)
    // akan tetap lolos di sini walau MOBILE_MIN_APP_BUILD diset sangat tinggi.
    process.env.MOBILE_MIN_APP_BUILD = "999999";
    try {
      const response = await get("1.0.0+4");
      expect(response.status).not.toBe(426);
    } finally {
      delete process.env.MOBILE_MIN_APP_BUILD;
    }
  });

  it("request user_app (tanpa X-TapGo-App) TIDAK terpengaruh env driver sama sekali", async () => {
    const asUser = await fetch(`${baseUrl}/api/v1/membership/current`, {
      headers: { "x-tapgo-platform": "android", "x-tapgo-distribution": "play", "x-tapgo-app-version": "0.0.1+1" }
    });
    expect(asUser.status).not.toBe(426);
  });
});

describe("Gerbang versi minimum driver_app — default mati", () => {
  let server: Server;
  let baseUrl = "";
  beforeAll(async () => ({ server, baseUrl } = await startApp(undefined)));
  afterAll(async () => stop(server));

  it("tidak menolak build lama saat saklar tidak dinyalakan", async () => {
    const response = await fetch(`${baseUrl}/api/v1/driver/rides/offers`, {
      headers: { "x-tapgo-app": "driver", "x-tapgo-platform": "android", "x-tapgo-app-version": "0.1.0+1" }
    });
    expect(response.status).not.toBe(426);
  });

  it("build driver_app lama (sebelum 1.0.0+4, tanpa header X-TapGo-App) tidak pernah masuk gerbang ini", async () => {
    const response = await fetch(`${baseUrl}/api/v1/driver/rides/offers`, { headers: {} });
    expect(response.status).not.toBe(426);
  });
});
