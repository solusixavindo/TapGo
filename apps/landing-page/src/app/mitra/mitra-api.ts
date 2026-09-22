/**
 * Klien API dashboard mitra.
 *
 * Semua permintaan memakai token kanal WEB dari /web/auth/login. Token akses
 * hanya hidup 15 menit, jadi berkas ini menyimpan refresh token dan
 * memperbaruinya otomatis satu kali saat server menjawab 401 — tanpa itu mitra
 * akan terlempar ke halaman masuk di tengah mengisi formulir pencairan.
 *
 * Penyimpanan memakai sessionStorage (hilang saat tab ditutup), sama seperti
 * alur upgrade dan top up. Data uang tidak pernah disimpan di sini.
 */
import { API_BASE } from "../upgrade/api";

export { API_BASE };

export const MITRA_PREVIEW =
  process.env.NEXT_PUBLIC_TAPGO_UPGRADE_PREVIEW === "true";

const SESSION_KEY = "tapgo.mitra.session";

export type MitraSession = {
  accessToken: string;
  refreshToken: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function readSession(): MitraSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MitraSession>;
    if (typeof parsed.accessToken === "string" && typeof parsed.refreshToken === "string") {
      return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
    }
  } catch {
    // Data rusak diperlakukan sebagai belum masuk.
  }
  return null;
}

function writeSession(session: MitraSession) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Penyimpanan diblokir: sesi tetap jalan selama halaman tidak dimuat ulang.
  }
}

export function clearSession() {
  clearAvatarCache();
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Tidak ada yang perlu dibersihkan.
  }
}

async function rawRequest<T>(
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(headers ?? {})
      },
      credentials: "omit"
    });
  } catch {
    throw new ApiError("Tidak dapat terhubung ke server. Periksa koneksi internet Anda.", 0, "NETWORK");
  }

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    message?: string;
    code?: string;
  };
  if (!response.ok || payload.success === false) {
    throw new ApiError(
      payload.message ?? "Permintaan belum dapat diproses.",
      response.status,
      payload.code ?? ""
    );
  }
  return payload.data as T;
}

let refreshInFlight: Promise<MitraSession> | null = null;

/**
 * Satu refresh dipakai bersama bila beberapa permintaan kedaluwarsa serentak.
 *
 * Refresh token sekali pakai: permintaan yang gagal 401 membawa salinan sesi
 * yang DIBACA SEBELUM refresh pertama selesai. Tanpa pemeriksaan di bawah,
 * permintaan itu menukar token yang sudah dikonsumsi dan server menganggapnya
 * pencurian (sesi dicabut → pengguna keluar sendiri). Karena itu: (1) bila
 * penyimpanan sudah berisi token yang lebih baru, pakai itu tanpa jaringan;
 * (2) bila server menjawab 409 (baru dirotasi permintaan lain), pakai hasil
 * yang tersimpan.
 */
function refreshSession(current: MitraSession): Promise<MitraSession> {
  const latest = readSession();
  if (latest && latest.refreshToken !== current.refreshToken) {
    return Promise.resolve(latest);
  }
  if (!refreshInFlight) {
    refreshInFlight = rawRequest<{ accessToken: string; refreshToken: string }>("/web/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: current.refreshToken })
    })
      .then((result) => {
        const next = { accessToken: result.accessToken, refreshToken: result.refreshToken };
        writeSession(next);
        return next;
      })
      .catch(async (caught) => {
        if (caught instanceof ApiError && caught.status === 409) {
          // Pemenang menyimpan hasilnya sesaat setelah kita menerima 409.
          await new Promise((resolve) => setTimeout(resolve, 300));
          const after = readSession();
          if (after && after.refreshToken !== current.refreshToken) return after;
        }
        throw caught;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = readSession();
  if (!session) throw new ApiError("Sesi berakhir. Silakan masuk kembali.", 401, "AUTH_REQUIRED");

  try {
    return await rawRequest<T>(path, { ...init, token: session.accessToken });
  } catch (caught) {
    if (!(caught instanceof ApiError) || caught.status !== 401) throw caught;
    let renewed: MitraSession;
    try {
      renewed = await refreshSession(session);
    } catch {
      clearSession();
      throw new ApiError("Sesi berakhir. Silakan masuk kembali.", 401, "AUTH_REQUIRED");
    }
    return rawRequest<T>(path, { ...init, token: renewed.accessToken });
  }
}

export function isAuthError(caught: unknown): boolean {
  return caught instanceof ApiError && caught.status === 401;
}

/* ------------------------------------------------------------------ */
/* Tipe tampilan                                                       */
/* ------------------------------------------------------------------ */

export type Profile = {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  referralCode: string;
};

export type WalletBalance = {
  balance: number;
  cashBalance: number;
  ppobBalance: number;
};

export type WalletTransaction = {
  id: string;
  type: string;
  amount: number;
  createdAt: string;
};

export type BankAccount = {
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
  updatedAt: string;
};

export type WithdrawalStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAID" | "CANCELLED";

export type Withdrawal = {
  id: string;
  amount: number;
  fee: number;
  finalAmount: number;
  status: WithdrawalStatus;
  bankName: string;
  accountNumber: string;
  requestedAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  rejectedAt: string | null;
  note: string;
};

export type ReferralSummary = {
  referralCode: string;
  referralLink: string;
  membershipTier: string;
  directDownlines: number;
  totalDownlines: number;
  totalCommission: number;
};

export type TeamMember = {
  userId: string;
  fullName: string;
  referralCode: string;
  level: number;
  membershipTier: string;
  joinedAt: string;
  hasAvatar: boolean;
};

export type Commission = {
  id: string;
  type: string;
  status: string;
  level: number;
  amount: number;
  createdAt: string;
};

/** Prisma membuat serial kolom Decimal sebagai string. */
function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/* ------------------------------------------------------------------ */
/* Endpoint                                                            */
/* ------------------------------------------------------------------ */

export async function login(phone: string, password: string): Promise<MitraSession> {
  const result = await rawRequest<{ accessToken: string; refreshToken: string }>("/web/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password })
  });
  const session = { accessToken: result.accessToken, refreshToken: result.refreshToken };
  writeSession(session);
  return session;
}

/** Cabut sesi di server bila masih bisa dijangkau; sesi lokal selalu dihapus. */
export async function logout() {
  try {
    await authed<void>("/auth/logout", { method: "POST" });
  } catch {
    // Token sudah mati atau jaringan putus: sesi lokal tetap dihapus.
  }
  clearSession();
}

export async function getProfile(): Promise<Profile> {
  const raw = await authed<Record<string, unknown>>("/auth/me");
  return {
    id: str(raw.id),
    fullName: str(raw.fullName),
    phone: str(raw.phone),
    email: typeof raw.email === "string" ? raw.email : null,
    referralCode: str(raw.referralCode)
  };
}

export async function getWallet(): Promise<WalletBalance> {
  const raw = await authed<Record<string, unknown>>("/web/wallet");
  return {
    balance: num(raw.balance),
    cashBalance: num(raw.cashBalance),
    ppobBalance: num(raw.ppobBalance)
  };
}

export async function getWalletTransactions(page: number, pageSize: number): Promise<WalletTransaction[]> {
  const raw = await authed<Array<Record<string, unknown>>>(
    `/web/wallet/transactions?page=${page}&pageSize=${pageSize}`
  );
  return raw.map((item) => ({
    id: str(item.id),
    type: str(item.type),
    amount: num(item.amount),
    createdAt: str(item.createdAt)
  }));
}

export async function getBankAccount(): Promise<BankAccount | null> {
  const raw = await authed<Record<string, unknown> | null>("/web/wallet/bank-account");
  if (!raw || !str(raw.accountNumber)) return null;
  return {
    bankName: str(raw.bankName),
    bankCode: str(raw.bankCode),
    accountNumber: str(raw.accountNumber),
    accountHolderName: str(raw.accountHolderName),
    updatedAt: str(raw.updatedAt)
  };
}

export async function saveBankAccount(input: {
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
}): Promise<BankAccount> {
  const raw = await authed<Record<string, unknown>>("/web/wallet/bank-account", {
    method: "PUT",
    body: JSON.stringify(input)
  });
  return {
    bankName: str(raw.bankName),
    bankCode: str(raw.bankCode),
    accountNumber: str(raw.accountNumber),
    accountHolderName: str(raw.accountHolderName),
    updatedAt: str(raw.updatedAt)
  };
}

export async function getWithdrawals(page: number, pageSize: number): Promise<Withdrawal[]> {
  const raw = await authed<Array<Record<string, unknown>>>(
    `/web/wallet/withdrawals?page=${page}&pageSize=${pageSize}`
  );
  return raw.map(toWithdrawal);
}

export async function requestWithdrawal(input: {
  amount: number;
  password: string;
  notes?: string;
}): Promise<Withdrawal> {
  const raw = await authed<Record<string, unknown>>("/web/wallet/withdrawals", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return toWithdrawal(raw);
}

function toWithdrawal(item: Record<string, unknown>): Withdrawal {
  const amount = num(item.amount);
  return {
    id: str(item.id),
    amount,
    fee: num(item.fee),
    finalAmount: item.finalAmount === undefined ? amount : num(item.finalAmount),
    status: (str(item.status) || "PENDING") as WithdrawalStatus,
    bankName: str(item.bankName),
    accountNumber: str(item.accountNumber),
    requestedAt: str(item.requestedAt),
    approvedAt: str(item.approvedAt) || null,
    paidAt: str(item.paidAt) || null,
    rejectedAt: str(item.rejectedAt) || null,
    note: str(item.note)
  };
}

export async function getReferralSummary(): Promise<ReferralSummary> {
  const raw = await authed<Record<string, unknown>>("/referrals/summary");
  return {
    referralCode: str(raw.referralCode),
    referralLink: str(raw.referralLink),
    membershipTier: str(raw.membershipTier) || "BASIC",
    directDownlines: num(raw.directDownlines),
    totalDownlines: num(raw.totalDownlines),
    totalCommission: num(raw.totalCommission)
  };
}

export async function getTeam(): Promise<TeamMember[]> {
  const raw = await authed<Array<Record<string, unknown>>>("/referrals/tree?maxLevel=10");
  return raw.map((item) => ({
    userId: str(item.userId),
    fullName: str(item.fullName),
    referralCode: str(item.referralCode),
    level: num(item.level),
    membershipTier: str(item.membershipTier) || "BASIC",
    joinedAt: str(item.joinedAt),
    hasAvatar: item.hasAvatar === true
  }));
}

export async function getCommissions(page: number, pageSize: number): Promise<Commission[]> {
  const raw = await authed<Array<Record<string, unknown>>>(
    `/referrals/commissions?page=${page}&pageSize=${pageSize}`
  );
  return raw.map((item) => ({
    id: str(item.id),
    type: str(item.type),
    status: str(item.status),
    level: num(item.level),
    amount: num(item.amount),
    createdAt: str(item.createdAt)
  }));
}

/** Mengganti password mencabut seluruh sesi, jadi pemanggil harus meminta masuk ulang. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await authed<void>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword })
  });
  clearSession();
}

const avatarCache = new Map<string, Promise<string | null>>();

/**
 * Foto anggota referral. Rutenya butuh token, jadi tidak bisa dipasang
 * langsung sebagai src gambar: berkas diunduh lalu dijadikan blob lokal.
 * Hasil (termasuk "tidak ada") di-cache selama halaman terbuka.
 */
export function getMemberAvatar(userId: string): Promise<string | null> {
  const cached = avatarCache.get(userId);
  if (cached) return cached;

  const request = (async () => {
    if (MITRA_PREVIEW) return previewAvatar(userId);
    const session = readSession();
    if (!session) return null;
    try {
      const response = await fetch(`${API_BASE}/referrals/members/${encodeURIComponent(userId)}/avatar`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
        credentials: "omit"
      });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) return null;
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  })();
  avatarCache.set(userId, request);
  return request;
}

/** Kunci cache foto profil milik pemilik sesi sendiri (bukan anggota referral). */
const SELF_AVATAR_KEY = "__self__";
const AVATAR_CHANGED_EVENT = "tapgo-avatar-changed";

/**
 * Permintaan berotentikasi yang mengembalikan Response mentah (untuk blob/berkas),
 * dengan pola refresh yang sama seperti authed().
 */
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = readSession();
  if (!session) throw new ApiError("Sesi berakhir. Silakan masuk kembali.", 401, "AUTH_REQUIRED");
  const call = (token: string) =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
      credentials: "omit"
    });
  const first = await call(session.accessToken);
  if (first.status !== 401) return first;
  let renewed: MitraSession;
  try {
    renewed = await refreshSession(session);
  } catch {
    clearSession();
    throw new ApiError("Sesi berakhir. Silakan masuk kembali.", 401, "AUTH_REQUIRED");
  }
  return call(renewed.accessToken);
}

/**
 * Foto profil milik sendiri. Sumbernya SAMA dengan aplikasi Play Store
 * (GET/POST /account/avatar, satu foto per akun): apa pun yang diunggah dari
 * aplikasi tampil di sini, dan sebaliknya.
 */
export function getOwnAvatar(): Promise<string | null> {
  const cached = avatarCache.get(SELF_AVATAR_KEY);
  if (cached) return cached;
  const request = (async () => {
    if (MITRA_PREVIEW) return previewAvatar("self");
    try {
      const response = await authedFetch("/account/avatar");
      if (!response.ok) return null;
      const blob = await response.blob();
      return blob.type.startsWith("image/") ? URL.createObjectURL(blob) : null;
    } catch {
      return null;
    }
  })();
  avatarCache.set(SELF_AVATAR_KEY, request);
  return request;
}

export const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

export async function uploadOwnAvatar(file: File): Promise<void> {
  if (file.type !== "image/jpeg" && file.type !== "image/png") {
    throw new Error("Foto harus berformat JPG atau PNG.");
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error("Ukuran foto maksimal 4 MB.");
  }
  if (MITRA_PREVIEW) return;
  const response = await authedFetch("/account/avatar", {
    method: "POST",
    headers: { "content-type": file.type },
    body: file
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Foto belum dapat diunggah.");
  }
  // Buang salinan lama lalu beri tahu semua tampilan avatar agar memuat ulang.
  const old = avatarCache.get(SELF_AVATAR_KEY);
  avatarCache.delete(SELF_AVATAR_KEY);
  void old?.then((url) => (url ? URL.revokeObjectURL(url) : undefined));
  window.dispatchEvent(new Event(AVATAR_CHANGED_EVENT));
}

export function onOwnAvatarChanged(listener: () => void): () => void {
  window.addEventListener(AVATAR_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AVATAR_CHANGED_EVENT, listener);
}

export function clearAvatarCache() {
  avatarCache.forEach((pending) => {
    void pending.then((url) => (url ? URL.revokeObjectURL(url) : undefined));
  });
  avatarCache.clear();
}

/** Ilustrasi potret untuk mode tinjauan saja; tidak pernah dipakai di produksi. */
function previewAvatar(userId: string): string {
  const hue = (userId.charCodeAt(userId.length - 1) * 47) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 62%)"/>` +
    `<stop offset="1" stop-color="hsl(${(hue + 40) % 360} 60% 38%)"/></linearGradient></defs>` +
    `<rect width="96" height="96" fill="url(#g)"/>` +
    `<circle cx="48" cy="38" r="17" fill="rgba(255,255,255,0.88)"/>` +
    `<path d="M14 96c2-22 16-32 34-32s32 10 34 32Z" fill="rgba(255,255,255,0.88)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
