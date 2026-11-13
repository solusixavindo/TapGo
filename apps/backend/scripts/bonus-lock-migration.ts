/**
 * Migrasi surut kunci bonus 20% + deposit awal (Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir 4).
 *
 * DEFAULT = SIMULASI: tidak ada data yang berubah; mencetak ringkasan dan daftar dompet terdampak (nomor HP dan nama
 * disamarkan). Perubahan nyata hanya bila memakai --apply DAN --confirm-backup-sudah-dibuat.
 * Aman diulang: dompet yang sudah dimigrasi dilewati, dan bonus yang sudah dipecah aturan baru tidak dihitung lagi.
 *
 * Jalankan (di server, dari apps/backend):
 *   npx tsx scripts/bonus-lock-migration.ts
 *   npx tsx scripts/bonus-lock-migration.ts --apply --confirm-backup-sudah-dibuat
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runBonusLockMigration } from "../src/modules/wallets/application/BonusLockMigration.js";

const CONFIRM_FLAG = "--confirm-backup-sudah-dibuat";
const rupiah = (value: { toString(): string }) => `Rp${Number(value.toString()).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
const mask = (text: string, keepStart: number, keepEnd: number) =>
  text.length <= keepStart + keepEnd ? "*".repeat(text.length) : `${text.slice(0, keepStart)}${"*".repeat(Math.max(4, text.length - keepStart - keepEnd))}${text.slice(-keepEnd)}`;

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    console.error(`GAGAL: perubahan nyata memerlukan ${CONFIRM_FLAG} (pastikan cadangan database sudah dibuat).`);
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const result = await runBonusLockMigration(prisma, { apply });
    console.log(apply ? "=== MIGRASI DITERAPKAN ===" : "=== SIMULASI (tidak ada data berubah) ===");
    const t = result.totals;
    console.log(`dompet: ${t.wallets} | terdampak: ${t.affected} | dilewati: ${t.skipped}`);
    console.log(`total bonus lama: ${rupiah(t.totalLegacyBonus)} | seharusnya dikunci: ${rupiah(t.locked)}`);
    console.log(`dipindah ke terkunci: ${rupiah(t.moved)} | kekurangan (tidak ditagih): ${rupiah(t.shortfall)}`);
    console.log(`deposit awal dicatat: ${rupiah(t.depositInitial)}`);

    const affected = result.rows.filter((r) => r.moved.gt(0) || r.shortfall.gt(0) || r.depositInitial.gt(0)).sort((a, b) => Number(b.moved.minus(a.moved)));
    const users = await prisma.user.findMany({ where: { id: { in: affected.map((r) => r.userId) } }, select: { id: true, phone: true, fullName: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    console.log("\n--- dompet terdampak (disamarkan) ---");
    for (const r of affected.slice(0, 30)) {
      const u = byId.get(r.userId);
      console.log(
        `${mask(u?.phone ?? "?", 4, 3)} ${mask(u?.fullName ?? "?", 1, 0)} | status ${r.status} | dipindah ${rupiah(r.moved)} | kekurangan ${rupiah(r.shortfall)} | deposit ${rupiah(r.depositInitial)}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("GAGAL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
