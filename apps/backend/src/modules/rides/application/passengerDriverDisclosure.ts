import { RideOrderStatus, RideServiceType } from "@prisma/client";

/**
 * Pengungkapan identitas driver dan kendaraan kepada PENUMPANG.
 *
 * Dipisahkan sebagai modul murni tanpa akses database supaya seluruh aturan
 * masking dan gating dapat diuji langsung, dan supaya tidak ada satu pun
 * keputusan privasi yang berpindah ke Flutter.
 *
 * Yang TIDAK pernah keluar dari sini: plat mentah, blind index, nomor telepon,
 * email, NIK, SIM, STNK, URL dokumen, rating, maupun UUID internal.
 */

/** Label aman ketika nama tidak dapat dipakai. Keputusan Owner D-1. */
export const GENERIC_DRIVER_NAME = "Driver TapGo";

/** Label aman ketika plat tidak dapat dipetakan. Keputusan Owner D-2. */
export const GENERIC_PLATE_LABEL = "Plat terverifikasi";

/** Karakter mask. Bullet, bukan asterisk, mengikuti format B 12•• XYZ. */
const MASK_CHAR = "•";

/**
 * Status yang SELALU boleh membuka data driver bila relasinya lengkap.
 * Keputusan Owner D-5.
 */
const ALWAYS_DISCLOSABLE: ReadonlySet<RideOrderStatus> = new Set<RideOrderStatus>([
  "DRIVER_ASSIGNED",
  "DRIVER_TO_PICKUP",
  "DRIVER_ARRIVED",
  "IN_TRIP",
  "COMPLETED"
]);

/**
 * Pembatalan terminal. Boleh membuka data HANYA bila driver pernah ditetapkan,
 * yang dibuktikan `assignedAt`.
 */
const CANCELLATION_STATUSES: ReadonlySet<RideOrderStatus> = new Set<RideOrderStatus>([
  "CANCELLED_BY_PASSENGER",
  "CANCELLED_BY_DRIVER",
  "CANCELLED_BY_SYSTEM"
]);

export type PassengerDriverView = { displayName: string };

export type PassengerVehicleView = {
  serviceType: RideServiceType;
  model?: string;
  color?: string;
  maskedPlate: string;
};

/** Bentuk minimum yang dibutuhkan; sengaja bukan tipe Prisma penuh. */
export type DisclosureSource = {
  status: RideOrderStatus;
  driverProfileId: string | null;
  vehicleId: string | null;
  assignedAt: Date | null;
  driverProfile?: { user?: { fullName?: string | null } | null } | null;
  vehicle?: {
    type?: RideServiceType | null;
    model?: string | null;
    color?: string | null;
    plateNumberMasked?: string | null;
  } | null;
};

/**
 * Apakah status ini boleh membuka data driver.
 *
 * CREATED, SEARCHING_DRIVER, NO_DRIVER, dan EXPIRED tidak pernah boleh —
 * tidak disebut di kedua himpunan, sehingga fungsi ini menolaknya tanpa perlu
 * daftar larangan terpisah yang bisa lupa diperbarui.
 */
export function isDisclosableStatus(status: RideOrderStatus, assignedAt: Date | null): boolean {
  if (ALWAYS_DISCLOSABLE.has(status)) {
    return true;
  }
  if (CANCELLATION_STATUSES.has(status)) {
    return assignedAt !== null;
  }
  return false;
}

/**
 * Nama depan saja. Keputusan Owner D-1.
 *
 * Whitespace dinormalkan lebih dulu supaya "  Budi   Santoso " tidak
 * menghasilkan token kosong. Bila hasilnya bukan nama yang dapat dipakai,
 * label generik dipakai — BUKAN nama sintetis yang menyerupai orang nyata.
 */
export function toDriverDisplayName(fullName: string | null | undefined): string {
  if (typeof fullName !== "string") {
    return GENERIC_DRIVER_NAME;
  }
  const normalized = fullName.replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return GENERIC_DRIVER_NAME;
  }
  const first = normalized.split(" ")[0] ?? "";
  // Nama yang hanya berisi tanda baca atau karakter mask tidak dipakai.
  if (!/[\p{L}\p{N}]/u.test(first)) {
    return GENERIC_DRIVER_NAME;
  }
  return first;
}

/**
 * Masking plat sesuai format Owner D-2: `B 12•• XYZ`.
 *
 * Masukannya adalah `RideVehicle.plateNumberMasked` — kolom yang SUDAH
 * ter-masking. Plat mentah tidak pernah disimpan pada domain Ride (hanya
 * `plateNumberHash` sebagai blind index), sehingga fungsi ini tidak pernah
 * menyentuh nilai mentah dan tidak memerlukan perubahan schema.
 *
 * Fungsi ini hanya boleh MENGURANGI keterbukaan, tidak pernah menambah:
 *   - kode wilayah dipertahankan;
 *   - paling banyak dua digit pertama ditampilkan, sisanya di-mask;
 *   - suffix hanya ditampilkan bila benar-benar berupa huruf. Bila kolom
 *     tersimpan sudah menyembunyikannya (mis. `***`), suffix tidak dipulihkan.
 *
 * Bentuk apa pun di luar pola yang dikenali FAIL CLOSED ke label generik.
 * Nilai masukan tidak pernah dikembalikan apa adanya sebagai fallback.
 */
export function toMaskedPlate(storedMasked: string | null | undefined): string {
  if (typeof storedMasked !== "string") {
    return GENERIC_PLATE_LABEL;
  }

  const normalized = storedMasked.replace(/\s+/g, " ").trim().toUpperCase();
  if (normalized === "") {
    return GENERIC_PLATE_LABEL;
  }

  const parts = normalized.split(" ");
  if (parts.length < 2 || parts.length > 3) {
    return GENERIC_PLATE_LABEL;
  }

  const [region, digits, suffix] = parts;

  // Kode wilayah Indonesia: satu atau dua huruf.
  if (!region || !/^[A-Z]{1,2}$/.test(region)) {
    return GENERIC_PLATE_LABEL;
  }

  // Nomor polisi: 1–4 digit. Kolom yang sudah menyembunyikan digit tidak
  // dapat dipetakan dengan aman, jadi ditolak.
  if (!digits || !/^[0-9]{1,4}$/.test(digits)) {
    return GENERIC_PLATE_LABEL;
  }

  const visible = digits.slice(0, 2);
  const masked = MASK_CHAR.repeat(Math.max(0, digits.length - visible.length));
  const numberPart = `${visible}${masked}`;

  // Suffix opsional, dan tiga kemungkinannya dibedakan dengan sengaja:
  //
  //   1. huruf asli 1–3 karakter  -> ditampilkan (format penuh D-2);
  //   2. seluruhnya karakter mask -> nilai tersimpan memang sudah
  //      menyembunyikannya. Suffix dibuang dan TIDAK dipulihkan, tetapi bagian
  //      digit tetap dipetakan karena itu aman dan justru lebih tertutup
  //      daripada nilai tersimpan;
  //   3. bentuk lain              -> struktur plat tidak dikenali. Ini FAIL
  //      CLOSED penuh: nilai yang tidak berbentuk plat tidak boleh dipetakan
  //      sebagian, karena bisa jadi ia bukan plat sama sekali.
  if (suffix === undefined) {
    return `${region} ${numberPart}`;
  }
  if (/^[A-Z]{1,3}$/.test(suffix)) {
    return `${region} ${numberPart} ${suffix}`;
  }
  if (/^[*•]+$/.test(suffix)) {
    return `${region} ${numberPart}`;
  }
  return GENERIC_PLATE_LABEL;
}

/**
 * Membangun bagian driver dan vehicle untuk passenger order view.
 *
 * Mengembalikan null berpasangan: bila salah satu relasi tidak lengkap,
 * keduanya null. Tidak pernah mengembalikan kendaraan tanpa driver atau
 * sebaliknya, sehingga UI tidak perlu menangani state setengah jadi.
 */
export function buildPassengerDisclosure(source: DisclosureSource): {
  driver: PassengerDriverView | null;
  vehicle: PassengerVehicleView | null;
} {
  const empty = { driver: null, vehicle: null };

  if (!isDisclosableStatus(source.status, source.assignedAt)) {
    return empty;
  }

  // Relasi wajib lengkap. Foreign key yang ada tanpa baris terkait berarti
  // data tidak konsisten, dan itu fail-closed.
  if (!source.driverProfileId || !source.vehicleId) {
    return empty;
  }
  if (!source.driverProfile || !source.vehicle) {
    return empty;
  }

  const serviceType = source.vehicle.type;
  if (serviceType !== "MOTORCYCLE" && serviceType !== "CAR") {
    // Jenis kendaraan tak dikenal tidak diteruskan sebagai nilai mentah.
    return empty;
  }

  const vehicle: PassengerVehicleView = {
    serviceType,
    maskedPlate: toMaskedPlate(source.vehicle.plateNumberMasked)
  };

  // model dan color hanya disertakan bila benar-benar ada isinya. Nilai kosong
  // tidak dikirim sebagai string kosong agar UI tidak menampilkan baris hampa.
  const model = source.vehicle.model?.replace(/\s+/g, " ").trim();
  if (model) {
    vehicle.model = model;
  }
  const color = source.vehicle.color?.replace(/\s+/g, " ").trim();
  if (color) {
    vehicle.color = color;
  }

  return {
    driver: { displayName: toDriverDisplayName(source.driverProfile.user?.fullName) },
    vehicle
  };
}

/**
 * Projection minimum untuk kedua endpoint penumpang.
 *
 * Sengaja TIDAK memuat: userId, driverProfileId pada relasi, phone, email,
 * plateNumberHash, verificationStatus, rating, maupun kolom lain yang tidak
 * dipakai kontrak.
 */
export const PASSENGER_DISCLOSURE_INCLUDE = {
  driverProfile: {
    select: { user: { select: { fullName: true } } }
  },
  vehicle: {
    select: { type: true, model: true, color: true, plateNumberMasked: true }
  }
} as const;
