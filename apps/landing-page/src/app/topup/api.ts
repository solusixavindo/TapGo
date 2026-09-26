/**
 * Top Up TapGoPay (Stage R2.10).
 *
 * Login dan penyimpanan sesi dipakai ULANG dari alur upgrade membership
 * (../upgrade/api.ts) — satu akun TapGo, satu token WEB, dua fitur di situs
 * yang sama. Hanya fungsi yang khas top up yang ditambahkan di sini.
 */
import { API_BASE, PREVIEW_MODE, login, readSession, writeSession, clearSession } from "../upgrade/api";

export { API_BASE, PREVIEW_MODE, login, readSession, writeSession, clearSession };
export { TOKEN_KEY } from "../upgrade/api";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
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
  };
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message ?? "Permintaan belum dapat diproses.");
  }
  return payload.data as T;
}

export async function createTopUpOrder(token: string, amount: number): Promise<TopUpOrder> {
  const result = await request<RawTopUpOrder>("/web/wallet/topup/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount })
  });
  return toOrder(result);
}

export type ManualTopUpOrder = {
  id: string;
  reference: string;
  status: TopUpOrderStatus;
  transferAmount: number;
  baseAmount: number;
  uniqueCode: number;
  expiresAt: string;
  bank: { bankName: string; accountNumber: string; accountHolder: string };
};

/** Top up lewat transfer bank: nominal transfer = jumlah + kode unik. */
export async function createManualTopUp(token: string, amount: number): Promise<ManualTopUpOrder> {
  return request<ManualTopUpOrder>("/web/wallet/topup/manual", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount })
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
  status: "PENDING",
  transferAmount: 100347,
  baseAmount: 100000,
  uniqueCode: 347,
  expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
  bank: { bankName: "BRI", accountNumber: "0000000000", accountHolder: "PT Contoh" }
};

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

/** Nominal top up cepat yang ditawarkan di langkah pertama. */
export const TOPUP_QUICK_AMOUNTS = [50000, 100000, 200000, 500000, 1000000];
export const TOPUP_MIN_AMOUNT = 50000;
export const TOPUP_MAX_AMOUNT = 5000000;
