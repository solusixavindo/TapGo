import { RideServiceType } from "@prisma/client";

/**
 * Kalkulator tarif provider-neutral.
 *
 * Aturan uang (Stage 5.2):
 * - SELURUH perhitungan memakai integer rupiah penuh (number bulat), tanpa
 *   floating point pada nilai akhir maupun komponen tersimpan.
 * - Pembulatan deterministik: jumlahkan seluruh komponen lebih dulu, lalu
 *   bulatkan total ke Rp100 terdekat dengan half-up.
 * - Konfigurasi tarif berada di server (bukan di UI/presentation).
 */

export const FARE_RULE_VERSION = "RIDE_FARE_RULE_V2";
export const FARE_ROUNDING_RULE = "ROUND_TO_NEAREST_100_HALF_UP";

export type FareRule = {
  baseFare: number;
  /** Kilometer pertama yang sudah termasuk dalam baseFare. */
  includedKm: number;
  perKmFare: number;
  minimumFare: number;
  serviceFee: number;
};

/**
 * Konfigurasi tarif default per jenis layanan (integer rupiah).
 * Nilai dapat dipindah ke tabel konfigurasi/admin pada tahap berikutnya
 * tanpa mengubah kontrak kalkulator ini.
 */
export const DEFAULT_FARE_RULES: Record<RideServiceType, FareRule> = {
  MOTORCYCLE: {
    baseFare: 8_500,
    includedKm: 4,
    perKmFare: 2_100,
    minimumFare: 9_000,
    serviceFee: 1_000,
  },
  CAR: {
    baseFare: 13_000,
    includedKm: 3,
    perKmFare: 4_000,
    minimumFare: 17_000,
    serviceFee:  2_500,
  },
};

export type FareBreakdown = {
  baseFare: number;
  distanceFare: number;
  serviceFee: number;
  /** Jumlah seluruh komponen SEBELUM pembulatan (untuk audit). */
  subtotalFare: number;
  /** Nilai final SETELAH pembulatan Rp100 half-up. */
  totalFare: number;
  fareRuleVersion: string;
  roundingRule: string;
};

/** Pembulatan ke Rp100 terdekat, half-up, murni aritmetika integer. */
export function roundToNearestHundredHalfUp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError("Nilai tarif harus berupa angka terbatas");
  }
  const intValue = Math.trunc(value);
  return Math.trunc((intValue + 50) / 100) * 100;
}

/**
 * Menghitung tarif authoritative dari jarak yang sudah diverifikasi server.
 *
 * @param distanceMeters jarak dari sumber tepercaya server (bukan client)
 */
export function calculateFare(input: {
  serviceType: RideServiceType;
  distanceMeters: number;
  rule?: FareRule;
}): FareBreakdown {
  const rule = input.rule ?? DEFAULT_FARE_RULES[input.serviceType];

  if (!Number.isInteger(input.distanceMeters) || input.distanceMeters <= 0) {
    throw new TypeError("distanceMeters harus bilangan bulat positif");
  }

  // kilometer yang ditagih hanyalah yang melebihi includedKm (tarif paket).
  const billableMeters = Math.max(0, input.distanceMeters - rule.includedKm * 1000);
  // Tarif jarak dihitung dari meter agar tidak ada pecahan tersembunyi.

  const distanceFare = Math.trunc(
    (billableMeters * rule.perKmFare) / 1000,
  );

  const rawSubtotal = rule.baseFare + distanceFare + rule.serviceFee;
  const subtotalFare = Math.max(rawSubtotal, rule.minimumFare);
  const totalFare = roundToNearestHundredHalfUp(subtotalFare);

  return {
    baseFare: rule.baseFare,
    distanceFare,
    serviceFee: rule.serviceFee,
    subtotalFare,
    totalFare,
    fareRuleVersion: FARE_RULE_VERSION,
    roundingRule: FARE_ROUNDING_RULE,
  };
}

/** Masa berlaku quote. */
export const QUOTE_TTL_SECONDS = 120;

export function quoteExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000);
}
