/**
 * Purge akun uji — DRY-RUN sebagai default.
 *
 * Alat ini sengaja dibuat sulit dipakai secara tidak sengaja:
 *   - hanya menerima daftar ID eksplisit dari berkas JSON;
 *   - tidak punya wildcard, `--all`, maupun filter apa pun;
 *   - menolak berjalan di database yang tidak terbukti non-production;
 *   - dry-run kecuali TIGA flag konfirmasi diberikan sekaligus;
 *   - menolak setiap ID yang punya jejak finansial, bahkan bila diminta.
 *
 * Jalankan (dry-run):
 *   DATABASE_URL=... npx tsx scripts/data-audit/purge.ts --ids kandidat.json
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  FinancialFootprint,
  assertNonProductionDatabase,
  hasFinancialFootprint,
  maskPhone
} from "./guard.js";

type Args = {
  idsFile: string;
  execute: boolean;
  backupConfirmed: boolean;
  environmentConfirmation: string | null;
};

function parseArgs(argv: string[]): Args {
  let idsFile = "";
  let execute = false;
  let backupConfirmed = false;
  let environmentConfirmation: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ids") {
      idsFile = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--execute") {
      execute = true;
    } else if (arg === "--i-have-a-verified-backup") {
      backupConfirmed = true;
    } else if (arg?.startsWith("--confirm-environment=")) {
      environmentConfirmation = arg.split("=")[1] ?? "";
    }
  }

  return { idsFile, execute, backupConfirmed, environmentConfirmation };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseName = assertNonProductionDatabase(process.env.DATABASE_URL);

  if (!args.idsFile) {
    throw new Error(
      "--ids wajib diisi dengan berkas JSON berisi daftar ID. " +
        "Tidak ada mode wildcard atau hapus-semua pada alat ini."
    );
  }

  const parsed = JSON.parse(readFileSync(args.idsFile, "utf8")) as unknown;
  const ids = Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === "string")
    : (parsed as { ids?: unknown })?.ids;

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("Berkas ID kosong atau tidak berisi array string.");
  }
  const explicitIds = ids.filter((value): value is string => typeof value === "string");
  if (explicitIds.length !== ids.length) {
    throw new Error("Berkas ID memuat entri yang bukan string. Dihentikan.");
  }

  const prisma = new PrismaClient();
  try {
    console.log("=".repeat(72));
    console.log("TAPGO — PURGE AKUN UJI");
    console.log("=".repeat(72));
    console.log(`Database   : ${databaseName}`);
    console.log(`ID diminta : ${explicitIds.length}`);
    console.log(`Mode       : ${args.execute ? "EKSEKUSI" : "DRY-RUN (default)"}`);
    console.log("");

    const blocked: string[] = [];
    const missing: string[] = [];
    const eligible: Array<{ id: string; maskedPhone: string }> = [];

    for (const id of explicitIds) {
      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, phone: true }
      });
      if (!user) {
        missing.push(id);
        continue;
      }

      const footprint: FinancialFootprint = {
        invoices: await prisma.invoice.count({ where: { userId: id } }),
        membershipPayments: await prisma.membershipPayment.count({ where: { userId: id } }),
        membershipOrders: await prisma.membershipOrder.count({ where: { userId: id } }),
        commissions: await prisma.commission.count({ where: { beneficiaryId: id } }),
        withdrawals: await prisma.withdrawal.count({ where: { userId: id } }),
        walletTransactions: await prisma.walletTransaction.count({
          where: { wallet: { userId: id } }
        }),
        rewardTransactions: await prisma.rewardTransaction.count({ where: { userId: id } }),
        profitSharingDistributions: await prisma.profitSharingDistribution.count({
          where: { userId: id }
        })
      };

      // Penjaga terakhir: jejak finansial selalu menang atas permintaan hapus.
      if (hasFinancialFootprint(footprint)) {
        blocked.push(id);
        continue;
      }

      eligible.push({ id: user.id, maskedPhone: maskPhone(user.phone) });
    }

    console.log("--- HASIL EVALUASI ---");
    console.log(`Layak dihapus        : ${eligible.length}`);
    console.log(`Ditolak (finansial)  : ${blocked.length}`);
    console.log(`Tidak ditemukan      : ${missing.length}`);
    console.log("");

    for (const row of eligible) {
      console.log(`LAYAK    ${row.id}  ${row.maskedPhone}`);
    }
    for (const id of blocked) {
      console.log(`DITOLAK  ${id}  (punya jejak finansial — tidak akan dihapus)`);
    }
    for (const id of missing) {
      console.log(`HILANG   ${id}`);
    }
    console.log("");

    if (!args.execute) {
      console.log("DRY-RUN selesai. Tidak ada baris yang dihapus.");
      console.log(
        "Untuk mengeksekusi, sertakan --execute --i-have-a-verified-backup " +
          `--confirm-environment=${databaseName}`
      );
      return;
    }

    if (!args.backupConfirmed) {
      throw new Error("Eksekusi ditolak: --i-have-a-verified-backup belum diberikan.");
    }
    if (args.environmentConfirmation !== databaseName) {
      throw new Error(
        "Eksekusi ditolak: --confirm-environment tidak cocok dengan nama database aktif."
      );
    }
    if (blocked.length > 0) {
      throw new Error(
        `Eksekusi ditolak: ${blocked.length} ID memiliki jejak finansial. ` +
          "Perbaiki daftar ID lalu jalankan dry-run lagi."
      );
    }

    console.log("Menghapus akun yang layak...");
    let deleted = 0;
    for (const row of eligible) {
      // Penghapusan per-ID, bukan deleteMany dengan filter: setiap baris yang
      // hilang dapat ditelusuri ke satu ID yang disetujui secara eksplisit.
      await prisma.user.delete({ where: { id: row.id } });
      deleted += 1;
      console.log(`DIHAPUS  ${row.id}`);
    }
    console.log("");
    console.log(`Selesai. ${deleted} akun dihapus.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`PURGE GAGAL: ${error instanceof Error ? error.message : "kesalahan tidak dikenal"}`);
  process.exitCode = 1;
});
