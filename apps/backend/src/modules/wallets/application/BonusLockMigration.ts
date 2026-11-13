import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Migrasi surut kunci bonus 20% dan deposit awal (keputusan Owner 12 Nov 2026: berlaku untuk SELURUH bonus yang sudah
 * masuk). Lihat docs/finance/RANCANGAN_KUNCI_BONUS_DAN_TARIK_DEPOSIT.md bagian 4.
 *
 * Per dompet:
 *   dikunci   = jumlah dari tiap baris bonus LAMA (tanpa penanda `lockedBonus`) dikali persen, dibulatkan ke bawah per
 *               baris; bonus insentif yang sudah ditarik kembali ikut dikeluarkan.
 *   dipindah  = MIN(dikunci, cashBalance)         -> cashBalance turun, lockedBonusBalance naik, balance TETAP.
 *   kekurangan= dikunci - dipindah                -> sudah terlanjur ditarik/dipakai; tidak pernah ditagih.
 *   deposit   = MIN(saldo "lain-lain", total top up lama tanpa penanda `deposit`) -> depositBalance naik, balance TETAP.
 *
 * Aman diulang dan aman dijalankan sesudah BONUS_LOCK_ENABLED menyala: baris yang sudah diberi penanda tidak
 * dihitung lagi, dan dompet yang sudah punya catatan migrasi dilewati. Setiap dompet diubah dalam satu transaksi
 * dengan compare-and-set; bila dompet berubah di tengah jalan ia dilewati (jalankan ulang).
 */

export const BONUS_LOCK_MIGRATION_REFERENCE = "BONUS_LOCK_MIGRATION";
const BONUS_TYPES = [
  "SPONSOR_BONUS",
  "BASIC_SPONSOR_BONUS",
  "LEVEL_BONUS",
  "REWARD_BONUS",
  "PROFIT_SHARING",
  "PROFIT_SHARING_BONUS",
  "INCENTIVE_BONUS",
] as const;

export interface BonusLockMigrationRow {
  walletId: string;
  userId: string;
  totalLegacyBonus: Prisma.Decimal;
  locked: Prisma.Decimal;
  moved: Prisma.Decimal;
  shortfall: Prisma.Decimal;
  depositInitial: Prisma.Decimal;
  status: "APPLIED" | "WOULD_APPLY" | "SKIPPED_ALREADY_MIGRATED" | "SKIPPED_CHANGED" | "NOTHING_TO_DO";
}

export interface BonusLockMigrationResult {
  apply: boolean;
  rows: BonusLockMigrationRow[];
  totals: {
    wallets: number;
    affected: number;
    totalLegacyBonus: Prisma.Decimal;
    locked: Prisma.Decimal;
    moved: Prisma.Decimal;
    shortfall: Prisma.Decimal;
    depositInitial: Prisma.Decimal;
    skipped: number;
  };
}

const zero = () => new Prisma.Decimal(0);
const markerOf = (metadata: Prisma.JsonValue | null, key: string) =>
  Boolean(metadata && typeof metadata === "object" && !Array.isArray(metadata) && (metadata as Record<string, unknown>)[key] !== undefined);

export async function runBonusLockMigration(
  prisma: PrismaClient,
  options: { apply: boolean; percent?: number },
): Promise<BonusLockMigrationResult> {
  const percent = options.percent ?? 20;
  const wallets = await prisma.wallet.findMany({ select: { id: true, userId: true }, orderBy: { createdAt: "asc" } });
  const rows: BonusLockMigrationRow[] = [];

  for (const { id: walletId, userId } of wallets) {
    const outcome = await prisma.$transaction(
      async (tx) => {
        const migrated = await tx.walletTransaction.findFirst({
          where: { walletId, referenceType: BONUS_LOCK_MIGRATION_REFERENCE },
          select: { id: true },
        });
        const current = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
        if (migrated) {
          return { status: "SKIPPED_ALREADY_MIGRATED" as const, totalLegacyBonus: zero(), locked: zero(), moved: zero(), shortfall: zero(), depositInitial: zero() };
        }

        const ledger = await tx.walletTransaction.findMany({
          where: {
            walletId,
            OR: [
              { type: { in: [...BONUS_TYPES] } },
              { type: "ADJUSTMENT", referenceType: "DRIVER_INCENTIVE_REVERSAL" },
              { type: "TOPUP" },
            ],
          },
          select: { type: true, amount: true, referenceType: true, referenceId: true, metadata: true },
        });

        // Insentif yang sudah ditarik kembali: aslinya dikeluarkan dari hitungan (kreditnya sudah dibatalkan penuh).
        const reversedClaims = new Set(
          ledger.filter((r) => r.type === "ADJUSTMENT" && r.referenceType === "DRIVER_INCENTIVE_REVERSAL").map((r) => r.referenceId),
        );

        let totalLegacyBonus = zero();
        let locked = zero();
        let topUpLegacy = zero();
        for (const row of ledger) {
          if ((BONUS_TYPES as readonly string[]).includes(row.type)) {
            if (markerOf(row.metadata, "lockedBonus")) continue; // sudah dipecah oleh aturan baru
            if (row.type === "INCENTIVE_BONUS" && row.referenceId && reversedClaims.has(row.referenceId)) continue;
            totalLegacyBonus = totalLegacyBonus.plus(row.amount);
            locked = locked.plus(row.amount.times(percent).div(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN));
          } else if (row.type === "TOPUP") {
            const target = (row.metadata as { target?: string } | null)?.target;
            if (target === "PPOB" || markerOf(row.metadata, "deposit")) continue; // PPOB tidak pernah deposit; sisanya sudah tercatat
            topUpLegacy = topUpLegacy.plus(row.amount);
          }
        }

        const moved = Prisma.Decimal.min(locked, current.cashBalance.lt(0) ? zero() : current.cashBalance);
        const shortfall = locked.minus(moved);
        const other = current.balance.minus(current.cashBalance).minus(current.lockedBonusBalance).minus(current.depositBalance);
        const depositInitial = Prisma.Decimal.min(other.lt(0) ? zero() : other, topUpLegacy);

        const nothing = moved.lte(0) && depositInitial.lte(0) && shortfall.lte(0);
        if (nothing) {
          return { status: "NOTHING_TO_DO" as const, totalLegacyBonus, locked, moved, shortfall, depositInitial };
        }
        if (!options.apply) {
          return { status: "WOULD_APPLY" as const, totalLegacyBonus, locked, moved, shortfall, depositInitial };
        }

        const changed = await tx.wallet.updateMany({
          where: {
            id: walletId,
            balance: current.balance,
            cashBalance: current.cashBalance,
            lockedBonusBalance: current.lockedBonusBalance,
            depositBalance: current.depositBalance,
          },
          data: {
            cashBalance: { decrement: moved },
            lockedBonusBalance: { increment: moved },
            depositBalance: { increment: depositInitial },
          },
        });
        if (changed.count !== 1) {
          return { status: "SKIPPED_CHANGED" as const, totalLegacyBonus, locked, moved, shortfall, depositInitial };
        }
        // Catatan 0 rupiah: saldo total tidak berubah, hanya komposisinya. Sekaligus penanda idempotensi.
        await tx.walletTransaction.create({
          data: {
            walletId,
            type: "ADJUSTMENT",
            amount: zero(),
            referenceType: BONUS_LOCK_MIGRATION_REFERENCE,
            referenceId: walletId,
            metadata: {
              percent,
              totalLegacyBonus: totalLegacyBonus.toString(),
              locked: locked.toString(),
              moved: moved.toString(),
              shortfall: shortfall.toString(),
              depositInitial: depositInitial.toString(),
            },
          },
        });
        return { status: "APPLIED" as const, totalLegacyBonus, locked, moved, shortfall, depositInitial };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 },
    );
    rows.push({ walletId, userId, ...outcome });
  }

  const sum = (pick: (r: BonusLockMigrationRow) => Prisma.Decimal) => rows.reduce((acc, r) => acc.plus(pick(r)), zero());
  return {
    apply: options.apply,
    rows,
    totals: {
      wallets: rows.length,
      affected: rows.filter((r) => r.status === "APPLIED" || r.status === "WOULD_APPLY").length,
      totalLegacyBonus: sum((r) => r.totalLegacyBonus),
      locked: sum((r) => r.locked),
      moved: sum((r) => r.moved),
      shortfall: sum((r) => r.shortfall),
      depositInitial: sum((r) => r.depositInitial),
      skipped: rows.filter((r) => r.status.startsWith("SKIPPED")).length,
    },
  };
}
