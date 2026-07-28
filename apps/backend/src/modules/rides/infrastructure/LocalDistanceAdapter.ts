import { RideServiceType } from "@prisma/client";
import { DistanceEstimate, DistancePort, GeoPoint } from "../domain/ridePorts.js";

/**
 * Adapter estimasi jarak deterministik in-process (tanpa jaringan).
 *
 * Memakai haversine + faktor jalan sederhana. Ini BUKAN pengganti routing
 * provider; tujuannya agar jarak selalu berasal dari server (bukan client)
 * dan seluruh test dapat berjalan tanpa network/credential.
 */
export class LocalDistanceAdapter implements DistancePort {
  static readonly SOURCE = "HAVERSINE_LOCAL_V1";

  /** Faktor koreksi jarak garis lurus -> perkiraan jarak jalan. */
  private readonly roadFactor = 1.35;

  private readonly averageSpeedMps: Record<RideServiceType, number> = {
    MOTORCYCLE: 7.5,
    CAR: 5.8,
  };

  async estimate(input: {
    pickup: GeoPoint;
    dropoff: GeoPoint;
    serviceType: RideServiceType;
  }): Promise<DistanceEstimate> {
    const straight = haversineMeters(input.pickup, input.dropoff);
    const distanceMeters = Math.max(1, Math.round(straight * this.roadFactor));
    const speed = this.averageSpeedMps[input.serviceType];
    const durationSeconds = Math.max(60, Math.round(distanceMeters / speed));
    // ETA penjemputan disederhanakan sebagai fraksi durasi perjalanan.
    const etaSeconds = Math.max(60, Math.round(durationSeconds * 0.25));

    return {
      distanceMeters,
      durationSeconds,
      etaSeconds,
      source: LocalDistanceAdapter.SOURCE,
    };
  }
}

const EARTH_RADIUS_METERS = 6_371_000;

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}
