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

  // Release 2.7 — katalog PPOB (selaras dengan seed di migration
  // 20260821130000_ppob_foundation; dipertahankan di sini agar environment dev
  // yang hanya menjalankan db:seed tetap memiliki katalog).
  const ppobCategories = [
    { code: "PULSA", name: "Pulsa", description: "Isi ulang pulsa reguler semua operator.", icon: "phone_iphone", sortOrder: 1 },
    { code: "DATA", name: "Paket Data", description: "Paket internet semua operator.", icon: "wifi", sortOrder: 2 },
    { code: "PLN_TOKEN", name: "Token PLN", description: "Token listrik prabayar PLN.", icon: "bolt", sortOrder: 3 },
    { code: "BPJS", name: "BPJS", description: "Iuran BPJS Kesehatan dan Ketenagakerjaan.", icon: "health_and_safety", sortOrder: 4 },
    { code: "PDAM", name: "PDAM", description: "Tagihan air PDAM.", icon: "water_drop", sortOrder: 5 },
    { code: "EMONEY", name: "E-Money", description: "Top up dompet elektronik.", icon: "account_balance_wallet", sortOrder: 6 }
  ];
  const ppobCategoryIds = new Map<string, string>();
  for (const category of ppobCategories) {
    const saved = await prisma.ppobCategory.upsert({
      where: { code: category.code },
      update: {
        name: category.name,
        description: category.description,
        icon: category.icon,
        sortOrder: category.sortOrder
      },
      create: category
    });
    ppobCategoryIds.set(saved.code, saved.id);
  }
  const ppobProducts = [
    { cat: "PULSA", sku: "PULSA_5K", name: "Pulsa Rp5.000", description: "Pulsa reguler Rp5.000 semua operator.", price: 6500, adminFee: 0, targetLabel: "Nomor HP", targetPattern: "^[0-9]{10,15}$", sortOrder: 1 },
    { cat: "PULSA", sku: "PULSA_10K", name: "Pulsa Rp10.000", description: "Pulsa reguler Rp10.000 semua operator.", price: 11500, adminFee: 0, targetLabel: "Nomor HP", targetPattern: "^[0-9]{10,15}$", sortOrder: 2 },
    { cat: "PULSA", sku: "PULSA_20K", name: "Pulsa Rp20.000", description: "Pulsa reguler Rp20.000 semua operator.", price: 21500, adminFee: 0, targetLabel: "Nomor HP", targetPattern: "^[0-9]{10,15}$", sortOrder: 3 },
    { cat: "PULSA", sku: "PULSA_50K", name: "Pulsa Rp50.000", description: "Pulsa reguler Rp50.000 semua operator.", price: 51000, adminFee: 0, targetLabel: "Nomor HP", targetPattern: "^[0-9]{10,15}$", sortOrder: 4 },
    { cat: "PULSA", sku: "PULSA_100K", name: "Pulsa Rp100.000", description: "Pulsa reguler Rp100.000 semua operator.", price: 101000, adminFee: 0, targetLabel: "Nomor HP", targetPattern: "^[0-9]{10,15}$", sortOrder: 5 },
    { cat: "DATA", sku: "DATA_1GB", name: "Paket Data 1 GB", description: "Paket internet 1 GB semua operator.", price: 12000, adminFee: 0, targetLabel: "Nomor HP", targetPattern: "^[0-9]{10,15}$", sortOrder: 1 },
    { cat: "DATA", sku: "DATA_5GB", name: "Paket Data 5 GB", description: "Paket internet 5 GB semua operator.", price: 43000, adminFee: 0, targetLabel: "Nomor HP", targetPattern: "^[0-9]{10,15}$", sortOrder: 2 },
    { cat: "DATA", sku: "DATA_10GB", name: "Paket Data 10 GB", description: "Paket internet 10 GB semua operator.", price: 78000, adminFee: 0, targetLabel: "Nomor HP", targetPattern: "^[0-9]{10,15}$", sortOrder: 3 },
    { cat: "PLN_TOKEN", sku: "PLN_20K", name: "Token PLN Rp20.000", description: "Token listrik prabayar Rp20.000.", price: 21500, adminFee: 0, targetLabel: "ID Pelanggan / Nomor Meter", targetPattern: "^[0-9]{11,12}$", sortOrder: 1 },
    { cat: "PLN_TOKEN", sku: "PLN_50K", name: "Token PLN Rp50.000", description: "Token listrik prabayar Rp50.000.", price: 51500, adminFee: 0, targetLabel: "ID Pelanggan / Nomor Meter", targetPattern: "^[0-9]{11,12}$", sortOrder: 2 },
    { cat: "PLN_TOKEN", sku: "PLN_100K", name: "Token PLN Rp100.000", description: "Token listrik prabayar Rp100.000.", price: 101500, adminFee: 0, targetLabel: "ID Pelanggan / Nomor Meter", targetPattern: "^[0-9]{11,12}$", sortOrder: 3 },
    { cat: "PLN_TOKEN", sku: "PLN_200K", name: "Token PLN Rp200.000", description: "Token listrik prabayar Rp200.000.", price: 201500, adminFee: 0, targetLabel: "ID Pelanggan / Nomor Meter", targetPattern: "^[0-9]{11,12}$", sortOrder: 4 },
    { cat: "BPJS", sku: "BPJS_IURAN_1BULAN", name: "Iuran BPJS Kesehatan 1 Bulan", description: "Iuran BPJS Kesehatan 1 bulan per orang.", price: 42000, adminFee: 2500, targetLabel: "Nomor VA BPJS", targetPattern: "^[0-9]{8,20}$", sortOrder: 1 },
    { cat: "PDAM", sku: "PDAM_50K", name: "Tagihan PDAM Rp50.000", description: "Pembayaran tagihan air PDAM nominal Rp50.000.", price: 50000, adminFee: 3000, targetLabel: "ID Pelanggan PDAM", targetPattern: "^[0-9]{6,20}$", sortOrder: 1 },
    { cat: "PDAM", sku: "PDAM_100K", name: "Tagihan PDAM Rp100.000", description: "Pembayaran tagihan air PDAM nominal Rp100.000.", price: 100000, adminFee: 3000, targetLabel: "ID Pelanggan PDAM", targetPattern: "^[0-9]{6,20}$", sortOrder: 2 },
    { cat: "EMONEY", sku: "EMONEY_20K", name: "E-Money Rp20.000", description: "Top up e-money Rp20.000.", price: 21500, adminFee: 0, targetLabel: "Nomor HP / ID Dompet", targetPattern: "^[0-9]{8,16}$", sortOrder: 1 },
    { cat: "EMONEY", sku: "EMONEY_50K", name: "E-Money Rp50.000", description: "Top up e-money Rp50.000.", price: 51500, adminFee: 0, targetLabel: "Nomor HP / ID Dompet", targetPattern: "^[0-9]{8,16}$", sortOrder: 2 },
    { cat: "EMONEY", sku: "EMONEY_100K", name: "E-Money Rp100.000", description: "Top up e-money Rp100.000.", price: 101500, adminFee: 0, targetLabel: "Nomor HP / ID Dompet", targetPattern: "^[0-9]{8,16}$", sortOrder: 3 }
  ];
  for (const product of ppobProducts) {
    const categoryId = ppobCategoryIds.get(product.cat);
    if (!categoryId) {
      throw new Error(`PPOB category ${product.cat} missing`);
    }
    const { cat: _cat, ...data } = product;
    await prisma.ppobProduct.upsert({
      where: { sku: product.sku },
      update: {
        categoryId,
        name: data.name,
        description: data.description,
        price: data.price,
        adminFee: data.adminFee,
        targetLabel: data.targetLabel,
        targetPattern: data.targetPattern,
        sortOrder: data.sortOrder
      },
      create: { ...data, categoryId }
    });
  }

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
