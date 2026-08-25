import { createHash } from "node:crypto";
import {
  Prisma,
  PrismaClient,
  RideDriverApplicationStatus,
  RideServiceType
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import {
  DRIVER_DOCUMENT_TYPES,
  DriverDocumentService
} from "./DriverDocumentService.js";
import { DriverReviewScopeService } from "../../rides/application/DriverReviewScopeService.js";

/**
 * Pengajuan mandiri mitra driver (Stage H1, keputusan Owner K1-A..K4-A + D1).
 *
 * Alurnya:
 *   1. Calon mitra mengunggah 4 dokumen (KTP/SIM/STNK/SELFIE). Baris Driver
 *      pradataur dibuat otomatis oleh DriverDocumentService.
 *   2. Ia mengisi data kendaraan lalu SUBMIT. Empat dokumen wajib sudah
 *      terunggah dan masih terbaca (K1-A); tanpa itu pengajuan ditolak.
 *   3. Admin dengan scope driver-review mengklaim pengajuan (lease 15 menit),
 *      mencetak dokumen, lalu APPROVE atau REJECT. Hanya pemegang klaim aktif
 *      yang dapat memutuskan (K3-A).
 *   4. APPROVE menciptakan RideDriverProfile + RideVehicle (K4-A). Data
 *      kendaraan yang selama pengajuan disimpan pada Driver legacy
 *      (vehicleType/vehiclePlate, plat ter-mask) dipindahkan ke RideVehicle;
 *      plaintext plat tidak pernah disimpan — hanya SHA-256 dan bentuk
 *      ter-mask (K2-A).
 *
 * Nomor siklus dihitung di dalam transaksi dengan mengunci baris User:
 * cycle berikutnya = COUNT(*) + 1. Partial unique index pada database
 * (satu open application per user) adalah penjaga terakhir; bila dua submit
 * benar-benar bersaing, yang kalah gagal oleh constraint, bukan oleh race
 * pembacaan.
 */

export const DRIVER_APPLICATION_DOCUMENTS_INCOMPLETE =
  "DRIVER_APPLICATION_DOCUMENTS_INCOMPLETE";
export const DRIVER_APPLICATION_NO_OPEN = "DRIVER_APPLICATION_NO_OPEN";
export const DRIVER_APPLICATION_ALREADY_ACTIVE_DRIVER =
  "DRIVER_APPLICATION_ALREADY_ACTIVE_DRIVER";
export const DRIVER_APPLICATION_REVIEW_NOT_ALLOWED =
  "DRIVER_APPLICATION_REVIEW_NOT_ALLOWED";

export const REJECT_REASON_CODES = [
  "DOCUMENTS_UNREADABLE",
  "DOCUMENTS_MISMATCH",
  "VEHICLE_NOT_ELIGIBLE",
  "INCOMPLETE_REQUIREMENTS",
  "OTHER"
] as const;
export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number];

const OPEN_STATUSES: RideDriverApplicationStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW"
];

/** Bentuk plat yang diterima: 4-12 karakter alfanumerik plus spasi/strip. */
const PLATE_PATTERN = /^[A-Z0-9][A-Z0-9 -]{2,11}$/;

function normalizePlate(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

function hashPlate(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** Bentuk tampilan aman, mis. "A 1234 ***". Karakter terakhir disembunyikan. */
function maskPlate(normalized: string): string {
  const compact = normalized.replace(/[ -]/g, "");
  const visible = normalized.slice(0, Math.max(0, normalized.length - 3)).trimEnd();
  if (compact.length <= 3) return "***";
  return `${visible} ***`;
}

export type DriverApplicationSummary = {
  id: string;
  cycleNumber: number;
  status: RideDriverApplicationStatus;
  version: number;
  submittedAt: Date | null;
  decisionReasonCode: string | null;
};

export class DriverApplicationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scopes: DriverReviewScopeService
  ) {}

  // -------------------------------------------------------------------
  // Sisi calon mitra
  // -------------------------------------------------------------------

  /** Pengajuan terbuka milik pengguna yang sedang masuk, bila ada. */
  async myApplication(userId: string): Promise<{
    application: DriverApplicationSummary | null;
    documentsComplete: boolean;
    vehicle: { serviceType: RideServiceType | null; plateMasked: string | null };
  }> {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true, vehicleType: true, vehiclePlate: true }
    });

    const application = await this.prisma.rideDriverApplication.findFirst({
      where: { userId, status: { in: OPEN_STATUSES } },
      orderBy: { cycleNumber: "desc" },
      select: {
        id: true,
        cycleNumber: true,
        status: true,
        version: true,
        submittedAt: true,
        decisionReasonCode: true
      }
    });

    const documentsComplete = driver
      ? await this.requiredDocumentsComplete(driver.id)
      : false;

    return {
      application,
      documentsComplete,
      vehicle: {
        serviceType: this.legacyVehicleTypeToServiceType(driver?.vehicleType ?? null),
        plateMasked: driver?.vehiclePlate ?? null
      }
    };
  }

  /**
   * Mengirim pengajuan baru. Satu pengajuan terbuka per user — ditegakkan
   * partial unique index di database, dicek lebih dulu di sini demi pesan
   * galat yang manusiawi.
   */
  async submit(input: {
    userId: string;
    serviceType: RideServiceType;
    plateNumber: string;
    brand?: string;
    model?: string;
    color?: string;
  }): Promise<DriverApplicationSummary> {
    const plate = normalizePlate(input.plateNumber);
    if (!PLATE_PATTERN.test(plate)) {
      throw new AppError(
        "Nomor plat tidak valid.",
        StatusCodes.BAD_REQUEST,
        "DRIVER_APPLICATION_PLATE_INVALID"
      );
    }

    // Pradataur ada begitu dokumen pertama diunggah. Bila belum ada sama
    // sekali, dokumen pasti belum lengkap.
    const driver = await this.prisma.driver.findUnique({
      where: { userId: input.userId },
      select: { id: true, kycStatus: true }
    });

    if (!driver || !(await this.requiredDocumentsComplete(driver.id))) {
      throw new AppError(
        "Lengkapi dulu keempat dokumen (KTP, SIM, STNK, foto diri) sebelum mengajukan.",
        StatusCodes.CONFLICT,
        DRIVER_APPLICATION_DOCUMENTS_INCOMPLETE
      );
    }

    const existingProfile = await this.prisma.rideDriverProfile.findUnique({
      where: { userId: input.userId },
      select: { status: true }
    });
    if (existingProfile && existingProfile.status !== "REJECTED") {
      throw new AppError(
        "Anda sudah terdaftar sebagai mitra driver.",
        StatusCodes.CONFLICT,
        DRIVER_APPLICATION_ALREADY_ACTIVE_DRIVER
      );
    }

    const plateMasked = maskPlate(plate);
    const plateHashed = hashPlate(plate);
    const legacyType =
      input.serviceType === "MOTORCYCLE" ? "BIKE" : "CAR";

    return this.prisma.$transaction(async (tx) => {
      // Mengunci baris User membuat perhitungan cycleNumber serial per user.
      await tx.$executeRaw`SELECT id FROM "users" WHERE id = ${input.userId}::uuid FOR UPDATE`;

      const openCount = await tx.rideDriverApplication.count({
        where: { userId: input.userId, status: { in: OPEN_STATUSES } }
      });
      if (openCount > 0) {
        throw new AppError(
          "Masih ada pengajuan yang sedang diproses.",
          StatusCodes.CONFLICT,
          "DRIVER_APPLICATION_OPEN_EXISTS"
        );
      }

      const total = await tx.rideDriverApplication.count({
        where: { userId: input.userId }
      });

      const application = await tx.rideDriverApplication.create({
        data: {
          userId: input.userId,
          cycleNumber: total + 1,
          status: "SUBMITTED",
          submittedAt: new Date()
        },
        select: {
          id: true,
          cycleNumber: true,
          status: true,
          version: true,
          submittedAt: true,
          decisionReasonCode: true
        }
      });

      // Data kendaraan menunggu keputusan pada Driver legacy; dipindahkan ke
      // RideVehicle saat approve. Plat yang tersimpan di sini sudah ter-mask.
      await tx.driver.update({
        where: { id: driver.id },
        data: {
          vehicleType: legacyType,
          vehiclePlate: plateMasked,
          licenseNumber: plateHashed,
          kycStatus: "PENDING"
        }
      });

      return application;
    });
  }

  /** Menarik pengajuan yang masih terbuka. */
  async withdraw(userId: string): Promise<DriverApplicationSummary> {
    const open = await this.prisma.rideDriverApplication.findFirst({
      where: { userId, status: { in: OPEN_STATUSES } },
      orderBy: { cycleNumber: "desc" }
    });

    if (!open) {
      throw new AppError(
        "Tidak ada pengajuan yang bisa ditarik.",
        StatusCodes.NOT_FOUND,
        DRIVER_APPLICATION_NO_OPEN
      );
    }

    const updated = await this.prisma.rideDriverApplication.updateMany({
      where: { id: open.id, status: { in: OPEN_STATUSES } },
      data: {
        status: "WITHDRAWN",
        withdrawnAt: new Date(),
        version: { increment: 1 }
      }
    });
    if (updated.count === 0) {
      throw new AppError(
        "Pengajuan sudah berubah status.",
        StatusCodes.CONFLICT,
        DRIVER_APPLICATION_NO_OPEN
      );
    }

    await this.syncLegacyKycAfterTerminal(userId, "REJECTED");

    return this.prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: open.id },
      select: {
        id: true,
        cycleNumber: true,
        status: true,
        version: true,
        submittedAt: true,
        decisionReasonCode: true
      }
    });
  }

  // -------------------------------------------------------------------
  // Sisi admin (K3-A): hanya pemegang klaim aktif yang boleh memutuskan
  // -------------------------------------------------------------------

  async approve(input: {
    actorId: string;
    applicationId: string;
  }): Promise<DriverApplicationSummary> {
    await this.scopes.requireScope(input.actorId, "DRIVER_APPLICATION_CLAIM", {
      applicationId: input.applicationId,
      auditAllowed: true
    });

    const application = await this.requireDecisionContext(input);

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Validasi ulang klaim di dalam transaksi — lease bisa kedaluwarsa
      // di antara pemeriksaan dan keputusan.
      await this.assertClaimHeldBy(tx, input.applicationId, input.actorId, now);

      const decided = await tx.rideDriverApplication.updateMany({
        where: { id: input.applicationId, status: "UNDER_REVIEW" },
        data: {
          status: "APPROVED",
          approvedAt: now,
          reviewedById: input.actorId,
          reviewedAt: now,
          version: { increment: 1 }
        }
      });
      if (decided.count === 0) {
        throw new AppError(
          "Pengajuan sudah berubah status.",
          StatusCodes.CONFLICT,
          DRIVER_APPLICATION_REVIEW_NOT_ALLOWED
        );
      }

      const legacyDriver = await tx.driver.findUnique({
        where: { userId: application.userId }
      });
      if (!legacyDriver) {
        throw new AppError(
          "Data mitra tidak lengkap.",
          StatusCodes.CONFLICT,
          DRIVER_APPLICATION_REVIEW_NOT_ALLOWED
        );
      }

      const serviceType =
        this.legacyVehicleTypeToServiceType(legacyDriver.vehicleType) ??
        "MOTORCYCLE";
      const plateMasked = legacyDriver.vehiclePlate ?? "***";
      const plateHashed = legacyDriver.licenseNumber ?? hashPlate(plateMasked);

      // K4-A: profil operasional + kendaraan lahir di sini.
      const profile = await tx.rideDriverProfile.upsert({
        where: { userId: application.userId },
        update: { status: "PENDING" },
        create: { userId: application.userId, status: "PENDING" }
      });

      await tx.rideVehicle.upsert({
        where: {
          driverProfileId_plateNumberHash: {
            driverProfileId: profile.id,
            plateNumberHash: plateHashed
          }
        },
        update: { verificationStatus: "VERIFIED", isActive: true },
        create: {
          driverProfileId: profile.id,
          type: serviceType,
          plateNumberHash: plateHashed,
          plateNumberMasked: plateMasked,
          verificationStatus: "VERIFIED",
          isActive: true
        }
      });

      await tx.driver.update({
        where: { id: legacyDriver.id },
        data: { kycStatus: "APPROVED" }
      });

      // Setiap dokumen pengajuan ikut ditandai disetujui.
      await tx.driverDocument.updateMany({
        where: { driverId: legacyDriver.id, status: "PENDING" },
        data: { status: "APPROVED", reviewedBy: input.actorId, reviewedAt: now }
      });

      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "DRIVER_APPLICATION_APPROVED",
          entityType: "RIDE_DRIVER_APPLICATION",
          entityId: input.applicationId,
          metadata: { userId: application.userId, cycleNumber: application.cycleNumber }
        }
      });
    });

    return this.summaryOf(input.applicationId);
  }

  async reject(input: {
    actorId: string;
    applicationId: string;
    reasonCode: RejectReasonCode;
  }): Promise<DriverApplicationSummary> {
    await this.scopes.requireScope(input.actorId, "DRIVER_APPLICATION_CLAIM", {
      applicationId: input.applicationId,
      auditAllowed: true
    });

    const application = await this.requireDecisionContext(input);

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await this.assertClaimHeldBy(tx, input.applicationId, input.actorId, now);

      const decided = await tx.rideDriverApplication.updateMany({
        where: { id: input.applicationId, status: "UNDER_REVIEW" },
        data: {
          status: "REJECTED",
          rejectedAt: now,
          decisionReasonCode: input.reasonCode,
          reviewedById: input.actorId,
          reviewedAt: now,
          version: { increment: 1 }
        }
      });
      if (decided.count === 0) {
        throw new AppError(
          "Pengajuan sudah berubah status.",
          StatusCodes.CONFLICT,
          DRIVER_APPLICATION_REVIEW_NOT_ALLOWED
        );
      }

      await this.syncLegacyKycAfterTerminal(application.userId, "REJECTED", tx);

      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "DRIVER_APPLICATION_REJECTED",
          entityType: "RIDE_DRIVER_APPLICATION",
          entityId: input.applicationId,
          metadata: {
            userId: application.userId,
            cycleNumber: application.cycleNumber,
            reasonCode: input.reasonCode
          }
        }
      });
    });

    return this.summaryOf(input.applicationId);
  }

  // -------------------------------------------------------------------
  // Bantu privat
  // -------------------------------------------------------------------

  /** Keempat dokumen wajib sudah terunggah dan isinya masih terbaca (K1-A). */
  private async requiredDocumentsComplete(driverId: string): Promise<boolean> {
    const now = new Date();
    const count = await this.prisma.driverDocument.count({
      where: {
        driverId,
        type: { in: [...DRIVER_DOCUMENT_TYPES] },
        cipherText: { not: null },
        purgedAt: null,
        expiresAt: { gt: now }
      }
    });
    return count === DRIVER_DOCUMENT_TYPES.length;
  }

  private async requireDecisionContext(input: {
    actorId: string;
    applicationId: string;
  }) {
    const application = await this.prisma.rideDriverApplication.findUnique({
      where: { id: input.applicationId },
      select: { id: true, userId: true, cycleNumber: true, status: true }
    });
    if (!application || application.status !== "UNDER_REVIEW") {
      throw new AppError(
        "Pengajuan tidak sedang menunggu keputusan Anda.",
        StatusCodes.CONFLICT,
        DRIVER_APPLICATION_REVIEW_NOT_ALLOWED
      );
    }
    return application;
  }

  /**
   * Klaim harus masih dipegang pemutus pada saat keputusan dibuat — bukan
   * hanya saat endpoint dipanggil. Lease kedaluwarsa berarti keputusan
   * batal: admin lain bisa saja sudah mengambil alih.
   */
  private async assertClaimHeldBy(
    tx: Prisma.TransactionClient,
    applicationId: string,
    actorId: string,
    now: Date
  ) {
    const rows = await tx.$queryRaw<Array<{ held: boolean }>>`
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') < "claim_expires_at"
             AND "claimed_by_id" = ${actorId}::uuid AS held
      FROM "ride_driver_applications"
      WHERE "id" = ${applicationId}::uuid
    `;
    if (!rows[0]?.held) {
      throw new AppError(
        "Klaim review sudah tidak dipegang. Klaim ulang pengajuan ini.",
        StatusCodes.CONFLICT,
        DRIVER_APPLICATION_REVIEW_NOT_ALLOWED
      );
    }
    void now;
  }

  private async syncLegacyKycAfterTerminal(
    userId: string,
    terminalKyc: "REJECTED",
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? this.prisma;
    await client.driver.updateMany({
      where: { userId, kycStatus: "PENDING" },
      data: { kycStatus: terminalKyc }
    });
  }

  private legacyVehicleTypeToServiceType(
    legacy: string | null
  ): RideServiceType | null {
    if (!legacy) return null;
    const upper = legacy.toUpperCase();
    if (upper === "BIKE" || upper === "MOTORCYCLE") return "MOTORCYCLE";
    if (upper === "CAR") return "CAR";
    return null;
  }

  private async summaryOf(applicationId: string): Promise<DriverApplicationSummary> {
    return this.prisma.rideDriverApplication.findUniqueOrThrow({
      where: { id: applicationId },
      select: {
        id: true,
        cycleNumber: true,
        status: true,
        version: true,
        submittedAt: true,
        decisionReasonCode: true
      }
    });
  }
}

export { DriverDocumentService };
