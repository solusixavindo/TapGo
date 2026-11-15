/**
 * Aturan isi pengumuman pemilik (keputusan Owner 15 Nov 2026): teks polos, TANPA tautan.
 *
 * Alasannya keamanan: bila akun Super Admin VIP suatu saat dibobol, pengumuman adalah saluran paling efektif untuk
 * menyebar tautan penipuan ke seluruh pengguna. Aplikasi juga menampilkannya sebagai teks biasa (tidak dapat diketuk),
 * dan server menolak apa pun yang menyerupai alamat situs. Tautan baru boleh dibuka kelak hanya untuk domain
 * tapgolion.id lewat daftar putih eksplisit.
 *
 * Murni (tanpa database) supaya dapat diuji tuntas.
 */

export const ANNOUNCEMENT_TITLE_MAX = 80;
export const ANNOUNCEMENT_BODY_MAX = 1000;

/** Karakter kendali (kecuali baris baru) serta karakter lebar-nol dan pengubah arah teks yang dipakai menyamarkan tulisan. */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/** Skema/awalan alamat, atau nama situs dengan akhiran yang lazim dipakai penipuan dan pemendek tautan. */
const SCHEME =
  /\b(?:https?|ftp)\s*:|\b(?:file|intent|market|whatsapp|tg)\s*:\s*\/\/|\b(?:javascript|data|mailto|tel)\s*:\S/i;
const WWW = /\bwww\s*\./i;
/** Tanpa spasi di sekitar titik: "kasih. Info" (akhir kalimat) bukan alamat, "toko.com" adalah. */
const TLD =
  /[a-z0-9-]+\.(?:com|id|net|org|co|io|me|ly|xyz|link|app|top|info|biz|site|online|shop|click|cc|tk|ru|cn|vip|club|live|store|page|dev|ai|gl|to|gg|us|uk|in|my|sg|ph|asia|work|fun|win|bid|icu|cfd|sbs|lol|bar|cam|men|stream|download|cloud|tech|pro|space|website|digital|network)\b/i;
/** Alamat surel juga tidak diperlukan; pengguna diarahkan ke kanal resmi di aplikasi. */
const AT_HANDLE = /@[a-z0-9_.-]{3,}/i;

export type AnnouncementContentProblem = "TITLE_REQUIRED" | "BODY_REQUIRED" | "TITLE_TOO_LONG" | "BODY_TOO_LONG" | "LINK_NOT_ALLOWED";

export type NormalizedAnnouncementContent =
  | { ok: true; title: string; body: string }
  | { ok: false; problem: AnnouncementContentProblem };

export function normalizeAnnouncementText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function containsLink(value: string): boolean {
  // NFKC sudah menyamakan huruf lebar penuh (ｗｗｗ．ｇｏｏｇｌｅ．ｃｏｍ) menjadi huruf biasa.
  const text = normalizeAnnouncementText(value);
  return SCHEME.test(text) || WWW.test(text) || TLD.test(text) || AT_HANDLE.test(text);
}

export function validateAnnouncementContent(input: { title: string; body: string }): NormalizedAnnouncementContent {
  // Judul satu baris: semua jeda (baris baru, spasi ganda) dirapatkan menjadi satu spasi.
  const title = normalizeAnnouncementText(input.title).replace(/\s+/g, " ");
  const body = normalizeAnnouncementText(input.body);
  if (title.length === 0) return { ok: false, problem: "TITLE_REQUIRED" };
  if (body.length === 0) return { ok: false, problem: "BODY_REQUIRED" };
  if (title.length > ANNOUNCEMENT_TITLE_MAX) return { ok: false, problem: "TITLE_TOO_LONG" };
  if (body.length > ANNOUNCEMENT_BODY_MAX) return { ok: false, problem: "BODY_TOO_LONG" };
  if (containsLink(title) || containsLink(body)) return { ok: false, problem: "LINK_NOT_ALLOWED" };
  return { ok: true, title, body };
}

export const ANNOUNCEMENT_PROBLEM_MESSAGE: Record<AnnouncementContentProblem, string> = {
  TITLE_REQUIRED: "Judul pengumuman wajib diisi.",
  BODY_REQUIRED: "Isi pengumuman wajib diisi.",
  TITLE_TOO_LONG: `Judul maksimal ${ANNOUNCEMENT_TITLE_MAX} karakter.`,
  BODY_TOO_LONG: `Isi maksimal ${ANNOUNCEMENT_BODY_MAX} karakter.`,
  LINK_NOT_ALLOWED:
    "Pengumuman tidak boleh memuat tautan, alamat situs, atau alamat surel. Tulis tanpa tautan; arahkan pengguna membuka aplikasi."
};
