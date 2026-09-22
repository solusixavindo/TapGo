import type {
  BankAccount,
  Commission,
  Profile,
  ReferralSummary,
  TeamMember,
  WalletBalance,
  WalletTransaction,
  Withdrawal
} from "./mitra-api";

/** Data contoh untuk tinjauan tampilan. Tidak pernah dipakai di produksi. */
const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();

export const PREVIEW_PROFILE: Profile = {
  id: "preview-user",
  fullName: "Budi Santoso",
  phone: "+6281234567890",
  email: "budi@example.com",
  referralCode: "TAPGO-BUDI01"
};

export const PREVIEW_WALLET: WalletBalance = {
  balance: 1_325_000,
  cashBalance: 1_075_000,
  ppobBalance: 250_000
};

export const PREVIEW_BANK: BankAccount = {
  bankName: "Bank Central Asia (BCA)",
  bankCode: "BCA",
  accountNumber: "8830123456",
  accountHolderName: "BUDI SANTOSO",
  updatedAt: ago(12)
};

export const PREVIEW_SUMMARY: ReferralSummary = {
  referralCode: "TAPGO-BUDI01",
  referralLink: "https://tapgolion.id/r/TAPGO-BUDI01",
  membershipTier: "GOLD",
  directDownlines: 6,
  totalDownlines: 17,
  totalCommission: 2_140_000
};

export const PREVIEW_TEAM: TeamMember[] = [
  { userId: "u1", fullName: "Siti Aminah", referralCode: "TAPGO-SITI01", level: 1, membershipTier: "GOLD", joinedAt: ago(96), hasAvatar: true },
  { userId: "u2", fullName: "Ahmad Fauzi", referralCode: "TAPGO-AHMAD1", level: 1, membershipTier: "SILVER", joinedAt: ago(81), hasAvatar: false },
  { userId: "u3", fullName: "Rina Wulandari", referralCode: "TAPGO-RINA01", level: 1, membershipTier: "SILVER", joinedAt: ago(63), hasAvatar: false },
  { userId: "u4", fullName: "Hendra Gunawan", referralCode: "TAPGO-HEND01", level: 1, membershipTier: "PLATINUM", joinedAt: ago(40), hasAvatar: true },
  { userId: "u5", fullName: "Maya Kusuma", referralCode: "TAPGO-MAYA01", level: 1, membershipTier: "BASIC", joinedAt: ago(22), hasAvatar: false },
  { userId: "u6", fullName: "Joko Prasetyo", referralCode: "TAPGO-JOKO01", level: 1, membershipTier: "SILVER", joinedAt: ago(9), hasAvatar: true },
  { userId: "u7", fullName: "Dewi Lestari", referralCode: "TAPGO-DEWI01", level: 2, membershipTier: "SILVER", joinedAt: ago(70), hasAvatar: false },
  { userId: "u8", fullName: "Agus Setiawan", referralCode: "TAPGO-AGUS01", level: 2, membershipTier: "BASIC", joinedAt: ago(55), hasAvatar: false },
  { userId: "u9", fullName: "Lina Marlina", referralCode: "TAPGO-LINA01", level: 2, membershipTier: "GOLD", joinedAt: ago(33), hasAvatar: true },
  { userId: "u10", fullName: "Rizky Ramadhan", referralCode: "TAPGO-RIZK01", level: 2, membershipTier: "SILVER", joinedAt: ago(15), hasAvatar: false },
  { userId: "u11", fullName: "Putri Anggraini", referralCode: "TAPGO-PUTR01", level: 3, membershipTier: "BASIC", joinedAt: ago(48), hasAvatar: false },
  { userId: "u12", fullName: "Dedi Kurniawan", referralCode: "TAPGO-DEDI01", level: 3, membershipTier: "SILVER", joinedAt: ago(20), hasAvatar: false }
];

export const PREVIEW_COMMISSIONS: Commission[] = [
  { id: "c1", type: "SPONSOR_BONUS", status: "POSTED", level: 1, amount: 240_000, createdAt: ago(3) },
  { id: "c2", type: "LEVEL_COMMISSION", status: "POSTED", level: 2, amount: 45_000, createdAt: ago(8) },
  { id: "c3", type: "SPONSOR_BONUS", status: "POSTED", level: 1, amount: 400_000, createdAt: ago(21) },
  { id: "c4", type: "REWARD_BONUS", status: "PENDING", level: 1, amount: 100_000, createdAt: ago(27) },
  { id: "c5", type: "LEVEL_COMMISSION", status: "POSTED", level: 3, amount: 30_000, createdAt: ago(44) },
  { id: "c6", type: "PROFIT_SHARING_BONUS", status: "POSTED", level: 0, amount: 185_000, createdAt: ago(58) },
  { id: "c7", type: "SPONSOR_BONUS", status: "POSTED", level: 1, amount: 240_000, createdAt: ago(73) },
  { id: "c8", type: "BASIC_SPONSOR_BONUS", status: "POSTED", level: 1, amount: 2_000, createdAt: ago(91) },
  { id: "c9", type: "LEVEL_COMMISSION", status: "REVERSED", level: 2, amount: 45_000, createdAt: ago(104) },
  { id: "c10", type: "SPONSOR_BONUS", status: "POSTED", level: 1, amount: 400_000, createdAt: ago(122) },
  { id: "c11", type: "LEVEL_COMMISSION", status: "POSTED", level: 2, amount: 45_000, createdAt: ago(140) },
  { id: "c12", type: "REWARD_BONUS", status: "POSTED", level: 1, amount: 100_000, createdAt: ago(158) }
];

export const PREVIEW_TRANSACTIONS: WalletTransaction[] = [
  { id: "t1", type: "SPONSOR_BONUS", amount: 240_000, createdAt: ago(3) },
  { id: "t2", type: "WITHDRAWAL_REQUEST", amount: -500_000, createdAt: ago(5) },
  { id: "t3", type: "LEVEL_COMMISSION", amount: 45_000, createdAt: ago(8) },
  { id: "t4", type: "TOPUP", amount: 300_000, createdAt: ago(14) },
  { id: "t5", type: "SPONSOR_BONUS", amount: 400_000, createdAt: ago(21) },
  { id: "t6", type: "PPOB_PURCHASE", amount: -52_500, createdAt: ago(24) },
  { id: "t7", type: "WITHDRAWAL_REFUND", amount: 250_000, createdAt: ago(31) },
  { id: "t8", type: "PROFIT_SHARING", amount: 185_000, createdAt: ago(58) }
];

export const PREVIEW_WITHDRAWALS: Withdrawal[] = [
  {
    id: "w1", amount: 500_000, fee: 0, finalAmount: 500_000, status: "APPROVED",
    bankName: "Bank Central Asia (BCA)", accountNumber: "8830123456",
    requestedAt: ago(5), approvedAt: ago(4), paidAt: null, rejectedAt: null, note: ""
  },
  {
    id: "w2", amount: 1_000_000, fee: 0, finalAmount: 1_000_000, status: "PAID",
    bankName: "Bank Central Asia (BCA)", accountNumber: "8830123456",
    requestedAt: ago(34), approvedAt: ago(33), paidAt: ago(33), rejectedAt: null, note: ""
  },
  {
    id: "w3", amount: 250_000, fee: 0, finalAmount: 250_000, status: "REJECTED",
    bankName: "Bank Central Asia (BCA)", accountNumber: "8830123456",
    requestedAt: ago(41), approvedAt: null, paidAt: null, rejectedAt: ago(40),
    note: "Nama pemilik rekening tidak sesuai dengan data akun."
  }
];
