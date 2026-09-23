import { afterEach, describe, expect, it } from "vitest";
import * as Sentry from "@sentry/node";

/**
 * Verifikasi hook logMethod di core/logger/logger.ts benar-benar meneruskan
 * log level error/fatal ke Sentry — TANPA spy pada modul @sentry/node
 * (namespace-nya frozen/ESM, vi.spyOn gagal dengan "Cannot redefine
 * property", lihat catatan di errorHandler.test.ts).
 *
 * Dipakai di sini justru API PUBLIK Sentry sendiri: Sentry.init() dengan DSN
 * dummy (format valid, project tidak sungguhan) + beforeSend yang
 * mengembalikan null — event benar-benar melalui pipeline pemrosesan Sentry
 * yang sesungguhnya, tapi TIDAK PERNAH benar-benar dikirim ke jaringan.
 */
describe("logger -> Sentry auto-forwarding (hooks.logMethod)", () => {
  afterEach(async () => {
    await Sentry.close(100);
  });

  it("logger.error({ err }, ...) diteruskan sebagai exception ke Sentry", async () => {
    const captured: Sentry.Event[] = [];
    Sentry.init({
      dsn: "https://abcdef0123456789abcdef0123456789@o0.ingest.sentry.io/0",
      beforeSend(event) {
        captured.push(event);
        return null;
      }
    });

    const { logger } = await import("../../src/core/logger/logger.js");
    const boom = new Error("boom untuk uji forwarding otomatis");
    logger.error({ err: boom }, "pesan error uji");

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]!.exception?.values?.[0]?.value).toContain(
      "boom untuk uji forwarding otomatis"
    );
  });

  it("logger.fatal({ err }, ...) juga diteruskan (level >= error)", async () => {
    const captured: Sentry.Event[] = [];
    Sentry.init({
      dsn: "https://abcdef0123456789abcdef0123456789@o0.ingest.sentry.io/0",
      beforeSend(event) {
        captured.push(event);
        return null;
      }
    });

    const { logger } = await import("../../src/core/logger/logger.js");
    logger.fatal({ err: new Error("fatal untuk uji forwarding") }, "pesan fatal uji");

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(captured.length).toBeGreaterThan(0);
  });

  it("logger.warn/.info TIDAK diteruskan ke Sentry (di bawah ambang error)", async () => {
    const captured: Sentry.Event[] = [];
    Sentry.init({
      dsn: "https://abcdef0123456789abcdef0123456789@o0.ingest.sentry.io/0",
      beforeSend(event) {
        captured.push(event);
        return null;
      }
    });

    const { logger } = await import("../../src/core/logger/logger.js");
    logger.warn({ err: new Error("cuma warning") }, "pesan warning uji");
    logger.info("pesan info biasa");

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(captured.length).toBe(0);
  });

  it("field `error` (bukan `err`) tetap dikenali — konvensi lama di errorHandler.ts", async () => {
    const captured: Sentry.Event[] = [];
    Sentry.init({
      dsn: "https://abcdef0123456789abcdef0123456789@o0.ingest.sentry.io/0",
      beforeSend(event) {
        captured.push(event);
        return null;
      }
    });

    const { logger } = await import("../../src/core/logger/logger.js");
    logger.error({ error: new Error("boom via field error") }, "Unhandled application error");

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]!.exception?.values?.[0]?.value).toContain("boom via field error");
  });
});
