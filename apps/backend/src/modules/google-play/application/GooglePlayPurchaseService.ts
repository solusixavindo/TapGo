import {
  GooglePlayAcknowledgementState,
  GooglePlayEntitlementStatus,
  GooglePlayPurchase,
  GooglePlayPurchaseState,
  MembershipTier,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { GooglePlayTokenProtection } from "./GooglePlayTokenProtection.js";
import { GooglePlayVerifier, GooglePlayVerifiedProductPurchase } from "./GooglePlayVerifier.js";

const MEMBERSHIP_RANK: Record<MembershipTier, number> = {
  BASIC: 0,
  SILVER: 1,
  GOLD: 2,
  PLATINUM: 3,
};

type VerifyPurchaseInput = {
  userId: string;
  productId: string;
  purchaseToken: string;
  clientRequestId: string;
};

type GooglePlayPurchaseWithMembership = GooglePlayPurchase & {
  membership: { tier: MembershipTier; name: string };
  googlePlayProduct?: { productId: string };
};

type VerifyPurchaseResult = {
  purchaseId: string;
  productId: string;
  membershipTier: MembershipTier;
  entitlementStatus: GooglePlayEntitlementStatus;
  purchaseState: GooglePlayPurchaseState;
  acknowledgementState: GooglePlayAcknowledgementState;
  acknowledged: boolean;
};

export class GooglePlayPurchaseService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly verifier: GooglePlayVerifier,
    private readonly tokenProtection: GooglePlayTokenProtection,
    private readonly packageName = env.GOOGLE_PLAY_PACKAGE_NAME,
  ) {}

  async verifyPurchase(input: VerifyPurchaseInput): Promise<VerifyPurchaseResult> {
    const product = await this.prisma.googlePlayProduct.findFirst({
      where: {
        productId: input.productId,
        isActive: true,
      },
      include: {
        membership: true,
      },
    });

    if (!product || product.membership.tier === "BASIC") {
      throw new AppError(
        "Produk Google Play tidak tersedia.",
        StatusCodes.NOT_FOUND,
        "GOOGLE_PLAY_PRODUCT_NOT_FOUND",
      );
    }

    if (product.packageName !== this.packageName) {
      throw new AppError(
        "Konfigurasi paket Google Play tidak valid.",
        StatusCodes.SERVICE_UNAVAILABLE,
        "GOOGLE_PLAY_PACKAGE_CONFIGURATION_MISMATCH",
      );
    }

    const purchaseTokenHash = this.tokenProtection.hashPurchaseToken(input.purchaseToken);
    const existingPurchase = await this.findPurchaseByTokenHash(purchaseTokenHash);
    if (existingPurchase) {
      if (existingPurchase.userId !== input.userId) {
        throw new AppError(
          "Purchase token sudah digunakan oleh akun lain.",
          StatusCodes.CONFLICT,
          "GOOGLE_PLAY_PURCHASE_TOKEN_OWNED_BY_ANOTHER_USER",
        );
      }

      if (existingPurchase.entitlementStatus !== "PENDING") {
        return this.handleExistingPurchase(input.userId, existingPurchase);
      }
    }

    const verified = await this.verifier.verifyProductPurchase({
      packageName: product.packageName,
      productId: product.productId,
      purchaseToken: input.purchaseToken,
    });

    this.assertVerifiedProductMatches(verified, product.packageName, product.productId);

    if (verified.purchaseState === "PENDING") {
      const purchase = await this.createNonActivePurchase({
        input,
        ...(existingPurchase ? { existingPurchaseId: existingPurchase.id } : {}),
        purchaseTokenHash,
        encryptedPurchaseToken: this.tokenProtection.encryptPurchaseToken(input.purchaseToken),
        googlePlayProductId: product.id,
        membershipId: product.membershipId,
        verified,
        entitlementStatus: "PENDING",
      });
      return this.toResult(purchase, product.membership.tier, false, product.productId);
    }

    if (verified.purchaseState !== "PURCHASED") {
      const purchase = await this.createNonActivePurchase({
        input,
        ...(existingPurchase ? { existingPurchaseId: existingPurchase.id } : {}),
        purchaseTokenHash,
        encryptedPurchaseToken: this.tokenProtection.encryptPurchaseToken(input.purchaseToken),
        googlePlayProductId: product.id,
        membershipId: product.membershipId,
        verified,
        entitlementStatus: verified.purchaseState === "CANCELLED" ? "CANCELLED" : "REVOKED",
      });
      return this.toResult(purchase, product.membership.tier, false, product.productId);
    }

    let acknowledgementState = verified.acknowledgementState;
    let acknowledgedAt: Date | undefined;
    if (acknowledgementState === "PENDING") {
      const acknowledgement = await this.verifier.acknowledgeProductPurchase({
        packageName: product.packageName,
        productId: product.productId,
        purchaseToken: input.purchaseToken,
      });
      acknowledgementState = "ACKNOWLEDGED";
      acknowledgedAt = acknowledgement.acknowledgedAt;
    }

    try {
      const purchase = await this.prisma.$transaction(async (tx) => {
        const duplicate = await tx.googlePlayPurchase.findUnique({
          where: { purchaseTokenHash },
          include: { membership: true },
        });

        if (duplicate) {
          if (duplicate.userId !== input.userId) {
            throw new AppError(
              "Purchase token sudah digunakan oleh akun lain.",
              StatusCodes.CONFLICT,
              "GOOGLE_PLAY_PURCHASE_TOKEN_OWNED_BY_ANOTHER_USER",
            );
          }

          if (duplicate.entitlementStatus !== "PENDING") {
            return duplicate;
          }
        }

        const currentTier = await this.getCurrentTier(tx, input.userId);
        if (MEMBERSHIP_RANK[product.membership.tier] < MEMBERSHIP_RANK[currentTier]) {
          throw new AppError(
            "Paket Google Play tidak dapat menurunkan membership aktif.",
            StatusCodes.CONFLICT,
            "GOOGLE_PLAY_MEMBERSHIP_DOWNGRADE_NOT_ALLOWED",
          );
        }

        await tx.userMembership.updateMany({
          where: { userId: input.userId, status: "ACTIVE" },
          data: {
            status: "EXPIRED",
            expiresAt: new Date(),
            metadata: {
              source: "GOOGLE_PLAY_SUPERSEDED",
              supersededByProductId: product.productId,
            },
          },
        });

        const purchaseData = {
          userId: input.userId,
          membershipId: product.membershipId,
          googlePlayProductId: product.id,
          purchaseTokenHash,
          encryptedPurchaseToken: this.tokenProtection.encryptPurchaseToken(input.purchaseToken),
          ...(verified.googleOrderId ? { googleOrderId: verified.googleOrderId } : {}),
          purchaseState: "PURCHASED" as const,
          acknowledgementState,
          entitlementStatus: "ACTIVE" as const,
          clientRequestId: input.clientRequestId,
          verifiedAt: new Date(),
          ...(acknowledgedAt ? { acknowledgedAt } : {}),
          metadata: this.metadataFor(verified),
        };

        const createdPurchase = duplicate
          ? await tx.googlePlayPurchase.update({
            where: { id: duplicate.id },
            data: purchaseData,
            include: { membership: true },
          })
          : await tx.googlePlayPurchase.create({
              data: purchaseData,
              include: { membership: true },
            });

        await tx.userMembership.create({
          data: {
            userId: input.userId,
            membershipId: product.membershipId,
            status: "ACTIVE",
            activeAt: new Date(),
            metadata: {
              source: "GOOGLE_PLAY",
              googlePlayPurchaseId: createdPurchase.id,
              productId: product.productId,
              ...(verified.googleOrderId ? { googleOrderId: verified.googleOrderId } : {}),
            },
          },
        });

        await tx.user.update({
          where: { id: input.userId },
          data: { membershipId: product.membershipId },
        });

        return createdPurchase;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      return this.toResult(
        purchase,
        product.membership.tier,
        acknowledgementState === "ACKNOWLEDGED",
        product.productId,
      );
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const duplicate = await this.findPurchaseByTokenHash(purchaseTokenHash);
        if (duplicate) {
          return this.handleExistingPurchase(input.userId, duplicate);
        }
      }
      throw error;
    }
  }

  async resolveHighestValidEntitlement(userId: string) {
    const [basic, purchases] = await Promise.all([
      this.prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } }),
      this.prisma.googlePlayPurchase.findMany({
        where: {
          userId,
          entitlementStatus: "ACTIVE",
          revokedAt: null,
          refundedAt: null,
        },
        include: { membership: true },
      }),
    ]);

    const highest = purchases
      .sort((left, right) => MEMBERSHIP_RANK[right.membership.tier] - MEMBERSHIP_RANK[left.membership.tier])[0];

    return highest?.membership ?? basic;
  }

  private async getCurrentTier(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<MembershipTier> {
    const activeMembership = await tx.userMembership.findFirst({
      where: { userId, status: "ACTIVE" },
      include: { membership: true },
      orderBy: { activeAt: "desc" },
    });

    if (activeMembership) {
      return activeMembership.membership.tier;
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { membership: true },
    });

    return user?.membership?.tier ?? "BASIC";
  }

  private async findPurchaseByTokenHash(purchaseTokenHash: string) {
    return this.prisma.googlePlayPurchase.findUnique({
      where: { purchaseTokenHash },
      include: { membership: true, googlePlayProduct: true },
    });
  }

  private handleExistingPurchase(
    userId: string,
    purchase: GooglePlayPurchaseWithMembership,
  ): VerifyPurchaseResult {
    if (purchase.userId !== userId) {
      throw new AppError(
        "Purchase token sudah digunakan oleh akun lain.",
        StatusCodes.CONFLICT,
        "GOOGLE_PLAY_PURCHASE_TOKEN_OWNED_BY_ANOTHER_USER",
      );
    }

    return this.toResult(
      purchase,
      purchase.membership.tier,
      purchase.acknowledgementState === "ACKNOWLEDGED",
      purchase.googlePlayProduct?.productId ?? "",
    );
  }

  private async createNonActivePurchase(args: {
    input: VerifyPurchaseInput;
    existingPurchaseId?: string;
    purchaseTokenHash: string;
    encryptedPurchaseToken: string;
    googlePlayProductId: string;
    membershipId: string;
    verified: GooglePlayVerifiedProductPurchase;
    entitlementStatus: GooglePlayEntitlementStatus;
  }) {
    const data = {
      userId: args.input.userId,
      membershipId: args.membershipId,
      googlePlayProductId: args.googlePlayProductId,
      purchaseTokenHash: args.purchaseTokenHash,
      encryptedPurchaseToken: args.encryptedPurchaseToken,
      ...(args.verified.googleOrderId ? { googleOrderId: args.verified.googleOrderId } : {}),
      purchaseState: args.verified.purchaseState,
      acknowledgementState: args.verified.acknowledgementState,
      entitlementStatus: args.entitlementStatus,
      clientRequestId: args.input.clientRequestId,
      verifiedAt: new Date(),
      metadata: this.metadataFor(args.verified),
    };

    if (args.existingPurchaseId) {
      return this.prisma.googlePlayPurchase.update({
        where: { id: args.existingPurchaseId },
        data,
      });
    }

    return this.prisma.googlePlayPurchase.create({
      data: {
        ...data,
      },
    });
  }

  private assertVerifiedProductMatches(
    verified: GooglePlayVerifiedProductPurchase,
    expectedPackageName: string,
    expectedProductId: string,
  ) {
    if (verified.packageName !== expectedPackageName) {
      throw new AppError(
        "Package pembelian Google Play tidak valid.",
        StatusCodes.BAD_REQUEST,
        "GOOGLE_PLAY_PACKAGE_MISMATCH",
      );
    }

    if (verified.productId !== expectedProductId) {
      throw new AppError(
        "Produk pembelian Google Play tidak valid.",
        StatusCodes.BAD_REQUEST,
        "GOOGLE_PLAY_PRODUCT_MISMATCH",
      );
    }
  }

  private metadataFor(verified: GooglePlayVerifiedProductPurchase): Prisma.InputJsonObject {
    return {
      source: "GOOGLE_PLAY",
      ...(verified.purchaseTime ? { purchaseTime: verified.purchaseTime.toISOString() } : {}),
      ...(typeof verified.testPurchase === "boolean" ? { testPurchase: verified.testPurchase } : {}),
      ...(verified.obfuscatedAccountId ? { obfuscatedAccountId: verified.obfuscatedAccountId } : {}),
    };
  }

  private toResult(
    purchase: GooglePlayPurchase,
    membershipTier: MembershipTier,
    acknowledged: boolean,
    productId: string,
  ): VerifyPurchaseResult {
    return {
      purchaseId: purchase.id,
      productId,
      membershipTier,
      entitlementStatus: purchase.entitlementStatus,
      purchaseState: purchase.purchaseState,
      acknowledgementState: purchase.acknowledgementState,
      acknowledged,
    };
  }

  private isUniqueConstraint(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    );
  }
}
