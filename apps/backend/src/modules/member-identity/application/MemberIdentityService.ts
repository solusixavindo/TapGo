import { Prisma, PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { prisma } from "../../../config/prisma.js";

const MEMBER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

export class MemberIdentityService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getOrCreateForUser(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        memberIdentity: true,
      },
    });

    if (!user) {
      throw new AppError("User tidak ditemukan.", StatusCodes.NOT_FOUND, "USER_NOT_FOUND");
    }

    const identity =
      user.memberIdentity ?? (await this.createIdentityWithRetry(user.id));

    return {
      memberId: identity.publicCode,
      displayName: user.fullName,
      membership: user.membership?.name ?? "Basic",
      membershipTier: user.membership?.tier ?? "BASIC",
      status: identity.revokedAt ? "INACTIVE" : "ACTIVE",
      joinedAt: user.createdAt,
      issuedAt: identity.issuedAt,
    };
  }

  private async createIdentityWithRetry(userId: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.db.memberIdentity.create({
          data: {
            userId,
            publicCode: this.generatePublicCode(),
          },
        });
      } catch (error) {
        if (this.isUniqueConstraint(error)) {
          const existing = await this.db.memberIdentity.findUnique({
            where: { userId },
          });
          if (existing) {
            return existing;
          }
          continue;
        }
        throw error;
      }
    }

    throw new AppError(
      "Member ID belum dapat dibuat. Silakan coba lagi.",
      StatusCodes.CONFLICT,
      "MEMBER_ID_CREATE_RETRY_EXHAUSTED",
    );
  }

  private generatePublicCode() {
    const bytes = randomBytes(10);
    let suffix = "";
    for (const byte of bytes) {
      suffix += MEMBER_CODE_ALPHABET[byte % MEMBER_CODE_ALPHABET.length];
    }
    return `TGM-${suffix}`;
  }

  private isUniqueConstraint(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }
}
