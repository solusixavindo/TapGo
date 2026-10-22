/**
 * Koreksi referral satu kali: mengaitkan sponsor ke akun yang membeli membership tanpa sponsor tercatat dan membayar
 * surut bonus referral dari order itu, dengan aturan hitung yang sama persis dengan aktivasi membership.
 *
 * DEFAULT = SIMULASI: menjalankan semua langkah lalu membatalkan transaksi (tidak ada data berubah) dan mencetak
 * rincian yang AKAN dibayar. Pembayaran nyata hanya bila memakai --apply DAN --confirm-referral-backfill.
 * Aman diulang: order yang sudah pernah membayar bonus referral ditolak (tidak ada pembayaran dobel).
 *
 * Jalankan (di server, dari apps/backend):
 *   npm run referral:backfill -- --user-id <uuid> --sponsor-code <KODE> --order-id <uuid>
 *   npm run referral:backfill -- --user-id <uuid> --sponsor-code <KODE> --order-id <uuid> \
 *     --apply --confirm-referral-backfill [--admin-id <uuid pelaku, untuk audit>]
 *
 * Output memuat nama dan jumlah saja; tidak pernah memuat nomor HP, password, atau token.
 */
// Memuat .env dari direktori kerja (apps/backend) supaya skrip bisa dijalankan langsung di server tanpa export manual.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { MembershipOrderService } from "../src/modules/memberships/application/MembershipOrderService.js";
import { ReferralBackfillService } from "../src/modules/referrals/application/ReferralBackfillService.js";
import { PrismaReferralRepository } from "../src/modules/referrals/infrastructure/PrismaReferralRepository.js";

const CONFIRM_FLAG = "--confirm-referral-backfill";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`GAGAL: ${message}`);
  process.exit(1);
}

function rupiah(value: string): string {
  return `Rp${Number(value).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}

async function main() {
  const userId = readArg("--user-id");
  const sponsorCode = readArg("--sponsor-code");
  const orderId = readArg("--order-id");
  const adminId = readArg("--admin-id");
  const apply = process.argv.includes("--apply");

  if (!userId || !sponsorCode || !orderId) {
    fail("--user-id, --sponsor-code, dan --order-id wajib diisi");
  }
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    fail(`pembayaran nyata memindahkan uang ke saldo sponsor; ulangi dengan ${CONFIRM_FLAG}`);
  }

  const prisma = new PrismaClient();
  try {
    const service = new ReferralBackfillService(
      prisma,
      new MembershipOrderService(prisma),
      new PrismaReferralRepository(prisma)
    );
    const report = await service.run({ userId, sponsorCode, orderId, adminId, apply });

    console.log(apply ? "=== DITERAPKAN ===" : "=== SIMULASI (tidak ada data berubah) ===");
    console.log(`Pembeli : ${report.userName}`);
    console.log(`Sponsor : ${report.sponsorName}`);
    console.log(`Order   : ${report.orderId} (${report.packageName}, ${rupiah(report.packagePrice)})`);
    if (report.payouts.length === 0) {
      console.log("Bonus   : tidak ada yang dibayar menurut aturan saat ini");
    } else {
      for (const payout of report.payouts) {
        console.log(
          `Bonus   : ${payout.beneficiaryName} | ${payout.type}${payout.level ? ` level ${payout.level}` : ""} | ${rupiah(payout.amount)}`
        );
      }
    }
    console.log(`Total   : ${rupiah(report.totalPayout)}`);
    if (!apply) {
      console.log("Jika sesuai harapan, ulangi dengan --apply --confirm-referral-backfill.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;
  fail(code ? `${message} (${code})` : message);
});
