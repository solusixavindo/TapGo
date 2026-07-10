import { MembershipTier, Prisma, User } from "@prisma/client";

export type ReferralSummary = {
  referralCode: string;
  referralLink: string;
  membershipTier: MembershipTier;
  directDownlines: number;
  totalDownlines: number;
  totalCommission: Prisma.Decimal;
};

export type ReferralTreeNode = {
  userId: string;
  fullName: string;
  referralCode: string;
  level: number;
  membershipTier: MembershipTier;
  joinedAt: Date;
};

export type ReferralUplinkNode = {
  userId: string;
  fullName: string;
  referralCode: string;
  levelFromUser: number;
  membershipTier: MembershipTier;
  joinedAt: Date;
};

export type ReferralDownlineNode = {
  userId: string;
  sponsorId: string;
  fullName: string;
  referralCode: string;
  depth: number;
  membershipTier: MembershipTier;
  joinedAt: Date;
};

export type ReferralDepthStats = {
  maxDepth: number;
  directDownlines: number;
  totalDownlines: number;
  byLevel: Array<{ level: number; total: number }>;
};

export type CommissionLedgerItem = {
  id: string;
  type: string;
  status: string;
  level: number | null;
  amount: Prisma.Decimal;
  triggerType: string;
  triggerId: string;
  createdAt: Date;
};

export type MembershipCommissionProfile = {
  id: string;
  tier: MembershipTier;
  directBonus: Prisma.Decimal;
  activeLevels: number;
  benefits: Array<{ level: number; commissionRate: Prisma.Decimal; fixedBonus: Prisma.Decimal }>;
};

export type CommissionDistribution = {
  beneficiaryId: string;
  sourceUserId: string;
  referralId: string;
  type: "BASIC_SPONSOR_BONUS" | "SPONSOR_BONUS" | "LEVEL_COMMISSION" | "REWARD_BONUS" | "PROFIT_SHARING_BONUS";
  level: number;
  amount: Prisma.Decimal;
  rate?: Prisma.Decimal;
  triggerType: string;
  triggerId: string;
  metadata: Prisma.InputJsonValue;
};

export type CreateReferralInput = {
  userId: string;
  sponsorCode: string;
  triggerType: string;
  triggerId: string;
  baseAmount: Prisma.Decimal;
};

export interface ReferralRepository {
  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  findUserById(userId: string, tx?: Prisma.TransactionClient): Promise<User | null>;
  findUserByReferralCode(referralCode: string, tx?: Prisma.TransactionClient): Promise<User | null>;
  findExistingReferral(userId: string, tx?: Prisma.TransactionClient): Promise<{ id: string } | null>;
  hasReferralPath(ancestorId: string, descendantId: string, tx?: Prisma.TransactionClient): Promise<boolean>;
  getSponsorAncestors(sponsorId: string, tx?: Prisma.TransactionClient): Promise<Array<{ ancestorId: string; level: number }>>;
  getUserMembership(userId: string, tx?: Prisma.TransactionClient): Promise<MembershipCommissionProfile>;
  getDirectSponsorCount(userId: string, tx?: Prisma.TransactionClient): Promise<number>;
  getUserRegistrationRank(userId: string, tx?: Prisma.TransactionClient): Promise<number>;
  hasCommission(input: {
    beneficiaryId: string;
    triggerType: string;
    triggerId: string;
    type: CommissionDistribution["type"];
    level: number;
  }, tx?: Prisma.TransactionClient): Promise<boolean>;
  createReferral(input: { sponsorId: string; userId: string }, tx: Prisma.TransactionClient): Promise<{ id: string }>;
  createReferralLevels(
    rows: Array<{ ancestorId: string; descendantId: string; level: number }>,
    tx: Prisma.TransactionClient
  ): Promise<void>;
  creditCommission(
    input: CommissionDistribution,
    tx: Prisma.TransactionClient
  ): Promise<void>;
  logCommissionDistribution(input: {
    actorId: string;
    referralId: string;
    triggerType: string;
    triggerId: string;
    totalAmount: Prisma.Decimal;
    distributions: CommissionDistribution[];
  }, tx: Prisma.TransactionClient): Promise<void>;
  getSummary(userId: string): Promise<ReferralSummary>;
  getTree(userId: string, maxLevel: number): Promise<ReferralTreeNode[]>;
  getUplinkChain(userId: string, maxLevel: number): Promise<ReferralUplinkNode[]>;
  getDownlinesRecursive(userId: string, maxLevel: number, page: number, pageSize: number): Promise<ReferralDownlineNode[]>;
  getDepthStats(userId: string, maxLevel: number): Promise<ReferralDepthStats>;
  getCommissions(userId: string, page: number, pageSize: number): Promise<CommissionLedgerItem[]>;
}
