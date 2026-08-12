/**
 * Klien API konsol admin.
 *
 * Token disimpan di sessionStorage, bukan localStorage: sesi admin ikut hilang
 * begitu tab ditutup. Tidak ada data pemohon yang disimpan di perangkat admin —
 * seluruhnya dibaca ulang dari server tiap kali dibutuhkan.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_TAPGO_API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";

export const TOKEN_KEY = "tapgo.admin.token";
export const ROLE_KEY = "tapgo.admin.role";

/** Role yang boleh membuka konsol ini. Server tetap penjaga sesungguhnya. */
const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN", "SUPER_ADMIN_VIP"];

export type DocumentType = "KTP" | "SELFIE";

export type MemberRequest = {
  id: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  paidAt: string | null;
  channel: string | null;
  registrationData: Record<string, unknown> | null;
  membership: { name: string; tier: string } | null;
  invoice: { number: string } | null;
  userMembership: { status: string } | null;
  user: { id: string; fullName: string; phone: string; referralCode: string } | null;
};

export type DocumentSummary = {
  type: DocumentType;
  status: string;
  contentType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  uploadedAt: string | null;
  expiresAt: string | null;
  purgedAt: string | null;
  available: boolean;
};

export function readToken(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(TOKEN_KEY) ?? "";
}

export function readRole(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(ROLE_KEY) ?? "";
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(ROLE_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(readToken() ? { authorization: `Bearer ${readToken()}` } : {}),
      ...(init?.headers ?? {})
    },
    credentials: "omit"
  });

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    message?: string;
  };

  if (!response.ok || payload.success === false) {
    throw new Error(payload.message ?? "Permintaan belum dapat diproses.");
  }
  return payload.data as T;
}

export async function login(phone: string, password: string) {
  const result = await request<{ accessToken: string; user?: { role?: string } }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ phone, password }) }
  );

  const role = result.user?.role ?? "";
  if (!ADMIN_ROLES.includes(role)) {
    // Penyaring di sisi klien hanya untuk memberi pesan yang jelas. Penjaga
    // sesungguhnya ada di server; token non-admin tetap ditolak di sana.
    throw new Error("Akun ini tidak memiliki akses konsol admin.");
  }

  window.sessionStorage.setItem(TOKEN_KEY, result.accessToken);
  window.sessionStorage.setItem(ROLE_KEY, role);
  return role;
}

export function listMemberRequests(status?: string) {
  const query = new URLSearchParams({ page: "1", pageSize: "50" });
  if (status) query.set("status", status);
  return request<{ items: MemberRequest[]; total: number }>(
    `/admin/member-requests?${query.toString()}`
  );
}

export function listDocuments(orderId: string) {
  return request<DocumentSummary[]>(`/admin/member-requests/${orderId}/documents`);
}

export function verifyDocuments(orderId: string) {
  return request<MemberRequest>(`/admin/member-requests/${orderId}/verify-documents`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function rejectDocuments(orderId: string, reason: string) {
  return request<MemberRequest>(`/admin/member-requests/${orderId}/reject-documents`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {})
  });
}

/**
 * Mengambil berkas dokumen sebagai object URL.
 *
 * Tidak bisa memakai <img src> langsung: endpoint-nya menuntut header
 * Authorization, dan menaruh token di query string akan membuatnya tercatat di
 * log akses maupun riwayat browser. Pemanggil WAJIB memanggil URL.revokeObjectURL
 * saat selesai supaya isi dokumen tidak menetap di memori tab.
 */
export async function fetchDocumentObjectUrl(orderId: string, type: DocumentType) {
  const response = await fetch(
    `${API_BASE}/admin/member-requests/${orderId}/documents/${type.toLowerCase()}`,
    { headers: { authorization: `Bearer ${readToken()}` }, credentials: "omit" }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Dokumen belum dapat dibuka.");
  }

  const blob = await response.blob();
  return {
    url: URL.createObjectURL(blob),
    checksum: response.headers.get("x-tapgo-document-checksum") ?? ""
  };
}

export function formatRupiah(value: string | number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value));
}

export function formatMoment(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(
    parsed
  );
}

/** Sisa masa simpan dokumen dalam kata-kata, untuk mendorong admin mencetak. */
export function remainingRetention(expiresAt: string | null) {
  if (!expiresAt) return "—";
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return "sudah lewat";
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  return hours > 0 ? `${hours} jam ${minutes} menit lagi` : `${minutes} menit lagi`;
}
