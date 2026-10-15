/**
 * Top Up TapGoPay (Stage R2.10).
 *
 * Login dan penyimpanan sesi dipakai ULANG dari alur upgrade membership
 * (../upgrade/api.ts) — satu akun TapGo, satu token WEB, dua fitur di situs
 * yang sama. Hanya fungsi yang khas top up yang ditambahkan di sini.
 */
import { API_BASE, PREVIEW_MODE, login, readSession, request, takeNextPath, writeSession, clearSession } from "../upgrade/api";

export { API_BASE, PREVIEW_MODE, login, readSession, takeNextPath, writeSession, clearSession };
export { BUYER_NAME_KEY, NEXT_KEY, NOTICE_KEY, TOKEN_KEY } from "../upgrade/api";

export const TOPUP_ORDER_KEY = "tapgo.topup.orderId";

export type TopUpOrderStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED" | "AUTHORIZED" | "REFUNDED";

export type TopUpOrder = {
  id: string;
  reference: string;
  amount: number;
  status: TopUpOrderStatus;
  createdAt: string;
};

export type TopUpPaymentHandoff = {
  redirectUrl: string;
};

type RawTopUpOrder = {
  id: string;
  reference: string;
  amount: unknown;
  status: TopUpOrderStatus;
  createdAt: string;
};

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOrder(raw: RawTopUpOrder): TopUpOrder {
  return {
    id: raw.id,
    reference: raw.reference,
    amount: toNumber(raw.amount),
    status: raw.status,
    createdAt: raw.createdAt
  };
}

export async function createTopUpOrder(token: string, amount: number): Promise<TopUpOrder> {
  const result = await request<RawTopUpOrder>("/web/wallet/topup/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount })
  });
  return toOrder(result);
}

/**
 * Tujuan top up. WALLET = Saldo TapGo (driver: komisi pesanan tunai; pembayaran
 * perjalanan). PPOB = Saldo PPOB: khusus pembelian pulsa/token/tagihan dan tidak
 * dapat ditarik. Batas minimal di sini harus sama dengan server
 * (MANUAL_TOPUP_MIN_AMOUNT / MANUAL_TOPUP_PPOB_MIN_AMOUNT); server tetap yang
 * memutuskan.
 */
export type TopUpTarget = "WALLET" | "PPOB";

export const TOPUP_TARGETS: Record<
  TopUpTarget,
  { label: string; short: string; description: string; min: number; quick: number[] }
> = {
  WALLET: {
    label: "Saldo TapGo",
    short: "Driver dan perjalanan",
    description:
      "Untuk mitra driver (komisi pesanan tunai dipotong dari saldo ini) dan pembayaran perjalanan.",
    // Rp25.000 tetap tersedia; Rp50.000 dipilihkan lebih dulu (indeks 1 di bawah).
    min: 25000,
    quick: [25000, 50000, 100000, 200000, 500000]
  },
  PPOB: {
    label: "Saldo PPOB",
    short: "Pulsa, token, dan tagihan",
    description:
      "Khusus pembelian pulsa, token listrik, dan tagihan di aplikasi. Saldo PPOB tidak dapat ditarik.",
    min: 25000,
    quick: [25000, 50000, 100000, 200000, 500000]
  }
};

/** Tujuan dari tautan (?tujuan=ppob); selain itu Saldo TapGo. */
export function parseTopUpTarget(raw: string | null | undefined): TopUpTarget {
  return (raw ?? "").trim().toLowerCase() === "ppob" ? "PPOB" : "WALLET";
}

export const TOPUP_TARGET_KEY = "tapgo.topup.target";

export type ManualTopUpOrder = {
  id: string;
  reference: string;
  target: TopUpTarget;
  status: TopUpOrderStatus;
  transferAmount: number;
  baseAmount: number;
  uniqueCode: number;
  expiresAt: string;
  createdAt?: string;
  bank: { bankName: string; accountNumber: string; accountHolder: string };
};

/** Top up lewat transfer bank: nominal transfer = jumlah + kode unik. */
export async function createManualTopUp(
  token: string,
  amount: number,
  target: TopUpTarget
): Promise<ManualTopUpOrder> {
  return request<ManualTopUpOrder>("/web/wallet/topup/manual", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount, target })
  });
}

export async function getManualTopUp(token: string, orderId: string): Promise<ManualTopUpOrder> {
  return request<ManualTopUpOrder>(`/web/wallet/topup/manual/${orderId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

export const PREVIEW_MANUAL_TOPUP: ManualTopUpOrder = {
  id: "preview-topup-order",
  reference: "MTOP-CONTOH01",
  target: "WALLET",
  status: "PENDING",
  transferAmount: 100347,
  baseAmount: 100000,
  uniqueCode: 347,
  expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
  bank: { bankName: "BRI", accountNumber: "0000000000", accountHolder: "PT Contoh" }
};

/** Metode bayar online. Biaya tiap metode berbeda, jadi pelanggan memilih metode sebelum pesanan dibuat. */
export type TopUpMethodId = "bank_transfer" | "gopay" | "qris" | "dana";

export type TopUpMethodInfo = { id: TopUpMethodId; label: string; description: string };

/** Penawaran harga satu metode untuk nominal dan tujuan tertentu: biaya layanan dan total yang dibayar. */
export type TopUpQuote = { method: TopUpMethodId; fee: number; gross: number };

/** Opsi top up dari server: apakah bayar online dibuka, metode dan biayanya, batas nominal, dan transfer manual. */
export type TopUpOptions = {
  online: boolean;
  /** Biaya transfer bank penuh; dipakai hanya bila server belum mengirim `quotes` (server lama). */
  onlineFee: number;
  /** Tidak ada pada server lama: halaman kembali ke satu biaya tunggal tanpa pilihan metode. */
  methods?: TopUpMethodInfo[];
  quotes?: TopUpQuote[];
  /** Batas biaya layanan Saldo TapGo; selisihnya ditanggung TapGo. */
  walletFeeCap?: number | null;
  minimum: Record<TopUpTarget, number>;
  maximum: number;
  manualTransfer: boolean;
};

/** Bila `amount` dan `target` diberikan, server menyertakan penawaran harga per metode. */
export async function getTopUpOptions(token: string, quote?: { amount: number; target: TopUpTarget }): Promise<TopUpOptions> {
  const query = quote ? `?amount=${encodeURIComponent(String(quote.amount))}&target=${quote.target}` : "";
  return request<TopUpOptions>(`/web/wallet/topup/options${query}`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

export type OnlineTopUp = {
  id: string;
  reference: string;
  target: TopUpTarget;
  method?: TopUpMethodId | null;
  baseAmount: number;
  feeAmount: number;
  grossAmount: number;
  redirectUrl: string;
};

/** Top up online: nominal + biaya layanan ditagih sekali; saldo bertambah sebesar nominal saja. */
export async function createOnlineTopUp(
  token: string,
  amount: number,
  target: TopUpTarget,
  method?: TopUpMethodId
): Promise<OnlineTopUp> {
  return request<OnlineTopUp>("/web/wallet/topup/online", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount, target, ...(method ? { method } : {}) })
  });
}

/** Ringkasan satu pesanan (online maupun manual) untuk halaman status. */
export type TopUpSummary = {
  id: string;
  reference: string;
  status: TopUpOrderStatus;
  online: boolean;
  resumeUrl: string | null;
  target: TopUpTarget;
  baseAmount: number;
  feeAmount: number;
  grossAmount: number;
};

export async function getTopUpSummary(token: string, orderId: string): Promise<TopUpSummary> {
  return request<TopUpSummary>(`/web/wallet/topup/online/${orderId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

/** Hanya alamat https yang boleh dibuka sebagai halaman pembayaran. */
export function isSafePaymentUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function getTopUpOrder(token: string, orderId: string): Promise<TopUpOrder> {
  const result = await request<RawTopUpOrder>(`/web/wallet/topup/orders/${orderId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  return toOrder(result);
}

export async function payTopUpOrder(token: string, orderId: string): Promise<TopUpPaymentHandoff> {
  const result = await request<{ redirectUrl?: string }>(`/web/wallet/topup/orders/${orderId}/pay`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({})
  });
  return { redirectUrl: result.redirectUrl ?? "" };
}

/** Data contoh untuk tinjauan tampilan. Tidak pernah dipakai di produksi. */
export const PREVIEW_TOPUP_ORDER: TopUpOrder = {
  id: "preview-topup-order",
  reference: "TOPUP-CONTOH01",
  amount: 100000,
  status: "PENDING",
  createdAt: new Date().toISOString()
};

/** Batas atas per pesanan (sama dengan MANUAL_TOPUP_MAX_AMOUNT di server). */
export const TOPUP_MAX_AMOUNT = 5000000;
