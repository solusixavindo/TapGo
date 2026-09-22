export function formatRupiah(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}Rp ${Math.abs(rounded).toLocaleString("id-ID")}`;
}

export function formatCompactRupiah(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (abs >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(1).replace(".", ",")} jt`;
  if (abs >= 1_000) return `Rp ${Math.round(amount / 1_000)} rb`;
  return `Rp ${Math.round(amount)}`;
}

export function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

export function maskAccount(accountNumber: string): string {
  if (accountNumber.length <= 4) return accountNumber;
  return `${"•".repeat(Math.max(accountNumber.length - 4, 4))}${accountNumber.slice(-4)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

export const COMMISSION_LABELS: Record<string, string> = {
  DIRECT_REFERRAL: "Referral Langsung",
  BASIC_SPONSOR_BONUS: "Bonus Referral",
  SPONSOR_BONUS: "Bonus Referral",
  LEVEL_BONUS: "Bonus Tingkat",
  LEVEL_COMMISSION: "Bonus Tingkat",
  REWARD_BONUS: "Reward",
  PROFIT_SHARING: "Bagi Hasil",
  PROFIT_SHARING_BONUS: "Bagi Hasil"
};

export const COMMISSION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Menunggu",
  POSTED: "Masuk saldo",
  PAID: "Masuk saldo",
  REVERSED: "Dibatalkan"
};

export const WALLET_TYPE_LABELS: Record<string, string> = {
  TOPUP: "Top up saldo",
  COMMISSION: "Komisi",
  BASIC_SPONSOR_BONUS: "Bonus referral",
  SPONSOR_BONUS: "Bonus referral",
  LEVEL_BONUS: "Bonus tingkat",
  LEVEL_COMMISSION: "Bonus tingkat",
  REWARD_BONUS: "Reward",
  PROFIT_SHARING: "Bagi hasil",
  REGISTRATION_BONUS: "Bonus registrasi",
  PPOB_BENEFIT: "Manfaat PPOB",
  PPOB_PURCHASE: "Pembelian PPOB",
  PPOB_REFUND: "Pengembalian PPOB",
  TRANSFER_IN: "Transfer masuk",
  TRANSFER_OUT: "Transfer keluar",
  WITHDRAWAL_REQUEST: "Pengajuan penarikan",
  WITHDRAWAL_REFUND: "Pengembalian penarikan",
  ADJUSTMENT: "Penyesuaian"
};

export function walletTypeLabel(type: string): string {
  return WALLET_TYPE_LABELS[type] ?? type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export const TIER_LABELS: Record<string, string> = {
  BASIC: "Basic",
  SILVER: "Silver",
  GOLD: "Gold",
  PLATINUM: "Platinum"
};

export function tierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? tier;
}

export const BANKS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "BCA", name: "Bank Central Asia (BCA)" },
  { code: "BRI", name: "Bank Rakyat Indonesia (BRI)" },
  { code: "BNI", name: "Bank Negara Indonesia (BNI)" },
  { code: "MANDIRI", name: "Bank Mandiri" },
  { code: "BSI", name: "Bank Syariah Indonesia (BSI)" },
  { code: "CIMB", name: "CIMB Niaga" },
  { code: "PERMATA", name: "Bank Permata" },
  { code: "DANAMON", name: "Bank Danamon" },
  { code: "BTN", name: "Bank Tabungan Negara (BTN)" },
  { code: "OCBC", name: "OCBC NISP" },
  { code: "MAYBANK", name: "Maybank Indonesia" },
  { code: "PANIN", name: "Bank Panin" },
  { code: "JAGO", name: "Bank Jago" },
  { code: "SEABANK", name: "SeaBank" },
  { code: "NEO", name: "Bank Neo Commerce" },
  { code: "BJB", name: "Bank BJB" },
  { code: "MEGA", name: "Bank Mega" }
];

export const MIN_WITHDRAWAL = 50_000;
export const BANK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Sisa jeda (ms) sebelum rekening boleh dipakai mencairkan dana; 0 bila sudah boleh. */
export function bankCooldownRemaining(updatedAt: string, now = Date.now()): number {
  const saved = Date.parse(updatedAt);
  if (!Number.isFinite(saved)) return BANK_COOLDOWN_MS;
  return Math.max(0, saved + BANK_COOLDOWN_MS - now);
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} menit`;
  return minutes === 0 ? `${hours} jam` : `${hours} jam ${minutes} menit`;
}
