import { Prisma, PrismaClient, RideDriverApplicationStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { DriverReviewScopeService } from "./DriverReviewScopeService.js";

/**
 * Claim/lease review pengajuan driver.
 *
 * KONTRAK WAKTU: seluruh keputusan memakai UTC dari DATABASE, dinyatakan
 * eksplisit sebagai `CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`.
 *
 * Jam Node dan jam client tidak pernah dipercaya. Session timezone PostgreSQL
 * juga tidak: `now()` maupun `LOCALTIMESTAMP` bergantung padanya, sehingga dua
 * environment dengan setelan berbeda akan menghasilkan lease yang berbeda dari
 * data yang sama. Ekspresi di atas menghasilkan wall-clock UTC apa pun setelan
 * sesi, sehingga kolom `timestamp without time zone` pada schema ini menyimpan
 * UTC dan Prisma membacanya kembali sebagai instant yang benar.
 *
 * Kedaluwarsa bersifat LAZY — dinilai saat dibaca, bukan oleh scheduler.
 * Tidak ada background job yang bisa mati diam-diam dan mengunci antrian.
 */

export const DRIVER_REVIEW_APPLICATION_NOT_ELIGIBLE = "DRIVER_REVIEW_APPLICATION_NOT_ELIGIBLE";
export const DRIVER_REVIEW_ALREADY_CLAIMED = "DRIVER_REVIEW_ALREADY_CLAIMED";
export const DRIVER_REVIEW_CLAIM_EXPIRED = "DRIVER_REVIEW_CLAIM_EXPIRED";
export const DRIVER_REVIEW_NOT_CLAIM_OWNER = "DRIVER_REVIEW_NOT_CLAIM_OWNER";
export const DRIVER_REVIEW_VERSION_CONFLICT = "DRIVER_REVIEW_VERSION_CONFLICT";
export const DRIVER_REVIEW_REASSIGN_NOT_ALLOWED = "DRIVER_REVIEW_REASSIGN_NOT_ALLOWED";
export const DRIVER_REVIEW_TARGET_NOT_ELIGIBLE = "DRIVER_REVIEW_TARGET_NOT_ELIGIBLE";

/** Durasi lease. Ditegakkan database, bukan dihitung di Node. */
export const REVIEW_LEASE_MINUTES = 15;

/** Status yang boleh masuk antrian review. */
export const REVIEWABLE_STATUSES: RideDriverApplicationStatus[] = ["SUBMITTED", "UNDER_REVIEW"];

/**
 * Kode alasan pelepasan yang dibatasi.
 *
 * Daftar tertutup, bukan teks bebas: alasan ikut ke audit log, dan teks bebas
 * di sana cepat berubah menjadi tempat bocornya pesan exception atau PII.
 */
export const RELEASE_REASON_CODES = [
  "REVIEW_POSTPONED",
  "NEEDS_OTHER_REVIEWER",
  "SHIFT_ENDED",
  "ADMIN_ERROR"
] as const;
export type ReleaseReasonCode = (typeof RELEASE_REASON_CODES)[number];

export const REASSIGN_REASON_CODES = [
  "WORKLOAD_BALANCING",
  "REVIEWER_UNAVAILABLE",
  "ESCALATION"
] as const;
export type ReassignReasonCode = (typeof REASSIGN_REASON_CODES)[number];

type TxClient = Prisma.TransactionClient;

function notEligible(): AppError {
  return new AppError(
    "Pengajuan tidak dapat direview.",
    StatusCodes.CONFLICT,
    DRIVER_REVIEW_APPLICATION_NOT_ELIGIBLE
  );
}

export type QueueItem = {
  id: string;
  status: RideDriverApplicationStatus;
  cycleNumber: number;
  version: number;
  submittedAt: Date | null;
  claimedById: string | null;
  claimExpiresAt: Date | null;
  claimActive: boolean;
};

export class DriverReviewLeaseService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scopes: DriverReviewScopeService
  ) {}

  /**
   * Waktu UTC dari database — satu-satunya sumber waktu untuk keputusan lease.
   *
   * LOCALTIMESTAMP yang dipakai sebelumnya memperbaiki pergeseran zona, tetapi
   * masih bergantung pada session timezone dan karena itu bukan kontrak yang
   * dapat dipegang lintas environment. `CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`
   * menghasilkan nilai yang sama pada setelan sesi apa pun.
   */
  private async databaseNow(tx: TxClient | PrismaClient): Promise<Date> {
    const rows = await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS now
    `;
    return rows[0]!.now;
  }

  // -------------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------------

  async listReviewQueue(actorId: string): Promise<QueueItem[]> {
    await this.scopes.requireScope(actorId, "DRIVER_APPLICATION_QUEUE_READ");

    // Keaktifan lease dinilai terhadap waktu database pada saat membaca —
    // inilah lazy expiry. Tidak ada job yang perlu berjalan.
    const now = await this.databaseNow(this.prisma);

    const rows = await this.prisma.rideDriverApplication.findMany({
      where: { status: { in: REVIEWABLE_STATUSES } },
      orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        status: true,
        cycleNumber: true,
        version: true,
        submittedAt: true,
        claimedById: true,
        claimExpiresAt: true
      }
    });

    // Nol field dokumen, nol identitas pemohon: antrian hanya membawa
    // pengenal internal dan metadata review.
    return rows.map((row) => ({
      ...row,
      claimActive: row.claimExpiresAt !== null && row.claimExpiresAt > now
    }));
  }

  // -------------------------------------------------------------------
  // Claim
  // -------------------------------------------------------------------

  /**
   * Mengambil klaim atas pengajuan yang belum diklaim, atau yang leasenya
   * sudah kedaluwarsa (takeover).
   *
   * Pemenang tunggal ditentukan `updateMany` bersyarat: hanya satu transaksi
   * yang dapat mengubah baris dari state yang diharapkan, dan yang kalah
   * melihat `count === 0`. Database yang memutuskan, bukan urutan pembacaan
   * di aplikasi.
   */
  async claimApplication(input: {
    actorId: string;
    applicationId: string;
    expectedVersion?: number;
  }) {
    await this.scopes.requireScope(input.actorId, "DRIVER_APPLICATION_CLAIM", {
      applicationId: input.applicationId,
      auditAllowed: true
    });

    return this.prisma.$transaction(async (tx) => {
      const now = await this.databaseNow(tx);

      const application = await tx.rideDriverApplication.findUnique({
        where: { id: input.applicationId },
        select: { id: true, status: true, version: true, claimedById: true, claimExpiresAt: true }
      });

      if (!application || !REVIEWABLE_STATUSES.includes(application.status)) {
        throw notEligible();
      }
      if (input.expectedVersion !== undefined && input.expectedVersion !== application.version) {
        throw new AppError(
          "Data pengajuan sudah berubah.",
          StatusCodes.CONFLICT,
          DRIVER_REVIEW_VERSION_CONFLICT
        );
      }

      const leaseHeld =
        application.claimExpiresAt !== null && application.claimExpiresAt > now;
      if (leaseHeld && application.claimedById !== input.actorId) {
        throw new AppError(
          "Pengajuan sedang direview admin lain.",
          StatusCodes.CONFLICT,
          DRIVER_REVIEW_ALREADY_CLAIMED
        );
      }

      const takeover = application.claimedById !== null && !leaseHeld;
      const previousClaimantId = application.claimedById;

      // Syarat perubahan mengunci versi DAN state klaim yang terbaca.
      // Dua permintaan bersamaan tidak mungkin sama-sama lolos.
      const claimed = await tx.$executeRaw`
        UPDATE "ride_driver_applications"
        SET "claimed_by_id" = ${input.actorId}::uuid,
            "claimed_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
            "claim_expires_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '15 minutes',
            "released_at" = NULL,
            "release_reason_code" = NULL,
            "status" = 'UNDER_REVIEW',
            "version" = "version" + 1,
            "updated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        WHERE "id" = ${input.applicationId}::uuid
          AND "version" = ${application.version}
          AND ("claim_expires_at" IS NULL OR "claim_expires_at" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
      `;

      if (claimed !== 1) {
        throw new AppError(
          "Pengajuan sedang direview admin lain.",
          StatusCodes.CONFLICT,
          DRIVER_REVIEW_ALREADY_CLAIMED
        );
      }

      const updated = await tx.rideDriverApplication.findUniqueOrThrow({
        where: { id: input.applicationId }
      });

      await this.writeAudit(tx, {
        actorId: input.actorId,
        action: takeover
          ? "driver.application.claim_expired_takeover"
          : "driver.application.claimed",
        applicationId: input.applicationId,
        metadata: {
          scope: "DRIVER_APPLICATION_CLAIM",
          status: updated.status,
          version: updated.version,
          ...(takeover && previousClaimantId
            ? { previousClaimantId }
            : {})
        }
      });

      return updated;
    });
  }

  // -------------------------------------------------------------------
  // Renew
  // -------------------------------------------------------------------

  /** Memperpanjang lease milik sendiri. `claimed_at` awal tidak diubah. */
  async renewClaim(input: { actorId: string; applicationId: string }) {
    await this.scopes.requireScope(input.actorId, "DRIVER_APPLICATION_RENEW", {
      applicationId: input.applicationId,
      auditAllowed: true
    });

    return this.prisma.$transaction(async (tx) => {
      const application = await tx.rideDriverApplication.findUnique({
        where: { id: input.applicationId },
        select: { id: true, status: true, claimedById: true, claimExpiresAt: true, version: true }
      });

      if (!application) {
        throw notEligible();
      }
      if (application.claimedById !== input.actorId) {
        throw new AppError(
          "Klaim dipegang admin lain.",
          StatusCodes.CONFLICT,
          DRIVER_REVIEW_NOT_CLAIM_OWNER
        );
      }

      // Lease yang sudah lewat tidak dapat diperpanjang — harus di-claim
      // ulang, agar takeover oleh admin lain tetap mungkin.
      const renewed = await tx.$executeRaw`
        UPDATE "ride_driver_applications"
        SET "claim_expires_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '15 minutes',
            "version" = "version" + 1,
            "updated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        WHERE "id" = ${input.applicationId}::uuid
          AND "claimed_by_id" = ${input.actorId}::uuid
          AND "claim_expires_at" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      `;

      if (renewed !== 1) {
        throw new AppError(
          "Klaim sudah kedaluwarsa.",
          StatusCodes.CONFLICT,
          DRIVER_REVIEW_CLAIM_EXPIRED
        );
      }

      const updated = await tx.rideDriverApplication.findUniqueOrThrow({
        where: { id: input.applicationId }
      });

      await this.writeAudit(tx, {
        actorId: input.actorId,
        action: "driver.application.claim_renewed",
        applicationId: input.applicationId,
        metadata: {
          scope: "DRIVER_APPLICATION_RENEW",
          status: updated.status,
          version: updated.version
        }
      });

      return updated;
    });
  }

  // -------------------------------------------------------------------
  // Release
  // -------------------------------------------------------------------

  async releaseClaim(input: {
    actorId: string;
    applicationId: string;
    reasonCode: ReleaseReasonCode;
  }) {
    await this.scopes.requireScope(input.actorId, "DRIVER_APPLICATION_RELEASE", {
      applicationId: input.applicationId,
      auditAllowed: true
    });

    if (!RELEASE_REASON_CODES.includes(input.reasonCode)) {
      throw notEligible();
    }

    return this.prisma.$transaction(async (tx) => {
      const released = await tx.$executeRaw`
        UPDATE "ride_driver_applications"
        SET "claimed_by_id" = NULL,
            "claimed_at" = NULL,
            "claim_expires_at" = NULL,
            "released_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
            "release_reason_code" = ${input.reasonCode},
            "status" = 'SUBMITTED',
            "version" = "version" + 1,
            "updated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        WHERE "id" = ${input.applicationId}::uuid
          AND "claimed_by_id" = ${input.actorId}::uuid
      `;

      if (released !== 1) {
        throw new AppError(
          "Klaim dipegang admin lain.",
          StatusCodes.CONFLICT,
          DRIVER_REVIEW_NOT_CLAIM_OWNER
        );
      }

      const updated = await tx.rideDriverApplication.findUniqueOrThrow({
        where: { id: input.applicationId }
      });

      await this.writeAudit(tx, {
        actorId: input.actorId,
        action: "driver.application.claim_released",
        applicationId: input.applicationId,
        metadata: {
          scope: "DRIVER_APPLICATION_RELEASE",
          reasonCode: input.reasonCode,
          status: updated.status,
          version: updated.version
        }
      });

      return updated;
    });
  }

  // -------------------------------------------------------------------
  // Reassign
  // -------------------------------------------------------------------

  async reassignClaim(input: {
    actorId: string;
    applicationId: string;
    targetUserId: string;
    reasonCode: ReassignReasonCode;
  }) {
    await this.scopes.requireScope(input.actorId, "DRIVER_APPLICATION_REASSIGN", {
      applicationId: input.applicationId,
      auditAllowed: true
    });

    if (!REASSIGN_REASON_CODES.includes(input.reasonCode)) {
      throw new AppError(
        "Alasan reassignment tidak dikenal.",
        StatusCodes.BAD_REQUEST,
        DRIVER_REVIEW_REASSIGN_NOT_ALLOWED
      );
    }

    // Target wajib memenuhi syarat SENDIRI. Kewenangan pemanggil tidak
    // menular ke penerima.
    const targetEligible = await this.scopes.isEligibleReviewer(
      input.targetUserId,
      "DRIVER_APPLICATION_CLAIM"
    );
    if (!targetEligible) {
      throw new AppError(
        "Reviewer tujuan tidak memenuhi syarat.",
        StatusCodes.CONFLICT,
        DRIVER_REVIEW_TARGET_NOT_ELIGIBLE
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const application = await tx.rideDriverApplication.findUnique({
        where: { id: input.applicationId },
        select: { id: true, status: true, claimedById: true, version: true }
      });

      if (!application || !REVIEWABLE_STATUSES.includes(application.status)) {
        throw notEligible();
      }

      const previousClaimantId = application.claimedById;

      const reassigned = await tx.$executeRaw`
        UPDATE "ride_driver_applications"
        SET "claimed_by_id" = ${input.targetUserId}::uuid,
            "claimed_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
            "claim_expires_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '15 minutes',
            "released_at" = NULL,
            "release_reason_code" = NULL,
            "status" = 'UNDER_REVIEW',
            "version" = "version" + 1,
            "updated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        WHERE "id" = ${input.applicationId}::uuid
          AND "version" = ${application.version}
      `;

      if (reassigned !== 1) {
        throw new AppError(
          "Data pengajuan sudah berubah.",
          StatusCodes.CONFLICT,
          DRIVER_REVIEW_VERSION_CONFLICT
        );
      }

      const updated = await tx.rideDriverApplication.findUniqueOrThrow({
        where: { id: input.applicationId }
      });

      await this.writeAudit(tx, {
        actorId: input.actorId,
        action: "driver.application.claim_reassigned",
        applicationId: input.applicationId,
        metadata: {
          scope: "DRIVER_APPLICATION_REASSIGN",
          reasonCode: input.reasonCode,
          status: updated.status,
          version: updated.version,
          newClaimantId: input.targetUserId,
          ...(previousClaimantId ? { previousClaimantId } : {})
        }
      });

      return updated;
    });
  }

  // -------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------

  /**
   * Menulis audit dalam transaksi yang SAMA dengan perubahannya.
   *
   * Metadata dibatasi pada UUID internal, scope, kode alasan, status, versi,
   * dan waktu. Nol nomor telepon, email, NIK, SIM, STNK, plate, URL dokumen,
   * token, maupun pesan exception.
   */
  private async writeAudit(
    tx: TxClient,
    input: {
      actorId: string;
      action: string;
      applicationId: string;
      metadata: Record<string, unknown>;
    }
  ) {
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entityType: "RideDriverApplication",
        entityId: input.applicationId,
        metadata: input.metadata as Prisma.InputJsonValue
      }
    });
  }
}
