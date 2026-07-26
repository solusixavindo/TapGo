import express from "express";
import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// P1-3: verifikasi (a) createApp menetapkan trust proxy = 1, dan (b) semantik
// resolusi IP yang menjadi dasar keamanan rate limiting di belakang satu Nginx.

describe("P1-3 trust proxy configuration", () => {
  it("configures Express to trust exactly one proxy hop", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? "postgresql://localhost:5432/placeholder";
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "trust-proxy-test-access-secret-000000000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "trust-proxy-test-refresh-secret-00000000000";

    const { createApp } = await import("../../src/app.js");
    const app = createApp();

    expect(app.get("trust proxy")).toBe(1);
  });
});

describe("P1-3 trust proxy IP resolution semantics", () => {
  let server: http.Server;
  let baseUrl = "";

  beforeAll(async () => {
    const app = express();
    // Konfigurasi identik dengan createApp (satu hop Nginx).
    app.set("trust proxy", 1);
    app.get("/ip", (req, res) => {
      res.json({ ip: req.ip });
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function requestIp(forwardedFor?: string): Promise<string> {
    const response = await fetch(`${baseUrl}/ip`, {
      headers: forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}
    });
    const body = (await response.json()) as { ip: string };
    return body.ip;
  }

  it("uses the socket IP for a direct request without X-Forwarded-For", async () => {
    const ip = await requestIp();
    expect(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).toContain(ip);
  });

  it("uses the client IP injected by the trusted proxy", async () => {
    const ip = await requestIp("203.0.113.7");
    expect(ip).toBe("203.0.113.7");
  });

  it("ignores a client-spoofed X-Forwarded-For prefix", async () => {
    // Klien memalsukan 9.9.9.9; Nginx menambahkan IP asli 203.0.113.7 di kanan.
    // trust proxy = 1 hanya memakai satu hop terkanan, sehingga spoof diabaikan.
    const ip = await requestIp("9.9.9.9, 203.0.113.7");
    expect(ip).toBe("203.0.113.7");
    expect(ip).not.toBe("9.9.9.9");
  });
});
