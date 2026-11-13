import { Prisma } from "@prisma/client";
import {
  BucketAmounts,
  creditData,
  debitData,
  planDebit,
  plansFromJson,
  plansToJson,
  sumOf,
  WalletBuckets,
} from "../domain/walletBuckets.js";

/**
 * Pengurangan dan pemulihan saldo menurut kantong (lihat domain/walletBuckets.ts).
 *
 * Aturan keselamatan yang berlaku di semua jalur:
 *  - rencana dihitung dari bacaan dompet, lalu ditulis dengan pembaruan bersyarat pada SELURUH kolom yang dibaca
 *    (compare-and-set): dua permintaan serentak tidak bisa sama-sama lolos dengan saldo yang hanya cukup untuk satu;
 *  - pembagian disimpan di metadata buku besar bila menyentuh kantong terkunci atau deposit, sehingga pembalikan
 *    (refund, pelepasan penahanan) memulihkan komposisi yang sama persis. Tanpa itu metadata tetap seperti dulu.
 */

export const bucketSelect = {
  id: true,
  balance: true,
  cashBalance: true,
  lockedBonusBalance: true,
  depositBalance: true,
} as const;

export interface BucketWalletRow extends WalletBuckets {
  id: string;
}

/** Syarat WHERE compare-and-set: nilai seluruh kolom sama persis dengan yang dibaca. */
export function sameBucketsWhere(wallet: BucketWalletRow) {
  return {
    id: wallet.id,
    balance: wallet.balance,
    cashBalance: wallet.cashBalance,
    lockedBonusBalance: wallet.lockedBonusBalance,
    depositBalance: wallet.depositBalance,
  };
}

/** Pembagian untuk buku besar: hanya bila menyentuh kantong terkunci atau deposit (catatan lama tidak berubah). */
export function ledgerBuckets(plan: BucketAmounts): { buckets?: ReturnType<typeof plansToJson> } {
  return plan.locked.gt(0) || plan.deposit.gt(0) ? { buckets: plansToJson(plan) } : {};
}

/**
 * Pembagian yang harus dikembalikan saat sebuah pengurangan dibalik. Memakai pembagian yang tersimpan; catatan
 * lama (sebelum fitur ini) hanya mengenal `fromCash`: sebanyak itu ke saldo yang dapat ditarik, sisanya ke "lain-lain".
 */
export function restorePlan(metadata: unknown, amount: Prisma.Decimal, legacyFromCash: Prisma.Decimal): BucketAmounts {
  const stored = plansFromJson((metadata as { buckets?: unknown } | null | undefined)?.buckets);
  if (stored && sumOf(stored).equals(amount)) return stored;
  const cash = Prisma.Decimal.min(legacyFromCash, amount);
  return { other: amount.minus(cash), locked: new Prisma.Decimal(0), deposit: new Prisma.Decimal(0), cash };
}

export { creditData, debitData, planDebit };
