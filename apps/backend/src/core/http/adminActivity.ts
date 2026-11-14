import { Request } from "express";

/**
 * Catatan aktivitas admin yang rinci untuk pemilik (Super Admin VIP): setiap tombol yang ditekan di konsol menjadi satu
 * baris audit berisi siapa, apa (dalam bahasa operator), kapan, dari mana, hasilnya, dan isian yang dikirim.
 *
 * Murni dan dapat diuji: pemetaan rute -> kalimat, penyamaran isian rahasia, dan keputusan baris mana yang dicatat.
 * Penulisan ke database ada di auditRequestLogger.
 */

/** Pola rute admin (setelah /api/v1/admin) -> kalimat. Yang tidak terdaftar tampil sebagai "METODE /rute". */
const LABELS: Array<[RegExp, string, string]> = [
  // [metode-dan-rute, kalimat, ""]
  [/^POST \/withdrawals\/:id\/approve$/, "Menyetujui penarikan dana", ""],
  [/^POST \/withdrawals\/:id\/reject$/, "Menolak penarikan dana", ""],
  [/^POST \/withdrawals\/:id\/paid$/, "Menandai penarikan sudah ditransfer", ""],
  [/^POST \/withdraw-requests\/:id\/(approve|reject)$/, "Memproses penarikan dana (jalur lama)", ""],
  [/^POST \/manual-topups\/:id\/confirm$/, "Mengonfirmasi top up manual", ""],
  [/^POST \/manual-topups\/:id\/reject$/, "Menolak top up manual", ""],
  [/^GET \/manual-topups$/, "Membuka daftar top up manual", ""],
  [/^POST \/member-requests\/:id\/approve$/, "Mengonfirmasi pembayaran membership secara manual", ""],
  [/^POST \/member-requests\/:id\/confirm-transfer$/, "Mengonfirmasi transfer membership", ""],
  [/^POST \/member-requests\/:id\/verify-documents$/, "Memverifikasi dokumen member", ""],
  [/^POST \/member-requests\/:id\/reject-documents$/, "Menolak dokumen member", ""],
  [/^POST \/member-requests\/:id\/request-correction$/, "Meminta perbaikan dokumen member", ""],
  [/^POST \/member-requests\/:id\/reject$/, "Menolak/membatalkan pengajuan member", ""],
  [/^POST \/member-requests\/:id\/execute-refund$/, "Menjalankan refund membership", ""],
  [/^POST \/member-requests\/:id\/confirm-manual-refund$/, "Mengonfirmasi refund manual membership", ""],
  [/^GET \/member-requests\/:id\/documents\/:type$/, "Melihat dokumen identitas member", ""],
  [/^GET \/member-requests\/:id\/documents$/, "Membuka daftar dokumen member", ""],
  [/^GET \/member-requests$/, "Membuka antrean Persetujuan Member", ""],
  [/^GET \/drivers\/:id\/documents\/:type$/, "Melihat dokumen driver", ""],
  [/^GET \/drivers\/:id\/documents$/, "Membuka daftar dokumen driver", ""],
  [/^POST \/rewards\/:id\/approve$/, "Menyetujui hadiah milestone", ""],
  [/^POST \/rewards\/:id\/reject$/, "Menolak hadiah milestone", ""],
  [/^POST \/rewards\/:id\/mark-paid$/, "Menandai hadiah milestone dibayar", ""],
  [/^POST \/driver-incentives$/, "Membuat aturan insentif driver", ""],
  [/^PATCH \/driver-incentives\/:id$/, "Mengubah aturan insentif driver", ""],
  [/^POST \/driver-incentives\/claims\/:id\/approve$/, "Menyetujui klaim insentif driver", ""],
  [/^POST \/driver-incentives\/claims\/:id\/reject$/, "Menolak klaim insentif driver", ""],
  [/^POST \/driver-incentives\/claims\/:id\/reverse$/, "Membalikkan klaim insentif driver", ""],
  [/^POST \/profit-sharing\/periods$/, "Membuat periode bagi hasil", ""],
  [/^POST \/profit-sharing\/periods\/:id\/approve$/, "Menyetujui periode bagi hasil", ""],
  [/^POST \/profit-sharing\/periods\/:id\/distribute$/, "Membagikan laba", ""],
  [/^PUT \/roles\/:id$/, "Mengubah role admin", ""],
  [/^PUT \/members\/:id\/status$/, "Mengubah status akun member", ""],
  [/^GET \/members\/:id$/, "Melihat detail member", ""],
  [/^GET \/members$/, "Membuka Direktori Member", ""],
  [/^GET \/wallets\/:id\/transactions$/, "Melihat riwayat saldo seorang member", ""],
  [/^GET \/wallets$/, "Membuka daftar saldo member", ""],
  [/^PATCH \/rides\/drivers\/:id\/status$/, "Mengubah status driver", ""],
  [/^PATCH \/rides\/:id\/status$/, "Mengoreksi status perjalanan", ""],
  [/^PATCH \/rides\/vehicles\/:id\/verification$/, "Mengubah verifikasi kendaraan", ""],
  [/^POST \/driver-review\/applications\/:id\/(approve|reject|claim|renew|release)$/, "Memproses pengajuan driver", ""],
  [/^POST \/delete-requests\/:id\/complete$/, "Menghapus akun anggota", ""],
  [/^POST \/delete-requests\/:id\/reject$/, "Menolak permintaan hapus akun", ""],
  [/^GET \/delete-requests/, "Membuka permintaan hapus akun", ""],
  [/^POST \/account-assist\//, "Membantu pemulihan akun", ""],
  [/^GET \/account-assist\//, "Mencari akun untuk bantuan", ""],
  [/^PUT \/service-suspension/, "Mengubah status layanan aplikasi", ""],
  [/^GET \/reports\/([a-z-]+)\.(xlsx|csv)$/, "Mengunduh laporan", ""],
  [/^GET \/reports\//, "Membuka laporan keuangan", ""],
  [/^GET \/audit-logs\.(xlsx|csv)$/, "Mengunduh Log Aktivitas", ""],
  [/^GET \/online-payments$/, "Membuka Pembayaran Online", ""],
  [/^GET \/ppob\/transactions/, "Membuka Transaksi Digiflazz", ""],
  [/^GET \/system\//, "Membuka pemantauan sistem", ""],
  [/^GET \/withdrawals(\/:id)?$/, "Membuka daftar/detail penarikan dana", ""]
];

/** GET yang dipanggil otomatis oleh layar (penyegaran berkala) atau yang membaca log itu sendiri: tidak dicatat. */
const NOISY_GET = new Set([
  "/dashboard",
  "/dashboard/summary",
  "/dashboard/growth",
  "/dashboard/activity",
  "/dashboard/oversight",
  "/dashboard/insights",
  "/dashboard/documents-nearing-retention",
  "/reports/financial-summary",
  "/reports/ppob-summary",
  "/audit-logs",
  "/ppob/digiflazz-balance"
]);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SECRET_KEY = /pass(word)?|token|secret|otp|pin|authorization|cookie|signature|code$/i;
const MAX_VALUE = 300;
const MAX_KEYS = 40;

/** "/api/v1/admin/withdrawals/<uuid>/approve?x=1" -> { path: "/withdrawals/<uuid>/approve", template: "/withdrawals/:id/approve" } */
export function normalizeAdminPath(originalUrl: string) {
  const full = originalUrl.split("?")[0] ?? "";
  const path = full.replace(/^\/api\/v1\/admin/, "") || "/";
  const template = path
    .replace(UUID, ":id")
    .replace(/\/RID-[A-Z0-9]+/g, "/:id")
    .replace(/\/(?:\d{4,})(?=\/|$)/g, "/:id");
  return { path, template };
}

export function describeAdminRequest(method: string, template: string): string {
  const key = `${method.toUpperCase()} ${template}`;
  for (const [pattern, label] of LABELS) {
    if (pattern.test(key)) return label;
  }
  return key;
}

/** Salinan isian yang aman disimpan: rahasia disamarkan, teks panjang dipotong, jumlah kunci dibatasi. */
export function sanitizeBody(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== "object" || Buffer.isBuffer(body) || Array.isArray(body)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>).slice(0, MAX_KEYS)) {
    if (SECRET_KEY.test(key)) {
      out[key] = "***";
    } else if (typeof value === "string") {
      out[key] = value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value;
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    } else {
      let text = "";
      try {
        text = JSON.stringify(value);
      } catch {
        text = "[tidak dapat dibaca]";
      }
      out[key] = text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Query string yang aman: rahasia disamarkan. */
export function sanitizeQuery(query: unknown): Record<string, string> | undefined {
  if (!query || typeof query !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query as Record<string, unknown>).slice(0, MAX_KEYS)) {
    out[key] = SECRET_KEY.test(key) ? "***" : String(value).slice(0, 120);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export type AdminRequestRecord = {
  action: "ADMIN_REQUEST";
  entityType: "HTTP";
  entityId: string;
  metadata: Record<string, unknown>;
};

const recentGets = new Map<string, number>();
const GET_DEBOUNCE_MS = 30_000;

/**
 * Apakah request ini dicatat, dan bagaimana bentuk barisnya. null = tidak dicatat.
 * GET yang identik oleh admin yang sama dalam 30 detik dicatat sekali (muat ganda, klik beruntun).
 */
export function buildAdminRequestRecord(
  req: Pick<Request, "method" | "originalUrl" | "body" | "query" | "headers">,
  statusCode: number,
  durationMs: number,
  actorId: string,
  now = Date.now(),
  /** Isian MENTAH seperti dikirim klien (diambil sebelum validasi mengganti req.body dengan versi yang sudah dibersihkan). */
  rawBody: unknown = req.body
): AdminRequestRecord | null {
  const method = req.method.toUpperCase();
  if (method === "OPTIONS" || method === "HEAD") return null;
  const { path, template } = normalizeAdminPath(req.originalUrl);
  const readOnly = method === "GET";
  if (readOnly) {
    if (NOISY_GET.has(template)) return null;
    const key = `${actorId}|${req.originalUrl}`;
    const last = recentGets.get(key);
    if (last !== undefined && now - last < GET_DEBOUNCE_MS) return null;
    recentGets.set(key, now);
    if (recentGets.size > 5000) {
      for (const [k, t] of recentGets) if (now - t > GET_DEBOUNCE_MS) recentGets.delete(k);
    }
  }
  const label = describeAdminRequest(method, template);
  const body = readOnly ? undefined : sanitizeBody(rawBody);
  const query = sanitizeQuery(req.query);
  const ua = req.headers["user-agent"];
  return {
    action: "ADMIN_REQUEST",
    entityType: "HTTP",
    entityId: `${method} ${template}`.slice(0, 80),
    metadata: {
      label,
      method,
      path,
      statusCode,
      ok: statusCode < 400,
      readOnly,
      durationMs: Math.round(durationMs),
      ...(query ? { query } : {}),
      ...(body ? { body } : {}),
      ...(typeof ua === "string" ? { userAgent: ua.slice(0, 160) } : {})
    }
  };
}

/** Hanya untuk tes. */
export function resetAdminRequestDebounce() {
  recentGets.clear();
}
