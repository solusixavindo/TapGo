import { RideServiceType } from "@prisma/client";

/**
 * Port provider-neutral untuk domain Ride.
 *
 * Stage 5.2 TIDAK memakai provider nyata: seluruh implementasi adalah adapter
 * deterministik in-process. Tidak ada panggilan jaringan keluar, tidak ada
 * credential, dan tidak ada SDK Maps/routing/realtime.
 */

export type GeoPoint = {
  lat: number;
  lng: number;
};

/** Hasil estimasi jarak/waktu dari sumber yang dipercaya server. */
export type DistanceEstimate = {
  distanceMeters: number;
  durationSeconds: number;
  etaSeconds: number;
  /** Penanda sumber estimasi untuk audit (mis. "HAVERSINE_LOCAL_V1"). */
  source: string;
};

/**
 * Port estimasi jarak. Implementasi produksi kelak memanggil Routes API di
 * belakang port ini; client tidak pernah menjadi sumber jarak.
 */
export interface DistancePort {
  estimate(input: {
    pickup: GeoPoint;
    dropoff: GeoPoint;
    serviceType: RideServiceType;
  }): Promise<DistanceEstimate>;
}

export type MatchCandidate = {
  driverProfileId: string;
  vehicleId: string;
};

/**
 * Port pencarian driver. Implementasi hanya boleh MENYARANKAN kandidat;
 * penetapan driver tetap dilakukan secara atomic di service.
 */
export interface MatchingPort {
  findCandidates(input: {
    serviceType: RideServiceType;
    pickup: GeoPoint;
    limit: number;
  }): Promise<MatchCandidate[]>;
}

/** Batas validasi koordinat (wajar secara global). */
export function isValidCoordinate(point: GeoPoint): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

/** Ambang kesegaran lokasi driver. */
export const LOCATION_MAX_AGE_SECONDS = 60;
export const LOCATION_MAX_FUTURE_SKEW_SECONDS = 10;
export const LOCATION_MAX_ACCURACY_METERS = 500;

export function isLocationFresh(capturedAt: Date, now: Date): boolean {
  const ageMs = now.getTime() - capturedAt.getTime();
  if (ageMs > LOCATION_MAX_AGE_SECONDS * 1000) return false;
  // Tolak timestamp dari masa depan (di luar toleransi clock skew).
  if (ageMs < -LOCATION_MAX_FUTURE_SKEW_SECONDS * 1000) return false;
  return true;
}
