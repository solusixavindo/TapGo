/**
 * Pemberian membership tanpa pembelian (keputusan Owner) untuk satu akun, dengan hak yang dihitung business engine:
 * keanggotaan aktif pada tingkat itu (bonus sponsor, bonus jenjang, hadiah pencapaian, pembagian laba tingkat itu)
 * dan benefit saldo PPOB paket. TIDAK membuat order/invoice/pendapatan dan TIDAK memicu bonus ke atasan.
 *
 * DEFAULT = SIMULASI: menjalankan semua langkah lalu membatalkan transaksi (tidak ada data berubah) dan mencetak
 * rincian. Pemberian nyata hanya bila memakai --apply DAN --confirm-membership-grant.
 *
 * Jalankan (di server, dari apps/backend):
 *   npm run membership:grant -- --user-id <uuid> --tier PLATINUM --reason "alasan singkat"
 *   npm run membership:grant -- --user-id <uuid> --tier PLATINUM --reason "alasan singkat" \
 *     --apply --confirm-membership-grant [--admin-id <uuid pelaku, untuk audit>]
 *
 * Output memuat nama dan jumlah saja; tidak pernah memuat nomor HP, password, atau token.
 */
import { PrismaClient } from "@prisma/client";
import { MembershipGrantService } from "../src/modules/memberships/application/MembershipGrantService.js";
import { MembershipOrderService } from "../src/modules/memberships/application/MembershipOrderService.js";

const CONFIRM_FLAG = "--confirm-membership-grant";
const TIERS = ["SILVER", "GOLD", "PLATINUM"] as const;

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
  const tier = readArg("--tier")?.toUpperCase();
  const reason = readArg("--reason")?.trim();
  const adminId = readArg("--admin-id");
  const apply = process.argv.includes("--apply");

  if (!userId || !tier || !reason) {
    fail("--user-id, --tier, dan --reason wajib diisi");
  }
  if (!(TIERS as readonly string[]).includes(tier)) {
    fail(`--tier harus salah satu dari ${TIERS.join(", ")}`);
  }
  if (reason.length < 8) {
    fail("--reason minimal 8 karakter (dicatat di audit)");
  }
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    fail(`pemberian nyata menambah saldo PPOB dan hak pembagian laba; ulangi dengan ${CONFIRM_FLAG}`);
  }

  const prisma = new PrismaClient();
  try {
    const service = new MembershipGrantService(prisma, new MembershipOrderService(prisma));
    const report = await service.run({ userId, tier: tier as (typeof TIERS)[number], reason, adminId, apply });

    console.log(apply ? "=== DITERAPKAN ===" : "=== SIMULASI (tidak ada data berubah) ===");
    console.log(`Akun         : ${report.userName}`);
    console.log(`Tingkat      : ${report.previousTier} -> ${report.tier} (${report.packageName}), tanpa pembelian`);
    console.log(`Saldo PPOB   : +${rupiah(report.ppobCredited)} (tercatat sebagai benefit PPOB yang diberikan)`);
    console.log(`Anggota ${report.tier} aktif: ${report.tierMembersBefore} -> ${report.tierMembersAfter} (alokasi laba tingkat ini dibagi rata)`);
    console.log("Tidak dibuat: order, invoice, pendapatan, bonus ke atasan.");
    console.log("Dipenuhi manual: BPJS, merchandise, dan hak usaha sesuai paket.");
    if (!apply) {
      console.log("Jika sesuai harapan, ulangi dengan --apply --confirm-membership-grant.");
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
