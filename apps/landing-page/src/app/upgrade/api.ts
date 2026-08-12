/**
 * Pemanggilan kanal web membership (Stage R2.6 jalur A).
 *
 * Seluruh permintaan menuju namespace /api/v1/web/membership/*, kanal yang
 * memang diizinkan menjual. Kanal aplikasi mobile tetap tertutup.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_TAPGO_API_BASE_URL ?? "https://api.tapgolion.id/api/v1";

/**
 * Mode tinjauan tampilan.
 *
 * Menyala hanya bila disetel eksplisit saat build. Halaman yang memakainya
 * WAJIB menampilkan penanda DATA CONTOH agar tidak dapat disalahartikan sebagai
 * transaksi nyata.
 */
export const PREVIEW_MODE =
  process.env.NEXT_PUBLIC_TAPGO_UPGRADE_PREVIEW === "true";

export type MembershipPackage = {
  id: string;
  name: string;
  tier: string;
  price: number;
  benefits: string[];
};

export type UpgradeOrderStatus =
  | "PENDING"
  | "PAID_AWAITING_VERIFICATION"
  | "ACTIVE"
  | "REJECTED_REFUNDING"
  | "EXPIRED"
  | "CANCELLED";

export type UpgradeOrder = {
  id: string;
  reference: string;
  packageName: string;
  amount: number;
  status: UpgradeOrderStatus;
  createdAt: string;
  invoiceNumber?: string;
};

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
    // Pesan dari server dipakai apa adanya; tidak pernah menampilkan exception
    // mentah atau detail internal kepada pengguna.
    throw new Error(payload.message ?? "Permintaan belum dapat diproses.");
  }
  return payload.data as T;
}

export function login(phone: string, password: string) {
  return request<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password })
  });
}

export function listPackages() {
  return request<MembershipPackage[]>("/web/membership/packages");
}

export function createOrder(token: string, packageId: string, registrationData: unknown) {
  return request<UpgradeOrder>("/web/membership/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ packageId, registrationData })
  });
}

export function payOrder(token: string, orderId: string) {
  return request<{ redirectUrl: string }>(`/web/membership/orders/${orderId}/pay`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({})
  });
}

export function getOrder(token: string, orderId: string) {
  return request<UpgradeOrder>(`/web/membership/orders/${orderId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

/** Data contoh untuk tinjauan tampilan. Tidak pernah dipakai di produksi. */
export const PREVIEW_PACKAGES: MembershipPackage[] = [
  {
    id: "pkg-silver",
    name: "Silver",
    tier: "SILVER",
    price: 500000,
    benefits: [
      "Kartu anggota digital Silver",
      "Akses layanan PPOB sebagai agen",
      "Insentif kemitraan level 1"
    ]
  },
  {
    id: "pkg-gold",
    name: "Gold",
    tier: "GOLD",
    price: 3000000,
    benefits: [
      "Seluruh manfaat Silver",
      "Saldo PPOB awal lebih besar",
      "Insentif kemitraan sampai level 2",
      "Prioritas dukungan mitra"
    ]
  },
  {
    id: "pkg-platinum",
    name: "Platinum",
    tier: "PLATINUM",
    price: 5500000,
    benefits: [
      "Seluruh manfaat Gold",
      "Saldo PPOB awal tertinggi",
      "Insentif kemitraan sampai level 3",
      "Pendampingan mitra khusus"
    ]
  }
];
