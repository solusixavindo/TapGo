import { describe, expect, it } from "vitest";
import { z } from "zod";
import { strictEnvBoolean } from "../../src/config/env.js";

/**
 * Flag boolean yang dibaca dari environment.
 *
 * Nilai environment SELALU berupa string. `z.coerce.boolean()` memakai
 * `Boolean(value)`, dan setiap string tak kosong bernilai truthy — termasuk
 * "false", "0", dan "no". Artinya menulis `MIDTRANS_IS_PRODUCTION=false` justru
 * menghasilkan `true`, dan seluruh permintaan pembayaran menuju endpoint
 * PRODUKSI padahal maksudnya sandbox. Jebakan yang sama pada `DOKU_ENABLED`
 * menyalakan penyedia yang dikira sudah dimatikan.
 *
 * Berkas ini mengunci perbaikannya dua arah: memastikan strictEnvBoolean
 * berperilaku benar, DAN memastikan tidak ada flag yang diam-diam kembali
 * memakai coerce.
 */

const FLAG_NAMES = [
  "MIDTRANS_IS_PRODUCTION",
  "DOKU_ENABLED",
  "EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED",
  "MEMBERSHIP_PURCHASE_WEB_ENABLED",
  "MEMBERSHIP_PURCHASE_APP_ENABLED",
  "WALLET_CASH_OUT_ENABLED",
  "REALTIME_ENABLED"
] as const;

describe("Environment boolean flags", () => {
  it("membaca 'false' sebagai false, bukan true", () => {
    const flag = strictEnvBoolean(false);

    // Inilah baris yang paling penting di berkas ini. Sebelum diperbaiki,
    // z.coerce.boolean() mengembalikan true untuk ketiganya.
    expect(flag.parse("false")).toBe(false);
    expect(flag.parse("FALSE")).toBe(false);
    expect(flag.parse("  false  ")).toBe(false);
  });

  it("membaca 'true' sebagai true", () => {
    const flag = strictEnvBoolean(false);
    expect(flag.parse("true")).toBe(true);
    expect(flag.parse("TRUE")).toBe(true);
    expect(flag.parse(" true ")).toBe(true);
  });

  it("memakai nilai bawaan saat variabel tidak disetel atau kosong", () => {
    expect(strictEnvBoolean(false).parse(undefined)).toBe(false);
    expect(strictEnvBoolean(false).parse("")).toBe(false);
    expect(strictEnvBoolean(true).parse(undefined)).toBe(true);
    expect(strictEnvBoolean(true).parse("")).toBe(true);
  });

  it("menolak nilai yang ambigu alih-alih menebaknya", () => {
    const flag = strictEnvBoolean(false);
    // Fail loud: "0", "1", "no", "yes" TIDAK diterjemahkan diam-diam. Menebak
    // di sini berarti menebak pada flag yang menentukan uang bergerak.
    for (const value of ["0", "1", "no", "yes", "off", "on", "ya"]) {
      expect(() => flag.parse(value), `nilai ${value} harus ditolak`).toThrow();
    }
  });

  it("membuktikan z.coerce.boolean memang tidak layak untuk environment", () => {
    // Kontrol negatif. Kalau suatu saat perilaku zod berubah dan baris ini
    // gagal, catatan pada env.ts perlu ditinjau ulang.
    expect(z.coerce.boolean().parse("false")).toBe(true);
    expect(z.coerce.boolean().parse("0")).toBe(true);
  });

  it("tidak menyisakan satu pun flag yang memakai coerce", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../../src/config/env.ts", import.meta.url),
      "utf8"
    );

    for (const name of FLAG_NAMES) {
      const line = source
        .split("\n")
        .find((candidate) => candidate.trimStart().startsWith(`${name}:`));
      expect(line, `deklarasi ${name} tidak ditemukan`).toBeDefined();
      expect(line, `${name} harus memakai strictEnvBoolean`).toContain(
        "strictEnvBoolean"
      );
      expect(line, `${name} tidak boleh memakai z.coerce.boolean`).not.toContain(
        "coerce"
      );
    }
  });
});
