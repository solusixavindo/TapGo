/**
 * Pembalikan satu pesanan membership yang ditandai lunas manual TANPA bukti (kasus 13 Nov 2026).
 *
 * DEFAULT = SIMULASI (tidak ada data berubah): mencetak pesanan, siapa yang mengonfirmasi, tingkat yang akan dipulihkan, benefit PPOB, dan
 * semua bonus beserta penerimanya. Perubahan nyata hanya dengan --apply DAN --confirm-backup-sudah-dibuat.
 *
 * Contoh (dari apps/backend di server):
 *   npx tsx scripts/reverse-unverified-order.ts --invoice=INV-MBR-20261113-MWEV226U5387
 *   npx tsx scripts/reverse-unverified-order.ts --invoice=INV-... --beneficiaries=08xxxxxxxxxx --apply --confirm-backup-sudah-dibuat
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { reverseUnverifiedOrder } from "../src/modules/memberships/application/UnverifiedOrderReversal.js";

const CONFIRM_FLAG = "--confirm-backup-sudah-dibuat";
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const rupiah = (v: string) => `Rp${Number(v).toLocaleString("id-ID")}`;

async function main() {
  const invoiceNumber = arg("invoice");
  if (!invoiceNumber) {
    console.error("GAGAL: wajib --invoice=<nomor invoice>");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    console.error(`GAGAL: perubahan nyata memerlukan ${CONFIRM_FLAG} (pastikan cadangan database sudah dibuat).`);
    process.exit(1);
  }
  const beneficiaryPhones = (arg("beneficiaries") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const prisma = new PrismaClient();
  try {
    const r = await reverseUnverifiedOrder(prisma, { invoiceNumber, beneficiaryPhones, apply });
    console.log(r.applied ? "=== PEMBALIKAN DITERAPKAN ===" : r.alreadyReversed ? "=== SUDAH PERNAH DIBALIK ===" : "=== SIMULASI (tidak ada data berubah) ===");
    console.log(`pesanan ${r.order.id} | ${r.order.packageName} ${rupiah(r.order.totalAmount)} | status ${r.order.status}`);
    console.log(`pembeli: ${r.order.buyerName} (${r.order.buyerPhone}) | ditandai lunas oleh: ${r.confirmedBy ?? "?"}`);
    console.log(`keanggotaan: ${r.membership.currentTier} -> ${r.membership.restoreTo}`);
    console.log(`benefit PPOB pembeli: ${rupiah(r.ppob.amount)} (dibalik ${rupiah(r.ppob.willReverse)})`);
    console.log("\n--- bonus dari pesanan ini ---");
    for (const c of r.commissions) {
      console.log(
        `${c.selected ? "[DIBALIK]" : "[dibiarkan]"} ${c.type} ${rupiah(c.amount)} -> ${c.beneficiaryName} (${c.beneficiaryPhone}) | saldo sekarang ${rupiah(c.walletBalance)} | dibalik ${rupiah(c.willReverse)} | kekurangan ${rupiah(c.shortfall)} | penarikan terbuka ${c.openWithdrawals}`
      );
    }
    if (r.commissions.length === 0) console.log("(tidak ada bonus tercatat)");
    if (!apply) console.log("\nPilih penerima yang dibalik dengan --beneficiaries=<hp1,hp2>, lalu ulangi dengan --apply " + CONFIRM_FLAG);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("GAGAL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
