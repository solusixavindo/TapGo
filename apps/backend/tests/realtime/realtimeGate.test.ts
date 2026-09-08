import http, { Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import type { Server as IoServer } from "socket.io";
import { io as ioClient } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

// A. Gate Socket.IO: fail-closed saat REALTIME_ENABLED=false. Tidak butuh DB
// (hanya probe HTTP + socket.io-client), sehingga berjalan di semua run.
//
// Pengecualian: skenario "enabled" sekarang mengautentikasi setiap koneksi
// (Stage R2.10 — lihat realtime/socket.ts), dan autentikasi itu melakukan satu
// pembacaan DB (authVersion). Test itu jadi butuh database sungguhan dan hanya
// berjalan bila TAPGO_TEST_DATABASE_URL tersedia; dua test gate lain di atas
// tidak pernah menyentuh middleware auth sama sekali (REALTIME_ENABLED=false
// berarti io.use() tidak pernah terpasang) sehingga tetap jalan tanpa DB.

let httpServer: HttpServer | undefined;
let realtime: IoServer | null = null;

async function startServer(realtimeEnabled: boolean): Promise<string> {
  process.env.DATABASE_URL =
    testDatabaseUrl ?? process.env.DATABASE_URL ?? "postgresql://localhost:5432/placeholder";
  process.env.JWT_ACCESS_SECRET =
    process.env.JWT_ACCESS_SECRET ?? "realtime-gate-access-secret-000000000000000";
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET ?? "realtime-gate-refresh-secret-00000000000000";

  const [{ createApp }, envMod, { attachRealtime }] = await Promise.all([
    import("../../src/app.js"),
    import("../../src/config/env.js"),
    import("../../src/realtime/socket.js")
  ]);
  Object.assign(envMod.env, { REALTIME_ENABLED: realtimeEnabled });

  httpServer = http.createServer(createApp());
  realtime = attachRealtime(httpServer);
  await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

function tryConnect(baseUrl: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const client = ioClient(baseUrl, {
      transports: ["websocket"],
      reconnection: false,
      timeout: timeoutMs
    });
    const done = (value: boolean) => {
      client.close();
      resolve(value);
    };
    client.on("connect", () => done(true));
    client.on("connect_error", () => done(false));
    setTimeout(() => done(false), timeoutMs + 200);
  });
}

describe("A. Realtime Socket.IO gate", () => {
  afterEach(async () => {
    if (realtime) {
      realtime.close();
      realtime = null;
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
      httpServer = undefined;
    }
  });

  it("does not attach Socket.IO when disabled, REST/health still serve", async () => {
    const base = await startServer(false);
    expect(realtime).toBeNull();

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    const apiHealth = await fetch(`${base}/api/v1/health`);
    expect(apiHealth.status).toBe(200);

    // Endpoint realtime tidak aktif -> handshake ditolak (404 dari Express).
    const probe = await fetch(`${base}/socket.io/?EIO=4&transport=polling`);
    expect(probe.status).toBe(404);
  });

  it("rejects a client connection when disabled", async () => {
    const base = await startServer(false);
    const connected = await tryConnect(base, 800);
    expect(connected).toBe(false);
  });

  it.skipIf(!runIntegration)(
    "attaches Socket.IO and completes connect/join/disconnect when enabled",
    async () => {
      const base = await startServer(true);
      expect(realtime).not.toBeNull();

      const health = await fetch(`${base}/health`);
      expect(health.status).toBe(200);

      const tokenService = await import("../../src/core/security/tokenService.js");
      const token = tokenService.signAccessToken({
        sub: "00000000-0000-0000-0000-000000000000",
        role: "USER",
        sessionId: "realtime-gate-smoke-session"
      });

      const client = ioClient(base, {
        transports: ["websocket"],
        reconnection: false,
        auth: { token }
      });
      const connected = await new Promise<boolean>((resolve) => {
        client.on("connect", () => resolve(true));
        client.on("connect_error", () => resolve(false));
        setTimeout(() => resolve(false), 2000);
      });
      expect(connected).toBe(true);

      // Lifecycle event tidak melempar error — ride palsu tidak dapat
      // ditemukan, jadi ack menyatakan gagal, tapi koneksi tetap sehat.
      const joinResult = await new Promise<{ ok: boolean }>((resolve) => {
        client.emit("ride:join", "ride-smoke-test", resolve);
        setTimeout(() => resolve({ ok: false }), 1000);
      });
      expect(joinResult.ok).toBe(false);

      const disconnected = await new Promise<boolean>((resolve) => {
        client.on("disconnect", () => resolve(true));
        client.close();
        setTimeout(() => resolve(true), 500);
      });
      expect(disconnected).toBe(true);
    }
  );
});
