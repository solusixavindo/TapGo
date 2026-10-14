/**
 * Klien API konsol admin.
 *
 * Token disimpan di sessionStorage, bukan localStorage: sesi admin ikut hilang
 * begitu tab ditutup. Tidak ada data pemohon yang disimpan di perangkat admin —
 * seluruhnya dibaca ulang dari server tiap kali dibutuhkan.
 */
import { adminHref } from "../app/hard-nav";
import type { PeriodQuery } from "./period";

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
  user: { id: string; fullName: string; phone: string; referralCode: string; status?: string } | null;
  /** Pembayaran terbaru; untuk transfer manual metadata memuat nominal berkode unik. */
  payments?: Array<{ provider: string; method: string; status: string; metadata: Record<string, unknown> | null }>;
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

const NOTICE_KEY = "tapgo.admin.notice";

/** Pesan satu kali untuk halaman masuk (mis. sesi berakhir). Dibaca sekali lalu dihapus. */
export function consumeSessionNotice(): string {
  if (typeof window === "undefined") return "";
  try {
    const notice = window.sessionStorage.getItem(NOTICE_KEY) ?? "";
    window.sessionStorage.removeItem(NOTICE_KEY);
    return notice;
  } catch {
    return "";
  }
}

/**
 * Token akses berlaku 15 menit dan konsol tidak memperbaruinya. Tanpa penanganan ini, tab yang dibiarkan terbuka
 * melewati batas itu menampilkan galat di setiap halaman (Beranda terus menarik data dan terus gagal) sementara
 * halaman masuk malah mengalihkan kembali ke Beranda karena token lama masih tersimpan. Jawaban 401 saat ada
 * token berarti token itu tidak berlaku lagi: hapus sesi dan kembali ke halaman masuk dengan pesan yang jelas.
 */
function endSessionIfExpired(response: Response) {
  if (response.status !== 401 || !readToken() || typeof window === "undefined") return;
  clearSession();
  try {
    window.sessionStorage.setItem(NOTICE_KEY, "Sesi Anda berakhir. Masuk lagi untuk melanjutkan.");
  } catch {
    // Tanpa pesan pun pengalihan tetap berjalan.
  }
  window.location.replace(adminHref("/"));
}

function periodSuffix(range?: PeriodQuery, existing = false) {
  const query = new URLSearchParams();
  if (range?.dateFrom) query.set("dateFrom", range.dateFrom);
  if (range?.dateTo) query.set("dateTo", range.dateTo);
  const text = query.toString();
  return text ? `${existing ? "&" : "?"}${text}` : "";
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

  // Salah kata sandi saat masuk juga 401, tetapi saat itu belum ada token yang dipegang.
  if (path !== "/auth/login") endSessionIfExpired(response);

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

/** Super Admin mengonfirmasi bahwa pembayaran (mis. transfer manual) sudah diterima. */
export function confirmMemberPayment(orderId: string) {
  return request<MemberRequest>(`/admin/member-requests/${orderId}/approve`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

/**
 * Super Admin mengonfirmasi bahwa transfer bank manual (nominal + kode unik) sudah
 * masuk ke rekening perusahaan. Berbeda dari confirmMemberPayment: memeriksa batas
 * waktu dan kemungkinan nominal kembar, serta mencatat audit khusus.
 */
export function confirmManualTransfer(orderId: string) {
  return request<{ orderId: string; status: string; alreadyConfirmed: boolean }>(
    `/admin/member-requests/${orderId}/confirm-transfer`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

/**
 * Super Admin mencatat bahwa dana pengajuan transfer manual yang dokumennya
 * ditolak SUDAH dikembalikan lewat transfer bank dari rekening perusahaan.
 * bankReference = nomor referensi transfer balik di mutasi bank.
 */
export function confirmManualRefund(orderId: string, bankReference: string) {
  return request<{ orderId: string; status: string; amount: string }>(
    `/admin/member-requests/${orderId}/confirm-manual-refund`,
    { method: "POST", body: JSON.stringify({ bankReference }) }
  );
}

/** Super Admin membatalkan pengajuan yang belum dibayar. */
export function cancelUnpaidMemberRequest(orderId: string, reason: string) {
  return request<MemberRequest>(`/admin/member-requests/${orderId}/reject`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {})
  });
}

export function requestDocumentCorrection(orderId: string, reason: string) {
  return request<{ id: string; correctionRequested: boolean }>(
    `/admin/member-requests/${orderId}/request-correction`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
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
  endSessionIfExpired(response);

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

/**
 * Mengganti password akun yang sedang masuk.
 *
 * Server mencabut SELURUH sesi setelah berhasil, termasuk token yang sedang
 * dipakai. Pemanggil karena itu WAJIB membersihkan sesi lokal dan meminta
 * pengguna masuk kembali — kalau tidak, layar berikutnya akan dipenuhi galat
 * 401 yang membingungkan.
 */
export async function changePassword(currentPassword: string, newPassword: string) {
  const response = await fetch(`${API_BASE}/auth/change-password`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${readToken()}`
    },
    body: JSON.stringify({ currentPassword, newPassword }),
    credentials: "omit"
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Password belum dapat diganti.");
  }
}

// --- Dokumen mitra driver --------------------------------------------------

export type DriverDocumentType = "KTP" | "SIM" | "STNK" | "SELFIE";

export type DriverDocumentSummary = {
  type: DriverDocumentType;
  status: string;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
  expiresAt: string | null;
  /** Isi berkas masih dapat dibuka. Dihitung server dari waktu, bukan flag. */
  available: boolean;
};

export type DriverDocumentQueueRow = {
  driverId: string;
  fullName: string;
  phone: string;
  kycStatus: string;
  vehicleType: string | null;
  vehiclePlate: string | null;
  documents: DriverDocumentSummary[];
  /** Pengajuan driver yang sedang terbuka untuk ditinjau; null bila tidak ada. */
  application: DriverApplicationReview | null;
  /** Profil operasional; ada setelah pengajuan disetujui. Harus ACTIVE agar driver dapat menerima pesanan. */
  profile: { id: string; status: "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED" } | null;
};

export type DriverApplicationReview = {
  id: string;
  status: "SUBMITTED" | "UNDER_REVIEW";
  submittedAt: string | null;
  claimActive: boolean;
  claimedByMe: boolean;
  claimExpiresAt: string | null;
};

export const DRIVER_REJECT_REASONS: Array<{ code: string; label: string }> = [
  { code: "DOCUMENTS_UNREADABLE", label: "Dokumen tidak terbaca / buram" },
  { code: "DOCUMENTS_MISMATCH", label: "Data dokumen tidak sesuai" },
  { code: "VEHICLE_NOT_ELIGIBLE", label: "Kendaraan tidak memenuhi syarat" },
  { code: "INCOMPLETE_REQUIREMENTS", label: "Persyaratan belum lengkap" },
  { code: "OTHER", label: "Alasan lain" }
];

function postJson<T>(path: string, body: unknown = {}) {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export const claimDriverApplication = (id: string) =>
  postJson(`/admin/driver-review/applications/${id}/claim`);
export const renewDriverApplication = (id: string) =>
  postJson(`/admin/driver-review/applications/${id}/renew`);
export const releaseDriverApplication = (id: string) =>
  postJson(`/admin/driver-review/applications/${id}/release`, { reasonCode: "REVIEW_POSTPONED" });
export const activateDriverProfile = (profileId: string) =>
  request(`/admin/rides/drivers/${profileId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "ACTIVE", reason: "Dokumen disetujui" })
  });
export const approveDriverApplication = (id: string) =>
  postJson(`/admin/driver-review/applications/${id}/approve`);
export const rejectDriverApplication = (id: string, reasonCode: string) =>
  postJson(`/admin/driver-review/applications/${id}/reject`, { reasonCode });

/** Scope review milik akun yang sedang masuk (tanpa PII). */
export function listOwnReviewScopes() {
  return request<{ userId: string; scopes: Array<{ scope: string }> }>("/admin/scope-grants/me");
}

/**
 * Memberi diri sendiri kewenangan review driver. Hanya berhasil bagi pemegang
 * ADMIN_SCOPE_MANAGE; server mencatatnya sebagai pemberian-diri di log audit.
 */
export async function grantSelfReviewScopes(userId: string) {
  for (const scope of ["DRIVER_APPLICATION_QUEUE_READ", "DRIVER_APPLICATION_CLAIM", "DRIVER_APPLICATION_RENEW", "DRIVER_APPLICATION_RELEASE"]) {
    await postJson("/admin/scope-grants", { targetUserId: userId, scope, reasonCode: "OPERATIONAL_ASSIGNMENT" });
  }
}

export function listDriverDocumentQueue() {
  const query = new URLSearchParams({ page: "1", pageSize: "50" });
  return request<{ items: DriverDocumentQueueRow[]; total: number }>(
    `/admin/driver-documents?${query.toString()}`
  );
}

/**
 * Mengambil berkas dokumen driver sebagai object URL.
 *
 * Alasannya sama dengan jalur membership: endpoint menuntut header
 * Authorization, dan menaruh token di query string membuatnya tercatat di log
 * akses maupun riwayat browser. Pemanggil WAJIB memanggil URL.revokeObjectURL
 * saat selesai supaya isi dokumen tidak menetap di memori tab.
 */
export async function fetchDriverDocumentObjectUrl(
  driverId: string,
  type: DriverDocumentType
) {
  const response = await fetch(
    `${API_BASE}/admin/drivers/${driverId}/documents/${type.toLowerCase()}`,
    { headers: { authorization: `Bearer ${readToken()}` }, credentials: "omit" }
  );
  endSessionIfExpired(response);

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

// --- Pengelolaan role (hanya SUPER_ADMIN_VIP) ------------------------------

export type AdminAccount = {
  id: string;
  fullName: string;
  phone: string;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  holdsScopeManage: boolean;
};

export type RoleCandidate = {
  id: string;
  fullName: string;
  phone: string;
  referralCode: string;
  role: string;
};

/** Daftar tertutup, sama dengan yang diterima server. */
export const ROLE_REASON_CODES = [
  "NEW_ADMIN_ASSIGNMENT",
  "PROMOTION",
  "DEMOTION",
  "RESPONSIBILITY_CHANGE",
  "ACCESS_REMOVAL",
  "OFFBOARDING",
  "SECURITY_INCIDENT"
] as const;

/** Role puncak sengaja tidak ada: hanya dapat diberikan lewat CLI di server. */
export const ASSIGNABLE_ROLES = ["USER", "ADMIN", "SUPER_ADMIN"] as const;

export function listAdminAccounts() {
  return request<AdminAccount[]>("/admin/roles");
}

export function searchRoleCandidates(query: string) {
  return request<RoleCandidate[]>(`/admin/roles/candidates?q=${encodeURIComponent(query)}`);
}

/** Khusus Super Admin VIP: nonaktifkan / aktifkan kembali akun member. */
export function setMemberAccountStatus(userId: string, status: "ACTIVE" | "SUSPENDED", reason: string) {
  return request<{ id: string; fullName: string; status: string; changed: boolean }>(
    `/admin/members/${userId}/status`,
    { method: "PUT", body: JSON.stringify({ status, reason }) }
  );
}

export function assignAdminRole(userId: string, role: string, reasonCode: string) {
  return request<AdminAccount>(`/admin/roles/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ role, reasonCode })
  });
}

// --- Beranda: ringkasan & tren ----------------------------------------------

export type DashboardSummary = {
  totalMembers: number;
  totalBasic: number;
  totalSilver: number;
  totalGold: number;
  totalPlatinum: number;
  totalRevenue: string;
  totalCommission: string;
  totalWithdrawPending: string;
  totalWithdrawApproved: string;
  totalWalletBalance: string;
  totalPpobGiven: string;
  totalRewardPending: string;
};

export type DashboardGrowth = {
  registrationTrend: Array<{ date: string; count: number }>;
  activeUsers7d: number;
  activeUsers30d: number;
  pendingApprovals: { memberRequests: number; rewards: number; withdrawals: number; total: number };
};

export type RetentionWarningDocument = {
  orderId: string;
  memberName: string;
  referralCode: string;
  documentType: string;
  expiresAt: string;
};

export type AdminActivityEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string;
  createdAt: string;
};

export function documentsNearingRetention() {
  return request<RetentionWarningDocument[]>("/admin/dashboard/documents-nearing-retention");
}

export function recentAdminActivity() {
  return request<AdminActivityEntry[]>("/admin/dashboard/activity?limit=20");
}

export type FinancialSummary = {
  totalWalletLiability: string;
  totalCashWalletLiability: string;
  totalPpobLiability: string;
  totalSponsorBonus: string;
  totalLevelBonus: string;
  totalRewardPending: string;
  totalRewardApproved: string;
  totalRewardPaid: string;
  totalProfitSharing: string;
  totalWithdrawalPending: string;
  totalWithdrawalPaidApproved: string;
  totalMembershipRevenuePaid: string;
  totalActiveBasic: number;
  totalActiveSilver: number;
  totalActiveGold: number;
  totalActivePlatinum: number;
};

export type PpobSummary = {
  basicRegistrationPpobTotal: string;
  silverPpobTotal: string;
  goldPpobTotal: string;
  platinumPpobTotal: string;
  unknownPackagePpobTotal: string;
  packagePpobBenefitTotal: string;
  totalPpobLiability: string;
  totalNonWithdrawablePpob: string;
  /** Penjualan PPOB dibayar dari saldo PPOB pelanggan: tidak ada uang baru masuk saat transaksi. */
  sales: {
    successCount: number;
    salesTotal: string;
    costedCount: number;
    providerCost: string;
    /** Selisih penjualan dan modal Digiflazz, hanya dari transaksi yang modalnya tercatat. */
    margin: string;
    withoutCostCount: number;
    openCount: number;
    openAmount: string;
    failedCount: number;
    failedAmount: string;
  };
  /** Satu-satunya sumber saldo PPOB yang berupa uang tunai masuk: top up PPOB yang lunas. */
  funding: {
    topUpOnlineCount: number;
    topUpOnline: string;
    topUpManualCount: number;
    topUpManual: string;
  };
};

export function dashboardSummary() {
  return request<DashboardSummary>("/admin/dashboard/summary");
}

export function dashboardGrowth() {
  return request<DashboardGrowth>("/admin/dashboard/growth");
}

export function financialSummaryReport(range?: PeriodQuery) {
  return request<FinancialSummary>(`/admin/reports/financial-summary${periodSuffix(range)}`);
}

export function ppobSummaryReportApi(range?: PeriodQuery) {
  return request<PpobSummary>(`/admin/reports/ppob-summary${periodSuffix(range)}`);
}

/**
 * Mengunduh laporan CSV.
 *
 * Tidak bisa memakai <a href> langsung: endpoint menuntut header
 * Authorization, dan token tersimpan di sessionStorage, bukan cookie. Pola
 * sama dengan fetchDocumentObjectUrl — ambil sebagai blob lalu picu unduhan
 * lewat elemen <a> sementara.
 */
export async function downloadReportCsv(kind: "bonus" | "ppob" | "ppob-transactions" | "reward", range?: PeriodQuery) {
  const response = await fetch(`${API_BASE}/admin/reports/${kind}.csv${periodSuffix(range)}`, {
    headers: { authorization: `Bearer ${readToken()}` },
    credentials: "omit"
  });
  endSessionIfExpired(response);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Laporan belum dapat diunduh.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const stamp = range?.dateFrom ? `${range.dateFrom.slice(0, 10)}_${(range.dateTo ?? "").slice(0, 10)}` : "semua-waktu";
  link.download = `tapgo-${kind}-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// --- Direktori member --------------------------------------------------------

export type MemberListItem = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string;
  referralCode: string;
  joinedAt: string;
  membership: { tier: string; name: string } | null;
  sponsor: { id: string; fullName: string; phone: string; referralCode: string } | null;
  directSponsorCount: number;
  totalDownline: number;
  signupSource?: "PLAY" | "OTHER" | "UNKNOWN";
  walletBalance: string;
  withdrawableBalance: string;
  ppobBalance: string;
  commissionTotal: string;
};

export async function listMembers(params: {
  page?: number;
  search?: string;
  tier?: string;
  activeDays?: number;
  registeredDays?: number;
  source?: string;
}) {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: "20"
  });
  if (params.search) query.set("search", params.search);
  if (params.tier) query.set("package", params.tier);
  if (params.source) query.set("source", params.source);
  if (params.activeDays) query.set("activeDays", String(params.activeDays));
  if (params.registeredDays) query.set("registeredDays", String(params.registeredDays));
  const result = await request<{
    items: MemberListItem[];
    total?: number;
    pagination?: { total?: number };
  }>(`/admin/members?${query.toString()}`);
  return { items: result.items, total: result.pagination?.total ?? result.total ?? result.items.length };
}

// --- Monitoring ride/trip (ADMIN ke atas) -----------------------------------

export type AdminRideOrder = {
  reference: string;
  serviceType: "MOTORCYCLE" | "CAR";
  status: string;
  isFinal: boolean;
  pickupAddress: string;
  dropoffAddress: string;
  distanceMeters: number;
  durationSeconds: number;
  totalFare: number;
  currency: string;
  payment: { method: string; state: string };
  passenger: { name: string | null; phoneMasked: string | null };
  driver: {
    profileId: string;
    name: string | null;
    phoneMasked: string | null;
    status: string;
    availability: string;
  } | null;
  vehicle: {
    id: string;
    type: string;
    plateNumberMasked: string;
    verificationStatus: string;
    isActive: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminRideOrderDetail = AdminRideOrder & {
  events: Array<{
    type: string;
    actorRole: string;
    previousStatus: string | null;
    newStatus: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
};

export type AdminRideDriver = {
  profileId: string;
  name: string | null;
  phoneMasked: string | null;
  status: string;
  availability: string;
  ratingAverage: string;
  ratingCount: number;
  lastSeenAt: string | null;
  vehicles: Array<{
    id: string;
    type: string;
    plateNumberMasked: string;
    verificationStatus: string;
    isActive: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
};

export function listAdminRides(params: { status?: string; serviceType?: string; limit?: number }) {
  const query = new URLSearchParams({ limit: String(params.limit ?? 100) });
  if (params.status) query.set("status", params.status);
  if (params.serviceType) query.set("serviceType", params.serviceType);
  return request<AdminRideOrder[]>(`/admin/rides?${query.toString()}`);
}

export function getAdminRide(reference: string) {
  return request<AdminRideOrderDetail>(`/admin/rides/${reference}`);
}

export function listAdminRideDrivers(params: { status?: string; limit?: number }) {
  const query = new URLSearchParams({ limit: String(params.limit ?? 100) });
  if (params.status) query.set("status", params.status);
  return request<AdminRideDriver[]>(`/admin/rides/drivers?${query.toString()}`);
}

// --- Kesehatan server (SUPER_ADMIN_VIP) -------------------------------------

export type SystemHealthReport = {
  server: {
    hostname: string;
    platform: string;
    nodeVersion: string;
    processUptimeSeconds: number;
    systemUptimeSeconds: number;
    loadAverage: [number, number, number];
    cpuCount: number;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
    processRssBytes: number;
    processHeapUsedBytes: number;
  };
  disk:
    | { available: true; totalBytes: number; usedBytes: number; usedPercent: number }
    | { available: false };
  database: { connected: boolean; latencyMs: number | null; error?: string };
  redis: { configured: boolean; connected: boolean; latencyMs: number | null; error?: string };
  checkedAt: string;
};

export function systemHealthReport() {
  return request<SystemHealthReport>("/admin/system/health");
}

export type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  culprit: string | null;
  level: string;
  status: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
};

export type SentryProjectKey = "backend" | "driver_app" | "user_app";

export const SENTRY_PROJECT_LABEL: Record<SentryProjectKey, string> = {
  backend: "Backend",
  driver_app: "Driver App",
  user_app: "User App"
};

export type ErrorMonitoringReport =
  | { configured: false; configuredProjects: SentryProjectKey[] }
  | { configured: true; configuredProjects: SentryProjectKey[]; issues: SentryIssue[]; fetchedAt: string };

export function errorMonitoringReport(project: SentryProjectKey, statsPeriod: "24h" | "14d" = "24h") {
  return request<ErrorMonitoringReport>(`/admin/system/errors?project=${project}&statsPeriod=${statsPeriod}`);
}

export function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} hari ${hours} jam`;
  if (hours > 0) return `${hours} jam ${minutes} menit`;
  return `${minutes} menit`;
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

// --- Penarikan dana (SUPER_ADMIN ke atas) ----------------------

/** Peringkat peran administratif; sama dengan tangga di backend. */
const ROLE_RANK: Record<string, number> = { ADMIN: 1, SUPER_ADMIN: 2, SUPER_ADMIN_VIP: 3 };

export function roleAtLeast(role: string, minimum: "ADMIN" | "SUPER_ADMIN" | "SUPER_ADMIN_VIP") {
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[minimum]!;
}

/** Ambang penarikan yang hanya boleh disetujui VIP. Server tetap penjaga sesungguhnya. */
export const WITHDRAWAL_VIP_THRESHOLD = 2_000_000;

export type WithdrawalStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAID" | "CANCELLED";

export type AdminWithdrawal = {
  id: string;
  amount: string;
  status: WithdrawalStatus;
  bankName: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
  requestedAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  rejectedAt: string | null;
  note: string | null;
  user?: { id: string; fullName: string; phone: string } | null;
};

export const WITHDRAWAL_PAGE_SIZE = 50;

export function listAdminWithdrawals(params: { status?: WithdrawalStatus; page?: number; range?: PeriodQuery }) {
  const query = new URLSearchParams({ page: String(params.page ?? 1), pageSize: String(WITHDRAWAL_PAGE_SIZE) });
  if (params.status) query.set("status", params.status);
  if (params.range?.dateFrom) query.set("dateFrom", params.range.dateFrom);
  if (params.range?.dateTo) query.set("dateTo", params.range.dateTo);
  return request<{ items: AdminWithdrawal[] }>(`/admin/withdrawals?${query.toString()}`);
}

export function actOnWithdrawal(id: string, action: "approve" | "reject" | "paid", note?: string) {
  return request<AdminWithdrawal>(`/admin/withdrawals/${id}/${action}`, {
    method: "POST",
    body: JSON.stringify(note ? { note } : {})
  });
}

// --- Laba rugi (hanya SUPER_ADMIN_VIP) ----------------------------------------

export type ProfitLossReport = {
  period: { from?: string | null; to?: string | null; dateFrom?: string | null; dateTo?: string | null } | null;
  /** Pendapatan usaha, tanpa PPN. */
  revenue: {
    membershipSales: string;
    membershipRefunds: string;
    membershipNet: string;
    /** Saldo PPOB manfaat paket: pendapatan diterima di muka, diakui saat dipakai. */
    membershipDeferred: string;
    membershipRecognized: string;
    rideCommission: string;
    ppobPrepaid: string;
    ppobPostpaidFee: string;
    ppobSales: string;
    total: string;
  };
  cogs: { hppPackages: string; ppobCost: string; total: string };
  grossProfit: string;
  opex: {
    sponsorBonus: string;
    levelBonus: string;
    rewardAccrued: string;
    rewardPaid: string;
    profitSharing: string;
    gatewayFee: string;
    serverCost: string;
    total: string;
  };
  operatingProfit: string;
  profitBeforeTax: string;
  incomeTax: { mode: "FINAL_OMZET" | "CORPORATE" | "NONE"; ratePercent: number; amount: string };
  netProfit: string;
  totalExpenses: string;
  grossMarginPercent: string | null;
  operatingMarginPercent: string | null;
  netMarginPercent: string | null;
  assumptions: { ppnInclusive: boolean; ppnRatePercent: number };
  operating: {
    gateway: {
      byMethod: Array<{ type: string; count: number; gross: string; fee: string }>;
      unknownCount: number;
    };
    ppob: { successCount: number; withoutCostCount: number };
    server: { monthly: number; days: number };
  };
  hpp: {
    tiers: Array<{
      tier: string;
      name: string;
      units: number;
      /** HPP per paket yang diakui sebagai beban pokok (tanpa saldo PPOB). */
      unitCost: string;
      fullUnitCost: string;
      ppobBenefit: string;
      total: string;
      items: Array<{ name: string; quantity: number; unit: string; cost: number }> | null;
    }>;
    missingTiers: string[];
  };
  previous: { totalRevenue: string; totalExpenses: string; netProfit: string } | null;
  memo: {
    ppobGrossSales: string;
    ppnOutput: string;
    walletLiabilityWallet: string;
    walletLiabilityCash: string;
    walletLiabilityPpob: string;
    withdrawalsOutstanding: string;
  };
  notes: string[];
};

export function profitLossReport(params: { dateFrom?: string; dateTo?: string }) {
  const query = new URLSearchParams();
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  const suffix = query.toString();
  return request<ProfitLossReport>(`/admin/reports/profit-loss${suffix ? `?${suffix}` : ""}`);
}

// --- Pembayaran online dan saldo Digiflazz (SUPER_ADMIN ke atas, hanya baca) ----

export type OnlinePaymentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" | "AUTHORIZED" | "REFUNDED";

export type OnlinePaymentItem = {
  kind: "TOPUP" | "MEMBERSHIP";
  id: string;
  reference: string;
  status: OnlinePaymentStatus;
  provider: string | null;
  /** Jenis pembayaran dari Midtrans (bank_transfer, echannel, ...); null selama belum dipilih/tercatat. */
  method: string | null;
  description: string;
  /** Yang ditagihkan ke pembeli (top up: nominal + biaya layanan). */
  amount: number;
  /** Top up: nominal yang dikreditkan ke saldo. */
  baseAmount: number | null;
  feeAmount: number;
  userName: string;
  phoneMasked: string;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  /** Masih menunggu pembayaran padahal batas waktunya lewat (menunggu kabar kedaluwarsa dari Midtrans). */
  overdue: boolean;
};

export type OnlinePaymentList = {
  items: OnlinePaymentItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { total: number; byStatus: Record<string, number>; overduePending: number };
};

export function listOnlinePayments(params: {
  page?: number;
  kind?: "TOPUP" | "MEMBERSHIP";
  status?: OnlinePaymentStatus;
  range?: PeriodQuery;
}) {
  const query = new URLSearchParams({ page: String(params.page ?? 1), pageSize: "25" });
  if (params.range?.dateFrom) query.set("dateFrom", params.range.dateFrom);
  if (params.range?.dateTo) query.set("dateTo", params.range.dateTo);
  if (params.kind) query.set("kind", params.kind);
  if (params.status) query.set("status", params.status);
  return request<OnlinePaymentList>(`/admin/online-payments?${query.toString()}`);
}

export type DigiflazzOverview = {
  provider: {
    provider: string;
    configured: boolean;
    balance: number | null;
    checkedAt: string | null;
    stale: boolean;
    error: string | null;
  };
  level: "UNKNOWN" | "OK" | "LOW" | "CRITICAL";
  thresholds: { warn: number; critical: number };
  customerPpobLiability: number;
  coverageRatio: number | null;
  spend: {
    today: { count: number; cost: number };
    last7Days: { count: number; cost: number; averagePerDay: number };
  };
  estimatedDaysLeft: number | null;
  inFlight: { count: number; amount: number };
};

export function getDigiflazzBalance(refresh = false) {
  return request<DigiflazzOverview>(`/admin/ppob/digiflazz-balance${refresh ? "?refresh=1" : ""}`);
}

export type DigiflazzTxStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "REFUNDED";

export type DigiflazzMarginStatus = "LOSS" | "BELOW_TARGET" | "OK";

export type DigiflazzTxItem = {
  id: string;
  /** `ref_id` di dasbor Digiflazz. */
  reference: string;
  status: DigiflazzTxStatus;
  category: string;
  productName: string;
  brand: string;
  sku: string;
  providerSku: string | null;
  provider: string;
  providerReference: string | null;
  targetMasked: string;
  serialMasked: string | null;
  amount: number;
  adminFee: number;
  totalAmount: number;
  /** Harga modal dari Digiflazz; null bila tidak tercatat. */
  providerCost: number | null;
  /** Selisih penjualan dan modal; hanya untuk transaksi sukses yang modalnya tercatat. */
  margin: number | null;
  /** Untung bersih setelah PPN atas selisih dan PPh; null bila bukan transaksi sukses atau modal tidak tercatat. */
  netMargin: number | null;
  /** Terhadap target untung bersih (Rp500 prabayar, Rp1.000 pascabayar): rugi, di bawah target, atau memenuhi. */
  marginStatus: DigiflazzMarginStatus | null;
  failureCode: string | null;
  failureReason: string | null;
  /** Saldo pelanggan sudah dikembalikan. */
  refunded: boolean;
  /** Masih PENDING/PROCESSING melebihi batas wajar. */
  stuck: boolean;
  userName: string;
  phoneMasked: string;
  createdAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
};

export type DigiflazzTxList = {
  items: DigiflazzTxItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: {
    total: number;
    byStatus: Record<string, number>;
    stuck: number;
    stuckAfterMinutes: number;
    success: {
      count: number;
      sales: number;
      costedSales: number;
      providerCost: number;
      withCostCount: number;
      /** Untung bersih seluruh transaksi sukses yang modalnya tercatat, dan berapa yang rugi atau di bawah target. */
      netMargin: number;
      lossCount: number;
      belowTargetCount: number;
      targets: { prepaid: number; postpaid: number };
    };
  };
};

export function listDigiflazzTransactions(params: {
  page?: number;
  status?: DigiflazzTxStatus;
  category?: string;
  search?: string;
  stuck?: boolean;
  /** Hanya transaksi sukses yang rugi bersih atau di bawah target untung bersih. */
  marginIssue?: boolean;
  range?: PeriodQuery;
}) {
  const query = new URLSearchParams({ page: String(params.page ?? 1), pageSize: "25" });
  if (params.status) query.set("status", params.status);
  if (params.category) query.set("category", params.category);
  if (params.search) query.set("search", params.search);
  if (params.stuck) query.set("stuck", "1");
  if (params.marginIssue) query.set("marginIssue", "1");
  if (params.range?.dateFrom) query.set("dateFrom", params.range.dateFrom);
  if (params.range?.dateTo) query.set("dateTo", params.range.dateTo);
  return request<DigiflazzTxList>(`/admin/ppob/transactions?${query.toString()}`);
}

// --- Wawasan Beranda Super Admin VIP --------------------------------------------------------

export type RegionCount = { name: string; count: number };
export type RegionTally = { total: number; unreadable: number; cities: RegionCount[]; provinces: RegionCount[] };
export type InsightDriverCard = { name: string; average: number; count: number };

export type VipInsights = {
  period: { from: string; to: string; bucket: "hour" | "day" | "month"; labels: string[] };
  totals: {
    members: number;
    drivers: number;
    driversActive: number;
    driversOnline: number;
    registrations: { current: number; previous: number };
    revenue: { current: number; previous: number };
    ridesCompleted: { current: number; previous: number };
    rating: { average: number | null; count: number };
  };
  series: {
    registrations: { members: number[]; drivers: number[] };
    revenue: { membership: number[]; ppobMargin: number[]; rideCommission: number[] };
    rides: { total: number[]; completed: number[] };
  };
  revenueBreakdown: { membership: number; ppobSales: number; ppobMargin: number; ppobWithoutCost: number; rideCommission: number };
  composition: {
    tiers: Array<{ tier: string; count: number }>;
    signupSources: { play: number; other: number; unknown: number };
    rideStatus: Array<{ status: string; count: number }>;
    rideServices: Array<{ type: string; count: number }>;
    driverStatus: Array<{ status: string; count: number }>;
  };
  rides: { total: number; completed: number; cancelled: number; completionRate: number | null; heatmap: number[][] };
  regions: { members: RegionTally; drivers: RegionTally; pickups: RegionTally };
  driverAges: {
    buckets: Array<{ label: string; count: number }>;
    counted: number;
    unknown: number;
    average: number | null;
    youngest: number | null;
    oldest: number | null;
  };
  ratings: {
    periodAverage: number | null;
    periodCount: number;
    distribution: Array<{ stars: number; count: number }>;
    topDrivers: InsightDriverCard[];
    attentionDrivers: InsightDriverCard[];
    recent: Array<{ stars: number; note: string | null; createdAt: string; driverName: string; passengerName: string; service: string }>;
  };
  attention: {
    stuckPpob: number;
    /** Transaksi PPOB prabayar/pascabayar 7 hari terakhir yang rugi bersih, dan yang di bawah target untung bersih. */
    ppobLossWeek: number;
    ppobBelowTargetWeek: number;
    withdrawalsPending: number;
    withdrawalsPendingAmount: number;
    memberRequestsAwaiting: number;
    driverApplicationsPending: number;
    overdueOnlinePayments: number;
    openSupportTickets: number;
    lowRatingsThisWeek: number;
    digiflazz: { level: string; balance: number | null } | null;
  };
  notes: string[];
};

export function getVipInsights(range?: PeriodQuery) {
  return request<VipInsights>(`/admin/dashboard/insights${periodSuffix(range)}`);
}

export type ManualTopUpStatus = "PENDING" | "PAID" | "CANCELLED";

/** WALLET = Saldo TapGo (driver, perjalanan); PPOB = Saldo PPOB (tidak dapat ditarik). */
export type ManualTopUpTarget = "WALLET" | "PPOB";

export type ManualTopUp = {
  id: string;
  reference: string;
  target: ManualTopUpTarget;
  status: ManualTopUpStatus;
  transferAmount: number;
  baseAmount: number | null;
  memberName: string;
  memberPhone: string;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
  paidAt: string | null;
};

export function listManualTopUps(status: ManualTopUpStatus, range?: PeriodQuery) {
  return request<ManualTopUp[]>(`/admin/manual-topups?status=${status}${periodSuffix(range, true)}`);
}

export function actOnManualTopUp(id: string, action: "confirm" | "reject", reason?: string) {
  return request<{ id: string; status: string }>(`/admin/manual-topups/${id}/${action}`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {})
  });
}
