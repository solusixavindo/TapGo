import {
  MembershipOrderChannel,
  MembershipOrderStatus,
  MembershipTier,
  Prisma,
  PrismaClient,
  UserRole
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

type PrismaTransaction = Prisma.TransactionClient;

const pendingOrderStatuses: MembershipOrderStatus[] = ["PENDING"];
const levelBonusRates = new Map<number, Prisma.Decimal>([
  [1, new Prisma.Decimal(8)],
  [2, new Prisma.Decimal(4)],
  [3, new Prisma.Decimal(2)],
  [4, new Prisma.Decimal(2)],
  [5, new Prisma.Decimal(2)],
  [6, new Prisma.Decimal(1)],
  [7, new Prisma.Decimal(1)],
  [8, new Prisma.Decimal(1)],
  [9, new Prisma.Decimal(1)],
  [10, new Prisma.Decimal(1)]
]);
const rewardMilestones: Array<{ threshold: number; amount: Prisma.Decimal }> = [
  { threshold: 10, amount: new Prisma.Decimal(500000) },
  { threshold: 100, amount: new Prisma.Decimal(5000000) },
  { threshold: 1000, amount: new Prisma.Decimal(50000000) },
  { threshold: 10000, amount: new Prisma.Decimal(500000000) },
  { threshold: 100000, amount: new Prisma.Decimal(5000000000) }
];
const basicSponsorBonusAmount = new Prisma.Decimal(2000);
const tierRank: Record<MembershipTier, number> = {
  BASIC: 0,
  SILVER: 1,
  GOLD: 2,
  PLATINUM: 3
};
const levelLimitByTier: Record<MembershipTier, number> = {
  BASIC: 0,
  SILVER: 3,
  GOLD: 5,
  PLATINUM: 10
};

/// Bentuk order yang dibutuhkan tahap aktivasi. Dipisah supaya fase settle
/// pembayaran dan fase aktivasi membaca order dengan relasi yang sama persis.
const activationOrderInclude = {
  membership: { include: { benefits: { orderBy: { level: "asc" as const } } } },
  invoice: true,
  payments: { orderBy: { createdAt: "desc" as const } },
  userMembership: true
} satisfies Prisma.MembershipOrderInclude;

type ActivationOrder = Prisma.MembershipOrderGetPayload<{ include: typeof activationOrderInclude }>;

export class MembershipOrderService {
  constructor(private readonly prisma: PrismaClient) {}

  listPackages() {
    return this.prisma.membership.findMany({
      where: { isActive: true },
      include: { benefits: { orderBy: { level: "asc" } } },
      orderBy: { price: "asc" }
    });
  }

  async createOrder(input: {
    userId: string;
    packageId: string;
    registrationData?: Record<string, unknown>;
    /// Kanal asal order. Dicatat untuk audit; tidak memengaruhi tarif maupun
    /// entitlement. Otorisasi kanal ditegakkan di lapisan presentation.
    channel?: MembershipOrderChannel;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const membershipPackage = await tx.membership.findFirst({
        where: { id: input.packageId, isActive: true },
        include: { benefits: { orderBy: { level: "asc" } } }
      });

      if (!membershipPackage) {
        throw new AppError("Membership package is unavailable", StatusCodes.BAD_REQUEST, "MEMBERSHIP_PACKAGE_UNAVAILABLE");
      }

      const currentTier = await this.getUserCurrentTier(tx, input.userId);
      this.assertNoDowngrade(currentTier, membershipPackage.tier);

      const activePendingOrder = await tx.membershipOrder.findFirst({
        where: {
          userId: input.userId,
          status: { in: pendingOrderStatuses }
        }
      });

      if (activePendingOrder) {
        throw new AppError("User already has a pending membership order", StatusCodes.CONFLICT, "MEMBERSHIP_ORDER_PENDING");
      }

      const invoiceNumber = await this.generateInvoiceNumber(tx);
      const packageSnapshot = this.buildPackageSnapshot(membershipPackage);
      const amount = new Prisma.Decimal(membershipPackage.price);

      const order = await tx.membershipOrder.create({
        data: {
          userId: input.userId,
          membershipId: membershipPackage.id,
          status: "PENDING",
          ...(input.channel ? { channel: input.channel } : {}),
          totalAmount: amount,
          packageSnapshot: packageSnapshot as Prisma.InputJsonValue,
          registrationData: (input.registrationData ?? {}) as Prisma.InputJsonValue,
          invoice: {
            create: {
              userId: input.userId,
              number: invoiceNumber,
              status: "PENDING",
              amount,
              dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
            }
          }
        }
      });

      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { orderId: order.id }
      });

      await tx.membershipPayment.create({
        data: {
          orderId: order.id,
          invoiceId: invoice.id,
          userId: input.userId,
          amount,
          status: "PENDING",
          method: "DEVELOPMENT_PLACEHOLDER"
        }
      });

      return tx.membershipOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: this.orderInclude()
      });
    });
  }

  async getOrder(input: { userId: string; role: UserRole; orderId: string }) {
    const order = await this.prisma.membershipOrder.findUnique({
      where: { id: input.orderId },
      include: this.orderInclude()
    });

    if (!order) {
      throw new AppError("Membership order not found", StatusCodes.NOT_FOUND, "MEMBERSHIP_ORDER_NOT_FOUND");
    }

    if (!this.canReadOrder(input.role, input.userId, order.userId)) {
      throw new AppError("You are not allowed to view this membership order", StatusCodes.FORBIDDEN, "MEMBERSHIP_ORDER_FORBIDDEN");
    }

    return order;
  }

  async markPaymentSuccess(input: {
    userId: string;
    role: UserRole;
    orderId: string;
    paymentReference?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.membershipOrder.findUnique({
        where: { id: input.orderId },
        include: activationOrderInclude
      });

      if (!order) {
        throw new AppError("Membership order not found", StatusCodes.NOT_FOUND, "MEMBERSHIP_ORDER_NOT_FOUND");
      }

      if (!this.canReadOrder(input.role, input.userId, order.userId)) {
        throw new AppError("You are not allowed to pay this membership order", StatusCodes.FORBIDDEN, "MEMBERSHIP_ORDER_FORBIDDEN");
      }

      if (!order.invoice) {
        throw new AppError("Membership order invoice not found", StatusCodes.CONFLICT, "MEMBERSHIP_INVOICE_NOT_FOUND");
      }

      const currentTier = await this.getUserCurrentTier(tx, order.userId);
      this.assertNoDowngrade(currentTier, order.membership.tier);

      const now = new Date();
      const invoiceUpdate = await tx.invoice.updateMany({
        where: {
          id: order.invoice.id,
          status: "PENDING"
        },
        data: {
          status: "PAID",
          paidAt: now
        }
      });

      if (invoiceUpdate.count !== 1) {
        throw new AppError("Membership invoice has already been paid or cannot be paid", StatusCodes.CONFLICT, "MEMBERSHIP_INVOICE_ALREADY_FINALIZED");
      }

      await tx.membershipOrder.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paidAt: now
        }
      });

      const latestPayment = order.payments[0];
      if (latestPayment) {
        await tx.membershipPayment.updateMany({
          where: {
            id: latestPayment.id,
            status: "PENDING"
          },
          data: {
            status: "PAID",
            paidAt: now,
            providerReference: input.paymentReference ?? latestPayment.providerReference
          }
        });
      } else {
        await tx.membershipPayment.create({
        data: {
          orderId: order.id,
          invoiceId: order.invoice.id,
          userId: order.userId,
          amount: order.totalAmount,
          status: "PAID",
          method: "DEVELOPMENT_PLACEHOLDER",
          paidAt: now,
          ...(input.paymentReference ? { providerReference: input.paymentReference } : {})
        }
      });
      }

      // Stage R2.6 jalur A: pembelian dari web berhenti di sini. Uangnya sudah
      // tercatat lunas, tetapi membership, benefit PPOB, bonus sponsor, bonus
      // level, reward, dan auto-upgrade baru berjalan setelah admin
      // memverifikasi dokumen KYC lewat activateVerifiedOrder(). Kanal lain
      // (APP, ADMIN, dan order lama yang kanalnya null) tidak berubah.
      if (this.requiresDocumentVerification(order.channel)) {
        return tx.membershipOrder.findUniqueOrThrow({
          where: { id: order.id },
          include: {
            ...this.orderInclude(),
            userMembership: true
          }
        });
      }

      await this.activateMembership(tx, order, now);

      return tx.membershipOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          ...this.orderInclude(),
          userMembership: true
        }
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000
    });
  }

  /// Aktivasi membership untuk order kanal WEB yang dokumennya sudah
  /// diverifikasi admin (Stage R2.6 jalur A, poin 5). Menjalankan rangkaian
  /// efek Business Engine yang sama persis dengan pembelian kanal lain, hanya
  /// waktunya yang ditunda sampai verifikasi selesai.
  async activateVerifiedOrder(input: { orderId: string; adminId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.membershipOrder.findUnique({
        where: { id: input.orderId },
        include: activationOrderInclude
      });

      if (!order) {
        throw new AppError("Membership order not found", StatusCodes.NOT_FOUND, "MEMBERSHIP_ORDER_NOT_FOUND");
      }

      if (!this.requiresDocumentVerification(order.channel)) {
        throw new AppError(
          "Membership order for this channel activates on payment and cannot be verified",
          StatusCodes.CONFLICT,
          "MEMBERSHIP_VERIFICATION_NOT_REQUIRED"
        );
      }

      if (order.status !== "PAID") {
        throw new AppError(
          "Membership order must be paid before document verification",
          StatusCodes.CONFLICT,
          "MEMBERSHIP_ORDER_NOT_PAID"
        );
      }

      if (order.userMembership) {
        throw new AppError(
          "Membership order has already been activated",
          StatusCodes.CONFLICT,
          "MEMBERSHIP_ALREADY_ACTIVATED"
        );
      }

      if (!order.invoice) {
        throw new AppError("Membership order invoice not found", StatusCodes.CONFLICT, "MEMBERSHIP_INVOICE_NOT_FOUND");
      }

      const currentTier = await this.getUserCurrentTier(tx, order.userId);
      this.assertNoDowngrade(currentTier, order.membership.tier);

      const now = new Date();

      await tx.membershipOrder.update({
        where: { id: order.id },
        data: {
          registrationData: {
            ...(this.asObject(order.registrationData)),
            documentVerification: {
              verifiedBy: input.adminId,
              verifiedAt: now.toISOString()
            }
          }
        }
      });

      await this.activateMembership(tx, order, now);

      return tx.membershipOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          ...this.orderInclude(),
          userMembership: true
        }
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000
    });
  }

  /// Hanya pembelian kanal WEB yang menunggu verifikasi dokumen. Aturannya
  /// ditegakkan di service, bukan di controller, supaya entry point baru tidak
  /// bisa melewatinya tanpa sengaja.
  private requiresDocumentVerification(channel: MembershipOrderChannel | null) {
    return channel === "WEB";
  }

  /// Seluruh efek Business Engine dari satu pembelian membership yang sah.
  /// Dipanggil dari markPaymentSuccess (kanal non-WEB) dan dari
  /// activateVerifiedOrder (kanal WEB setelah verifikasi admin), sehingga
  /// kedua jalur menghasilkan pembukuan yang identik.
  private async activateMembership(tx: PrismaTransaction, order: ActivationOrder, now: Date) {
    if (!order.invoice) {
      throw new AppError("Membership order invoice not found", StatusCodes.CONFLICT, "MEMBERSHIP_INVOICE_NOT_FOUND");
    }

    const invoice = order.invoice;

    const previousMembership = await tx.userMembership.findFirst({
      where: {
        userId: order.userId,
        status: "ACTIVE",
        orderId: { not: order.id }
      },
      include: { membership: true },
      orderBy: { activeAt: "desc" }
    });

    if (previousMembership) {
      await tx.userMembership.update({
        where: { id: previousMembership.id },
        data: {
          status: "EXPIRED",
          expiresAt: now,
          metadata: {
            ...(this.asObject(previousMembership.metadata)),
            upgradedToMembershipId: order.membershipId,
            upgradedToOrderId: order.id,
            upgradedAt: now.toISOString()
          }
        }
      });
    }

    await tx.userMembership.upsert({
      where: { orderId: order.id },
      update: {
        status: "ACTIVE",
        activeAt: now,
        expiresAt: null,
        metadata: {
          previousMembershipId: previousMembership?.membershipId ?? null,
          previousPackageName: previousMembership?.membership.name ?? null,
          packageName: order.membership.name,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          activatedAt: now.toISOString()
        }
      },
      create: {
        userId: order.userId,
        membershipId: order.membershipId,
        orderId: order.id,
        status: "ACTIVE",
        activeAt: now,
        metadata: {
          previousMembershipId: previousMembership?.membershipId ?? null,
          previousPackageName: previousMembership?.membership.name ?? null,
          packageName: order.membership.name,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          activatedAt: now.toISOString()
        }
      }
    });

    await tx.user.update({
      where: { id: order.userId },
      data: { membershipId: order.membershipId }
    });

    await this.creditPpobBenefit(tx, {
      userId: order.userId,
      orderId: order.id,
      invoiceId: invoice.id,
      membershipId: order.membershipId,
      packageName: order.membership.name,
      amount: order.membership.ppobBalance
    });

    await this.creditSponsorBonus(tx, {
      userId: order.userId,
      orderId: order.id,
      invoiceId: invoice.id,
      membershipId: order.membershipId,
      packageName: order.membership.name,
      packageTier: order.membership.tier,
      packagePrice: order.membership.price
    });

    await this.creditLevelBonuses(tx, {
      userId: order.userId,
      orderId: order.id,
      invoiceId: invoice.id,
      membershipId: order.membershipId,
      packageName: order.membership.name,
      packageTier: order.membership.tier,
      packagePrice: order.membership.price
    });

    await this.creditRewardBonus(tx, {
      userId: order.userId,
      sourceUserId: order.userId,
      membershipTier: order.membership.tier
    });

    await this.evaluateAutoUpgradeForUser(tx, {
      userId: order.userId,
      sourceOrderId: order.id,
      now
    });

    const directSponsor = await tx.referral.findUnique({
      where: { userId: order.userId },
      select: { sponsorId: true, status: true }
    });
    if (directSponsor?.status === "ACTIVE") {
      await this.evaluateAutoUpgradeForUser(tx, {
        userId: directSponsor.sponsorId,
        sourceOrderId: order.id,
        now
      });
      await this.creditRewardBonus(tx, {
        userId: directSponsor.sponsorId,
        sourceUserId: order.userId,
        membershipTier: await this.getUserCurrentTier(tx, directSponsor.sponsorId)
      });
    }
  }

  listMyOrders(userId: string) {
    return this.prisma.membershipOrder.findMany({
      where: { userId },
      include: this.orderInclude(),
      orderBy: { createdAt: "desc" }
    });
  }

  async getMyMembership(userId: string) {
    const activeMembership = await this.prisma.userMembership.findFirst({
      where: { userId, status: "ACTIVE" },
      include: {
        membership: { include: { benefits: { orderBy: { level: "asc" } } } },
        order: { include: { invoice: true } }
      },
      orderBy: { activeAt: "desc" }
    });

    if (!activeMembership) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          membershipId: true,
          createdAt: true,
          updatedAt: true,
          membership: {
            include: { benefits: { orderBy: { level: "asc" } } }
          }
        }
      });

      if (!user) {
        throw new AppError("User not found", StatusCodes.NOT_FOUND, "USER_NOT_FOUND");
      }

      const membership =
        user.membership ??
        await this.prisma.membership.findUnique({
          where: { tier: "BASIC" },
          include: { benefits: { orderBy: { level: "asc" } } }
        });

      if (!membership) {
        return {
          status: "EMPTY" as const,
          membership: null
        };
      }

      return {
        status: "ACTIVE" as const,
        membership: {
          id: `profile-${user.id}`,
          userId: user.id,
          membershipId: membership.id,
          orderId: null,
          status: "ACTIVE" as const,
          activeAt: user.createdAt,
          expiresAt: null,
          metadata: {
            source: "USER_PROFILE_MEMBERSHIP"
          },
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          membership,
          order: null
        }
      };
    }

    return {
      status: "ACTIVE" as const,
      membership: activeMembership
    };
  }

  private orderInclude() {
    return {
      membership: { include: { benefits: { orderBy: { level: "asc" as const } } } },
      invoice: true,
      payments: { orderBy: { createdAt: "desc" as const } },
      user: { select: { id: true, fullName: true, email: true, phone: true, referralCode: true } }
    };
  }

  private canReadOrder(role: UserRole, requesterId: string, ownerId: string) {
    return requesterId === ownerId || role === "ADMIN" || role === "SUPER_ADMIN";
  }

  private async generateInvoiceNumber(tx: PrismaTransaction) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const date = new Date();
      const yyyymmdd = date.toISOString().slice(0, 10).replaceAll("-", "");
      const entropy = `${Date.now().toString(36)}${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`.toUpperCase();
      const number = `INV-MBR-${yyyymmdd}-${entropy}`;
      const existing = await tx.invoice.findUnique({ where: { number } });

      if (!existing) {
        return number;
      }
    }

    throw new AppError("Failed to generate invoice number", StatusCodes.INTERNAL_SERVER_ERROR, "INVOICE_NUMBER_GENERATION_FAILED");
  }

  private buildPackageSnapshot(membershipPackage: {
    id: string;
    tier: string;
    name: string;
    price: Prisma.Decimal;
    directBonus: Prisma.Decimal;
    activeLevels: number;
    ppobBalance: Prisma.Decimal;
    bpjsBenefit: string | null;
    merchandise: Prisma.JsonValue;
    businessRight: string | null;
    benefits: Array<{
      level: number;
      commissionRate: Prisma.Decimal;
      fixedBonus: Prisma.Decimal;
      isActive: boolean;
    }>;
  }) {
    return {
      id: membershipPackage.id,
      tier: membershipPackage.tier,
      name: membershipPackage.name,
      price: membershipPackage.price.toFixed(2),
      directBonus: membershipPackage.directBonus.toFixed(2),
      activeLevels: membershipPackage.activeLevels,
      ppobBalance: membershipPackage.ppobBalance.toFixed(2),
      bpjsBenefit: membershipPackage.bpjsBenefit,
      merchandise: membershipPackage.merchandise,
      businessRight: membershipPackage.businessRight,
      benefits: membershipPackage.benefits.map((benefit) => ({
        level: benefit.level,
        commissionRate: benefit.commissionRate.toFixed(2),
        fixedBonus: benefit.fixedBonus.toFixed(2),
        isActive: benefit.isActive
      }))
    };
  }

  private async creditPpobBenefit(tx: PrismaTransaction, input: {
    userId: string;
    orderId: string;
    invoiceId: string;
    membershipId: string;
    packageName: string;
    amount: Prisma.Decimal;
  }) {
    if (input.amount.lte(0)) {
      return;
    }

    const existingCredit = await tx.walletTransaction.findFirst({
      where: {
        type: "PPOB_BENEFIT",
        referenceType: "MEMBERSHIP_ORDER",
        referenceId: input.orderId
      }
    });

    if (existingCredit) {
      return;
    }

    const wallet = await tx.wallet.upsert({
      where: { userId: input.userId },
      update: {
        ppobBalance: {
          increment: input.amount
        }
      },
      create: {
        userId: input.userId,
        balance: new Prisma.Decimal(0),
        cashBalance: new Prisma.Decimal(0),
        ppobBalance: input.amount,
        currency: "IDR"
      }
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "PPOB_BENEFIT",
        amount: input.amount,
        referenceType: "MEMBERSHIP_ORDER",
        referenceId: input.orderId,
        metadata: {
          invoiceId: input.invoiceId,
          membershipId: input.membershipId,
          packageName: input.packageName
        }
      }
    });
  }

  private async creditSponsorBonus(tx: PrismaTransaction, input: {
    userId: string;
    orderId: string;
    invoiceId: string;
    membershipId: string;
    packageName: string;
    packageTier: "BASIC" | "SILVER" | "GOLD" | "PLATINUM";
    packagePrice: Prisma.Decimal;
  }) {
    if (input.packageTier === "BASIC") {
      return;
    }

    const referral = await tx.referral.findUnique({
      where: { userId: input.userId },
      select: {
        id: true,
        sponsorId: true,
        status: true
      }
    });

    if (!referral || referral.status !== "ACTIVE") {
      return;
    }

    if (!(await this.canReceiveNewFounderBonus(tx, referral.sponsorId))) {
      return;
    }

    const sponsorTier = await this.getUserCurrentTier(tx, referral.sponsorId);
    const isBasicSponsor = sponsorTier === "BASIC";
    const commissionType = isBasicSponsor ? "BASIC_SPONSOR_BONUS" : "SPONSOR_BONUS";
    const amount = isBasicSponsor
      ? basicSponsorBonusAmount
      : input.packagePrice.mul(8).div(100);

    if (amount.lte(0)) {
      return;
    }

    const existingCommission = await tx.commission.findUnique({
      where: {
        beneficiaryId_triggerType_triggerId_type_level: {
          beneficiaryId: referral.sponsorId,
          triggerType: "MEMBERSHIP_ORDER",
          triggerId: input.orderId,
          type: commissionType,
          level: 1
        }
      },
      select: { id: true }
    });

    if (existingCommission) {
      return;
    }

    const wallet = await tx.wallet.upsert({
      where: { userId: referral.sponsorId },
      update: {},
      create: {
        userId: referral.sponsorId,
        balance: new Prisma.Decimal(0),
        cashBalance: new Prisma.Decimal(0),
        ppobBalance: new Prisma.Decimal(0),
        currency: "IDR"
      },
      select: { id: true }
    });

    const walletTransaction = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: commissionType,
        amount,
        referenceType: "MEMBERSHIP_ORDER",
        referenceId: input.orderId,
        metadata: {
          invoiceId: input.invoiceId,
          membershipId: input.membershipId,
          packageName: input.packageName,
          packageTier: input.packageTier,
          sourceUserId: input.userId,
          referralId: referral.id,
          sponsorTier,
          rate: isBasicSponsor ? null : "8.00",
          rule: isBasicSponsor ? "basic_sponsor_paid_membership_fixed_bonus" : "paid_membership_direct_sponsor_8_percent"
        }
      },
      select: { id: true }
    });

    await tx.commission.create({
      data: {
        beneficiaryId: referral.sponsorId,
        sourceUserId: input.userId,
        referralId: referral.id,
        walletTransactionId: walletTransaction.id,
        type: commissionType,
        status: "POSTED",
        level: 1,
        amount,
        ...(isBasicSponsor ? {} : { rate: new Prisma.Decimal(8) }),
        triggerType: "MEMBERSHIP_ORDER",
        triggerId: input.orderId,
        metadata: {
          invoiceId: input.invoiceId,
          membershipId: input.membershipId,
          packageName: input.packageName,
          packageTier: input.packageTier,
          sponsorTier
        },
        postedAt: new Date()
      }
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        cashBalance: {
          increment: amount
        },
        balance: {
          increment: amount
        }
      }
    });
  }

  private async creditLevelBonuses(tx: PrismaTransaction, input: {
    userId: string;
    orderId: string;
    invoiceId: string;
    membershipId: string;
    packageName: string;
    packageTier: "BASIC" | "SILVER" | "GOLD" | "PLATINUM";
    packagePrice: Prisma.Decimal;
  }) {
    if (input.packageTier === "BASIC") {
      return;
    }

    const uplines = await tx.referralLevel.findMany({
      where: {
        descendantId: input.userId,
        level: { gte: 1, lte: 10 }
      },
      select: {
        ancestorId: true,
        level: true
      },
      orderBy: { level: "asc" }
    });

    for (const upline of uplines) {
      const rate = levelBonusRates.get(upline.level);
      if (!rate) {
        continue;
      }

      if (!(await this.canReceiveNewFounderBonus(tx, upline.ancestorId))) {
        continue;
      }

      const uplineTier = await this.getUserCurrentTier(tx, upline.ancestorId);
      const unlockedLevel = levelLimitByTier[uplineTier];

      if (upline.level > unlockedLevel) {
        continue;
      }

      const amount = input.packagePrice.mul(rate).div(100);
      if (amount.lte(0)) {
        continue;
      }

      const existingCommission = await tx.commission.findUnique({
        where: {
          beneficiaryId_triggerType_triggerId_type_level: {
            beneficiaryId: upline.ancestorId,
            triggerType: "MEMBERSHIP_ORDER",
            triggerId: input.orderId,
            type: "LEVEL_BONUS",
            level: upline.level
          }
        },
        select: { id: true }
      });

      if (existingCommission) {
        continue;
      }

      const wallet = await tx.wallet.upsert({
        where: { userId: upline.ancestorId },
        update: {},
        create: {
          userId: upline.ancestorId,
          balance: new Prisma.Decimal(0),
          cashBalance: new Prisma.Decimal(0),
          ppobBalance: new Prisma.Decimal(0),
          currency: "IDR"
        },
        select: { id: true }
      });

      const walletTransaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "LEVEL_BONUS",
          amount,
          referenceType: "MEMBERSHIP_ORDER",
          referenceId: input.orderId,
          metadata: {
            invoiceId: input.invoiceId,
            membershipId: input.membershipId,
            packageName: input.packageName,
            packageTier: input.packageTier,
            sourceUserId: input.userId,
            level: upline.level,
            rate: rate.toFixed(2),
            uplineTier,
            unlockedLevel
          }
        },
        select: { id: true }
      });

      await tx.commission.create({
        data: {
          beneficiaryId: upline.ancestorId,
          sourceUserId: input.userId,
          walletTransactionId: walletTransaction.id,
          type: "LEVEL_BONUS",
          status: "POSTED",
          level: upline.level,
          amount,
          rate,
          triggerType: "MEMBERSHIP_ORDER",
          triggerId: input.orderId,
          metadata: {
            invoiceId: input.invoiceId,
            membershipId: input.membershipId,
            packageName: input.packageName,
            packageTier: input.packageTier,
            uplineTier,
            unlockedLevel
          },
          postedAt: new Date()
        }
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          cashBalance: {
            increment: amount
          },
          balance: {
            increment: amount
          }
        }
      });
    }
  }

  private async creditRewardBonus(tx: PrismaTransaction, input: {
    userId: string;
    sourceUserId: string;
    membershipTier: "BASIC" | "SILVER" | "GOLD" | "PLATINUM";
  }) {
    if (!(await this.canReceiveNewFounderBonus(tx, input.userId))) {
      return;
    }

    const directSilverCount = await tx.referral.count({
      where: {
        sponsorId: input.userId,
        status: "ACTIVE",
        user: {
          membership: {
            tier: "SILVER"
          },
          userMemberships: {
            some: {
              status: "ACTIVE",
              membership: {
                tier: "SILVER"
              }
            }
          }
        }
      }
    });

    for (const milestone of rewardMilestones) {
      if (directSilverCount < milestone.threshold) {
        continue;
      }

      const referenceId = `DIRECT_SILVER_${milestone.threshold}`;
      const existingReward = await tx.rewardTransaction.findUnique({
        where: {
          userId_referenceType_referenceId: {
            userId: input.userId,
            referenceType: "REWARD_MILESTONE",
            referenceId
          }
        },
        select: { id: true }
      });

      if (existingReward) {
        continue;
      }

      await tx.rewardTransaction.create({
        data: {
          userId: input.userId,
          threshold: milestone.threshold,
          directSilverCount,
          amount: milestone.amount,
          status: "PENDING",
          referenceType: "REWARD_MILESTONE",
          referenceId,
          metadata: {
            membershipTier: input.membershipTier,
            directSilverCount,
            rule: "direct_active_silver_threshold_reward",
            sourceUserId: input.sourceUserId
          }
        }
      });
    }
  }

  private async evaluateAutoUpgradeForUser(tx: PrismaTransaction, input: {
    userId: string;
    sourceOrderId: string;
    now: Date;
  }) {
    const currentTier = await this.getUserCurrentTier(tx, input.userId);
    if (currentTier === "PLATINUM" || currentTier === "BASIC") {
      return;
    }

    const directActiveSilver = await tx.referral.count({
      where: {
        sponsorId: input.userId,
        status: "ACTIVE",
        user: {
          membership: {
            tier: "SILVER"
          },
          userMemberships: {
            some: {
              status: "ACTIVE",
              membership: {
                tier: "SILVER"
              }
            }
          }
        }
      }
    });

    const targetTier: MembershipTier | null = directActiveSilver >= 10
      ? "PLATINUM"
      : directActiveSilver >= 5 && currentTier === "SILVER"
        ? "GOLD"
        : null;

    if (!targetTier || tierRank[targetTier] <= tierRank[currentTier]) {
      return;
    }

    const targetMembership = await tx.membership.findUnique({
      where: { tier: targetTier },
      select: { id: true, tier: true }
    });
    if (!targetMembership) {
      return;
    }

    const previousMembership = await tx.userMembership.findFirst({
      where: {
        userId: input.userId,
        status: "ACTIVE"
      },
      include: { membership: true },
      orderBy: { activeAt: "desc" }
    });

    await tx.userMembership.updateMany({
      where: {
        userId: input.userId,
        status: "ACTIVE"
      },
      data: {
        status: "EXPIRED",
        expiresAt: input.now,
        metadata: {
          autoUpgradedToTier: targetTier,
          autoUpgradeSourceOrderId: input.sourceOrderId,
          autoUpgradeAt: input.now.toISOString()
        }
      }
    });

    await tx.userMembership.create({
      data: {
        userId: input.userId,
        membershipId: targetMembership.id,
        status: "ACTIVE",
        activeAt: input.now,
        metadata: {
          autoUpgrade: true,
          autoUpgradeFromTier: currentTier,
          previousMembershipId: previousMembership?.membershipId ?? null,
          previousPackageName: previousMembership?.membership.name ?? null,
          directActiveSilver,
          sourceOrderId: input.sourceOrderId,
          activatedAt: input.now.toISOString()
        }
      }
    });

    await tx.user.update({
      where: { id: input.userId },
      data: { membershipId: targetMembership.id }
    });
  }

  private async getUserCurrentTier(tx: PrismaTransaction, userId: string): Promise<MembershipTier> {
    const activeMembership = await tx.userMembership.findFirst({
      where: {
        userId,
        status: "ACTIVE"
      },
      include: { membership: true },
      orderBy: { activeAt: "desc" }
    });
    if (activeMembership?.membership.tier) {
      return activeMembership.membership.tier;
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { membership: true }
    });

    return user?.membership?.tier ?? "BASIC";
  }

  private async canReceiveNewFounderBonus(tx: PrismaTransaction, userId: string) {
    const founderGrant = await tx.founderProgramGrant.findFirst({
      where: {
        userId
      },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { status: true } } }
    });

    if (!founderGrant) {
      return true;
    }

    return !founderGrant.revokedAt && founderGrant.user.status === "ACTIVE";
  }

  private assertNoDowngrade(currentTier: MembershipTier, targetTier: MembershipTier) {
    if (tierRank[targetTier] < tierRank[currentTier]) {
      throw new AppError("Membership downgrade is not allowed", StatusCodes.CONFLICT, "MEMBERSHIP_DOWNGRADE_NOT_ALLOWED");
    }
  }

  private asObject(value: Prisma.JsonValue) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }
}
