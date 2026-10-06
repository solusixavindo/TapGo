/**
 * Pemanggilan kanal web membership (Stage R2.6 jalur A).
 *
 * Seluruh permintaan pembelian menuju namespace /api/v1/web/membership/*, kanal
 * yang memang diizinkan menjual. Kanal aplikasi mobile tetap tertutup.
 *
 * Backend mengembalikan bentuk baris database apa adanya. Berkas ini yang
 * menerjemahkannya menjadi bentuk tampilan, supaya komponen tidak perlu tahu
 * nama kolom maupun cara Prisma membuat serial angka Decimal.
 */
import { prepareImageForUpload } from "./image-prep";

export const API_BASE =
  process.env.NEXT_PUBLIC_TAPGO_API_BASE_URL ?? "https://api.tapgolion.id/api/v1";

/**
 * Mode tinjauan tampilan.
 *
 * Menyala hanya bila disetel eksplisit saat build. Halaman yang memakainya
 * WAJIB menampilkan penanda DATA CONTOH agar tidak dapat disalahartikan sebagai
 * transaksi nyata.
 */
export const PREVIEW_MODE =
  process.env.NEXT_PUBLIC_TAPGO_UPGRADE_PREVIEW === "true";

export const TOKEN_KEY = "tapgo.upgrade.token";
/** Token akses hanya hidup 15 menit; refresh token menyambungnya tanpa meminta masuk ulang. */
export const REFRESH_KEY = "tapgo.upgrade.refreshToken";
/** Pesan singkat untuk halaman masuk setelah sesi benar-benar habis. */
export const NOTICE_KEY = "tapgo.upgrade.notice";
/** Foto profil gagal terunggah saat pengajuan (ditampilkan di halaman pembayaran). */
export const AVATAR_FAILED_KEY = "tapgo.upgrade.avatarFailed";
export const PACKAGE_KEY = "tapgo.upgrade.packageId";
export const ORDER_KEY = "tapgo.upgrade.orderId";

/**
 * Paket yang ditunjuk pengunjung dari halaman depan.
 *
 * Menyimpan TIER, bukan id paket: halaman depan adalah HTML statis yang tidak
 * mengenal id dari basis data, sedangkan tier ("SILVER" / "GOLD" / "PLATINUM")
 * stabil di kedua sisi.
 *
 * Nilainya hanya petunjuk awal. Pengunjung tetap bebas memilih paket lain, dan
 * pilihan yang benar-benar dipakai tetap PACKAGE_KEY yang ditulis saat menekan
 * lanjut.
 */
export const PACKAGE_HINT_KEY = "tapgo.upgrade.packageHint";

export type MembershipPackage = {
  id: string;
  name: string;
  tier: string;
  price: number;
  benefits: string[];
};

/**
 * Menerjemahkan petunjuk tier dari halaman depan menjadi id paket yang nyata.
 *
 * Dipisah sebagai fungsi murni supaya dapat diperiksa tanpa merender komponen —
 * aplikasi ini belum punya perkakas uji, dan memasangnya berisiko merusak
 * node_modules worktree.
 *
 * Mengembalikan string kosong bila petunjuknya kosong atau tidak cocok dengan
 * satu pun paket. Pemanggil WAJIB memperlakukan itu sebagai "tidak ada pilihan
 * awal", bukan sebagai galat: daftar paket dapat berubah kapan saja di sisi
 * server, dan petunjuk basi tidak boleh menghalangi pengunjung memilih sendiri.
 */
export function matchPackageByTier(
  packages: MembershipPackage[],
  hint: string
): string {
  const wanted = hint.trim().toUpperCase();
  if (!wanted) return "";
  const found = packages.find(
    (item) => (item.tier ?? "").trim().toUpperCase() === wanted
  );
  return found ? found.id : "";
}

export type UpgradeOrderStatus =
  | "PENDING"
  | "PAID_AWAITING_VERIFICATION"
  | "ACTIVE"
  | "REJECTED_REFUNDING"
  | "EXPIRED"
  | "CANCELLED";

export type UpgradeOrder = {
  id: string;
  reference: string;
  packageName: string;
  amount: number;
  status: UpgradeOrderStatus;
  createdAt: string;
  invoiceNumber: string;
  buyerName: string;
  /** Permintaan perbaikan dokumen dari admin; null bila tidak ada. */
  correction: { reason: string; resubmitted: boolean } | null;
};

export type PaymentHandoff = {
  /** Halaman pembayaran penyedia. Kosong bila pembayaran sudah lunas. */
  redirectUrl: string;
  /** True hanya pada mode sandbox tanpa kredensial penyedia. */
  alreadyPaid: boolean;
};

/**
 * Penyimpanan sementara antar langkah.
 *
 * sessionStorage, bukan localStorage: token ikut hilang begitu tab ditutup.
 * Hanya boleh dipanggil dari komponen klien.
 */
export function readSession(key: string): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(key) ?? "";
}

export function writeSession(key: string, value: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, value);
}

export function clearSession(...keys: string[]) {
  if (typeof window === "undefined") return;
  for (const key of keys) {
    window.sessionStorage.removeItem(key);
  }
}

/** Bentuk mentah dari server. Sengaja longgar: hanya kolom yang dipakai. */
type RawMembership = {
  id: string;
  tier: string;
  name: string;
  price: unknown;
  activeLevels?: number | null;
  ppobBalance?: unknown;
  bpjsBenefit?: string | null;
  businessRight?: string | null;
  merchandise?: unknown;
};

type RawOrder = {
  id: string;
  status: string;
  totalAmount: unknown;
  createdAt: string;
  registrationData?: Record<string, unknown> | null;
  membership?: { name?: string | null } | null;
  invoice?: { number?: string | null } | null;
  userMembership?: { status?: string | null } | null;
  user?: { fullName?: string | null } | null;
};

/** Prisma membuat serial kolom Decimal sebagai string, bukan number. */
function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Galat dari server dengan kode stabilnya. Halaman memakai [code] untuk
 * menentukan tindakan (mis. melanjutkan pengajuan yang menggantung) dan
 * pesan berbahasa Indonesia untuk tampilan.
 */
export class UpgradeApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "", status = 0) {
    super(message);
    this.name = "UpgradeApiError";
    this.code = code;
    this.status = status;
  }
}

/** Kode server yang pesannya berbahasa Inggris dipetakan ke kalimat Indonesia. */
const FRIENDLY_MESSAGES: Record<string, string> = {
  MEMBERSHIP_ORDER_PENDING:
    "Anda masih memiliki pengajuan membership yang belum dibayar.",
  MEMBERSHIP_ALREADY_ACTIVATED: "Paket membership ini sudah aktif.",
  VALIDATION_ERROR: "Data belum sesuai. Periksa isian lalu coba lagi.",
  RATE_LIMITED: "Terlalu banyak percobaan. Coba lagi beberapa saat lagi."
};

const NETWORK_MESSAGE =
  "Tidak dapat terhubung ke server. Periksa koneksi internet Anda lalu coba lagi.";
const SESSION_EXPIRED_MESSAGE = "Sesi Anda berakhir. Silakan masuk kembali.";

/**
 * fetch dengan galat jaringan yang ramah. Peramban melaporkan SEMUA kegagalan
 * tingkat jaringan (putus, DNS, ditolak CORS, 413 dari nginx tanpa header CORS)
 * sebagai TypeError "Failed to fetch"; teks itu tidak boleh sampai ke pengguna.
 */
async function send(url: string, init: RequestInit, networkMessage = NETWORK_MESSAGE): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new UpgradeApiError(networkMessage, "NETWORK", 0);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let refreshInFlight: Promise<string> | null = null;

/** Sesi habis total: bersihkan, titipkan pesan untuk halaman masuk, lalu kembali ke sana. */
function endSession(): never {
  clearSession(TOKEN_KEY, REFRESH_KEY);
  if (typeof window !== "undefined") {
    writeSession(NOTICE_KEY, SESSION_EXPIRED_MESSAGE);
    const home = window.location.pathname.startsWith("/topup") ? "/topup/" : "/upgrade/";
    window.setTimeout(() => window.location.replace(home), 1200);
  }
  throw new UpgradeApiError(SESSION_EXPIRED_MESSAGE, "SESSION_EXPIRED", 401);
}

/**
 * Menukar refresh token dengan token akses baru. Refresh token sekali pakai:
 * (1) bila penyimpanan sudah berisi token yang lebih baru (permintaan lain
 * sudah menyegarkan), pakai itu tanpa jaringan; (2) satu penyegaran dipakai
 * bersama permintaan serentak; (3) jawaban 409 berarti permintaan lain baru
 * saja merotasi, pakai hasil yang tersimpan. Bila tidak ada jalan lagi: sesi habis.
 */
async function refreshAccessToken(failedToken: string): Promise<string> {
  const latest = readSession(TOKEN_KEY);
  if (latest && latest !== failedToken) return latest;
  const refreshToken = readSession(REFRESH_KEY);
  if (!refreshToken) return endSession();
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await send(`${API_BASE}/web/auth/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken }),
          credentials: "omit"
        });
        if (response.status === 409) {
          await sleep(300);
          const after = readSession(TOKEN_KEY);
          if (after && after !== failedToken) return after;
        }
        const payload = (await response.json().catch(() => ({}))) as {
          data?: { accessToken?: string; refreshToken?: string };
        };
        const next = payload.data;
        if (!response.ok || !next?.accessToken || !next.refreshToken) return endSession();
        writeSession(TOKEN_KEY, next.accessToken);
        writeSession(REFRESH_KEY, next.refreshToken);
        return next.accessToken;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/**
 * Permintaan berotentikasi: memakai token tersimpan terkini (halaman membaca
 * token sekali saat dimuat dan bisa basi), dan bila server menjawab 401 menukar
 * refresh token lalu mengulang SEKALI.
 */
async function sendAuthed(
  url: string,
  init: RequestInit,
  networkMessage?: string,
  requireAuth = false
): Promise<Response> {
  const headers = new Headers(init.headers);
  const passed = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Hanya permintaan yang MEMBAWA token (atau yang ditandai requireAuth, mis.
  // unggahan yang memakai token tersimpan) diperlakukan berotentikasi. Masuk
  // (login) tanpa token tidak boleh memicu penyegaran: 401-nya berarti password
  // salah, bukan sesi habis.
  if (!passed && !requireAuth) return send(url, init, networkMessage);
  const token = readSession(TOKEN_KEY) || passed;
  if (!token) return endSession();

  headers.set("authorization", `Bearer ${token}`);
  const first = await send(url, { ...init, headers }, networkMessage);
  if (first.status !== 401) return first;

  const renewed = await refreshAccessToken(token);
  headers.set("authorization", `Bearer ${renewed}`);
  return send(url, { ...init, headers }, networkMessage);
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sendAuthed(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    credentials: "omit"
  });
  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    message?: string;
    code?: string;
  };
  if (!response.ok || payload.success === false) {
    // Kode yang dikenal dipetakan ke kalimat Indonesia; selebihnya pesan server
    // dipakai apa adanya. Tidak pernah menampilkan exception mentah atau detail
    // internal kepada pengguna.
    const code = payload.code ?? "";
    throw new UpgradeApiError(
      FRIENDLY_MESSAGES[code] ?? payload.message ?? "Permintaan belum dapat diproses.",
      code,
      response.status
    );
  }
  return payload.data as T;
}

export async function login(phone: string, password: string) {
  // Login lewat kanal WEB (R2.9/K1c): token yang diterbitkan distempel
  // channel="WEB" oleh server, sehingga sah untuk rute /web/membership dan
  // tidak dapat dipakai menembak fitur app (ojek/PPOB).
  const result = await request<{ accessToken: string; refreshToken?: string }>("/web/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password })
  });
  // Refresh token ikut disimpan supaya sesi tidak mati di tengah mengisi
  // formulir atau menunggu pembayaran (token akses hanya 15 menit).
  writeSession(TOKEN_KEY, result.accessToken);
  if (result.refreshToken) writeSession(REFRESH_KEY, result.refreshToken);
  return result;
}

export async function listPackages(): Promise<MembershipPackage[]> {
  const result = await request<RawMembership[]>("/web/membership/packages");
  return result
    // Basic adalah paket bawaan setiap akun; tidak ada yang perlu diupgrade ke sana.
    .filter((item) => item.tier !== "BASIC")
    .map(toPackage)
    .sort((left, right) => left.price - right.price);
}

export async function createOrder(
  token: string,
  packageId: string,
  registrationData: Record<string, unknown>
): Promise<UpgradeOrder> {
  const result = await request<RawOrder>("/web/membership/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ packageId, registrationData })
  });
  return toOrder(result);
}

/** Daftar pengajuan milik akun yang sedang masuk, terbaru dulu. */
export async function listMyOrders(token: string): Promise<UpgradeOrder[]> {
  const result = await request<RawOrder[] | { items?: RawOrder[] }>(
    "/web/membership/orders/me",
    { headers: { authorization: `Bearer ${token}` } }
  );
  const rows = Array.isArray(result) ? result : (result.items ?? []);
  return rows
    .map(toOrder)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Pengajuan terbaru yang masih menunggu pembayaran, atau null. */
export function pickPendingOrder(orders: UpgradeOrder[]): UpgradeOrder | null {
  return orders.find((order) => order.status === "PENDING") ?? null;
}

const UPLOAD_NETWORK_MESSAGE =
  "Foto belum terkirim. Periksa koneksi internet Anda lalu coba lagi.";
const UPLOAD_TOO_LARGE_MESSAGE =
  "Ukuran foto terlalu besar untuk diunggah. Coba pilih foto yang lebih kecil.";

async function postImage(
  path: string,
  file: File,
  fallbackMessage: string
): Promise<void> {
  // Pengaman terakhir: foto selalu diperkecil sebelum dikirim, apa pun jalur
  // yang memanggil (server membatasi badan permintaan 1 MB).
  let ready: File;
  try {
    ready = await prepareImageForUpload(file);
  } catch (caught) {
    throw new UpgradeApiError(
      caught instanceof Error ? caught.message : fallbackMessage,
      "IMAGE_INVALID",
      0
    );
  }
  const response = await sendAuthed(
    `${API_BASE}${path}`,
    {
      method: "POST",
      headers: { "content-type": ready.type },
      body: ready,
      credentials: "omit"
    },
    UPLOAD_NETWORK_MESSAGE,
    true
  );
  if (!response.ok) {
    if (response.status === 413) {
      throw new UpgradeApiError(UPLOAD_TOO_LARGE_MESSAGE, "PAYLOAD_TOO_LARGE", 413);
    }
    const payload = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
    throw new UpgradeApiError(payload.message ?? fallbackMessage, payload.code ?? "", response.status);
  }
}

export async function uploadDocument(
  token: string,
  orderId: string,
  type: "ktp" | "selfie",
  file: File
) {
  void token; // token tersimpan dibaca terkini oleh sendAuthed
  await postImage(
    `/web/membership/orders/${encodeURIComponent(orderId)}/documents/${type}`,
    file,
    "Dokumen belum dapat diunggah."
  );
}

/**
 * Mengunggah foto profil (opsional). Sumbernya SAMA dengan aplikasi Play Store
 * (POST /account/avatar), sehingga foto ini juga tampil di aplikasi. Terpisah
 * dari dokumen verifikasi: foto KTP/swafoto tidak pernah dijadikan foto profil.
 */
export async function uploadAvatar(token: string, file: File) {
  void token;
  await postImage("/account/avatar", file, "Foto profil belum dapat diunggah.");
}

export async function payOrder(token: string, orderId: string): Promise<PaymentHandoff> {
  const result = await request<{ redirectUrl?: string | null; paid?: boolean }>(
    `/web/membership/orders/${orderId}/pay`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({})
    }
  );
  return {
    redirectUrl: result.redirectUrl ?? "",
    alreadyPaid: result.paid === true
  };
}

export type ReferralSummary = {
  referralCode: string;
  referralLink: string;
  membershipTier: string;
  directDownlines: number;
  totalDownlines: number;
  totalCommission: number;
};

export type ReferralTeamMember = {
  userId: string;
  fullName: string;
  referralCode: string;
  level: number;
  membershipTier: string;
  joinedAt: string;
};

type RawReferralSummary = {
  referralCode: string;
  referralLink: string;
  membershipTier: string;
  directDownlines: number;
  totalDownlines: number;
  totalCommission: unknown;
};

/**
 * GET /referrals/summary dan /referrals/tree hidup di luar namespace
 * /web/membership/*, tapi tetap satu backend yang sama dan tidak dibatasi
 * channel (lihat referralRouter.use(requireAuth) tanpa requireChannel di
 * apps/backend/src/modules/referrals/presentation/referral.routes.ts) —
 * token WEB dari /web/auth/login sah dipakai di sini.
 */
export async function getReferralSummary(token: string): Promise<ReferralSummary> {
  const result = await request<RawReferralSummary>("/referrals/summary", {
    headers: { authorization: `Bearer ${token}` }
  });
  return { ...result, totalCommission: toNumber(result.totalCommission) };
}

export async function getReferralTeam(token: string): Promise<ReferralTeamMember[]> {
  return request<ReferralTeamMember[]>("/referrals/tree?maxLevel=10", {
    headers: { authorization: `Bearer ${token}` }
  });
}

export type CommissionHistoryItem = {
  id: string;
  type: string;
  status: string;
  level: number;
  amount: number;
  createdAt: string;
};

type RawCommissionHistoryItem = {
  id: string;
  type: string;
  status: string;
  level: number;
  amount: unknown;
  createdAt: string;
};

/**
 * GET /referrals/commissions — riwayat komisi milik pengguna yang login
 * sendiri (beneficiaryId = user dari token), dipaginasi. Endpoint ini sudah
 * ada di backend sejak lama untuk keperluan lain; dipakai apa adanya di sini,
 * bukan endpoint baru.
 */
export async function getCommissionHistory(
  token: string,
  page: number,
  pageSize: number
): Promise<CommissionHistoryItem[]> {
  const result = await request<RawCommissionHistoryItem[]>(
    `/referrals/commissions?page=${page}&pageSize=${pageSize}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  return result.map((item) => ({ ...item, amount: toNumber(item.amount) }));
}

export async function getOrder(token: string, orderId: string): Promise<UpgradeOrder> {
  const result = await request<RawOrder>(`/web/membership/orders/${orderId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  return toOrder(result);
}

type RawMyMembership = {
  status: "ACTIVE" | "EMPTY";
  membership: { membership?: { tier?: string; name?: string } | null } | null;
};

/**
 * Tier keanggotaan yang sedang aktif untuk pengguna yang login.
 *
 * Setiap akun punya membership (default BASIC bila belum pernah upgrade),
 * jadi "EMPTY" secara praktis tidak pernah terjadi untuk akun yang sudah
 * berhasil login — tetap ditangani agar pemanggil tidak perlu menebak.
 */
export async function getCurrentMembershipTier(token: string): Promise<string> {
  const result = await request<RawMyMembership>("/web/membership/me", {
    headers: { authorization: `Bearer ${token}` }
  });
  return result.membership?.membership?.tier ?? "BASIC";
}

function toPackage(raw: RawMembership): MembershipPackage {
  const benefits: string[] = [];
  const ppob = toNumber(raw.ppobBalance);
  if (ppob > 0) {
    benefits.push(`Saldo PPOB awal ${formatAmount(ppob)}`);
  }
  if (raw.activeLevels && raw.activeLevels > 0) {
    benefits.push(`Bonus referral sampai tingkat ${raw.activeLevels}`);
  }
  if (raw.bpjsBenefit) {
    benefits.push(raw.bpjsBenefit);
  }
  if (raw.businessRight) {
    benefits.push(raw.businessRight);
  }
  if (Array.isArray(raw.merchandise)) {
    for (const item of raw.merchandise) {
      if (typeof item === "string" && item.trim()) {
        benefits.push(item.trim());
      }
    }
  }

  return {
    id: raw.id,
    name: raw.name,
    tier: raw.tier,
    price: toNumber(raw.price),
    benefits
  };
}

function toCorrection(raw: RawOrder): UpgradeOrder["correction"] {
  const value = raw.registrationData?.documentCorrection;
  if (!value || typeof value !== "object") return null;
  const data = value as { reason?: unknown; resubmittedAt?: unknown };
  return {
    reason: typeof data.reason === "string" ? data.reason : "",
    resubmitted: Boolean(data.resubmittedAt)
  };
}

function toOrder(raw: RawOrder): UpgradeOrder {
  const invoiceNumber = raw.invoice?.number ?? "";
  return {
    id: raw.id,
    // Nomor invoice adalah nomor yang dilihat pengguna di bukti bayar, jadi itu
    // yang dipakai sebagai nomor pengajuan. UUID order tidak pernah ditampilkan.
    reference: invoiceNumber || raw.id,
    packageName: raw.membership?.name ?? "",
    amount: toNumber(raw.totalAmount),
    status: toViewStatus(raw),
    createdAt: raw.createdAt,
    invoiceNumber,
    buyerName: raw.user?.fullName ?? "",
    correction: toCorrection(raw)
  };
}

/**
 * Menurunkan status tampilan dari keadaan order di server.
 *
 * Sejak Stage R2.6 jalur A, PAID tidak lagi berarti aktif: pembelian dari web
 * baru aktif setelah admin memverifikasi dokumen. Karena itu status tampilan
 * tidak dapat dipetakan satu-lawan-satu dari kolom status.
 */
function toViewStatus(raw: RawOrder): UpgradeOrderStatus {
  const rejected = Boolean(raw.registrationData?.documentRejection);

  switch (raw.status) {
    case "PENDING":
      return "PENDING";
    case "PAID":
      return raw.userMembership?.status === "ACTIVE"
        ? "ACTIVE"
        : "PAID_AWAITING_VERIFICATION";
    case "CANCELLED":
      // Dibatalkan karena dokumen ditolak berarti ada dana yang harus kembali.
      // Itu pesan yang sangat berbeda dari pembatalan biasa.
      return rejected ? "REJECTED_REFUNDING" : "CANCELLED";
    case "EXPIRED":
    case "FAILED":
      return "EXPIRED";
    default:
      return "PENDING";
  }
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(value);
}

/** Data contoh untuk tinjauan tampilan. Tidak pernah dipakai di produksi. */
export const PREVIEW_PACKAGES: MembershipPackage[] = [
  {
    id: "pkg-silver",
    name: "Silver",
    tier: "SILVER",
    price: 500000,
    benefits: [
      "Kaos TAPGO",
      "Saldo PPOB awal Rp100.000",
      "BPJS Ketenagakerjaan JKK dan JKM (gratis 1 bulan pertama)"
    ]
  },
  {
    id: "pkg-gold",
    name: "Gold",
    tier: "GOLD",
    price: 3000000,
    benefits: [
      "Kaos TAPGO",
      "Rompi TAPGO",
      "Banner TAPGO",
      "Saldo PPOB awal Rp600.000",
      "BPJS Ketenagakerjaan JKK dan JKM 1 tahun"
    ]
  },
  {
    id: "pkg-platinum",
    name: "Platinum",
    tier: "PLATINUM",
    price: 5500000,
    benefits: [
      "Kaos TAPGO",
      "Rompi TAPGO",
      "Banner TAPGO",
      "Saldo PPOB awal Rp1.000.000",
      "BPJS Ketenagakerjaan 1 tahun (JKK, JKM, JHT)"
    ]
  }
];

/** Data contoh untuk tinjauan tampilan. Tidak pernah dipakai di produksi. */
export const PREVIEW_REFERRAL_SUMMARY: ReferralSummary = {
  referralCode: "TAPGO-BUDI01",
  referralLink: "https://tapgolion.id/r/TAPGO-BUDI01",
  membershipTier: "GOLD",
  directDownlines: 4,
  totalDownlines: 11,
  totalCommission: 850000
};

/** Data contoh untuk tinjauan tampilan. Tidak pernah dipakai di produksi. */
export const PREVIEW_REFERRAL_TEAM: ReferralTeamMember[] = [
  { userId: "u1", fullName: "Siti Aminah", referralCode: "TAPGO-SITI01", level: 1, membershipTier: "SILVER", joinedAt: "2026-07-02T09:00:00.000Z" },
  { userId: "u2", fullName: "Ahmad Fauzi", referralCode: "TAPGO-AHMAD1", level: 1, membershipTier: "GOLD", joinedAt: "2026-07-15T09:00:00.000Z" },
  { userId: "u3", fullName: "Dewi Lestari", referralCode: "TAPGO-DEWI01", level: 2, membershipTier: "SILVER", joinedAt: "2026-08-01T09:00:00.000Z" }
];

/** Data contoh untuk tinjauan tampilan. Tidak pernah dipakai di produksi. */
export const PREVIEW_COMMISSIONS: CommissionHistoryItem[] = [
  { id: "c1", type: "SPONSOR_BONUS", status: "PAID", level: 1, amount: 40000, createdAt: "2026-08-20T09:00:00.000Z" },
  { id: "c2", type: "LEVEL_COMMISSION", status: "PAID", level: 2, amount: 15000, createdAt: "2026-08-15T09:00:00.000Z" },
  { id: "c3", type: "REWARD_BONUS", status: "PENDING", level: 1, amount: 25000, createdAt: "2026-08-01T09:00:00.000Z" }
];
