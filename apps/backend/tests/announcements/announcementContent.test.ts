import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  containsLink,
  normalizeAnnouncementText,
  validateAnnouncementContent
} from "../../src/modules/announcements/application/announcementContent.js";

const ZERO_WIDTH = String.fromCharCode(0x200b);
const BIDI_OVERRIDE = String.fromCharCode(0x202e);

describe("Aturan isi pengumuman: teks polos tanpa tautan", () => {
  it.each([
    "Kunjungi https://tapgolion.id/upgrade untuk upgrade",
    "buka http://contoh.test sekarang",
    "klik www.promo-tapgo.com",
    "Hubungi toko.com untuk info",
    "unduh di bit.ly/abc123",
    "chat kami wa.me/6281234567890",
    "hubungi support@tapgolion.id",
    "ikuti @tapgo_resmi di sosial media",
    "javascript:alert(1)",
    "mailto:admin@tapgolion.id",
    "tel:+6281234567890",
    "intent://scan/#Intent;scheme=zxing;end",
    "TAPGOLION.ID/UPGRADE",
    "Kunjungi tapgolion.id"
  ])("menolak: %s", (text) => {
    expect(containsLink(text)).toBe(true);
    expect(validateAnnouncementContent({ title: "Info", body: text })).toEqual({ ok: false, problem: "LINK_NOT_ALLOWED" });
  });

  it("menolak tautan yang disamarkan dengan karakter lebar-nol, arah teks, atau huruf lebar penuh", () => {
    expect(containsLink(`ht${ZERO_WIDTH}tps://x`)).toBe(true);
    expect(containsLink(`toko${ZERO_WIDTH}.${ZERO_WIDTH}com`)).toBe(true);
    expect(containsLink(`${BIDI_OVERRIDE}moc.ekot`)).toBe(false); // teks terbalik biasa bukan alamat
    expect(containsLink("ｗｗｗ．ｐｒｏｍｏ．ｃｏｍ")).toBe(true); // lebar penuh disamakan oleh NFKC
    expect(containsLink("ｈｔｔｐｓ：／／ｘ．ｃｏｍ")).toBe(true);
  });

  it("menolak tautan di judul, bukan hanya di isi", () => {
    expect(validateAnnouncementContent({ title: "Promo di toko.com", body: "Diskon besar" })).toEqual({
      ok: false,
      problem: "LINK_NOT_ALLOWED"
    });
  });

  it.each([
    "Terima kasih. Info lebih lanjut ada di aplikasi.",
    "Pembayaran sudah diterima. Id pengguna Anda tidak berubah.",
    "Data: paket 5 GB tersedia.",
    "Promo top up Rp 100.000 sampai 30 November 2026, berlaku 1.000 pengguna pertama.",
    "Layanan PLN dan BPJS normal kembali pukul 08.00 WIB.",
    "Selamat Hari Raya! Driver tetap melayani pukul 06.00-22.00.",
    "Hubungi bantuan lewat menu Akun > Tiket Bantuan."
  ])("mengizinkan kalimat biasa: %s", (text) => {
    expect(containsLink(text)).toBe(false);
    expect(validateAnnouncementContent({ title: "Informasi layanan", body: text }).ok).toBe(true);
  });

  it("menormalkan: membuang karakter tak terlihat, merapikan baris, memangkas spasi", () => {
    expect(normalizeAnnouncementText(`  Halo${ZERO_WIDTH}\r\n\r\n\r\n\r\nDunia  `)).toBe("Halo\n\nDunia");
    const result = validateAnnouncementContent({ title: "  Judul \n panjang ", body: "Isi\n\n\n\nakhir" });
    expect(result).toEqual({ ok: true, title: "Judul panjang", body: "Isi\n\nakhir" });
  });

  it("memeriksa wajib isi dan batas panjang setelah normalisasi", () => {
    expect(validateAnnouncementContent({ title: "   ", body: "Isi" })).toEqual({ ok: false, problem: "TITLE_REQUIRED" });
    expect(validateAnnouncementContent({ title: "Judul", body: ZERO_WIDTH })).toEqual({ ok: false, problem: "BODY_REQUIRED" });
    expect(validateAnnouncementContent({ title: "a".repeat(ANNOUNCEMENT_TITLE_MAX + 1), body: "Isi" })).toEqual({
      ok: false,
      problem: "TITLE_TOO_LONG"
    });
    expect(validateAnnouncementContent({ title: "Judul", body: "a".repeat(ANNOUNCEMENT_BODY_MAX + 1) })).toEqual({
      ok: false,
      problem: "BODY_TOO_LONG"
    });
    expect(validateAnnouncementContent({ title: "a".repeat(ANNOUNCEMENT_TITLE_MAX), body: "b".repeat(ANNOUNCEMENT_BODY_MAX) }).ok).toBe(true);
  });
});
