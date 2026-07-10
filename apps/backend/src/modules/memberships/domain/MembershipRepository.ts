import { MembershipTier, Prisma } from "@prisma/client";

export type MembershipBenefitRule = {
  id: string;
  level: number;
  commissionRate: Prisma.Decimal;
  fixedBonus: Prisma.Decimal;
  isActive: boolean;
};

export type MembershipPlan = {
  id: string;
  tier: MembershipTier;
  name: string;
  price: Prisma.Decimal;
  directBonus: Prisma.Decimal;
  activeLevels: number;
  isActive: boolean;
  benefits: MembershipBenefitRule[];
};

export type UserMembershipStatus = {
  userId: string;
  membership: MembershipPlan;
};

export interface MembershipRepository {
  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  listPlans(): Promise<MembershipPlan[]>;
  getPlanByTier(tier: MembershipTier, tx?: Prisma.TransactionClient): Promise<MembershipPlan | null>;
  getUserMembership(userId: string, tx?: Prisma.TransactionClient): Promise<UserMembershipStatus>;
  upgradeUserMembership(input: {
    userId: string;
    targetMembershipId: string;
    actorId: string;
    paymentReference: string;
  }, tx: Prisma.TransactionClient): Promise<UserMembershipStatus>;
  updatePlan(input: {
    tier: MembershipTier;
    name?: string;
    price?: Prisma.Decimal;
    directBonus?: Prisma.Decimal;
    activeLevels?: number;
    isActive?: boolean;
    benefits?: Array<{
      level: number;
      commissionRate: Prisma.Decimal;
      fixedBonus: Prisma.Decimal;
      isActive?: boolean;
    }>;
    adminId: string;
  }, tx: Prisma.TransactionClient): Promise<MembershipPlan>;
}
