import { Prisma, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import {
  decryptDocument,
  encryptDocument,
  MEMBERSHIP_DOCUMENT_KEY_VERSION
} from "../../../core/security/documentCipher.js";
import { DRIVER_FACE_EMBEDDING_MODEL_VERSION } from "./DriverFaceEmbeddingService.js";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Tanggal kalender WIB (Asia/Jakarta) untuk `now`, dipangkas ke tengah malam
 * UTC agar cocok dengan kolom Prisma `@db.Date` — pola identik
 * core/finance/plConfig.ts (WIB_OFFSET_MS), dipakai ulang di sini supaya
 * driver tidak diminta verifikasi ulang pagi WIB gara-gara hari UTC sudah
 * berganti tengah malam sebelumnya.
 */
export function wibCheckDate(now: Date): Date {
  const shifted = new Date(now.getTime() + WIB_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted;
}

export type DriverFaceCheckSnapshot = {
  status: "PENDING" | "PASSED" | "BLOCKED";
  attemptsRemaining: number;
};

export class DriverFaceCheckService {
  constructor(private readonly prisma: PrismaClient) {}

  private requireEnabled() {
    if (!env.DRIVER_FACE_CHECK_ENABLED) {
      throw new AppError(
        "Verifikasi wajah belum diaktifkan.",
        StatusCodes.SERVICE_UNAVAILABLE,
        "DRIVER_FACE_CHECK_DISABLED"
      );
    }
  }

  private toSnapshot(row: { status: string; attemptCount: number } | null): DriverFaceCheckSnapshot {
    if (!row) {
      return { status: "PENDING", attemptsRemaining: env.DRIVER_FACE_CHECK_MAX_ATTEMPTS_PER_DAY };
    }
    const remaining = Math.max(0, env.DRIVER_FACE_CHECK_MAX_ATTEMPTS_PER_DAY - row.attemptCount);
    return { status: row.status as DriverFaceCheckSnapshot["status"], attemptsRemaining: remaining };
  }

  /** Status verifikasi HARI INI (kalender WIB) untuk driver yang sedang login. */
  async getTodayStatus(userId: string): Promise<DriverFaceCheckSnapshot> {
    const checkDate = wibCheckDate(new Date());
    const row = await this.prisma.driverFaceCheck.findUnique({
      where: { userId_checkDate: { userId, checkDate } },
      select: { status: true, attemptCount: true }
    });
    return this.toSnapshot(row);
  }

  /**
   * Referensi embedding wajah milik driver ini SAJA — selalu dari
   * req.auth.userId di controller, tidak pernah dari parameter klien.
   */
  async getReference(userId: string): Promise<{ embedding: Float32Array; modelVersion: string }> {
    this.requireEnabled();
    const row = await this.prisma.driverFaceReference.findUnique({ where: { userId } });
    if (!row) {
      throw new AppError(
        "Foto referensi wajah belum tersedia. Hubungi admin TapGo.",
        StatusCodes.NOT_FOUND,
        "RIDE_DRIVER_FACE_REFERENCE_MISSING"
      );
    }
    const bytes = decryptDocument(
      {
        cipherText: row.embeddingCipherText,
        cipherIv: row.embeddingCipherIv,
        cipherTag: row.embeddingCipherTag,
        keyVersion: row.keyVersion
      },
      "driverFace"
    );
    return { embedding: bufferToFloat32(bytes), modelVersion: row.modelVersion };
  }

  /**
   * Mencatat HASIL yang sudah diputuskan di perangkat driver (skor kemiripan +
   * status liveness), lalu MENEGAKKAN ULANG ambang batas dan batas percobaan
   * di server — klien tidak pernah cukup dipercaya mengirim {passed: true}
   * begitu saja. Ini bukan tempat foto/embedding mentah diunggah; keduanya
   * sengaja tidak pernah meninggalkan perangkat untuk keputusan pencocokan
   * (lihat catatan trust-boundary di plan) — baris ini adalah jejak audit
   * hasilnya, bukan bukti kriptografis bahwa perangkat tidak dimodifikasi.
   */
  async submitAttempt(input: {
    userId: string;
    similarityScore: number;
    livenessPassed: boolean;
    modelVersion: string;
  }): Promise<DriverFaceCheckSnapshot> {
    this.requireEnabled();
    if (!Number.isFinite(input.similarityScore) || input.similarityScore < 0 || input.similarityScore > 1) {
      throw new AppError("Skor kemiripan tidak valid.", StatusCodes.BAD_REQUEST, "DRIVER_FACE_CHECK_SCORE_INVALID");
    }

    const checkDate = wibCheckDate(new Date());
    const now = new Date();

    // PENTING: melempar DI DALAM prisma.$transaction() membatalkan seluruh
    // transaksi (termasuk upsert percobaan yang baru saja dicatat) — Prisma
    // roll back otomatis begitu callback-nya throw. Baris attemptCount akan
    // hilang diam-diam kalau keputusan gagal/blokir dilempar dari dalam sini.
    // Karena itu transaksi HANYA menulis dan mengembalikan hasilnya; keputusan
    // melempar error terjadi SETELAH transaksi commit, di luar callback.
    const outcome = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.driverFaceCheck.findUnique({
        where: { userId_checkDate: { userId: input.userId, checkDate } }
      });

      if (existing?.status === "BLOCKED") {
        return { kind: "already-blocked" as const, row: existing };
      }
      if (existing?.status === "PASSED") {
        return { kind: "already-passed" as const, row: existing };
      }

      const attemptCount = (existing?.attemptCount ?? 0) + 1;
      const maxAttempts = env.DRIVER_FACE_CHECK_MAX_ATTEMPTS_PER_DAY;
      const passed = input.livenessPassed && input.similarityScore >= env.DRIVER_FACE_CHECK_MIN_SIMILARITY;
      const blocked = !passed && attemptCount >= maxAttempts;

      const data = {
        attemptCount,
        similarityScore: new Prisma.Decimal(input.similarityScore.toFixed(4)),
        modelVersion: input.modelVersion,
        lastAttemptAt: now,
        status: (passed ? "PASSED" : blocked ? "BLOCKED" : "PENDING") as "PASSED" | "BLOCKED" | "PENDING",
        ...(passed ? { passedAt: now } : {}),
        ...(blocked ? { blockedAt: now } : {})
      };

      const row = await tx.driverFaceCheck.upsert({
        where: { userId_checkDate: { userId: input.userId, checkDate } },
        create: { userId: input.userId, checkDate, ...data },
        update: data
      });

      return {
        kind: passed ? ("passed" as const) : blocked ? ("blocked" as const) : ("mismatch" as const),
        row
      };
    });

    switch (outcome.kind) {
      case "already-blocked":
      case "blocked":
        throw new AppError(
          "Percobaan verifikasi wajah hari ini sudah habis. Hubungi admin TapGo.",
          StatusCodes.FORBIDDEN,
          "RIDE_DRIVER_FACE_CHECK_BLOCKED"
        );
      case "mismatch":
        throw new AppError(
          "Wajah tidak cocok. Silakan coba lagi.",
          StatusCodes.FORBIDDEN,
          "RIDE_DRIVER_FACE_CHECK_MISMATCH"
        );
      case "already-passed":
      case "passed":
        return this.toSnapshot(outcome.row);
    }
  }

  /** Dipanggil dari RideService.setAvailability() saat transisi ke ONLINE. */
  async requirePassedToday(userId: string): Promise<void> {
    if (!env.DRIVER_FACE_CHECK_ENABLED) return;
    const snapshot = await this.getTodayStatus(userId);
    if (snapshot.status === "PASSED") return;
    if (snapshot.status === "BLOCKED") {
      throw new AppError(
        "Percobaan verifikasi wajah hari ini sudah habis. Hubungi admin TapGo.",
        StatusCodes.FORBIDDEN,
        "RIDE_DRIVER_FACE_CHECK_BLOCKED"
      );
    }
    throw new AppError(
      "Verifikasi wajah harian diperlukan sebelum online.",
      StatusCodes.FORBIDDEN,
      "RIDE_DRIVER_FACE_CHECK_REQUIRED"
    );
  }

  /** Membuka blokir tanpa memalsukan hasil PASSED asli — dicatat di AuditLog. */
  async adminOverride(input: { userId: string; adminId: string }): Promise<DriverFaceCheckSnapshot> {
    const checkDate = wibCheckDate(new Date());
    const now = new Date();

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.driverFaceCheck.upsert({
        where: { userId_checkDate: { userId: input.userId, checkDate } },
        create: {
          userId: input.userId,
          checkDate,
          status: "PASSED",
          passedAt: now,
          adminOverrideById: input.adminId,
          adminOverrideAt: now
        },
        update: {
          status: "PASSED",
          passedAt: now,
          adminOverrideById: input.adminId,
          adminOverrideAt: now
        }
      });

      await tx.auditLog.create({
        data: {
          actorId: input.adminId,
          action: "DRIVER_FACE_CHECK_OVERRIDE",
          entityType: "DRIVER_FACE_CHECK",
          entityId: updated.id,
          metadata: { userId: input.userId, checkDate: checkDate.toISOString() }
        }
      });

      return updated;
    });

    return this.toSnapshot(row);
  }

  /**
   * Dipanggil dari DriverApplicationService.approve() di dalam transaksinya,
   * SEBELUM swafoto KYC berpotensi tersapu oleh purgeExpired(). embeddingBuffer
   * berasal dari DriverFaceEmbeddingService.computeEmbedding() dijalankan di
   * luar fungsi ini (embedding service tidak bergantung pada Prisma).
   */
  async storeReference(
    tx: Prisma.TransactionClient,
    input: { userId: string; embedding: Float32Array }
  ): Promise<void> {
    const encrypted = encryptDocument(float32ToBuffer(input.embedding), "driverFace");
    await tx.driverFaceReference.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        embeddingCipherText: encrypted.cipherText,
        embeddingCipherIv: encrypted.cipherIv,
        embeddingCipherTag: encrypted.cipherTag,
        keyVersion: encrypted.keyVersion ?? MEMBERSHIP_DOCUMENT_KEY_VERSION,
        modelVersion: DRIVER_FACE_EMBEDDING_MODEL_VERSION,
        computedAt: new Date()
      },
      update: {
        embeddingCipherText: encrypted.cipherText,
        embeddingCipherIv: encrypted.cipherIv,
        embeddingCipherTag: encrypted.cipherTag,
        keyVersion: encrypted.keyVersion ?? MEMBERSHIP_DOCUMENT_KEY_VERSION,
        modelVersion: DRIVER_FACE_EMBEDDING_MODEL_VERSION,
        computedAt: new Date()
      }
    });
  }
}

function float32ToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function bufferToFloat32(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
}
