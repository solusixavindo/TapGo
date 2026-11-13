import { Prisma } from "@prisma/client";

/**
 * Pembukuan kantong Saldo TapGo (docs/finance/RANCANGAN_KUNCI_BONUS_DAN_TARIK_DEPOSIT.md).
 *
 * `balance` adalah saldo total. Di dalamnya ada tiga kantong yang tercatat:
 *   cashBalance        : dapat ditarik (bonus 80%, komisi, insentif)
 *   lockedBonusBalance : bonus terkunci (20%): boleh dipakai, tidak boleh ditarik
 *   depositBalance     : deposit pribadi (top up): dapat ditarik kembali (biaya tetap)
 * Selisihnya, `other` = balance - cash - locked - deposit, adalah saldo yang tidak dapat ditarik dan tidak terlacak
 * kantongnya (transfer masuk, pengembalian dana, penyesuaian).
 *
 * Fungsi di sini MURNI (tanpa database) supaya pembagiannya dapat diuji habis-habisan. Setiap jalur yang menambah
 * atau mengurangi saldo memakai fungsi yang sama dan menyimpan pembagiannya di buku besar, sehingga pembalikan
 * (refund, pelepasan penahanan) mengembalikan komposisi yang sama persis.
 *
 * Bila semua kantong baru bernilai 0 (bendera BONUS_LOCK_ENABLED mati), `other` sama dengan "non-tarik" yang lama
 * dan urutan pemakaian lama tetap berlaku persis.
 */

export type Decimalish = Prisma.Decimal;

export interface WalletBuckets {
  balance: Decimalish;
  cashBalance: Decimalish;
  lockedBonusBalance: Decimalish;
  depositBalance: Decimalish;
}

/** Jumlah yang diambil dari (atau dikembalikan ke) tiap kantong. */
export interface BucketAmounts {
  other: Decimalish;
  locked: Decimalish;
  deposit: Decimalish;
  cash: Decimalish;
}

export type DebitOrder =
  /** Pakai saldo yang tidak dapat ditarik lebih dulu (perjalanan, PPOB, transfer): hak tarik pengguna bertahan. */
  | "NON_CASH_FIRST"
  /** Penahanan komisi pesanan tunai: dimulai dari saldo yang dapat ditarik, seperti perilaku sebelumnya. */
  | "CASH_FIRST";

const ZERO = new Prisma.Decimal(0);

export const zeroAmounts = (): BucketAmounts => ({ other: ZERO, locked: ZERO, deposit: ZERO, cash: ZERO });

export function sumOf(plan: BucketAmounts): Decimalish {
  return plan.other.plus(plan.locked).plus(plan.deposit).plus(plan.cash);
}

/** Saldo "lain-lain": tidak dapat ditarik dan tidak terlacak kantongnya. */
export function otherBalance(wallet: WalletBuckets): Decimalish {
  return wallet.balance.minus(wallet.cashBalance).minus(wallet.lockedBonusBalance).minus(wallet.depositBalance);
}

/** Pelanggaran invarian pembukuan; seharusnya mustahil (database juga menegakkannya lewat CHECK). */
export function assertInvariant(wallet: WalletBuckets): void {
  if (
    wallet.cashBalance.lt(0) ||
    wallet.lockedBonusBalance.lt(0) ||
    wallet.depositBalance.lt(0) ||
    otherBalance(wallet).lt(0)
  ) {
    throw new Error("Invarian kantong saldo dilanggar");
  }
}

/**
 * Memecah satu bonus menjadi bagian yang dapat ditarik dan bagian terkunci.
 * Bagian terkunci dibulatkan KE BAWAH ke rupiah penuh; sisanya masuk ke bagian yang dapat ditarik, sehingga
 * cash + locked selalu persis sama dengan jumlah bonus.
 */
export function splitBonus(
  amount: Decimalish,
  options: { enabled: boolean; percent: number },
): { cash: Decimalish; locked: Decimalish } {
  if (!options.enabled || options.percent <= 0 || amount.lte(0)) {
    return { cash: amount, locked: ZERO };
  }
  const percent = Math.min(options.percent, 100);
  const locked = amount.times(percent).div(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  return { cash: amount.minus(locked), locked };
}

/**
 * Rencana pengurangan `amount` dari kantong menurut urutan.
 *  NON_CASH_FIRST : lain-lain, terkunci, deposit, dapat ditarik
 *  CASH_FIRST     : dapat ditarik, lain-lain, terkunci, deposit
 * Melempar bila `amount` melebihi saldo total.
 */
export function planDebit(
  wallet: WalletBuckets,
  amount: Decimalish,
  order: DebitOrder = "NON_CASH_FIRST",
): BucketAmounts {
  assertInvariant(wallet);
  if (amount.lt(0)) throw new Error("Jumlah pengurangan tidak boleh negatif");
  if (amount.gt(wallet.balance)) throw new Error("Saldo tidak mencukupi");

  const available: Record<keyof BucketAmounts, Decimalish> = {
    other: otherBalance(wallet),
    locked: wallet.lockedBonusBalance,
    deposit: wallet.depositBalance,
    cash: wallet.cashBalance,
  };
  const sequence: Array<keyof BucketAmounts> =
    order === "CASH_FIRST" ? ["cash", "other", "locked", "deposit"] : ["other", "locked", "deposit", "cash"];

  const plan = zeroAmounts();
  let remaining = amount;
  for (const bucket of sequence) {
    if (remaining.lte(0)) break;
    const take = Prisma.Decimal.min(available[bucket], remaining);
    plan[bucket] = take;
    remaining = remaining.minus(take);
  }
  // Tidak mungkin tersisa karena amount <= balance = jumlah semua kantong; jaga-jaga terhadap invarian rusak.
  if (remaining.gt(0)) throw new Error("Rencana pengurangan tidak lengkap");
  return plan;
}

/** Kolom `wallets` untuk pembaruan Prisma saat saldo berkurang menurut rencana. */
export function debitData(plan: BucketAmounts) {
  return {
    balance: { decrement: sumOf(plan) },
    cashBalance: { decrement: plan.cash },
    lockedBonusBalance: { decrement: plan.locked },
    depositBalance: { decrement: plan.deposit },
  };
}

/** Kebalikan: saldo bertambah menurut rencana (refund, pelepasan penahanan, pembalikan). */
export function creditData(plan: BucketAmounts) {
  return {
    balance: { increment: sumOf(plan) },
    cashBalance: { increment: plan.cash },
    lockedBonusBalance: { increment: plan.locked },
    depositBalance: { increment: plan.deposit },
  };
}

/** Kolom `wallets` untuk bonus yang masuk: seluruhnya ke balance, dipecah ke cash dan locked. */
export function bonusCreditData(split: { cash: Decimalish; locked: Decimalish }) {
  return {
    balance: { increment: split.cash.plus(split.locked) },
    cashBalance: { increment: split.cash },
    // Hanya bila ada bagian terkunci: dengan bendera mati pembaruan identik dengan perilaku lama.
    ...(split.locked.gt(0) ? { lockedBonusBalance: { increment: split.locked } } : {}),
  };
}

/** Pembagian yang disimpan di metadata buku besar supaya pembalikan memulihkan komposisi yang sama. */
export function plansToJson(plan: BucketAmounts) {
  return {
    other: plan.other.toString(),
    locked: plan.locked.toString(),
    deposit: plan.deposit.toString(),
    cash: plan.cash.toString(),
  };
}

/** Membaca kembali pembagian dari metadata; null bila tidak ada atau rusak (catatan lama sebelum fitur ini). */
export function plansFromJson(value: unknown): BucketAmounts | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  try {
    const plan: BucketAmounts = {
      other: new Prisma.Decimal(String(raw.other ?? "0")),
      locked: new Prisma.Decimal(String(raw.locked ?? "0")),
      deposit: new Prisma.Decimal(String(raw.deposit ?? "0")),
      cash: new Prisma.Decimal(String(raw.cash ?? "0")),
    };
    if (plan.other.lt(0) || plan.locked.lt(0) || plan.deposit.lt(0) || plan.cash.lt(0)) return null;
    return plan;
  } catch {
    return null;
  }
}
