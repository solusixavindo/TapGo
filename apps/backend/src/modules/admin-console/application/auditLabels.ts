/** Uraian aksi audit untuk berkas unduhan Log Aktivitas (cermin dari admin_dashboard/src/lib/audit-labels.ts). */
const LABEL: Record<string, string> = {
  ADMIN_LOGIN: "Masuk ke konsol",
  ADMIN_LOGOUT: "Keluar dari konsol",
  ADMIN_PASSWORD_CHANGED: "Mengganti password",
  AUTH_LOGIN_FAILED: "Percobaan masuk gagal (password salah)",
  WITHDRAWAL_APPROVED: "Penarikan disetujui",
  WITHDRAWAL_REJECTED: "Penarikan ditolak",
  WITHDRAWAL_PAID: "Penarikan ditandai ditransfer",
  MANUAL_TOPUP_CONFIRMED: "Top up manual dikonfirmasi",
  MANUAL_TOPUP_REJECTED: "Top up manual ditolak",
  REWARD_APPROVED: "Hadiah disetujui",
  REWARD_REJECTED: "Hadiah ditolak",
  REWARD_PAID: "Hadiah ditandai dibayar",
  DRIVER_INCENTIVE_RULE_CREATED: "Aturan insentif dibuat",
  DRIVER_INCENTIVE_RULE_UPDATED: "Aturan insentif diubah",
  DRIVER_INCENTIVE_CLAIM_APPROVED: "Klaim insentif disetujui",
  DRIVER_INCENTIVE_CLAIM_REJECTED: "Klaim insentif ditolak",
  DRIVER_INCENTIVE_CLAIM_REVERSED: "Klaim insentif dibalikkan",
  PROFIT_SHARING_PERIOD_CREATED: "Periode bagi hasil dibuat",
  PROFIT_SHARING_PERIOD_APPROVED: "Periode bagi hasil disetujui",
  PROFIT_SHARING_PERIOD_DISTRIBUTED: "Laba dibagikan",
  MEMBERSHIP_PAYMENT_CONFIRMED: "Pembayaran membership dikonfirmasi",
  MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED: "Transfer membership dikonfirmasi",
  MEMBERSHIP_DOCUMENTS_VERIFIED: "Dokumen member diverifikasi",
  MEMBERSHIP_DOCUMENTS_REJECTED: "Dokumen member ditolak",
  DRIVER_APPLICATION_APPROVED: "Pengajuan driver disetujui",
  DRIVER_APPLICATION_REJECTED: "Pengajuan driver ditolak",
  RIDE_DRIVER_STATUS_CHANGED: "Status driver diubah",
  ACCOUNT_RECOVERY_CODE_ISSUED: "Kode pemulihan akun diterbitkan",
  ACCOUNT_DELETION_COMPLETED: "Hapus akun diselesaikan",
  ACCOUNT_DELETION_REJECTED: "Hapus akun ditolak",
  ADMIN_ROLE_ASSIGNED: "Role admin diubah",
  REPORT_EXPORT: "Laporan diunduh",
  DRIVER_DOCUMENT_VIEWED: "Dokumen driver dilihat",
  MEMBERSHIP_DOCUMENT_VIEWED: "Dokumen member dilihat"
};

const MONEY = new Set([
  "WITHDRAWAL_APPROVED", "WITHDRAWAL_PAID", "MANUAL_TOPUP_CONFIRMED", "REWARD_APPROVED", "REWARD_PAID",
  "DRIVER_INCENTIVE_CLAIM_APPROVED", "DRIVER_INCENTIVE_CLAIM_REVERSED", "PROFIT_SHARING_PERIOD_DISTRIBUTED",
  "MEMBERSHIP_PAYMENT_CONFIRMED", "MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED"
]);

export function auditDescription(action: string, metadata: unknown): string {
  if (action === "ADMIN_REQUEST") {
    const label = (metadata as { label?: unknown } | null)?.label;
    return typeof label === "string" ? label : "Menekan tombol di konsol";
  }
  return LABEL[action] ?? action;
}

/** Penggolongan kasar untuk menyaring di Excel: UANG, MASUK/KELUAR, UBAH (menekan sesuatu), LIHAT (hanya membuka). */
export function auditKind(action: string, metadata: unknown): string {
  if (action === "ADMIN_LOGIN" || action === "ADMIN_LOGOUT" || action === "ADMIN_PASSWORD_CHANGED" || action === "AUTH_LOGIN_FAILED") return "AKUN";
  if (MONEY.has(action)) return "UANG";
  if (action === "ADMIN_REQUEST") {
    return (metadata as { readOnly?: unknown } | null)?.readOnly === true ? "LIHAT" : "UBAH";
  }
  return "UBAH";
}
