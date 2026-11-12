// Pengaman: berkas QRIS resmi tidak boleh berubah tanpa disengaja.
// QRIS statis TAPGO LION INDO TRANS (NMID ID1026632896191), isi QR dan checksum EMV-nya sudah diverifikasi pada 12 Nov 2026.
// Mengganti QRIS adalah keputusan Owner: ganti berkas, verifikasi isi QR-nya, lalu perbarui nilai di bawah.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const EXPECTED_SHA256 = "09a7834aac609a67dd976634ede57fb767364189275e197cda502e4d087d51c8";
const file = new URL("../public/images/qris-tapgo.jpeg", import.meta.url);
const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
if (actual !== EXPECTED_SHA256) {
  console.error(`QRIS berubah! sha256 ${actual} tidak sama dengan yang diverifikasi (${EXPECTED_SHA256}). Build dihentikan.`);
  process.exit(1);
}
console.log("QRIS resmi terverifikasi (sha256 cocok).");
