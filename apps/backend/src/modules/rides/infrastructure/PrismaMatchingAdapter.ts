import { PrismaClient, RideServiceType } from "@prisma/client";
import { GeoPoint, MatchCandidate, MatchingPort } from "../domain/ridePorts.js";

/**
 * Adapter matching deterministik berbasis database (tanpa jaringan/realtime).
 *
 * Aturan kelayakan:
 * - driver berstatus ACTIVE (bukan PENDING/SUSPENDED/REJECTED);
 * - availability ONLINE (bukan OFFLINE/BUSY);
 * - memiliki kendaraan aktif & terverifikasi dengan tipe yang cocok;
 * - tidak sedang memegang ride aktif.
 *
 * Adapter ini hanya MENYARANKAN kandidat. Penetapan driver tetap dilakukan
 * secara atomic pada RideOrderService (conditional update), sehingga aman
 * terhadap balapan (race) meski beberapa kandidat dikembalikan.
 */
export class PrismaMatchingAdapter implements MatchingPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findCandidates(input: {
    serviceType: RideServiceType;
    pickup: GeoPoint;
    limit: number;
  }): Promise<MatchCandidate[]> {
    const drivers = await this.prisma.rideDriverProfile.findMany({
      where: {
        status: "ACTIVE",
        availability: "ONLINE",
        user: { status: "ACTIVE" },
        vehicles: {
          some: {
            type: input.serviceType,
            isActive: true,
            verificationStatus: "VERIFIED",
          },
        },
        // Tidak sedang memegang perjalanan aktif.
        orders: {
          none: {
            status: {
              in: [
                "DRIVER_ASSIGNED",
                "DRIVER_TO_PICKUP",
                "DRIVER_ARRIVED",
                "IN_TRIP",
              ],
            },
          },
        },
      },
      select: {
        id: true,
        vehicles: {
          where: {
            type: input.serviceType,
            isActive: true,
            verificationStatus: "VERIFIED",
          },
          select: { id: true },
          take: 1,
        },
      },
      // Deterministik agar test dapat direproduksi.
      orderBy: { id: "asc" },
      take: Math.max(1, Math.min(input.limit, 50)),
    });

    return drivers
      .filter((d) => d.vehicles.length > 0)
      .map((d) => ({
        driverProfileId: d.id,
        vehicleId: d.vehicles[0]!.id,
      }));
  }
}
