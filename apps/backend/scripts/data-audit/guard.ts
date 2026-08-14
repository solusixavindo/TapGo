/**
 * Penjaga bersama untuk seluruh tooling audit data.
 *
 * Satu tempat yang memutuskan boleh-tidaknya sebuah database disentuh, dan
 * satu tempat yang menyamarkan identifier. Duplikasi aturan ini di beberapa
 * script akan membuat salah satunya cepat atau lambat menyimpang.
 */

/**
 * Penanda environment non-production. Nama database WAJIB memuat salah satu
 * dari ini. Daftar ini sengaja berupa allowlist, bukan blocklist: environment
 * yang tidak dikenali otomatis ditolak, bukan diizinkan.
 */
const ALLOWED_ENVIRONMENT_MARKERS = ["test", "uat", "staging", "clone", "disposable"];

export class UnsafeEnvironmentError extends Error {}

/** Nama database dari connection string, tanpa pernah mengembalikan kredensial. */
export function databaseNameFromUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return url.pathname.replace(/^\//, "").split("?")[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * Menolak berjalan bila database tidak terbukti non-production.
 *
 * Pesan error tidak pernah memuat connection string — hanya nama database,
 * yang memang harus terlihat agar operator tahu apa yang ditolak.
 */
export function assertNonProductionDatabase(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    throw new UnsafeEnvironmentError("DATABASE_URL belum diisi.");
  }

  const name = databaseNameFromUrl(databaseUrl).toLowerCase();
  if (!name) {
    throw new UnsafeEnvironmentError("Nama database tidak dapat dibaca dari DATABASE_URL.");
  }

  const matched = ALLOWED_ENVIRONMENT_MARKERS.some((marker) => name.includes(marker));
  if (!matched) {
    throw new UnsafeEnvironmentError(
      `Database "${name}" tidak terbukti non-production. ` +
        `Nama wajib memuat salah satu dari: ${ALLOWED_ENVIRONMENT_MARKERS.join(", ")}. ` +
        "Tooling ini tidak boleh dijalankan terhadap production."
    );
  }

  return name;
}

/** Nomor telepon tersamarkan: hanya 4 digit terakhir. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) {
    return "*".repeat(digits.length);
  }
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** Email tersamarkan: satu huruf pertama, domain dipertahankan. */
export function maskEmail(email: string | null): string | null {
  if (!email) {
    return null;
  }
  const [local = "", domain = ""] = email.split("@");
  if (!domain) {
    return "*".repeat(email.length);
  }
  return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

/** Nama tersamarkan: inisial saja. */
export function maskName(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}.`)
    .join(" ");
}

export type DataClass =
  | "SYSTEM_MASTER"
  | "CONFIRMED_TEST"
  | "POSSIBLE_TEST"
  | "REAL_PRODUCTION"
  | "MUST_PRESERVE"
  | "REQUIRES_OWNER_DECISION";

export type FinancialFootprint = {
  invoices: number;
  membershipPayments: number;
  membershipOrders: number;
  commissions: number;
  withdrawals: number;
  walletTransactions: number;
  rewardTransactions: number;
  profitSharingDistributions: number;
};

export function hasFinancialFootprint(footprint: FinancialFootprint): boolean {
  return Object.values(footprint).some((count) => count > 0);
}

/**
 * Pola akun tester yang diketahui.
 *
 * Sengaja konservatif. Pola ini hanya boleh dipakai sebagai SINYAL, tidak
 * pernah sebagai izin menghapus: klasifikasi di bawah tetap mengangkat
 * apa pun yang punya jejak finansial keluar dari CONFIRMED_TEST.
 */
export const KNOWN_TESTER_PATTERNS: RegExp[] = [
  /^0?8{6,}$/, // nomor berulang seperti 08888888888
  /^0?1234567/, // urutan menaik
  /@(example|test|contoh)\.(com|test|local)$/i,
  /\+?62?8(0{6,})/ // nol beruntun
];

export function looksLikeTester(input: { phone: string; email: string | null }): boolean {
  const candidates = [input.phone, input.email ?? ""];
  return candidates.some((value) =>
    value ? KNOWN_TESTER_PATTERNS.some((pattern) => pattern.test(value)) : false
  );
}

/**
 * Klasifikasi satu akun.
 *
 * Aturan yang tidak boleh dilonggarkan: akun dengan jejak finansial TIDAK
 * PERNAH menjadi CONFIRMED_TEST, sekalipun polanya sangat mirip akun uji.
 * Salah menghapus data finansial nyata jauh lebih mahal daripada menyimpan
 * beberapa akun uji.
 */
export function classifyAccount(input: {
  phone: string;
  email: string | null;
  footprint: FinancialFootprint;
}): DataClass {
  const financial = hasFinancialFootprint(input.footprint);
  const tester = looksLikeTester(input);

  if (financial && tester) {
    return "POSSIBLE_TEST";
  }
  if (financial) {
    return "MUST_PRESERVE";
  }
  if (tester) {
    return "CONFIRMED_TEST";
  }
  return "REAL_PRODUCTION";
}
