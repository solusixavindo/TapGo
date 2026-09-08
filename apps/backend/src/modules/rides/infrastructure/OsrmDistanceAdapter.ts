import { RideServiceType } from "@prisma/client";
import { logger } from "../../../core/logger/logger.js";
import { DistanceEstimate, DistancePort, GeoPoint } from "../domain/ridePorts.js";

const REQUEST_TIMEOUT_MS = 5000;
/** Konsisten dengan LocalDistanceAdapter: ETA penjemputan disederhanakan
 * sebagai fraksi durasi perjalanan, bukan estimasi terpisah. */
const ETA_FRACTION_OF_DURATION = 0.25;

type OsrmRouteResponse = {
  code?: string;
  routes?: Array<{ distance?: number; duration?: number }>;
};

/**
 * Mem-parse respons OSRM `/route` menjadi jarak+durasi.
 *
 * Dipisah dari pemanggilan jaringan agar dapat diuji dengan fixture JSON
 * langsung, mengikuti pola mapDigiflazzStatus — tidak perlu stub fetch untuk
 * menguji logika pemetaan.
 */
export function mapOsrmRouteResponse(payload: OsrmRouteResponse): {
  distanceMeters: number;
  durationSeconds: number;
} {
  const route = payload.routes?.[0];
  if (
    payload.code !== "Ok" ||
    !route ||
    !Number.isFinite(route.distance) ||
    !Number.isFinite(route.duration)
  ) {
    throw new Error(`OSRM route response tidak valid (code=${payload.code ?? "?"})`);
  }
  return {
    distanceMeters: Math.max(1, Math.round(route.distance as number)),
    durationSeconds: Math.max(1, Math.round(route.duration as number)),
  };
}

/**
 * Adapter jarak berbasis rute jalan asli lewat instance OSRM self-host.
 *
 * Berbeda dari LocalDistanceAdapter (haversine + faktor 1.35), jarak dan
 * durasi di sini datang dari graf jalan sungguhan — presisi tarif tidak lagi
 * bergantung pada garis lurus yang meleset di jalan berkelok/satu arah.
 *
 * Ketersediaan booking diprioritaskan di atas presisi: bila OSRM tidak dapat
 * dihubungi, timeout, atau merespons tidak valid, adapter jatuh ke
 * `fallback` (LocalDistanceAdapter) alih-alih menggagalkan quote. Field
 * `source` pada hasil tetap jujur soal adapter mana yang benar-benar
 * dipakai, sehingga degradasi tetap auditable lewat data yang sama yang
 * sudah dipakai untuk fareRuleVersion.
 */
export class OsrmDistanceAdapter implements DistancePort {
  static readonly SOURCE = "OSRM_ROAD_V1";

  constructor(
    private readonly baseUrl: string,
    private readonly fallback: DistancePort,
  ) {}

  async estimate(input: {
    pickup: GeoPoint;
    dropoff: GeoPoint;
    serviceType: RideServiceType;
  }): Promise<DistanceEstimate> {
    try {
      const { distanceMeters, durationSeconds } = await this.fetchRoute(
        input.pickup,
        input.dropoff,
      );
      const boundedDuration = Math.max(60, durationSeconds);
      const etaSeconds = Math.max(
        60,
        Math.round(boundedDuration * ETA_FRACTION_OF_DURATION),
      );
      return {
        distanceMeters,
        durationSeconds: boundedDuration,
        etaSeconds,
        source: OsrmDistanceAdapter.SOURCE,
      };
    } catch (error) {
      logger.warn(
        { err: error },
        "OSRM route request failed, falling back to local distance estimate",
      );
      return this.fallback.estimate(input);
    }
  }

  private async fetchRoute(pickup: GeoPoint, dropoff: GeoPoint) {
    const coords = `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;
    const url = `${this.baseUrl.replace(/\/$/, "")}/route/v1/driving/${coords}?overview=false&alternatives=false&steps=false`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OSRM request rejected (HTTP ${response.status})`);
    }
    const payload = (await response.json()) as OsrmRouteResponse;
    return mapOsrmRouteResponse(payload);
  }
}
