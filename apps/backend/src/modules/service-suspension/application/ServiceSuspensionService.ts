import { PrismaClient, UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { logger } from "../../../core/logger/logger.js";

export const DEFAULT_SUSPENSION_MESSAGE =
  "Layanan TapGo sedang dihentikan sementara. Silakan hubungi support@tapgolion.id untuk informasi.";

export const SUSPENSION_ACTIONS = {
  suspended: "SERVICE_SUSPENDED",
  resumed: "SERVICE_RESUMED"
} as const;

const ROW_ID = "GLOBAL";

export interface SuspensionSnapshot {
  suspended: boolean;
  message: string;
}

/** Yang dibutuhkan gerbang: hanya membaca. */
export interface SuspensionReader {
  current(): Promise<SuspensionSnapshot>;
}

export interface SuspensionStatus extends SuspensionSnapshot {
  changedAt: Date | null;
  changedById: string | null;
}

/**
 * Penghentian layanan (suspend) yang dikendalikan HANYA oleh SUPER_ADMIN_VIP.
 *
 * - Sumber kebenaran adalah satu baris di database, bukan variabel lingkungan:
 *   mengubahnya tidak butuh akses server dan selalu meninggalkan jejak audit.
 * - Pembacaan di-cache singkat agar gerbang tidak membebani database pada tiap
 *   permintaan. Bila pembacaan gagal, keadaan terakhir yang diketahui dipakai
 *   (tidak tiba-tiba menutup atau membuka layanan karena gangguan database).
 * - Peran diperiksa ULANG di sini (selain di rute) sebagai pertahanan berlapis.
 */
export class ServiceSuspensionService implements SuspensionReader {
  private cached: { snapshot: SuspensionSnapshot; loadedAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlMs = 5_000,
    private readonly now: () => number = () => Date.now()
  ) {}

  async current(): Promise<SuspensionSnapshot> {
    const at = this.now();
    if (this.cached && at - this.cached.loadedAt < this.ttlMs) {
      return this.cached.snapshot;
    }
    try {
      const row = await this.prisma.serviceSuspension.findUnique({ where: { id: ROW_ID } });
      const snapshot = toSnapshot(row);
      this.cached = { snapshot, loadedAt: at };
      return snapshot;
    } catch (error) {
      logger.error({ err: error }, "Gagal membaca status penghentian layanan; memakai keadaan terakhir");
      if (this.cached) {
        // Tunda percobaan berikutnya agar database yang sedang bermasalah tidak dihujani.
        this.cached.loadedAt = at;
        return this.cached.snapshot;
      }
      return { suspended: false, message: DEFAULT_SUSPENSION_MESSAGE };
    }
  }

  async status(): Promise<SuspensionStatus> {
    const row = await this.prisma.serviceSuspension.findUnique({ where: { id: ROW_ID } });
    return {
      ...toSnapshot(row),
      changedAt: row?.changedAt ?? null,
      changedById: row?.changedById ?? null
    };
  }

  async set(input: {
    actorId: string;
    actorRole: UserRole;
    suspended: boolean;
    message?: string | undefined;
  }): Promise<SuspensionStatus> {
    if (input.actorRole !== "SUPER_ADMIN_VIP") {
      throw new AppError(
        "Hanya Super Admin VIP yang dapat mengubah status layanan.",
        StatusCodes.FORBIDDEN,
        "SERVICE_SUSPENSION_FORBIDDEN"
      );
    }
    const message = input.message?.trim() ? input.message.trim() : null;
    const changedAt = new Date(this.now());

    const row = await this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceSuspension.findUnique({ where: { id: ROW_ID } });
      const updated = await tx.serviceSuspension.upsert({
        where: { id: ROW_ID },
        update: { suspended: input.suspended, message, changedById: input.actorId, changedAt },
        create: { id: ROW_ID, suspended: input.suspended, message, changedById: input.actorId, changedAt }
      });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: input.suspended ? SUSPENSION_ACTIONS.suspended : SUSPENSION_ACTIONS.resumed,
          entityType: "SERVICE_SUSPENSION",
          entityId: ROW_ID,
          metadata: { before: before?.suspended ?? false, after: input.suspended, message }
        }
      });
      return updated;
    });

    // Perubahan harus berlaku seketika di proses ini; proses lain menyusul dalam hitungan detik (TTL).
    this.cached = null;
    return {
      ...toSnapshot(row),
      changedAt: row.changedAt,
      changedById: row.changedById
    };
  }
}

function toSnapshot(row: { suspended: boolean; message: string | null } | null): SuspensionSnapshot {
  return {
    suspended: row?.suspended ?? false,
    message: row?.message?.trim() ? row.message.trim() : DEFAULT_SUSPENSION_MESSAGE
  };
}
