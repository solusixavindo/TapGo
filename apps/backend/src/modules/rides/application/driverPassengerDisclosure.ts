import { RideOrderStatus } from "@prisma/client";
import { isDisclosableStatus } from "./passengerDriverDisclosure.js";

/**
 * Pengungkapan identitas PENUMPANG kepada driver.
 *
 * Arah sebaliknya dari passengerDriverDisclosure.ts (driver -> penumpang),
 * memakai aturan gating status YANG SAMA (isDisclosableStatus) supaya kedua
 * arah simetris: bila penumpang belum boleh melihat driver, driver juga
 * belum boleh melihat penumpang, dan sebaliknya.
 *
 * Yang TIDAK pernah keluar dari sini: nomor telepon, email, NIK, rating,
 * maupun UUID internal penumpang — driver menghubungi lewat chat dalam
 * aplikasi (RideChatScreen), bukan kontak langsung.
 */
export const GENERIC_PASSENGER_NAME = "Penumpang TapGo";

export type DriverPassengerView = { displayName: string };

/** Bentuk minimum yang dibutuhkan; sengaja bukan tipe Prisma penuh. */
export type DriverDisclosureSource = {
  status: RideOrderStatus;
  driverProfileId: string | null;
  assignedAt: Date | null;
  passenger?: { fullName?: string | null } | null;
};

/**
 * Nama depan saja. Logika identik toDriverDisplayName di
 * passengerDriverDisclosure.ts, dipertahankan terpisah (bukan reuse fungsi
 * yang sama) supaya kedua arah bisa berevolusi independen tanpa risiko
 * perubahan satu arah tidak sengaja memengaruhi arah lain.
 */
export function toPassengerDisplayName(fullName: string | null | undefined): string {
  if (typeof fullName !== "string") {
    return GENERIC_PASSENGER_NAME;
  }
  const normalized = fullName.replace(/\s+/g, " ").trim();
  if (normalized === "") {
    return GENERIC_PASSENGER_NAME;
  }
  const first = normalized.split(" ")[0] ?? "";
  if (!/[\p{L}\p{N}]/u.test(first)) {
    return GENERIC_PASSENGER_NAME;
  }
  return first;
}

/**
 * Membangun bagian passenger untuk driver order view.
 *
 * Mengembalikan null bila order belum ditugaskan ke driver mana pun (status
 * belum disclosable) — driver yang belum menerima order tidak pernah melihat
 * identitas penumpang, konsisten dengan toOfferView yang sudah anonim.
 */
export function buildDriverDisclosure(source: DriverDisclosureSource): {
  passenger: DriverPassengerView | null;
} {
  if (!isDisclosableStatus(source.status, source.assignedAt)) {
    return { passenger: null };
  }
  if (!source.driverProfileId) {
    return { passenger: null };
  }
  if (!source.passenger) {
    return { passenger: null };
  }
  return {
    passenger: { displayName: toPassengerDisplayName(source.passenger.fullName) },
  };
}

/**
 * Projection minimum untuk jalur driver.
 *
 * Sengaja TIDAK memuat: id, phone, email, maupun kolom lain yang tidak
 * dipakai kontrak.
 */
export const DRIVER_DISCLOSURE_INCLUDE = {
  passenger: { select: { fullName: true } },
} as const;
