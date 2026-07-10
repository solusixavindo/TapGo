import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "../src/core/security/passwordHasher.js";

const prisma = new PrismaClient();

async function main() {
  const adminPasswordHash = await hashPassword("Admin@TapGo2026!");
  const driverPasswordHash = await hashPassword("Driver@TapGo2026!");
  const userPasswordHash = await hashPassword("User@TapGo2026!");
  const benefitRates = [
    { level: 1, commissionRate: 8 },
    { level: 2, commissionRate: 4 },
    { level: 3, commissionRate: 2 },
    { level: 4, commissionRate: 2 },
    { level: 5, commissionRate: 2 },
    { level: 6, commissionRate: 1 },
    { level: 7, commissionRate: 1 },
    { level: 8, commissionRate: 1 },
    { level: 9, commissionRate: 1 },
    { level: 10, commissionRate: 1 }
  ];

  const basic = await prisma.membership.upsert({
    where: { tier: "BASIC" },
    update: {
      name: "Basic",
      price: 0,
      directBonus: 2000,
      activeLevels: 0,
      ppobBalance: 0,
      bpjsBenefit: "Tidak termasuk",
      merchandise: [],
      businessRight: "Akses pengguna"
    },
    create: {
      tier: "BASIC",
      name: "Basic",
      price: 0,
      directBonus: 2000,
      activeLevels: 0,
      ppobBalance: 0,
      bpjsBenefit: "Tidak termasuk",
      merchandise: [],
      businessRight: "Akses pengguna"
    }
  });

  for (const packagePlan of [
    {
      tier: "SILVER" as const,
      name: "Silver",
      price: 500000,
      ppobBalance: 100000,
      bpjsBenefit: "BPJS TK, JKK, JKM",
      merchandise: ["Kaos TAPGO"],
      businessRight: "Hak Usaha"
    },
    {
      tier: "GOLD" as const,
      name: "Gold",
      price: 3000000,
      ppobBalance: 600000,
      bpjsBenefit: "BPJS TK, JKK, JKM",
      merchandise: ["Kaos TAPGO", "Topi TAPGO"],
      businessRight: "Hak Usaha"
    },
    {
      tier: "PLATINUM" as const,
      name: "Platinum",
      price: 5500000,
      ppobBalance: 1000000,
      bpjsBenefit: "BPJS TK, JKK, JKM, JHT",
      merchandise: ["Kaos TAPGO", "Jaket TAPGO", "Rompi TAPGO"],
      businessRight: "Hak Usaha Mitra"
    }
  ]) {
    const membership = await prisma.membership.upsert({
      where: { tier: packagePlan.tier },
      update: {
        name: packagePlan.name,
        price: packagePlan.price,
        directBonus: 0,
        activeLevels: 10,
        ppobBalance: packagePlan.ppobBalance,
        bpjsBenefit: packagePlan.bpjsBenefit,
        merchandise: packagePlan.merchandise,
        businessRight: packagePlan.businessRight
      },
      create: {
        tier: packagePlan.tier,
        name: packagePlan.name,
        price: packagePlan.price,
        directBonus: 0,
        activeLevels: 10,
        ppobBalance: packagePlan.ppobBalance,
        bpjsBenefit: packagePlan.bpjsBenefit,
        merchandise: packagePlan.merchandise,
        businessRight: packagePlan.businessRight
      }
    });

    for (const benefit of benefitRates) {
      await prisma.membershipBenefit.upsert({
        where: {
          membershipId_level: {
            membershipId: membership.id,
            level: benefit.level
          }
        },
        update: {
          commissionRate: benefit.commissionRate,
          fixedBonus: 0,
          isActive: true
        },
        create: {
          membershipId: membership.id,
          level: benefit.level,
          commissionRate: benefit.commissionRate,
          fixedBonus: 0
        }
      });
    }
  }

  await prisma.user.upsert({
    where: { phone: "+628111000001" },
    update: {},
    create: {
      role: UserRole.SUPER_ADMIN,
      fullName: "TapGo Super Admin",
      email: "admin@tapgo.local",
      phone: "+628111000001",
      passwordHash: adminPasswordHash,
      referralCode: "ADMIN001",
      membershipId: basic.id,
      wallet: { create: { balance: 0 } }
    }
  });

  const driverUser = await prisma.user.upsert({
    where: { phone: "+628122000001" },
    update: {},
    create: {
      role: UserRole.DRIVER,
      fullName: "Bima TapGo Driver",
      email: "driver@tapgo.local",
      phone: "+628122000001",
      passwordHash: driverPasswordHash,
      referralCode: "DRV001",
      membershipId: basic.id,
      wallet: { create: { balance: 250000 } },
      driver: {
        create: {
          status: "AVAILABLE",
          kycStatus: "APPROVED",
          licenseNumber: "SIM-DRV-001",
          vehicleType: "BIKE",
          vehiclePlate: "B 1234 TGO",
          currentLat: -6.175392,
          currentLng: 106.827153
        }
      }
    }
  });

  await prisma.user.upsert({
    where: { phone: "+628133000001" },
    update: {},
    create: {
      role: UserRole.USER,
      fullName: "Ayu TapGo User",
      email: "user@tapgo.local",
      phone: "+628133000001",
      passwordHash: userPasswordHash,
      referralCode: "USR001",
      membershipId: basic.id,
      wallet: { create: { balance: 150000 } }
    }
  });

  await prisma.promoCode.upsert({
    where: { code: "TAPGOHEMAT" },
    update: {},
    create: {
      code: "TAPGOHEMAT",
      description: "Launch promo for transport bookings",
      discountType: "PERCENTAGE",
      discountValue: 20,
      maxDiscount: 15000,
      minSpend: 25000,
      quota: 10000,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2027-01-01T00:00:00.000Z")
    }
  });

  console.log(`Seed completed. Driver user: ${driverUser.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
