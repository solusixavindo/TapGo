/**
 * Generator kandidat purge — READ-ONLY.
 *
 * Menghasilkan berkas JSON berisi daftar ID yang diklasifikasikan sebagai
 * CONFIRMED_TEST. Berkas itu adalah USULAN, bukan izin: purge.ts tetap
 * mengevaluasi ulang setiap ID dan tetap menolak apa pun yang punya jejak
 * finansial.
 *
 * Akun POSSIBLE_TEST dan REQUIRES_OWNER_DECISION sengaja TIDAK dimasukkan.
 * Keduanya dicetak terpisah agar Owner memutuskan satu per satu.
 *
 * Jalankan:
 *   DATABASE_URL=... npx tsx scripts/data-audit/purge-candidates.ts --out kandidat.json
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  FinancialFootprint,
  assertNonProductionDatabase,
  classifyAccount,
  maskEmail,
  maskPhone
} from "./guard.js";

async function main() {
  const outIndex = process.argv.indexOf("--out");
  const outFile = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
  if (!outFile) {
    throw new Error("--out wajib diisi dengan path berkas JSON tujuan.");
  }

  const databaseName = assertNonProductionDatabase(process.env.DATABASE_URL);
  const prisma = new PrismaClient();

  try {
    const users = await prisma.user.findMany({
      select: { id: true, phone: true, email: true, createdAt: true }
    });

    const confirmed: string[] = [];
    const needsDecision: Array<{ id: string; phone: string; email: string | null; reason: string }> = [];

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

      const classification = classifyAccount({
        phone: user.phone,
        email: user.email,
        footprint
      });

      if (classification === "CONFIRMED_TEST") {
        confirmed.push(user.id);
      } else if (classification === "POSSIBLE_TEST") {
        needsDecision.push({
          id: user.id,
          phone: maskPhone(user.phone),
          email: maskEmail(user.email),
          reason: "Cocok pola tester TETAPI punya jejak finansial."
        });
      }
    }

    writeFileSync(
      outFile,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          database: databaseName,
          note:
            "Daftar ini USULAN, bukan izin hapus. purge.ts mengevaluasi ulang " +
            "setiap ID dan tetap menolak yang punya jejak finansial.",
          ids: confirmed
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    console.log(`Database                  : ${databaseName}`);
    console.log(`CONFIRMED_TEST (ditulis)  : ${confirmed.length}`);
    console.log(`POSSIBLE_TEST (perlu Owner): ${needsDecision.length}`);
    console.log(`Berkas kandidat           : ${outFile}`);
    console.log("");
    if (needsDecision.length > 0) {
      console.log("--- PERLU KEPUTUSAN OWNER (tidak masuk berkas kandidat) ---");
      for (const row of needsDecision) {
        console.log(`${row.id} | ${row.phone} | ${row.email ?? "-"} | ${row.reason}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    `GENERATOR GAGAL: ${error instanceof Error ? error.message : "kesalahan tidak dikenal"}`
  );
  process.exitCode = 1;
});
