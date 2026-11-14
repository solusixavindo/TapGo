/** Nama aksi audit dalam bahasa operator. Aksi yang belum terdaftar tampil apa adanya (jangan disembunyikan). */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
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
  MEMBERSHIP_CORRECTION_REQUESTED: "Perbaikan dokumen diminta",
  MEMBERSHIP_UPGRADED: "Membership di-upgrade",
  DRIVER_APPLICATION_APPROVED: "Pengajuan driver disetujui",
  DRIVER_APPLICATION_REJECTED: "Pengajuan driver ditolak",
  RIDE_DRIVER_STATUS_CHANGED: "Status driver diubah",
  RIDE_VEHICLE_VERIFICATION_CHANGED: "Verifikasi kendaraan diubah",
  DRIVER_FACE_CHECK_OVERRIDE: "Verifikasi wajah dikesampingkan",
  ACCOUNT_RECOVERY_CODE_ISSUED: "Kode pemulihan akun diterbitkan",
  ACCOUNT_DELETION_COMPLETED: "Hapus akun diselesaikan",
  ACCOUNT_DELETION_REJECTED: "Hapus akun ditolak",
  ADMIN_ROLE_ASSIGNED: "Role admin diubah",
  ADMIN_ROLE_ASSIGN_DENIED: "Ubah role ditolak",
  REPORT_EXPORT: "Laporan diunduh",
  DRIVER_DOCUMENT_VIEWED: "Dokumen driver dilihat",
  MEMBERSHIP_DOCUMENT_VIEWED: "Dokumen member dilihat",
  AUTH_LOGIN_FAILED: "Login gagal",
  SUPPORT_TICKET_UPDATED: "Tiket bantuan diperbarui"
};

export const auditLabel = (action: string) => AUDIT_ACTION_LABEL[action] ?? action;

/** Aksi yang menggerakkan atau menyetujui uang: ditandai di log. */
export const MONEY_AUDIT_ACTIONS = new Set([
  "WITHDRAWAL_APPROVED",
  "WITHDRAWAL_PAID",
  "MANUAL_TOPUP_CONFIRMED",
  "REWARD_APPROVED",
  "REWARD_PAID",
  "DRIVER_INCENTIVE_CLAIM_APPROVED",
  "DRIVER_INCENTIVE_CLAIM_REVERSED",
  "PROFIT_SHARING_PERIOD_DISTRIBUTED",
  "MEMBERSHIP_PAYMENT_CONFIRMED",
  "MEMBERSHIP_MANUAL_TRANSFER_CONFIRMED"
]);
