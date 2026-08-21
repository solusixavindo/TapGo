import { PrismaClient, UserRole, PpobCategory } from "@prisma/client";
import { hashPassword } from "../src/core/security/passwordHasher.js";

const prisma = new PrismaClient();

/**
 * Password akun demo diambil dari environment, dan seed GAGAL bila tidak ada.
 *
 * Sebelumnya ketiga password ditulis harfiah di berkas ini — dan berkas ini
 * ter-track di Git, berbeda dari seed-admin.ts/seed-demo.ts/seed-uat-credentials.ts
 * yang sudah dikecualikan .gitignore. Akibatnya `npm run db:seed`, langkah setup
 * yang didokumentasikan di README, membuat akun SUPER_ADMIN dengan password yang
 * dapat dibaca siapa pun yang memegang salinan repositori.
 *
 * Tidak ada nilai bawaan di sini, dan itu disengaja: seed yang gagal terang-terangan
 * jauh lebih baik daripada seed yang berhasil membuat akun istimewa dengan
 * password yang sudah bocor. Pola ini sama dengan scripts/seed-founder-chairman.ts.
 */
const MIN_SEED_PASSWORD_LENGTH = 12;

function requireSeedPassword(variable: string): string {
  const value = process.env[variable];
  if (!value || value.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(
      `${variable} wajib disetel dengan minimal ${MIN_SEED_PASSWORD_LENGTH} karakter sebelum menjalankan seed. ` +
        "Password akun seed TIDAK boleh ditanam di dalam kode."
    );
  }
  return value;
}

async function main() {
  // Dibaca SEBELUM pekerjaan apa pun menyentuh database, supaya konfigurasi yang
  // kurang tidak meninggalkan seed setengah jalan.
  const adminPassword = requireSeedPassword("SEED_ADMIN_PASSWORD");
  const driverPassword = requireSeedPassword("SEED_DRIVER_PASSWORD");
  const userPassword = requireSeedPassword("SEED_USER_PASSWORD");

  const adminPasswordHash = await hashPassword(adminPassword);
  const driverPasswordHash = await hashPassword(driverPassword);
  const userPasswordHash = await hashPassword(userPassword);
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

  // Release 2.8 — katalog PPOB (enum kategori + brand; selaras migration
  // 20260821013849_ppob_foundation; dipertahankan di sini agar environment dev
  // yang hanya menjalankan db:seed tetap memiliki katalog).
  const ppobProducts: Array<{
    category: PpobCategory;
    brand: string;
    sku: string;
    name: string;
    description: string;
    price: number;
    adminFee: number;
    sortOrder: number;
  }> = [
    { category: "PULSA", brand: "Telkomsel", sku: "PULSA_5K", name: "Pulsa Rp5.000", description: "Pulsa reguler Rp5.000 semua operator.", price: 6500, adminFee: 0, sortOrder: 1 },
    { category: "PULSA", brand: "Telkomsel", sku: "PULSA_10K", name: "Pulsa Rp10.000", description: "Pulsa reguler Rp10.000 semua operator.", price: 11500, adminFee: 0, sortOrder: 2 },
    { category: "PULSA", brand: "Telkomsel", sku: "PULSA_20K", name: "Pulsa Rp20.000", description: "Pulsa reguler Rp20.000 semua operator.", price: 21500, adminFee: 0, sortOrder: 3 },
    { category: "PULSA", brand: "Telkomsel", sku: "PULSA_50K", name: "Pulsa Rp50.000", description: "Pulsa reguler Rp50.000 semua operator.", price: 51000, adminFee: 0, sortOrder: 4 },
    { category: "PULSA", brand: "Telkomsel", sku: "PULSA_100K", name: "Pulsa Rp100.000", description: "Pulsa reguler Rp100.000 semua operator.", price: 101000, adminFee: 0, sortOrder: 5 },
    { category: "DATA", brand: "Telkomsel", sku: "DATA_1GB", name: "Paket Data 1 GB", description: "Paket internet 1 GB semua operator.", price: 12000, adminFee: 0, sortOrder: 1 },
    { category: "DATA", brand: "Telkomsel", sku: "DATA_5GB", name: "Paket Data 5 GB", description: "Paket internet 5 GB semua operator.", price: 43000, adminFee: 0, sortOrder: 2 },
    { category: "DATA", brand: "Telkomsel", sku: "DATA_10GB", name: "Paket Data 10 GB", description: "Paket internet 10 GB semua operator.", price: 78000, adminFee: 0, sortOrder: 3 },
    { category: "PLN_PREPAID", brand: "PLN", sku: "PLN_20K", name: "Token PLN Rp20.000", description: "Token listrik prabayar Rp20.000.", price: 21500, adminFee: 0, sortOrder: 1 },
    { category: "PLN_PREPAID", brand: "PLN", sku: "PLN_50K", name: "Token PLN Rp50.000", description: "Token listrik prabayar Rp50.000.", price: 51500, adminFee: 0, sortOrder: 2 },
    { category: "PLN_PREPAID", brand: "PLN", sku: "PLN_100K", name: "Token PLN Rp100.000", description: "Token listrik prabayar Rp100.000.", price: 101500, adminFee: 0, sortOrder: 3 },
    { category: "PLN_PREPAID", brand: "PLN", sku: "PLN_200K", name: "Token PLN Rp200.000", description: "Token listrik prabayar Rp200.000.", price: 201500, adminFee: 0, sortOrder: 4 },
    { category: "BPJS", brand: "BPJS Kesehatan", sku: "BPJS_IURAN_1BULAN", name: "Iuran BPJS Kesehatan 1 Bulan", description: "Iuran BPJS Kesehatan 1 bulan per orang.", price: 42000, adminFee: 2500, sortOrder: 1 },
    { category: "PDAM", brand: "PDAM", sku: "PDAM_50K", name: "Tagihan PDAM Rp50.000", description: "Pembayaran tagihan air PDAM nominal Rp50.000.", price: 50000, adminFee: 3000, sortOrder: 1 },
    { category: "PDAM", brand: "PDAM", sku: "PDAM_100K", name: "Tagihan PDAM Rp100.000", description: "Pembayaran tagihan air PDAM nominal Rp100.000.", price: 100000, adminFee: 3000, sortOrder: 2 },
    { category: "EWALLET", brand: "E-Money", sku: "EMONEY_20K", name: "E-Money Rp20.000", description: "Top up e-money Rp20.000.", price: 21500, adminFee: 0, sortOrder: 1 },
    { category: "EWALLET", brand: "E-Money", sku: "EMONEY_50K", name: "E-Money Rp50.000", description: "Top up e-money Rp50.000.", price: 51500, adminFee: 0, sortOrder: 2 },
    { category: "EWALLET", brand: "E-Money", sku: "EMONEY_100K", name: "E-Money Rp100.000", description: "Top up e-money Rp100.000.", price: 101500, adminFee: 0, sortOrder: 3 }
  ];
  for (const product of ppobProducts) {
    await prisma.ppobProduct.upsert({
      where: { sku: product.sku },
      update: {
        category: product.category,
        brand: product.brand,
        name: product.name,
        description: product.description,
        price: product.price,
        adminFee: product.adminFee,
        sortOrder: product.sortOrder
      },
      create: product
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
