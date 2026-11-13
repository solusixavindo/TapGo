import { Prisma } from "@prisma/client";
import { bonusCreditData, splitBonus } from "../domain/walletBuckets.js";

/**
 * Titik tunggal kredit bonus membership (sponsor, level, reward, bagi hasil, insentif driver).
 *
 * Bendera BONUS_LOCK_ENABLED mati: seluruh bonus ke saldo yang dapat ditarik, tepat seperti sebelumnya
 * (catatan buku besar dan kolom wallet tidak berubah sama sekali). Menyala: BONUS_LOCK_PERCENT% dikunci sebagai
 * Saldo TapGo (boleh dipakai, tidak boleh ditarik) dan sisanya dapat ditarik.
 */
export interface BonusSplit {
  cash: Prisma.Decimal;
  locked: Prisma.Decimal;
}

/**
 * Konfigurasi dimuat MALAS (saat dipakai), bukan saat modul dimuat. Modul ini terjangkau dari harness tes
 * (setupFiles global), dan memuat config/env lebih awal akan membekukan variabel lingkungan sebelum tes sempat
 * mengisinya (kode DOKU, misalnya, membaca konfigurasinya saat dimuat). Di server nyata tidak ada bedanya.
 */
async function currentEnv() {
  return (await import("../../../config/env.js")).env;
}

export async function splitBonusForCredit(amount: Prisma.Decimal): Promise<BonusSplit> {
  const env = await currentEnv();
  return splitBonus(amount, { enabled: env.BONUS_LOCK_ENABLED, percent: env.BONUS_LOCK_PERCENT });
}

/** Pembaruan kolom `wallets` untuk bonus yang masuk. */
export function bonusWalletUpdate(split: BonusSplit) {
  return bonusCreditData(split);
}

/** Nilai awal kolom saat dompet dibuat bersamaan dengan bonus pertama (upsert, cabang create). */
export function bonusWalletCreate(split: BonusSplit) {
  return {
    balance: split.cash.plus(split.locked),
    cashBalance: split.cash,
    ...(split.locked.gt(0) ? { lockedBonusBalance: split.locked } : {}),
  };
}

/** Catatan untuk buku besar: hanya bila ada bagian terkunci, sehingga catatan lama tidak berubah. */
export function bonusLockMetadata(split: BonusSplit): { lockedBonus?: string } {
  return split.locked.gt(0) ? { lockedBonus: split.locked.toString() } : {};
}
