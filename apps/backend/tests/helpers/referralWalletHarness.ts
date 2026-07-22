import { MembershipTier, Prisma, PrismaClient, User } from "@prisma/client";
import { beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaReferralRepository } from "../../src/modules/referrals/infrastructure/PrismaReferralRepository.js";
import { ReferralService } from "../../src/modules/referrals/application/ReferralService.js";
import { PrismaWalletRepository } from "../../src/modules/wallets/infrastructure/PrismaWalletRepository.js";
import { WalletService } from "../../src/modules/wallets/application/WalletService.js";
import { PrismaAuthRepository } from "../../src/modules/auth/infrastructure/PrismaAuthRepository.js";

export const testDatabaseUrl = process.env.TAPGO_TEST_DATABASE_URL;
export const runIntegration = Boolean(testDatabaseUrl);

export const prisma = new PrismaClient({
  ...(testDatabaseUrl ? { datasources: { db: { url: testDatabaseUrl } } } : {})
});

export const referralRepository = new PrismaReferralRepository(prisma);
export const referralService = new ReferralService(referralRepository);
export const walletRepository = new PrismaWalletRepository(prisma);
export const walletService = new WalletService(walletRepository);
export const authRepository = new PrismaAuthRepository(prisma);

export function setupReferralWalletIntegration() {
  beforeAll(async () => {
    if (!runIntegration) {
      return;
    }

    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    await prisma.$connect();
  });

  beforeEach(async () => {
    if (!runIntegration) {
      return;
    }

    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
}

export async function cleanDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.ppobProviderEvent.deleteMany();
  await prisma.ppobTransaction.deleteMany();
  await prisma.ppobProduct.deleteMany();
  await prisma.founderProgramGrant.deleteMany();
  await prisma.membershipDocument.deleteMany();
  await prisma.membershipPayment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.userMembership.deleteMany();
  await prisma.membershipOrder.deleteMany();
  await prisma.profitSharingDistribution.deleteMany();
  await prisma.profitSharingPeriod.deleteMany();
  await prisma.withdrawal.deleteMany();
  await prisma.commission.deleteMany();
  await prisma.rewardTransaction.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.referralLevel.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
  await prisma.membershipBenefit.deleteMany();
  await prisma.membership.deleteMany();
}

export async function seedMemberships() {
  const tiers: Array<{
    tier: MembershipTier;
    price: string;
    directBonus: string;
    activeLevels: number;
    ppobBalance: string;
    benefits: Array<{ level: number; commissionRate: string; fixedBonus: string }>;
  }> = [
    {
      tier: "BASIC",
      price: "0.00",
      directBonus: "2000.00",
      activeLevels: 0,
      ppobBalance: "0.00",
      benefits: []
    },
    {
      tier: "SILVER",
      price: "500000.00",
      directBonus: "0.00",
      activeLevels: 10,
      ppobBalance: "100000.00",
      benefits: [
        { level: 1, commissionRate: "8.00", fixedBonus: "0.00" },
        { level: 2, commissionRate: "4.00", fixedBonus: "0.00" },
        { level: 3, commissionRate: "2.00", fixedBonus: "0.00" },
        { level: 4, commissionRate: "2.00", fixedBonus: "0.00" },
        { level: 5, commissionRate: "2.00", fixedBonus: "0.00" },
        { level: 6, commissionRate: "1.00", fixedBonus: "0.00" },
        { level: 7, commissionRate: "1.00", fixedBonus: "0.00" },
        { level: 8, commissionRate: "1.00", fixedBonus: "0.00" },
        { level: 9, commissionRate: "1.00", fixedBonus: "0.00" },
        { level: 10, commissionRate: "1.00", fixedBonus: "0.00" }
      ]
    },
    {
      tier: "GOLD",
      price: "3000000.00",
      directBonus: "0.00",
      activeLevels: 10,
      ppobBalance: "600000.00",
      benefits: []
    },
    {
      tier: "PLATINUM",
      price: "5500000.00",
      directBonus: "0.00",
      activeLevels: 10,
      ppobBalance: "1000000.00",
      benefits: []
    }
  ];

  tiers[2]!.benefits = tiers[1]!.benefits;
  tiers[3]!.benefits = tiers[1]!.benefits;

  for (const tier of tiers) {
    await prisma.membership.create({
      data: {
        tier: tier.tier,
        name: tier.tier[0] + tier.tier.slice(1).toLowerCase(),
        price: new Prisma.Decimal(tier.price),
        directBonus: new Prisma.Decimal(tier.directBonus),
        activeLevels: tier.activeLevels,
        ppobBalance: new Prisma.Decimal(tier.ppobBalance),
        benefits: {
          create: tier.benefits.map((benefit) => ({
            level: benefit.level,
            commissionRate: new Prisma.Decimal(benefit.commissionRate),
            fixedBonus: new Prisma.Decimal(benefit.fixedBonus)
          }))
        }
      }
    });
  }
}

export async function createUser(referralCode: string, tier: MembershipTier = "BASIC"): Promise<User> {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });

  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.padStart(9, "0")}`,
      referralCode,
      membershipId: membership.id
    }
  });
}

export async function registerBasicUser(referralCode: string, sponsorReferralCode?: string): Promise<User> {
  return authRepository.createUser({
    fullName: `User ${referralCode}`,
    phone: `+628${referralCode.padStart(9, "0")}`,
    passwordHash: "hashed-password",
    role: "USER",
    referralCode,
    ...(sponsorReferralCode !== undefined ? { sponsorReferralCode } : {})
  });
}

export async function claim(userId: string, sponsorCode: string, triggerId = `claim:${userId}`, baseAmount = "100.00") {
  return referralService.claimReferral({
    userId,
    sponsorCode,
    triggerType: "REFERRAL_JOIN",
    triggerId,
    baseAmount: new Prisma.Decimal(baseAmount)
  });
}

export function decimalString(value: Prisma.Decimal.Value) {
  return new Prisma.Decimal(value).toFixed(2);
}
