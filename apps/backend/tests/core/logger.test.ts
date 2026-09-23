import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * logDir dibaca SEKALI di top-level module logger.ts saat pertama diimpor —
 * karena itu LOG_DIR harus di-set SEBELUM modul diimpor (import() dinamis di
 * beforeAll), bukan lewat import statis di puncak file ini. File test ini
 * mendapat modul segar sendiri (isolate:true default vitest per file), jadi
 * tidak bentrok dengan file test lain yang mengimpor logger.ts tanpa LOG_DIR.
 */
describe("logger dengan LOG_DIR (pemisahan audit.log / error.log)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tapgo-logger-test-"));
  let logger: typeof import("../../src/core/logger/logger.js").logger;
  let auditLogger: typeof import("../../src/core/logger/logger.js").auditLogger;

  beforeAll(async () => {
    process.env.LOG_DIR = tmpDir;
    const mod = await import("../../src/core/logger/logger.js");
    logger = mod.logger;
    auditLogger = mod.auditLogger;

    logger.error({ marker: "err-1" }, "pesan error uji");
    auditLogger.info({ marker: "audit-1" }, "pesan audit uji");

    // pino.destination(sync:false) menulis async — beri waktu singkat supaya
    // buffer benar-benar sampai ke disk sebelum dibaca ulang di bawah.
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  afterAll(() => {
    delete process.env.LOG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("error.log berisi log level error, TIDAK berisi log audit", () => {
    const content = fs.readFileSync(path.join(tmpDir, "error.log"), "utf8");
    expect(content).toContain("err-1");
    expect(content).not.toContain("audit-1");
  });

  it("audit.log berisi log audit, ditandai scope: audit", () => {
    const content = fs.readFileSync(path.join(tmpDir, "audit.log"), "utf8");
    expect(content).toContain("audit-1");
    expect(content).toContain('"scope":"audit"');
  });

  it("audit.log TIDAK berisi log error umum (dua file sungguhan terpisah)", () => {
    const content = fs.readFileSync(path.join(tmpDir, "audit.log"), "utf8");
    expect(content).not.toContain("err-1");
  });
});

describe("logger tanpa LOG_DIR (perilaku default tidak berubah)", () => {
  it("tidak melempar error dan tidak membuat direktori file apa pun", async () => {
    delete process.env.LOG_DIR;
    const mod = await import("../../src/core/logger/logger.js?no-log-dir");
    expect(() => mod.logger.info("halo")).not.toThrow();
    expect(() => mod.auditLogger.info("halo audit")).not.toThrow();
  });
});
