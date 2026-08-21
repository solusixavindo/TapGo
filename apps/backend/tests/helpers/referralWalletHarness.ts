import { MembershipTier, Prisma, PrismaClient, User } from "@prisma/client";
import { beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaReferralRepository } from "../../src/modules/referrals/infrastructure/PrismaReferralRepository.js";
import { ReferralService } from "../../src/modules/referrals/application/ReferralService.js";
import { PrismaWalletRepository } from "../../src/modules/wallets/infrastructure/PrismaWalletRepository.js";
import { WalletService } from "../../src/modules/wallets/application/WalletService.js";
import { PrismaAuthRepository } from "../../src/modules/auth/infrastructure/PrismaAuthRepository.js";

export const testDatabaseUrl = process.env.TAPGO_TEST_DATABASE_URL;
export const runIntegration = Boolean(testDatabaseUrl);

// Perbesar connection pool khusus test agar concurrency test (P1-4) deterministik
// lintas lingkungan: saat banyak registrasi berlomba pada satu row lock kuota,
// koneksi tertahan selama transaksi menunggu lock, sehingga pool default bisa
// habis dan transaksi berikutnya gagal maxWait. Ini konfigurasi test-infra saja.
function withTestConnectionPool(url: string): string {
  if (url.includes("connection_limit=")) {
    return url;
  }
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=30`;
}

export const prisma = new PrismaClient({
  ...(testDatabaseUrl ? { datasources: { db: { url: withTestConnectionPool(testDatabaseUrl) } } } : {})
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
    await resetRegistrationQuota();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
}

export async function cleanDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.supportTicketMessage.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.memberIdentity.deleteMany();
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
  // RideDriverApplication memakai ON DELETE RESTRICT, bukan CASCADE: histori
  // pengajuan driver sengaja bertahan melewati penghapusan User. Karena itu
  // baris ini harus dibersihkan lebih dulu, kalau tidak deleteMany() di bawah
  // akan ditolak database. Relasi Ride lain (quote, order) tetap cascade dan
  // tidak perlu disebut di sini.
  await prisma.rideDriverApplication.deleteMany();
  // AdminScopeGrant memakai FK RESTRICT ke users pada kolom user_id,
  // granted_by_id, dan revoked_by_id. Tanpa baris ini, deleteMany() di bawah
  // ditolak database.
  await prisma.adminScopeGrant.deleteMany();
  await prisma.user.deleteMany();
  // User dihapus dulu; PpobTransaction cascade-delete mengikuti user. Produk
  // dibersihkan setelah transaksinya hilang (relation RESTRICT pada produk).
  await prisma.ppobTransaction.deleteMany();
  await prisma.ppobProduct.deleteMany();
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

// Release 2.8 — katalog PPOB minimal untuk test: produk aktif/nonaktif memakai
// enum kategori + field brand (skema PpobTransaction), selaras kontraknya
// dengan seed produksi (migration 20260821013849_ppob_foundation).
export async function seedPpobCatalog(): Promise<void> {
  await prisma.ppobProduct.upsert({
    where: { sku: "PULSA_10K" },
    update: {},
    create: {
      sku: "PULSA_10K",
      category: "PULSA",
      brand: "Telkomsel",
      name: "Pulsa Rp10.000",
      price: new Prisma.Decimal(11500),
      adminFee: new Prisma.Decimal(0),
      sortOrder: 1
    }
  });
  await prisma.ppobProduct.upsert({
    where: { sku: "PULSA_100K_INACTIVE" },
    update: {},
    create: {
      sku: "PULSA_100K_INACTIVE",
      category: "PULSA",
      brand: "Telkomsel",
      name: "Pulsa Rp100.000 (Nonaktif)",
      price: new Prisma.Decimal(101000),
      adminFee: new Prisma.Decimal(0),
      sortOrder: 2,
      isActive: false
    }
  });
}

// P1-4: pastikan baris kuota registrasi selalu ada dan granted=0 di awal tiap
// test (semua user dihapus oleh cleanDatabase, jadi granted harus ikut reset).
export async function resetRegistrationQuota(limit = 1000): Promise<void> {
  await prisma.registrationQuota.upsert({
    where: { key: "BASIC_PPOB_FIRST_1000" },
    update: { granted: 0, limit },
    create: { key: "BASIC_PPOB_FIRST_1000", limit, granted: 0 }
  });
}

// P1-4: helper untuk mensimulasikan kuota yang sudah terpakai sebagian/penuh.
export async function setRegistrationQuotaGranted(granted: number): Promise<void> {
  await prisma.registrationQuota.update({
    where: { key: "BASIC_PPOB_FIRST_1000" },
    data: { granted }
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
