import crypto from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../errors/AppError.js";
import { env } from "../../config/env.js";

/**
 * Enkripsi dokumen identitas (KTP dan swafoto) yang disimpan sementara di
 * database aplikasi.
 *
 * Keputusan Owner: dokumen disimpan maksimal 24 jam, lalu admin mencetaknya
 * sebagai berkas administrasi. Masa simpan sependek itu memperkecil paparan,
 * tetapi TIDAK menutup satu celah: backup database biasanya disimpan jauh lebih
 * lama dari 24 jam, sehingga foto KTP ikut bertahan di sana. Karena itu isi
 * berkas dienkripsi, dan kuncinya berada di environment — bukan di database.
 * Salinan backup database saja tidak cukup untuk membukanya.
 *
 * AES-256-GCM dipilih karena sekaligus memberi autentikasi: ciphertext yang
 * diubah di database akan gagal didekripsi, bukan menghasilkan gambar palsu.
 *
 * Secret ini SENGAJA terpisah dari JWT, payment, recovery HMAC, dan identifier
 * HMAC driver. Kebocoran satu domain tidak boleh melemahkan domain lain.
 */

export const MEMBERSHIP_DOCUMENT_SECRET_UNAVAILABLE = "MEMBERSHIP_DOCUMENT_SECRET_UNAVAILABLE";

/** Panjang minimum yang sama dengan kebijakan secret lain di repo. */
export const MIN_MEMBERSHIP_DOCUMENT_SECRET_LENGTH = 32;

/** Versi kunci aktif, disimpan bersama ciphertext agar rotasi mungkin dilakukan. */
export const MEMBERSHIP_DOCUMENT_KEY_VERSION = 1;

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
/**
 * Domain kunci. Tiap jenis dokumen menurunkan kunci sendiri dari secret yang
 * sama, sehingga ciphertext KTP pemohon membership TIDAK dapat dibuka dengan
 * kunci dokumen driver, dan sebaliknya.
 *
 * Nilainya WAJIB stabil selamanya: mengubah label berarti seluruh dokumen lama
 * di domain itu tidak lagi dapat didekripsi.
 */
export const DOCUMENT_DOMAINS = {
  membership: "tapgo.membership.document.v1",
  driver: "tapgo.driver.document.v1"
} as const;

export type DocumentDomain = keyof typeof DOCUMENT_DOMAINS;

export type EncryptedDocument = {
  cipherText: Buffer;
  cipherIv: Buffer;
  cipherTag: Buffer;
  keyVersion: number;
  checksum: string;
};

/**
 * Fail-closed pada titik pemakaian, bukan saat boot.
 *
 * env.ts dimuat oleh hampir seluruh test lewat logger dan tokenService, jadi
 * memaksa secret ada saat boot akan menumbangkan test yang tidak berhubungan.
 * Sebagai gantinya setiap operasi dokumen menolak dengan 503 bila secret belum
 * disetel — unggahan gagal terang-terangan, tidak diam-diam menyimpan mentah.
 */
export function membershipDocumentSecretAvailable(): boolean {
  const secret = env.MEMBERSHIP_DOCUMENT_SECRET;
  return typeof secret === "string" && secret.length >= MIN_MEMBERSHIP_DOCUMENT_SECRET_LENGTH;
}

function requireKey(domain: DocumentDomain): Buffer {
  const secret = env.MEMBERSHIP_DOCUMENT_SECRET;
  if (!secret || secret.length < MIN_MEMBERSHIP_DOCUMENT_SECRET_LENGTH) {
    throw new AppError(
      "Penyimpanan dokumen belum dikonfigurasi.",
      StatusCodes.SERVICE_UNAVAILABLE,
      MEMBERSHIP_DOCUMENT_SECRET_UNAVAILABLE
    );
  }

  // Secret environment berupa teks dengan panjang bebas; AES-256 menuntut kunci
  // tepat 32 byte. Turunkan lewat HKDF dengan label domain agar kunci ini tidak
  // pernah sama dengan kunci domain lain sekalipun secret-nya kebetulan sama.
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.alloc(0),
      DOCUMENT_DOMAINS[domain],
      32
    )
  );
}

export function encryptDocument(
  plain: Buffer,
  domain: DocumentDomain
): EncryptedDocument {
  const key = requireKey(domain);
  const cipherIv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, cipherIv);
  const cipherText = Buffer.concat([cipher.update(plain), cipher.final()]);

  return {
    cipherText,
    cipherIv,
    cipherTag: cipher.getAuthTag(),
    keyVersion: MEMBERSHIP_DOCUMENT_KEY_VERSION,
    // Checksum isi ASLI, bukan ciphertext: dipakai membuktikan berkas yang
    // dicetak admin sama persis dengan yang diunggah pemohon.
    checksum: crypto.createHash("sha256").update(plain).digest("hex")
  };
}

export function decryptDocument(
  input: {
    cipherText: Buffer;
    cipherIv: Buffer;
    cipherTag: Buffer;
    keyVersion: number | null;
  },
  domain: DocumentDomain
): Buffer {
  if (input.keyVersion !== null && input.keyVersion !== MEMBERSHIP_DOCUMENT_KEY_VERSION) {
    throw new AppError(
      "Dokumen dienkripsi dengan versi kunci yang tidak dikenal.",
      StatusCodes.SERVICE_UNAVAILABLE,
      "MEMBERSHIP_DOCUMENT_KEY_VERSION_UNKNOWN"
    );
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, requireKey(domain), input.cipherIv);
  decipher.setAuthTag(input.cipherTag);

  try {
    return Buffer.concat([decipher.update(input.cipherText), decipher.final()]);
  } catch {
    // Tag GCM gagal berarti ciphertext atau tag-nya berubah. Jangan pernah
    // mengembalikan hasil sebagian — perlakukan sebagai dokumen rusak.
    throw new AppError(
      "Dokumen tidak dapat dibuka.",
      StatusCodes.CONFLICT,
      "MEMBERSHIP_DOCUMENT_CORRUPT"
    );
  }
}
