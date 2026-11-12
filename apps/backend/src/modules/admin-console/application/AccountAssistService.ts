import { PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { env } from "../../../config/env.js";
import { phoneLookupVariants } from "../../../core/security/phone.js";
import { DriverFaceCheckService } from "../../drivers/application/DriverFaceCheckService.js";
import { evaluateDriverReadiness } from "../../rides/application/driverReadiness.js";
import { maskEmail } from "../../auth/application/AccountRecoveryService.js";

/**
 * Bantuan akun untuk Super Admin VIP: melihat keadaan satu akun (kenapa tidak bisa masuk / tidak bisa menerima order)
 * dan jalur pemulihannya. Hanya membaca; penerbitan kode pemulihan ada di AccountRecoveryService.issueAssistedCode.
 */
export class AccountAssistService {
  private readonly faceCheck: DriverFaceCheckService;

  constructor(private readonly prisma: PrismaClient) {
    this.faceCheck = new DriverFaceCheckService(prisma);
  }

  async lookupByPhone(phoneInput: string) {
    const user = await this.prisma.user.findFirst({
      where: { phone: { in: phoneLookupVariants(phoneInput) } },
      orderBy: { createdAt: "asc" },
      include: {
        wallet: { select: { balance: true } },
        rideDriverProfile: {
          include: {
            vehicles: { select: { type: true, verificationStatus: true, isActive: true } }
          }
        }
      }
    });
    if (!user) {
      throw new AppError("Akun dengan nomor itu tidak ditemukan.", StatusCodes.NOT_FOUND, "ACCOUNT_ASSIST_NOT_FOUND");
    }

    const now = new Date();
    const activeChallenge = await this.prisma.authChallenge.findFirst({
      where: { userId: user.id, purpose: "PASSWORD_RECOVERY", consumedAt: null, expiresAt: { gt: now } },
      select: { expiresAt: true }
    });

    // Riwayat penerbitan kode (terbaru dulu) supaya admin berikutnya melihat siapa, kapan, dan buktinya.
    const issuedLogs = await this.prisma.auditLog.findMany({
      where: { action: "ACCOUNT_RECOVERY_CODE_ISSUED", entityType: "USER", entityId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { actorId: true, createdAt: true, metadata: true }
    });
    const actorIds = [...new Set(issuedLogs.map((log) => log.actorId).filter((id): id is string => id !== null))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })
      : [];
    const actorName = new Map(actors.map((actor) => [actor.id, actor.fullName]));
    const codeHistory = issuedLogs.map((log) => {
      const meta = (log.metadata ?? {}) as { reasonCode?: unknown; evidenceNote?: unknown };
      return {
        at: log.createdAt,
        by: log.actorId ? (actorName.get(log.actorId) ?? null) : null,
        reasonCode: typeof meta.reasonCode === "string" ? meta.reasonCode : null,
        evidenceNote: typeof meta.evidenceNote === "string" ? meta.evidenceNote : null
      };
    });

    const emailVerified = user.email !== null && user.emailVerifiedAt !== null;
    const privileged = user.role === "ADMIN" || user.role === "SUPER_ADMIN" || user.role === "SUPER_ADMIN_VIP";

    const profile = user.rideDriverProfile;
    const driver = profile
      ? {
          profileStatus: profile.status,
          availability: profile.availability,
          readiness: evaluateDriverReadiness({
            userStatus: user.status,
            profileStatus: profile.status,
            availability: profile.availability,
            lastSeenAt: profile.lastSeenAt,
            vehicles: profile.vehicles,
            walletBalance: user.wallet ? user.wallet.balance.toNumber() : null,
            faceRecheckDue: await this.faceCheck.isRecheckDue(user.id),
            commission: {
              enabled: env.DRIVER_COMMISSION_ENABLED,
              percent: env.DRIVER_COMMISSION_PERCENT,
              minCashBalance: env.DRIVER_MIN_CASH_BALANCE
            },
            now
          })
        }
      : null;

    return {
      account: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        hasPassword: user.passwordHash !== null,
        phoneVerified: user.phoneVerifiedAt !== null,
        emailMasked: user.email ? maskEmail(user.email) : null,
        emailVerified
      },
      recovery: {
        /** Pemulihan otomatis (OTP) hanya lewat email yang sudah terverifikasi. */
        automaticViaEmail: emailVerified,
        /** Kode dari admin boleh diterbitkan hanya untuk akun biasa yang aktif. */
        canIssueAssistedCode: user.status === "ACTIVE" && !privileged,
        activeCodeUntil: activeChallenge?.expiresAt ?? null
      },
      codeHistory,
      driver
    };
  }
}
