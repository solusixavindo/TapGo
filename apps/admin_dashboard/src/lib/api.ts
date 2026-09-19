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
  user: { id: string; fullName: string; phone: string; referralCode: string; status?: string } | null;
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
};

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
};

export function dashboardSummary() {
  return request<DashboardSummary>("/admin/dashboard/summary");
}

export function dashboardGrowth() {
  return request<DashboardGrowth>("/admin/dashboard/growth");
}

export function financialSummaryReport() {
  return request<FinancialSummary>("/admin/reports/financial-summary");
}

export function ppobSummaryReportApi() {
  return request<PpobSummary>("/admin/reports/ppob-summary");
}

/**
 * Mengunduh laporan CSV.
 *
 * Tidak bisa memakai <a href> langsung: endpoint menuntut header
 * Authorization, dan token tersimpan di sessionStorage, bukan cookie. Pola
 * sama dengan fetchDocumentObjectUrl — ambil sebagai blob lalu picu unduhan
 * lewat elemen <a> sementara.
 */
export async function downloadReportCsv(kind: "bonus" | "ppob" | "reward") {
  const response = await fetch(`${API_BASE}/admin/reports/${kind}.csv`, {
    headers: { authorization: `Bearer ${readToken()}` },
    credentials: "omit"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Laporan belum dapat diunduh.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tapgo-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
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

// --- Penarikan dana dan log audit (SUPER_ADMIN ke atas) ----------------------

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

export function listAdminWithdrawals(params: { status?: WithdrawalStatus; page?: number }) {
  const query = new URLSearchParams({ page: String(params.page ?? 1), pageSize: "20" });
  if (params.status) query.set("status", params.status);
  return request<{ items: AdminWithdrawal[] }>(`/admin/withdrawals?${query.toString()}`);
}

export function actOnWithdrawal(id: string, action: "approve" | "reject" | "paid", note?: string) {
  return request<AdminWithdrawal>(`/admin/withdrawals/${id}/${action}`, {
    method: "POST",
    body: JSON.stringify(note ? { note } : {})
  });
}

export type AuditLogItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actorName: string;
  actorRole: string | null;
  ipAddress?: string | null;
};

export function listAuditLogs(params: { page?: number; action?: string; entityType?: string }) {
  const query = new URLSearchParams({ page: String(params.page ?? 1), pageSize: "25" });
  if (params.action) query.set("action", params.action);
  if (params.entityType) query.set("entityType", params.entityType);
  return request<{ total: number; items: AuditLogItem[] }>(`/admin/audit-logs?${query.toString()}`);
}

// --- Laba rugi (hanya SUPER_ADMIN_VIP) ----------------------------------------

export type ProfitLossReport = {
  period: { from?: string | null; to?: string | null; dateFrom?: string | null; dateTo?: string | null } | null;
  revenue: {
    membershipSales: string;
    membershipRefunds: string;
    membershipNet: string;
    rideCommission: string;
    ppobAdminFee: string;
    total: string;
  };
  expenses: {
    sponsorBonus: string;
    levelBonus: string;
    rewardPaid: string;
    profitSharing: string;
    hppPackages: string;
    total: string;
  };
  hpp: {
    tiers: Array<{
      tier: string;
      name: string;
      units: number;
      unitCost: string;
      total: string;
      items: Array<{ name: string; quantity: number; unit: string; cost: number }> | null;
    }>;
    missingTiers: string[];
  };
  operatingProfit: string;
  operatingMarginPercent: string | null;
  previous: { totalRevenue: string; totalExpenses: string; operatingProfit: string } | null;
  memo: {
    ppobGrossSales: string;
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
