import * as Sentry from "@sentry/node";
import { afterEach, describe, expect, it } from "vitest";
import { scrubSensitiveText, scrubSentryEvent } from "../../src/core/monitoring/sentry.js";

/**
 * Audit keamanan 30 September 2026 (M5): logger.error/fatal meneruskan
 * exception ke Sentry (lihat loggerSentryForwarding.test.ts) — di sini
 * dipastikan isinya sudah disaring SEBELUM benar-benar terkirim, walau
 * secret itu muncul sebagai SUBSTRING pesan bebas (bukan field terstruktur
 * yang sudah ditangani redact Pino di logger.ts).
 */
describe("scrubSensitiveText", () => {
  it("menyamarkan header Bearer token", () => {
    const input = "Gagal memanggil API: Authorization: Bearer abc123.def456.ghi789 ditolak";
    expect(scrubSensitiveText(input)).toBe(
      "Gagal memanggil API: Authorization: Bearer [REDACTED] ditolak"
    );
  });

  it("menyamarkan JWT mentah (tiga segmen dipisah titik)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ_dQw4w9WgXcQdQw4w9WgXcQ";
    expect(scrubSensitiveText(`token mentah: ${jwt}`)).toBe(
      "token mentah: [REDACTED_JWT]"
    );
  });

  it("menyamarkan rangkaian digit panjang (mis. nomor rekening/NIK/OTP)", () => {
    expect(scrubSensitiveText("Nomor rekening 1234567890123 tidak valid")).toBe(
      "Nomor rekening [REDACTED_DIGITS] tidak valid"
    );
  });

  it("tidak mengubah pesan tanpa pola sensitif", () => {
    expect(scrubSensitiveText("Koneksi ke database gagal")).toBe(
      "Koneksi ke database gagal"
    );
  });

  it("angka pendek (di bawah ambang) tidak ikut disamarkan", () => {
    expect(scrubSensitiveText("HTTP status 404 pada percobaan ke-3")).toBe(
      "HTTP status 404 pada percobaan ke-3"
    );
  });
});

describe("scrubSentryEvent", () => {
  it("menyaring string di dalam exception.values[].value secara rekursif", () => {
    const event = {
      exception: {
        values: [{ type: "Error", value: "Authorization: Bearer secret-token-xyz gagal" }]
      }
    } as unknown as Sentry.Event;

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.exception?.values?.[0]?.value).toBe(
      "Authorization: Bearer [REDACTED] gagal"
    );
  });

  it("me-redact PENUH field bernama sensitif (authorization, token, dst) apa pun isinya", () => {
    const event = {
      request: {
        headers: { authorization: "Bearer some-real-looking-value" },
        data: { accessToken: "abc.def.ghi", accountNumber: "9988776655" }
      }
    } as unknown as Sentry.Event;

    const scrubbed = scrubSentryEvent(event) as unknown as {
      request: { headers: { authorization: string }; data: { accessToken: string; accountNumber: string } };
    };

    expect(scrubbed.request.headers.authorization).toBe("[REDACTED]");
    expect(scrubbed.request.data.accessToken).toBe("[REDACTED]");
    expect(scrubbed.request.data.accountNumber).toBe("[REDACTED]");
  });

  it("menyaring breadcrumbs bersarang tanpa mengubah struktur objeknya", () => {
    const event = {
      breadcrumbs: [
        { message: "panggil endpoint dengan Bearer abc123.def456.ghi789" },
        { message: "pesan aman tanpa apa pun" }
      ]
    } as unknown as Sentry.Event;

    const scrubbed = scrubSentryEvent(event);

    expect(scrubbed.breadcrumbs?.[0]?.message).toBe("panggil endpoint dengan Bearer [REDACTED]");
    expect(scrubbed.breadcrumbs?.[1]?.message).toBe("pesan aman tanpa apa pun");
  });
});

/**
 * Verifikasi END-TO-END lewat initSentry() sungguhan (bukan Sentry.init()
 * ditulis ulang di test) — membuktikan beforeSend yang benar-benar dipasang
 * di sentry.ts, bukan cuma fungsi scrub yang diuji terpisah di atas.
 */
describe("initSentry() memasang beforeSend yang menyaring event", () => {
  afterEach(async () => {
    await Sentry.close(100);
    delete process.env.SENTRY_DSN;
  });

  it("exception yang mengandung Bearer token disaring sebelum ditangkap", async () => {
    process.env.SENTRY_DSN = "https://abcdef0123456789abcdef0123456789@o0.ingest.sentry.io/0";
    const { initSentry } = await import("../../src/core/monitoring/sentry.js");

    const captured: Sentry.Event[] = [];
    initSentry();
    // beforeSend dari initSentry() sudah terpasang; tangkap hasil akhirnya
    // lewat client hook client.on("beforeSendEvent", ...) API publik Sentry,
    // supaya tidak menimpa beforeSend yang sedang diuji.
    const client = Sentry.getClient();
    client?.on("beforeSendEvent", (event) => {
      captured.push(event);
    });

    Sentry.captureException(new Error("gagal: Authorization: Bearer leaked-token-value"));

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]!.exception?.values?.[0]?.value).toContain("Bearer [REDACTED]");
    expect(captured[0]!.exception?.values?.[0]?.value).not.toContain("leaked-token-value");
  });
});
