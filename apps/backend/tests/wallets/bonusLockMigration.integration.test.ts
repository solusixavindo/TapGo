import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { runBonusLockMigration } from "../../src/modules/wallets/application/BonusLockMigration.js";
import { prisma, runIntegration, setupReferralWalletIntegration } from "../helpers/referralWalletHarness.js";

/**
 * Migrasi surut kunci bonus 20% dan deposit awal. Setiap kasus memakai dompet sendiri dengan hitungan manual:
 * jumlah dikunci = 20% tiap baris bonus lama (dibulatkan ke bawah), dipindah = MIN(dikunci, saldo yang dapat ditarik),
 * deposit awal = MIN(saldo lain-lain, top up lama).
 */
type Ledger = Array<[type: string, amount: number, meta?: Record<string, unknown> | undefined, ref?: [string, string]]>;
let seq = 0;

async function wallet(input: { balance: number; cash: number; locked?: number; deposit?: number; ledger?: Ledger }) {
  seq += 1;
  const user = await prisma.user.create({
    data: { fullName: `Migrasi ${seq}`, phone: `+6281${String(seq).padStart(9, "0")}`, referralCode: `MIG${String(seq).padStart(5, "0")}`, role: "USER" },
  });
  const w = await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: new Prisma.Decimal(input.balance),
      cashBalance: new Prisma.Decimal(input.cash),
      lockedBonusBalance: new Prisma.Decimal(input.locked ?? 0),
      depositBalance: new Prisma.Decimal(input.deposit ?? 0),
    },
  });
  let n = 0;
  for (const [type, amount, meta, ref] of input.ledger ?? []) {
    n += 1;
    await prisma.walletTransaction.create({
      data: {
        walletId: w.id,
        type: type as never,
        amount: new Prisma.Decimal(amount),
        ...(ref ? { referenceType: ref[0], referenceId: ref[1] } : {}),
        ...(meta ? { metadata: meta as never } : {}),
      },
    });
    void n;
  }
  return { userId: user.id, walletId: w.id };
}

const read = async (userId: string) => {
  const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return [Number(w.balance), Number(w.cashBalance), Number(w.lockedBonusBalance), Number(w.depositBalance)];
};

describe.skipIf(!runIntegration)("Migrasi surut kunci bonus 20% dan deposit awal", () => {
  setupReferralWalletIntegration();

  it("SIMULASI (bawaan) tidak mengubah apa pun tetapi melaporkan angka yang sama dengan penerapan", async () => {
    const a = await wallet({ balance: 260000, cash: 200000, ledger: [["SPONSOR_BONUS", 100000], ["LEVEL_BONUS", 50000], ["TOPUP", 60000, { target: "WALLET" }]] });
    const before = await read(a.userId);
    const sim = await runBonusLockMigration(prisma, { apply: false });
    expect(await read(a.userId)).toEqual(before);
    expect(await prisma.walletTransaction.count({ where: { referenceType: "BONUS_LOCK_MIGRATION" } })).toBe(0);
    expect(sim.rows.find((r) => r.userId === a.userId)!.status).toBe("WOULD_APPLY");
    expect(sim.totals.moved.toString()).toBe("30000");
  });

  it("menerapkan: dikunci 20% per baris, deposit awal dari top up, saldo total TIDAK berubah, ada catatan 0 rupiah", async () => {
    const a = await wallet({ balance: 260000, cash: 200000, ledger: [["SPONSOR_BONUS", 100000], ["LEVEL_BONUS", 50000], ["TOPUP", 60000, { target: "WALLET" }]] });
    const result = await runBonusLockMigration(prisma, { apply: true });
    expect(result.rows.find((r) => r.userId === a.userId)!.status).toBe("APPLIED");
    // dikunci 20.000 + 10.000 = 30.000; non-tarik 60.000 = top up 60.000 -> deposit 60.000
    expect(await read(a.userId)).toEqual([260000, 170000, 30000, 60000]);
    const marker = await prisma.walletTransaction.findFirstOrThrow({ where: { walletId: a.walletId, referenceType: "BONUS_LOCK_MIGRATION" } });
    expect(Number(marker.amount)).toBe(0);
    expect(marker.type).toBe("ADJUSTMENT");
    expect(marker.metadata).toMatchObject({ moved: "30000", shortfall: "0", depositInitial: "60000" });
  });

  it("saldo yang dapat ditarik kurang dari 20%: hanya yang ada dipindah, kekurangan dicatat dan tidak pernah negatif", async () => {
    const b = await wallet({ balance: 5000, cash: 5000, ledger: [["REWARD_BONUS", 100000]] });
    const result = await runBonusLockMigration(prisma, { apply: true });
    const row = result.rows.find((r) => r.userId === b.userId)!;
    expect([row.locked.toString(), row.moved.toString(), row.shortfall.toString()]).toEqual(["20000", "5000", "15000"]);
    expect(await read(b.userId)).toEqual([5000, 0, 5000, 0]);
  });

  it("saldo yang dapat ditarik nol: tidak ada yang dipindah, tidak ada yang negatif", async () => {
    const c = await wallet({ balance: 0, cash: 0, ledger: [["PROFIT_SHARING", 80000]] });
    const result = await runBonusLockMigration(prisma, { apply: true });
    expect(result.rows.find((r) => r.userId === c.userId)!.shortfall.toString()).toBe("16000");
    expect(await read(c.userId)).toEqual([0, 0, 0, 0]);
  });

  it("insentif yang sudah ditarik kembali dikeluarkan dari hitungan", async () => {
    const d = await wallet({
      balance: 30000,
      cash: 30000,
      ledger: [
        ["INCENTIVE_BONUS", 50000, undefined, ["DRIVER_INCENTIVE", "claim-1"]],
        ["ADJUSTMENT", -50000, undefined, ["DRIVER_INCENTIVE_REVERSAL", "claim-1"]],
        ["INCENTIVE_BONUS", 10000, undefined, ["DRIVER_INCENTIVE", "claim-2"]],
      ],
    });
    const result = await runBonusLockMigration(prisma, { apply: true });
    // hanya claim-2 yang dihitung: 20% x 10.000 = 2.000
    expect(result.rows.find((r) => r.userId === d.userId)!.locked.toString()).toBe("2000");
    expect(await read(d.userId)).toEqual([30000, 28000, 2000, 0]);
  });

  it("bonus yang sudah dipecah aturan baru (bertanda lockedBonus) tidak dihitung lagi", async () => {
    const e = await wallet({ balance: 100000, cash: 80000, locked: 20000, ledger: [["SPONSOR_BONUS", 100000, { lockedBonus: "20000" }]] });
    const result = await runBonusLockMigration(prisma, { apply: true });
    expect(result.rows.find((r) => r.userId === e.userId)!.status).toBe("NOTHING_TO_DO");
    expect(await read(e.userId)).toEqual([100000, 80000, 20000, 0]);
    expect(await prisma.walletTransaction.count({ where: { walletId: e.walletId, referenceType: "BONUS_LOCK_MIGRATION" } })).toBe(0);
  });

  it("top up PPOB dan top up yang sudah tercatat sebagai deposit tidak menjadi deposit lagi", async () => {
    const f = await wallet({
      balance: 50000,
      cash: 0,
      deposit: 20000,
      ledger: [["TOPUP", 30000, { target: "PPOB" }], ["TOPUP", 20000, { target: "WALLET", deposit: "20000" }], ["TOPUP", 10000, { target: "WALLET" }]],
    });
    await runBonusLockMigration(prisma, { apply: true });
    // lain-lain = 50.000 - 0 - 0 - 20.000 = 30.000; top up lama = hanya 10.000 -> deposit tambahan 10.000
    expect(await read(f.userId)).toEqual([50000, 0, 0, 30000]);
  });

  it("diulang tidak menggandakan: dompet yang sudah dimigrasi dilewati dan saldo sama", async () => {
    const g = await wallet({ balance: 260000, cash: 200000, ledger: [["SPONSOR_BONUS", 100000], ["TOPUP", 60000, { target: "WALLET" }]] });
    await runBonusLockMigration(prisma, { apply: true });
    const afterFirst = await read(g.userId);
    const second = await runBonusLockMigration(prisma, { apply: true });
    expect(second.rows.find((r) => r.userId === g.userId)!.status).toBe("SKIPPED_ALREADY_MIGRATED");
    expect(await read(g.userId)).toEqual(afterFirst);
    expect(await prisma.walletTransaction.count({ where: { walletId: g.walletId, referenceType: "BONUS_LOCK_MIGRATION" } })).toBe(1);
  });

  it("invarian terjaga di semua dompet dan total saldo seluruh sistem tidak berubah", async () => {
    await wallet({ balance: 260000, cash: 200000, ledger: [["SPONSOR_BONUS", 100000], ["LEVEL_BONUS", 50000], ["TOPUP", 60000, { target: "WALLET" }]] });
    await wallet({ balance: 5000, cash: 5000, ledger: [["REWARD_BONUS", 100000]] });
    await wallet({ balance: 90000, cash: 10000, ledger: [["TOPUP", 70000, { target: "WALLET" }], ["LEVEL_BONUS", 12345]] });
    const total = async () => (await prisma.wallet.aggregate({ _sum: { balance: true } }))._sum.balance!.toString();
    const before = await total();
    await runBonusLockMigration(prisma, { apply: true });
    expect(await total()).toBe(before);
    for (const w of await prisma.wallet.findMany()) {
      expect(w.cashBalance.gte(0) && w.lockedBonusBalance.gte(0) && w.depositBalance.gte(0)).toBe(true);
      expect(w.cashBalance.plus(w.lockedBonusBalance).plus(w.depositBalance).lte(w.balance)).toBe(true);
    }
  });
});
