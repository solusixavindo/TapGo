import { afterEach, describe, expect, it } from "vitest";
import * as Sentry from "@sentry/node";
import { prismaEngineErrorMessage } from "../../src/core/logger/prismaEngineLog.js";

/**
 * Regresi dashboard Error & Bugs (4 Okt 2026): issue Sentry "Prisma error"
 * (TAPGO-BACKEND-2) tidak punya isi apa pun. Penyebabnya bukan rute reject —
 * itu hanya request yang kebetulan sedang berjalan. Judulnya datang dari
 * `prisma.$on("error")` yang memanggil `logger.error({ event }, "Prisma error")`;
 * hook Sentry hanya membaca field `err`/`error`, jadi `event` (berisi pesan
 * mesin Prisma) dibuang dan Sentry hanya menerima teks "Prisma error". Semua
 * jenis galat mesin Prisma pun menumpuk di satu issue yang tidak bisa didiagnosis.
 */
describe("prismaEngineErrorMessage", () => {
  it("memuat pesan dan target mesin Prisma", () => {
    expect(
      prismaEngineErrorMessage({
        message: "Error in PostgreSQL connection: Error { kind: Closed, cause: None }",
        target: "quaint::connector::postgres::native"
      })
    ).toBe(
      "Prisma engine error: Error in PostgreSQL connection: Error { kind: Closed, cause: None } [quaint::connector::postgres::native]"
    );
  });

  it("tetap menghasilkan teks bermakna bila field kosong atau bukan string", () => {
    expect(prismaEngineErrorMessage({})).toBe("Prisma engine error: (tanpa pesan)");
    expect(prismaEngineErrorMessage(undefined)).toBe("Prisma engine error: (tanpa pesan)");
    expect(prismaEngineErrorMessage({ message: 42, target: {} })).toBe("Prisma engine error: (tanpa pesan)");
  });

  it("merapikan spasi/baris baru dan memotong pesan panjang", () => {
    const text = prismaEngineErrorMessage({ message: `baris satu\n\n  baris dua ${"x".repeat(1000)}` });
    expect(text).not.toContain("\n");
    expect(text.startsWith("Prisma engine error: baris satu baris dua ")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(400);
  });
});

describe("event mesin Prisma sampai ke Sentry dengan isinya", () => {
  afterEach(async () => {
    await Sentry.close(100);
  });

  it("logger.error dengan pesan dari prismaEngineErrorMessage membawa pesan asli ke Sentry", async () => {
    const captured: Sentry.Event[] = [];
    Sentry.init({
      dsn: "https://abcdef0123456789abcdef0123456789@o0.ingest.sentry.io/0",
      beforeSend(event) {
        captured.push(event);
        return null;
      }
    });
    const { logger } = await import("../../src/core/logger/logger.js");
    const event = { message: "Error in PostgreSQL connection: Error { kind: Closed }", target: "quaint" };
    logger.error({ event }, prismaEngineErrorMessage(event));

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Disaring menurut isi: suite penuh berjalan di satu proses, sehingga log
    // error dari berkas tes lain bisa ikut tertangkap pada jendela yang sama.
    const mine = captured.filter((e) => e.message?.includes("kind: Closed"));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.message).not.toBe("Prisma error");
  });
});
