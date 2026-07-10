import { Prisma, PrismaClient } from "@prisma/client";
import {
  CommissionLedgerItem,
  CommissionDistribution,
  ReferralDepthStats,
  ReferralDownlineNode,
  ReferralRepository,
  ReferralSummary,
  ReferralTreeNode,
  ReferralUplinkNode
} from "../domain/ReferralRepository.js";

type RawUplinkRow = {
  user_id: string;
  full_name: string;
  referral_code: string;
  level_from_user: number;
  membership_tier: "BASIC" | "SILVER" | "GOLD" | "PLATINUM";
  joined_at: Date;
};

type RawDownlineRow = {
  user_id: string;
  sponsor_id: string;
  full_name: string;
  referral_code: string;
  depth: number;
  membership_tier: "BASIC" | "SILVER" | "GOLD" | "PLATINUM";
  joined_at: Date;
};

type RawDepthRow = {
  level: number;
  total: number;
};

export class PrismaReferralRepository implements ReferralRepository {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(handler, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000
    });
  }

  findUserById(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.user.findUnique({ where: { id: userId } });
  }

  findUserByReferralCode(referralCode: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.user.findUnique({ where: { referralCode } });
  }

  findExistingReferral(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.referral.findUnique({
      where: { userId },
      select: { id: true }
    });
  }

  async hasReferralPath(ancestorId: string, descendantId: string, tx: Prisma.TransactionClient = this.prisma) {
    const existing = await tx.referralLevel.findUnique({
      where: {
        ancestorId_descendantId: {
          ancestorId,
          descendantId
        }
      },
      select: { id: true }
    });

    return Boolean(existing);
  }

  getSponsorAncestors(sponsorId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.referralLevel.findMany({
      where: {
        descendantId: sponsorId,
        level: { lt: 10 }
      },
      select: {
        ancestorId: true,
        level: true
      },
      orderBy: { level: "asc" }
    });
  }

  async getUserMembership(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        membership: {
          select: {
            id: true,
            tier: true,
            directBonus: true,
            activeLevels: true,
            benefits: {
              where: { isActive: true },
              select: {
                level: true,
                commissionRate: true,
                fixedBonus: true
              },
              orderBy: { level: "asc" }
            }
          }
        }
      }
    });

    const membership =
      user?.membership ??
      (await tx.membership.findUniqueOrThrow({
        where: { tier: "BASIC" },
        select: {
          id: true,
          tier: true,
          directBonus: true,
          activeLevels: true,
          benefits: {
            where: { isActive: true },
            select: {
              level: true,
              commissionRate: true,
              fixedBonus: true
            },
            orderBy: { level: "asc" }
          }
        }
      }));

    return membership;
  }

  getDirectSponsorCount(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.referral.count({
      where: {
        sponsorId: userId,
        status: "ACTIVE"
      }
    });
  }

  async getUserRegistrationRank(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        createdAt: true,
        role: true
      }
    });

    if (user.role !== "USER") {
      return Number.POSITIVE_INFINITY;
    }

    return tx.user.count({
      where: {
        role: "USER",
        createdAt: { lte: user.createdAt }
      }
    });
  }

  async hasCommission(
    input: {
      beneficiaryId: string;
      triggerType: string;
      triggerId: string;
      type: CommissionDistribution["type"];
      level: number;
    },
    tx: Prisma.TransactionClient = this.prisma
  ) {
    const commission = await tx.commission.findUnique({
      where: {
        beneficiaryId_triggerType_triggerId_type_level: input
      },
      select: { id: true }
    });

    return Boolean(commission);
  }

  createReferral(input: { sponsorId: string; userId: string }, tx: Prisma.TransactionClient) {
    return tx.referral.create({
      data: input,
      select: { id: true }
    });
  }

  async createReferralLevels(
    rows: Array<{ ancestorId: string; descendantId: string; level: number }>,
    tx: Prisma.TransactionClient
  ) {
    if (rows.length === 0) {
      return;
    }

    await tx.referralLevel.createMany({
      data: rows,
      skipDuplicates: true
    });
  }

  async creditCommission(
    input: CommissionDistribution,
    tx: Prisma.TransactionClient
  ) {
    const wallet = await tx.wallet.upsert({
      where: { userId: input.beneficiaryId },
      update: {},
      create: {
        userId: input.beneficiaryId,
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
        type: this.toWalletTransactionType(input.type),
        amount: input.amount,
        referenceType: input.triggerType === "REWARD_MILESTONE" ? "REWARD_MILESTONE" : input.type,
        referenceId: input.triggerId,
        metadata: {
          level: input.level,
          triggerType: input.triggerType,
          sourceUserId: input.sourceUserId
        }
      },
      select: { id: true }
    });

    await tx.commission.create({
      data: {
        beneficiaryId: input.beneficiaryId,
        sourceUserId: input.sourceUserId,
        referralId: input.referralId,
        walletTransactionId: walletTransaction.id,
        type: input.type,
        status: "POSTED",
        level: input.level,
        amount: input.amount,
        ...(input.rate !== undefined ? { rate: input.rate } : {}),
        triggerType: input.triggerType,
        triggerId: input.triggerId,
        metadata: input.metadata ?? Prisma.JsonNull,
        postedAt: new Date()
      }
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        cashBalance: {
          increment: input.amount
        },
        balance: {
          increment: input.amount
        }
      }
    });
  }

  async logCommissionDistribution(
    input: {
      actorId: string;
      referralId: string;
      triggerType: string;
      triggerId: string;
      totalAmount: Prisma.Decimal;
      distributions: CommissionDistribution[];
    },
    tx: Prisma.TransactionClient
  ) {
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "REFERRAL_COMMISSION_DISTRIBUTED",
        entityType: "referral",
        entityId: input.referralId,
        metadata: {
          triggerType: input.triggerType,
          triggerId: input.triggerId,
          totalAmount: input.totalAmount.toString(),
          distributions: input.distributions.map((distribution) => ({
            beneficiaryId: distribution.beneficiaryId,
            type: distribution.type,
            level: distribution.level,
            amount: distribution.amount.toString(),
            rate: distribution.rate?.toString()
          }))
        }
      }
    });
  }

  async getSummary(userId: string): Promise<ReferralSummary> {
    const [user, directDownlines, totalDownlines, totalCommission] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          referralCode: true,
          membership: { select: { tier: true } }
        }
      }),
      this.prisma.referral.count({ where: { sponsorId: userId, status: "ACTIVE" } }),
      this.prisma.referralLevel.count({ where: { ancestorId: userId } }),
      this.prisma.commission.aggregate({
        where: { beneficiaryId: userId, status: "POSTED" },
        _sum: { amount: true }
      })
    ]);

    return {
      referralCode: user.referralCode,
      referralLink: `https://tapgo.app/r/${user.referralCode}`,
      membershipTier: user.membership?.tier ?? "BASIC",
      directDownlines,
      totalDownlines,
      totalCommission: totalCommission._sum.amount ?? new Prisma.Decimal(0)
    };
  }

  async getTree(userId: string, maxLevel: number): Promise<ReferralTreeNode[]> {
    const levels = await this.prisma.referralLevel.findMany({
      where: {
        ancestorId: userId,
        level: { lte: maxLevel }
      },
      include: {
        descendant: {
          select: {
            id: true,
            fullName: true,
            referralCode: true,
            createdAt: true,
            membership: { select: { tier: true } }
          }
        }
      },
      orderBy: [{ level: "asc" }, { createdAt: "asc" }]
    });

    return levels.map((item) => ({
      userId: item.descendant.id,
      fullName: item.descendant.fullName,
      referralCode: item.descendant.referralCode,
      level: item.level,
      membershipTier: item.descendant.membership?.tier ?? "BASIC",
      joinedAt: item.createdAt
    }));
  }

  async getUplinkChain(userId: string, maxLevel: number): Promise<ReferralUplinkNode[]> {
    const rows = await this.prisma.$queryRaw<RawUplinkRow[]>`
      WITH RECURSIVE uplink AS (
        SELECT
          r.user_id AS descendant_id,
          r.sponsor_id AS ancestor_id,
          1 AS level_from_user,
          r.joined_at
        FROM referrals r
        WHERE r.user_id = ${userId}::uuid
          AND r.status = 'ACTIVE'

        UNION ALL

        SELECT
          uplink.descendant_id,
          r.sponsor_id AS ancestor_id,
          uplink.level_from_user + 1 AS level_from_user,
          r.joined_at
        FROM referrals r
        INNER JOIN uplink ON r.user_id = uplink.ancestor_id
        WHERE r.status = 'ACTIVE'
          AND uplink.level_from_user < ${maxLevel}
      )
      SELECT
        u.id::text AS user_id,
        u."fullName" AS full_name,
        u.referral_code,
        uplink.level_from_user::int,
        COALESCE(m.tier::text, 'BASIC') AS membership_tier,
        uplink.joined_at
      FROM uplink
      INNER JOIN users u ON u.id = uplink.ancestor_id
      LEFT JOIN memberships m ON m.id = u.membership_id
      ORDER BY uplink.level_from_user ASC;
    `;

    return rows.map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      referralCode: row.referral_code,
      levelFromUser: row.level_from_user,
      membershipTier: row.membership_tier,
      joinedAt: row.joined_at
    }));
  }

  async getDownlinesRecursive(
    userId: string,
    maxLevel: number,
    page: number,
    pageSize: number
  ): Promise<ReferralDownlineNode[]> {
    const offset = (page - 1) * pageSize;
    const rows = await this.prisma.$queryRaw<RawDownlineRow[]>`
      WITH RECURSIVE downline AS (
        SELECT
          r.sponsor_id AS sponsor_id,
          r.user_id AS descendant_id,
          1 AS depth,
          r.joined_at
        FROM referrals r
        WHERE r.sponsor_id = ${userId}::uuid
          AND r.status = 'ACTIVE'

        UNION ALL

        SELECT
          r.sponsor_id,
          r.user_id AS descendant_id,
          downline.depth + 1 AS depth,
          r.joined_at
        FROM referrals r
        INNER JOIN downline ON r.sponsor_id = downline.descendant_id
        WHERE r.status = 'ACTIVE'
          AND downline.depth < ${maxLevel}
      )
      SELECT
        u.id::text AS user_id,
        downline.sponsor_id::text AS sponsor_id,
        u."fullName" AS full_name,
        u.referral_code,
        downline.depth::int,
        COALESCE(m.tier::text, 'BASIC') AS membership_tier,
        downline.joined_at
      FROM downline
      INNER JOIN users u ON u.id = downline.descendant_id
      LEFT JOIN memberships m ON m.id = u.membership_id
      ORDER BY downline.depth ASC, downline.joined_at ASC, u.id ASC
      OFFSET ${offset}
      LIMIT ${pageSize};
    `;

    return rows.map((row) => ({
      userId: row.user_id,
      sponsorId: row.sponsor_id,
      fullName: row.full_name,
      referralCode: row.referral_code,
      depth: row.depth,
      membershipTier: row.membership_tier,
      joinedAt: row.joined_at
    }));
  }

  async getDepthStats(userId: string, maxLevel: number): Promise<ReferralDepthStats> {
    const rows = await this.prisma.$queryRaw<RawDepthRow[]>`
      WITH RECURSIVE downline AS (
        SELECT
          r.user_id AS descendant_id,
          1 AS depth
        FROM referrals r
        WHERE r.sponsor_id = ${userId}::uuid
          AND r.status = 'ACTIVE'

        UNION ALL

        SELECT
          r.user_id AS descendant_id,
          downline.depth + 1 AS depth
        FROM referrals r
        INNER JOIN downline ON r.sponsor_id = downline.descendant_id
        WHERE r.status = 'ACTIVE'
          AND downline.depth < ${maxLevel}
      )
      SELECT
        depth::int AS level,
        COUNT(*)::int AS total
      FROM downline
      GROUP BY depth
      ORDER BY depth ASC;
    `;

    const totalDownlines = rows.reduce((total, row) => total + row.total, 0);
    const directDownlines = rows.find((row) => row.level === 1)?.total ?? 0;
    const maxDepth = rows.at(-1)?.level ?? 0;

    return {
      maxDepth,
      directDownlines,
      totalDownlines,
      byLevel: rows
    };
  }

  async getCommissions(userId: string, page: number, pageSize: number): Promise<CommissionLedgerItem[]> {
    return this.prisma.commission.findMany({
      where: { beneficiaryId: userId },
      select: {
        id: true,
        type: true,
        status: true,
        level: true,
        amount: true,
        triggerType: true,
        triggerId: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    });
  }

  private toWalletTransactionType(type: CommissionDistribution["type"]) {
    if (type === "BASIC_SPONSOR_BONUS") {
      return "BASIC_SPONSOR_BONUS";
    }
    if (type === "SPONSOR_BONUS") {
      return "SPONSOR_BONUS";
    }
    if (type === "LEVEL_COMMISSION") {
      return "LEVEL_BONUS";
    }
    if (type === "REWARD_BONUS") {
      return "REWARD_BONUS";
    }
    return "PROFIT_SHARING_BONUS";
  }
}
