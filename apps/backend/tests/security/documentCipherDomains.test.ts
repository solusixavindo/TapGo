import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import {
  DOCUMENT_DOMAINS,
  decryptDocument,
  encryptDocument
} from "../../src/core/security/documentCipher.js";

/**
 * Pemisahan domain kunci dokumen.
 *
 * Dokumen membership dan dokumen driver dienkripsi dari SECRET yang sama, tetapi
 * lewat kunci turunan yang berbeda. Yang diuji di sini bukan "enkripsi bekerja",
 * melainkan bahwa keduanya benar-benar TIDAK saling membuka: bila suatu saat
 * label domain hilang atau disamakan, satu kebocoran akan membuka dua jenis
 * dokumen sekaligus, dan tidak ada galat yang muncul untuk memberi tahu.
 */

const secretAsli = env.MEMBERSHIP_DOCUMENT_SECRET;

describe("pemisahan domain kunci dokumen", () => {
  beforeAll(() => {
    env.MEMBERSHIP_DOCUMENT_SECRET =
      "rahasia-uji-pemisahan-domain-dokumen-tapgo-cukup-panjang";
  });

  afterAll(() => {
    env.MEMBERSHIP_DOCUMENT_SECRET = secretAsli;
  });

  const isi = Buffer.from("isi dokumen identitas untuk pengujian", "utf8");

  it("membuka kembali dokumen pada domain yang sama", () => {
    for (const domain of ["membership", "driver"] as const) {
      const terkunci = encryptDocument(isi, domain);
      const dibuka = decryptDocument(
        {
          cipherText: terkunci.cipherText,
          cipherIv: terkunci.cipherIv,
          cipherTag: terkunci.cipherTag,
          keyVersion: terkunci.keyVersion
        },
        domain
      );
      expect(dibuka.equals(isi), `domain ${domain}`).toBe(true);
    }
  });

  it("MENOLAK membuka dokumen memakai kunci domain lain", () => {
    const pasangan = [
      ["membership", "driver"],
      ["driver", "membership"]
    ] as const;

    for (const [asal, tujuan] of pasangan) {
      const terkunci = encryptDocument(isi, asal);
      expect(
        () =>
          decryptDocument(
            {
              cipherText: terkunci.cipherText,
              cipherIv: terkunci.cipherIv,
              cipherTag: terkunci.cipherTag,
              keyVersion: terkunci.keyVersion
            },
            tujuan
          ),
        `dokumen ${asal} tidak boleh terbuka dengan kunci ${tujuan}`
      ).toThrowError(/tidak dapat dibuka/i);
    }
  });

  it("memakai label domain yang berbeda dan tidak kosong", () => {
    const nilai = Object.values(DOCUMENT_DOMAINS);
    expect(new Set(nilai).size).toBe(nilai.length);
    for (const label of nilai) {
      expect(label.length).toBeGreaterThan(8);
    }
  });

  it("menghasilkan checksum isi asli, bukan checksum ciphertext", () => {
    // Checksum harus sama di kedua domain: yang dihitung adalah isi aslinya,
    // sehingga hasil cetak admin dapat dibuktikan identik dengan yang diunggah.
    const a = encryptDocument(isi, "membership");
    const b = encryptDocument(isi, "driver");
    expect(a.checksum).toBe(b.checksum);
    // Ciphertext-nya sendiri WAJIB berbeda.
    expect(a.cipherText.equals(b.cipherText)).toBe(false);
  });
});
