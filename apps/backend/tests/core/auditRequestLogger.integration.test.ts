import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships } from "../helpers/referralWalletHarness.js";

/**
 * Verifikasi end-to-end: request ke rute /api/v1/admin/* benar-benar tercatat
 * ke audit.log terpisah (lihat core/http/auditRequestLogger.ts + core/logger/
 * logger.ts), bukan cuma diuji unit terisolasi dari komponennya masing-masing.
 *
 * LOG_DIR di-set SEBELUM createApp() diimpor secara dinamis (module logger.ts
 * membaca process.env.LOG_DIR sekali saat pertama diimpor) — file test ini
 * mendapat modul segar sendiri (isolate:true default vitest per file).
 */
const describeIntegration = runIntegration ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: (p: { sub: string; role: UserRole; sessionId: string; authVersion?: number }) => string;
let sequence = 0;
let logDir: string;

async function createUser(role: UserRole = "ADMIN") {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Audit Log Admin ${sequence}`,
      phone: `08${String(700000000 + sequence)}`,
      referralCode: `ARL${String(sequence).padStart(6, "0")}`,
      role
    }
  });
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `sess-${user.id}`, authVersion: 0 });
}

describeIntegration("auditRequestLogger — audit.log mencatat request admin sungguhan", () => {
  beforeAll(async () => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "tapgo-audit-log-test-"));
    process.env.LOG_DIR = logDir;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-please-change-000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-please-change-00000";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await cleanDatabase();
    delete process.env.LOG_DIR;
    fs.rmSync(logDir, { recursive: true, force: true });
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  it("GET /api/v1/admin/rides ditolak (403) TETAP tercatat ke audit.log", async () => {
    // Role USER biasa -> ditolak requireRoles di dalam adminRideRouter, tapi
    // auditRequestLogger dipasang SEBELUM router itu (lihat app.ts) sehingga
    // tetap mencatat percobaannya, bukan hanya request yang berhasil.
    const user = await createUser("USER");
    const response = await fetch(`${baseUrl}/api/v1/admin/rides`, {
      headers: { authorization: `Bearer ${tokenFor(user)}` }
    });
    expect(response.status).toBe(403);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const auditContent = fs.readFileSync(path.join(logDir, "audit.log"), "utf8");
    const lastLine = auditContent.trim().split("\n").pop()!;
    const entry = JSON.parse(lastLine);
    expect(entry.path).toBe("/api/v1/admin/rides");
    expect(entry.method).toBe("GET");
    expect(entry.statusCode).toBe(403);
    expect(entry.adminUserId).toBe(user.id);
    expect(entry.scope).toBe("audit");
  });

  it("request ke rute NON-admin tidak masuk audit.log", async () => {
    await fetch(`${baseUrl}/health`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const auditPath = path.join(logDir, "audit.log");
    const content = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8") : "";
    expect(content).not.toContain('"path":"/health"');
  });
});
