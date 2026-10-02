import { Prisma, PrismaClient } from "@prisma/client";
import { randomInt } from "node:crypto";

type Client = PrismaClient | Prisma.TransactionClient;

/** Penanda penyedia untuk semua pembayaran transfer bank manual. */
export const MANUAL_BANK_PROVIDER = "MANUAL_BANK";

/**
 * Rekening tujuan transfer manual hanya SATU (rekening perusahaan), dipakai
 * bersama oleh top up saldo dan pembayaran membership. Nominal transfer unik
 * (jumlah + kode 1..999) adalah SATU-SATUNYA petunjuk Super Admin untuk
 * mencocokkan mutasi bank dengan pesanan, jadi dua pesanan terbuka — dari
 * tabel mana pun — tidak boleh memakai nominal yang sama. Top up Rp500.000
 * dengan kode 347 dan membership Rp500.000 dengan kode 347 sama-sama
 * berujung transfer Rp500.347, dan itu tidak dapat dibedakan di mutasi bank.
 *
 * Mengembalikan nominal transfer penuh dari semua pesanan manual yang masih
 * PENDING dan belum kedaluwarsa, dari kedua tabel.
 */
export async function openManualTransferAmounts(client: Client, now: Date): Promise<Set<number>> {
  const [topUps, memberships] = await Promise.all([
    client.walletTopUpOrder.findMany({
      where: { provider: MANUAL_BANK_PROVIDER, status: "PENDING", expiresAt: { gt: now } },
      select: { amount: true },
    }),
    client.membershipPayment.findMany({
      where: { provider: MANUAL_BANK_PROVIDER, status: "PENDING" },
      select: { metadata: true },
    }),
  ]);

  const amounts = new Set<number>(topUps.map((row) => row.amount.toNumber()));
  for (const row of memberships) {
    const meta = (row.metadata ?? {}) as { transferAmount?: unknown; expiresAt?: unknown };
    const transferAmount = typeof meta.transferAmount === "number" ? meta.transferAmount : null;
    const expiresAt = typeof meta.expiresAt === "string" ? new Date(meta.expiresAt) : null;
    if (transferAmount !== null && expiresAt !== null && expiresAt.getTime() > now.getTime()) {
      amounts.add(transferAmount);
    }
  }
  return amounts;
}

/**
 * Memilih kode unik 1..999 acak yang membuat (baseAmount + kode) tidak sedang
 * dipakai pesanan terbuka lain. Mengembalikan null bila semua 999 kode habis.
 */
export function pickFreeUniqueCode(baseAmount: number, taken: Set<number>): number | null {
  const free: number[] = [];
  for (let code = 1; code <= 999; code += 1) {
    if (!taken.has(baseAmount + code)) free.push(code);
  }
  if (free.length === 0) return null;
  return free[randomInt(free.length)]!;
}
