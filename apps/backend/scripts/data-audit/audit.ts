/**
 * Audit data READ-ONLY.
 *
 * Hanya menjalankan pembacaan. Tidak ada INSERT, UPDATE, DELETE, maupun DDL
 * di berkas ini. Output berupa agregat dan identifier tersamarkan; nomor
 * telepon, email, dan nama lengkap tidak pernah dicetak utuh.
 *
 * Jalankan:
 *   DATABASE_URL=postgresql://.../tapgo_clone_uat npx tsx scripts/data-audit/audit.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  DataClass,
  FinancialFootprint,
  assertNonProductionDatabase,
  classifyAccount,
  maskEmail,
  maskName,
  maskPhone
} from "./guard.js";

type AccountRow = {
  id: string;
  maskedPhone: string;
  maskedEmail: string | null;
  maskedName: string;
  createdAt: Date;
  phoneVerified: boolean;
  emailVerified: boolean;
  classification: DataClass;
  footprint: FinancialFootprint;
};

async function main() {
  const databaseName = assertNonProductionDatabase(process.env.DATABASE_URL);
  const prisma = new PrismaClient();

  try {
    console.log("=".repeat(72));
    console.log("TAPGO — AUDIT DATA READ-ONLY");
    console.log("=".repeat(72));
    console.log(`Database        : ${databaseName}`);
    console.log(`Waktu           : ${new Date().toISOString()}`);
    console.log("Mode            : READ-ONLY (tidak ada penulisan apa pun)");
    console.log("");

    // --- Ringkasan environment -----------------------------------------
    const [userCount, oldest, newest] = await Promise.all([
      prisma.user.count(),
      prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.user.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } })
    ]);

    console.log("--- RINGKASAN AKUN ---");
    console.log(`Total user      : ${userCount}`);
    console.log(`createdAt awal  : ${oldest?.createdAt.toISOString() ?? "-"}`);
    console.log(`createdAt akhir : ${newest?.createdAt.toISOString() ?? "-"}`);
    console.log("");

    // --- Volume per domain ----------------------------------------------
    const volumes = {
      memberships: await prisma.membership.count(),
      membershipBenefits: await prisma.membershipBenefit.count(),
      userMemberships: await prisma.userMembership.count(),
      membershipOrders: await prisma.membershipOrder.count(),
      membershipPayments: await prisma.membershipPayment.count(),
      invoices: await prisma.invoice.count(),
      wallets: await prisma.wallet.count(),
      walletTransactions: await prisma.walletTransaction.count(),
      commissions: await prisma.commission.count(),
      rewardTransactions: await prisma.rewardTransaction.count(),
      withdrawals: await prisma.withdrawal.count(),
      profitSharingPeriods: await prisma.profitSharingPeriod.count(),
      profitSharingDistributions: await prisma.profitSharingDistribution.count(),
      referrals: await prisma.referral.count(),
      referralLevels: await prisma.referralLevel.count(),
      supportTickets: await prisma.supportTicket.count(),
      sessions: await prisma.session.count(),
      authChallenges: await prisma.authChallenge.count(),
      memberIdentities: await prisma.memberIdentity.count(),
      membershipDocuments: await prisma.membershipDocument.count()
    };

    console.log("--- VOLUME PER DOMAIN ---");
    for (const [name, count] of Object.entries(volumes)) {
      console.log(`${name.padEnd(28)}: ${count}`);
    }
    console.log("");

    // --- Status verifikasi ----------------------------------------------
    const [phoneVerified, emailPresent, emailVerified] = await Promise.all([
      prisma.user.count({ where: { phoneVerifiedAt: { not: null } } }),
      prisma.user.count({ where: { email: { not: null } } }),
      prisma.user.count({ where: { emailVerifiedAt: { not: null } } })
    ]);

    console.log("--- STATUS VERIFIKASI KONTAK ---");
    console.log(`Nomor terverifikasi : ${phoneVerified} dari ${userCount}`);
    console.log(`Punya email         : ${emailPresent}`);
    console.log(`Email terverifikasi : ${emailVerified}`);
    console.log("");

    // --- Klasifikasi per akun -------------------------------------------
    const users = await prisma.user.findMany({
      select: { id: true, phone: true, email: true, fullName: true, createdAt: true,
                phoneVerifiedAt: true, emailVerifiedAt: true },
      orderBy: { createdAt: "asc" }
    });

    const rows: AccountRow[] = [];
    for (const user of users) {
      const footprint: FinancialFootprint = {
        invoices: await prisma.invoice.count({ where: { userId: user.id } }),
        membershipPayments: await prisma.membershipPayment.count({ where: { userId: user.id } }),
        membershipOrders: await prisma.membershipOrder.count({ where: { userId: user.id } }),
        commissions: await prisma.commission.count({ where: { beneficiaryId: user.id } }),
        withdrawals: await prisma.withdrawal.count({ where: { userId: user.id } }),
        walletTransactions: await prisma.walletTransaction.count({
          where: { wallet: { userId: user.id } }
        }),
        rewardTransactions: await prisma.rewardTransaction.count({ where: { userId: user.id } }),
        profitSharingDistributions: await prisma.profitSharingDistribution.count({
          where: { userId: user.id }
        })
      };

      rows.push({
        id: user.id,
        maskedPhone: maskPhone(user.phone),
        maskedEmail: maskEmail(user.email),
        maskedName: maskName(user.fullName),
        createdAt: user.createdAt,
        phoneVerified: user.phoneVerifiedAt !== null,
        emailVerified: user.emailVerifiedAt !== null,
        classification: classifyAccount({ phone: user.phone, email: user.email, footprint }),
        footprint
      });
    }

    const byClass = new Map<DataClass, number>();
    for (const row of rows) {
      byClass.set(row.classification, (byClass.get(row.classification) ?? 0) + 1);
    }

    console.log("--- KLASIFIKASI ---");
    for (const [name, count] of byClass) {
      console.log(`${name.padEnd(28)}: ${count}`);
    }
    console.log("");

    console.log("--- RINCIAN AKUN (tersamarkan) ---");
    console.log(
      ["id", "nama", "telepon", "email", "kelas", "finansial", "dibuat"].join(" | ")
    );
    for (const row of rows) {
      const financialTotal = Object.values(row.footprint).reduce((sum, n) => sum + n, 0);
      console.log(
        [
          row.id,
          row.maskedName,
          row.maskedPhone,
          row.maskedEmail ?? "-",
          row.classification,
          String(financialTotal),
          row.createdAt.toISOString().slice(0, 10)
        ].join(" | ")
      );
    }
    console.log("");
    console.log("Audit selesai. Tidak ada data yang diubah.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // Hanya pesan yang dicetak, tidak pernah connection string atau stack penuh
  // yang bisa memuat parameter query.
  console.error(`AUDIT GAGAL: ${error instanceof Error ? error.message : "kesalahan tidak dikenal"}`);
  process.exitCode = 1;
});
