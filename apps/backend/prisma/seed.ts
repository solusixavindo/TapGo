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

  // Katalog PPOB Stage R2.7 — upsert per sku supaya seed idempotent dan aman
  // dijalankan ulang pada environment yang sama.
  const ppobProducts = [
    { sku: "PULSA_TSEL_5", category: "PULSA", brand: "Telkomsel", name: "Pulsa Telkomsel 5.000", price: 6500, sortOrder: 1 },
    { sku: "PULSA_TSEL_10", category: "PULSA", brand: "Telkomsel", name: "Pulsa Telkomsel 10.000", price: 11500, sortOrder: 2 },
    { sku: "PULSA_TSEL_25", category: "PULSA", brand: "Telkomsel", name: "Pulsa Telkomsel 25.000", price: 26500, sortOrder: 3 },
    { sku: "PULSA_TSEL_50", category: "PULSA", brand: "Telkomsel", name: "Pulsa Telkomsel 50.000", price: 51500, sortOrder: 4 },
    { sku: "PULSA_TSEL_100", category: "PULSA", brand: "Telkomsel", name: "Pulsa Telkomsel 100.000", price: 101000, sortOrder: 5 },
    { sku: "PULSA_XL_10", category: "PULSA", brand: "XL", name: "Pulsa XL 10.000", price: 11400, sortOrder: 6 },
    { sku: "PULSA_XL_50", category: "PULSA", brand: "XL", name: "Pulsa XL 50.000", price: 50900, sortOrder: 7 },
    { sku: "DATA_TSEL_1GB", category: "DATA", brand: "Telkomsel", name: "Data Telkomsel 1 GB / 7 hari", price: 12000, sortOrder: 10 },
    { sku: "DATA_TSEL_5GB", category: "DATA", brand: "Telkomsel", name: "Data Telkomsel 5 GB / 30 hari", price: 48000, sortOrder: 11 },
    { sku: "PLN_TOKEN_20", category: "PLN_PREPAID", brand: "PLN", name: "Token PLN 20.000", price: 20500, sortOrder: 20 },
    { sku: "PLN_TOKEN_50", category: "PLN_PREPAID", brand: "PLN", name: "Token PLN 50.000", price: 50500, sortOrder: 21 },
    { sku: "PLN_TOKEN_100", category: "PLN_PREPAID", brand: "PLN", name: "Token PLN 100.000", price: 100500, sortOrder: 22 },
    { sku: "PLN_TAGIHAN", category: "PLN_POSTPAID", brand: "PLN", name: "Tagihan PLN Pascabayar", price: 0, adminFee: 2500, isActive: false, sortOrder: 30 },
    { sku: "BPJS_KESEHATAN", category: "BPJS", brand: "BPJS", name: "BPJS Kesehatan", price: 0, adminFee: 2500, isActive: false, sortOrder: 40 },
    { sku: "EWALLET_GOPAY_25", category: "EWALLET", brand: "GoPay", name: "Top Up GoPay 25.000", price: 26000, sortOrder: 50 },
    { sku: "EWALLET_OVO_50", category: "EWALLET", brand: "OVO", name: "Top Up OVO 50.000", price: 51500, sortOrder: 51 }
  ] as const;

  for (const product of ppobProducts) {
    await prisma.ppobProduct.upsert({
      where: { sku: product.sku },
      update: {
        brand: product.brand,
        name: product.name,
        price: product.price,
        ...("adminFee" in product ? { adminFee: product.adminFee } : {}),
        ...("isActive" in product ? { isActive: product.isActive } : {}),
        sortOrder: product.sortOrder
      },
      create: {
        sku: product.sku,
        category: product.category,
        brand: product.brand,
        name: product.name,
        price: product.price,
        ...("adminFee" in product ? { adminFee: product.adminFee } : {}),
        ...("isActive" in product ? { isActive: product.isActive } : {}),
        sortOrder: product.sortOrder
      }
    });
  }

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
