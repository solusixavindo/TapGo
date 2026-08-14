import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Penjaga interop CommonJS pada jalur autentikasi.
 *
 * Kenapa berkas ini ada: memakai named import untuk kelas galat jsonwebtoken
 * membuat server GAGAL START dengan SyntaxError, tetapi SELURUH suite tetap
 * hijau — vitest mem-bundle dengan cara yang menyembunyikan masalahnya. Bug
 * seperti itu hanya muncul di server sungguhan, dan itulah tempat paling mahal
 * untuk menemukannya.
 *
 * Karena itu pemeriksaan di bawah menjalankan Node ASLI sebagai proses
 * terpisah. Menguji lewat import biasa di dalam vitest tidak membuktikan apa
 * pun tentang perilaku produksi.
 */

const NODE = process.execPath;
const AKAR = new URL("../../", import.meta.url).pathname;

function jalankanNode(kode: string) {
  try {
    execFileSync(NODE, ["--input-type=module", "-e", kode], {
      cwd: AKAR,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000
    });
    return { berhasil: true, pesan: "" };
  } catch (error) {
    const err = error as { stderr?: Buffer };
    return { berhasil: false, pesan: err.stderr?.toString() ?? "" };
  }
}

/** Membuang komentar supaya pemindai tidak mencocoki contoh di dokumentasi. */
function tanpaKomentar(sumber: string) {
  return sumber.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("Interop CommonJS pada jalur autentikasi", () => {
  it("membuktikan named import dari jsonwebtoken MEMANG gagal di Node asli", () => {
    // Bila suatu hari jsonwebtoken menerbitkan ESM sungguhan, pemeriksaan ini
    // gagal dan memberi tahu bahwa alasan di tokenService.ts sudah usang.
    const hasil = jalankanNode(
      `import { JsonWebTokenError } from "jsonwebtoken"; void JsonWebTokenError;`
    );

    expect(hasil.berhasil).toBe(false);
    expect(hasil.pesan).toMatch(
      /Named export .* not found|does not provide an export named/
    );
    expect(hasil.pesan).toContain("CommonJS");
  });

  it("membuktikan default import menyediakan seluruh kelas galat", () => {
    const hasil = jalankanNode(`
      import jwt from "jsonwebtoken";
      for (const n of ["JsonWebTokenError", "NotBeforeError", "TokenExpiredError"]) {
        if (typeof jwt[n] !== "function") {
          throw new Error("hilang dari default export: " + n);
        }
      }
    `);

    expect(hasil.pesan).toBe("");
    expect(hasil.berhasil).toBe(true);
  });

  it("tokenService tidak memakai named import nilai dari jsonwebtoken", () => {
    const sumber = tanpaKomentar(
      readFileSync(
        new URL("../../src/core/security/tokenService.ts", import.meta.url),
        "utf8"
      )
    );

    // `import type { ... }` diperbolehkan: tipe terhapus saat kompilasi dan
    // tidak pernah menjadi permintaan modul saat runtime.
    const namedNilai = /(?<!import\s+type\s)import\s*\{[^}]*\}\s*from\s*["']jsonwebtoken["']/;
    expect(sumber).not.toMatch(namedNilai);
    expect(sumber).toMatch(/import\s+jwt\s+from\s*["']jsonwebtoken["']/);
  });
});
