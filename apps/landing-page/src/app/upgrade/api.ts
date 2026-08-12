/**
 * Pemanggilan kanal web membership (Stage R2.6 jalur A).
 *
 * Seluruh permintaan pembelian menuju namespace /api/v1/web/membership/*, kanal
 * yang memang diizinkan menjual. Kanal aplikasi mobile tetap tertutup.
 *
 * Backend mengembalikan bentuk baris database apa adanya. Berkas ini yang
 * menerjemahkannya menjadi bentuk tampilan, supaya komponen tidak perlu tahu
 * nama kolom maupun cara Prisma membuat serial angka Decimal.
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

export const TOKEN_KEY = "tapgo.upgrade.token";
export const PACKAGE_KEY = "tapgo.upgrade.packageId";
export const ORDER_KEY = "tapgo.upgrade.orderId";

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
  invoiceNumber: string;
  buyerName: string;
};

export type PaymentHandoff = {
  /** Halaman pembayaran penyedia. Kosong bila pembayaran sudah lunas. */
  redirectUrl: string;
  /** True hanya pada mode sandbox tanpa kredensial penyedia. */
  alreadyPaid: boolean;
};

/**
 * Penyimpanan sementara antar langkah.
 *
 * sessionStorage, bukan localStorage: token ikut hilang begitu tab ditutup.
 * Hanya boleh dipanggil dari komponen klien.
 */
export function readSession(key: string): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(key) ?? "";
}

export function writeSession(key: string, value: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, value);
}

export function clearSession(...keys: string[]) {
  if (typeof window === "undefined") return;
  for (const key of keys) {
    window.sessionStorage.removeItem(key);
  }
}

/** Bentuk mentah dari server. Sengaja longgar: hanya kolom yang dipakai. */
type RawMembership = {
  id: string;
  tier: string;
  name: string;
  price: unknown;
  activeLevels?: number | null;
  ppobBalance?: unknown;
  bpjsBenefit?: string | null;
  businessRight?: string | null;
  merchandise?: unknown;
};

type RawOrder = {
  id: string;
  status: string;
  totalAmount: unknown;
  createdAt: string;
  registrationData?: Record<string, unknown> | null;
  membership?: { name?: string | null } | null;
  invoice?: { number?: string | null } | null;
  userMembership?: { status?: string | null } | null;
  user?: { fullName?: string | null } | null;
};

/** Prisma membuat serial kolom Decimal sebagai string, bukan number. */
function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
    // Pesan dari server dipakai apa adanya; tidak pernah menampilkan exception
    // mentah atau detail internal kepada pengguna.
    throw new Error(payload.message ?? "Permintaan belum dapat diproses.");
  }
  return payload.data as T;
}

export async function login(phone: string, password: string) {
  const result = await request<{ accessToken: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone, password })
  });
  return result;
}

export async function listPackages(): Promise<MembershipPackage[]> {
  const result = await request<RawMembership[]>("/web/membership/packages");
  return result
    // Basic adalah paket bawaan setiap akun; tidak ada yang perlu diupgrade ke sana.
    .filter((item) => item.tier !== "BASIC")
    .map(toPackage)
    .sort((left, right) => left.price - right.price);
}

export async function createOrder(
  token: string,
  packageId: string,
  registrationData: Record<string, unknown>
): Promise<UpgradeOrder> {
  const result = await request<RawOrder>("/web/membership/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ packageId, registrationData })
  });
  return toOrder(result);
}

/**
 * Mengunggah satu dokumen identitas.
 *
 * Berkasnya dikirim mentah, bukan base64 di dalam JSON: base64 membengkakkan
 * muatan sekitar sepertiga tanpa memberi keuntungan apa pun di sini.
 */
export async function uploadDocument(
  token: string,
  orderId: string,
  type: "ktp" | "selfie",
  file: File
) {
  const response = await fetch(
    `${API_BASE}/web/membership/orders/${orderId}/documents/${type}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": file.type
      },
      body: file,
      credentials: "omit"
    }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? "Dokumen belum dapat diunggah.");
  }
}

export async function payOrder(token: string, orderId: string): Promise<PaymentHandoff> {
  const result = await request<{ redirectUrl?: string | null; paid?: boolean }>(
    `/web/membership/orders/${orderId}/pay`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({})
    }
  );
  return {
    redirectUrl: result.redirectUrl ?? "",
    alreadyPaid: result.paid === true
  };
}

export async function getOrder(token: string, orderId: string): Promise<UpgradeOrder> {
  const result = await request<RawOrder>(`/web/membership/orders/${orderId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  return toOrder(result);
}

function toPackage(raw: RawMembership): MembershipPackage {
  const benefits: string[] = [];
  const ppob = toNumber(raw.ppobBalance);
  if (ppob > 0) {
    benefits.push(`Saldo PPOB awal ${formatAmount(ppob)}`);
  }
  if (raw.activeLevels && raw.activeLevels > 0) {
    benefits.push(`Insentif kemitraan sampai level ${raw.activeLevels}`);
  }
  if (raw.bpjsBenefit) {
    benefits.push(raw.bpjsBenefit);
  }
  if (raw.businessRight) {
    benefits.push(raw.businessRight);
  }
  if (Array.isArray(raw.merchandise)) {
    for (const item of raw.merchandise) {
      if (typeof item === "string" && item.trim()) {
        benefits.push(item.trim());
      }
    }
  }

  return {
    id: raw.id,
    name: raw.name,
    tier: raw.tier,
    price: toNumber(raw.price),
    benefits
  };
}

function toOrder(raw: RawOrder): UpgradeOrder {
  const invoiceNumber = raw.invoice?.number ?? "";
  return {
    id: raw.id,
    // Nomor invoice adalah nomor yang dilihat pengguna di bukti bayar, jadi itu
    // yang dipakai sebagai nomor pengajuan. UUID order tidak pernah ditampilkan.
    reference: invoiceNumber || raw.id,
    packageName: raw.membership?.name ?? "",
    amount: toNumber(raw.totalAmount),
    status: toViewStatus(raw),
    createdAt: raw.createdAt,
    invoiceNumber,
    buyerName: raw.user?.fullName ?? ""
  };
}

/**
 * Menurunkan status tampilan dari keadaan order di server.
 *
 * Sejak Stage R2.6 jalur A, PAID tidak lagi berarti aktif: pembelian dari web
 * baru aktif setelah admin memverifikasi dokumen. Karena itu status tampilan
 * tidak dapat dipetakan satu-lawan-satu dari kolom status.
 */
function toViewStatus(raw: RawOrder): UpgradeOrderStatus {
  const rejected = Boolean(raw.registrationData?.documentRejection);

  switch (raw.status) {
    case "PENDING":
      return "PENDING";
    case "PAID":
      return raw.userMembership?.status === "ACTIVE"
        ? "ACTIVE"
        : "PAID_AWAITING_VERIFICATION";
    case "CANCELLED":
      // Dibatalkan karena dokumen ditolak berarti ada dana yang harus kembali.
      // Itu pesan yang sangat berbeda dari pembatalan biasa.
      return rejected ? "REJECTED_REFUNDING" : "CANCELLED";
    case "EXPIRED":
    case "FAILED":
      return "EXPIRED";
    default:
      return "PENDING";
  }
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(value);
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
