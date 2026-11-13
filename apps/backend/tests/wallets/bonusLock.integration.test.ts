import { MembershipTier, Prisma, User } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import { prisma, registerBasicUser, runIntegration, setupReferralWalletIntegration } from "../helpers/referralWalletHarness.js";

/**
 * Kunci 20% bonus membership (Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir 4), jalur sponsor dan level.
 * Rantai: PLATINUM <- GOLD <- SILVER <- PLATINUM <- SILVER, masing-masing mendaftar dengan sponsor sebelumnya
 * lalu membayar paketnya, sehingga bonus sponsor dan bonus level mengalir ke atas.
 */
const membership = new MembershipOrderService(prisma);
let seq = 0;

async function pay(user: User, tier: MembershipTier) {
  seq += 1;
  const pkg = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  const order = await membership.createOrder({ userId: user.id, packageId: pkg.id });
  await membership.markPaymentSuccess({ userId: user.id, role: "USER", orderId: order.id, paymentReference: `lock-${seq}` });
}

async function buildChain() {
  const tiers: MembershipTier[] = ["PLATINUM", "GOLD", "SILVER", "PLATINUM", "SILVER"];
  let sponsorCode: string | undefined;
  for (let i = 0; i < tiers.length; i += 1) {
    const user = await registerBasicUser(`LCK${i + 1}`, sponsorCode);
    await pay(user, tiers[i]!);
    sponsorCode = user.referralCode;
  }
}

const BONUS_TYPES = ["SPONSOR_BONUS", "BASIC_SPONSOR_BONUS", "LEVEL_BONUS"] as const;

async function snapshot() {
  const wallets = await prisma.wallet.findMany();
  const rows: Array<{
    balance: number;
    cash: number;
    locked: number;
    deposit: number;
    ledgerTotal: number;
    expectedLocked: number;
    markerLocked: number;
  }> = [];
  for (const wallet of wallets) {
    const ledger = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id, type: { in: [...BONUS_TYPES] } },
    });
    const ledgerTotal = ledger.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
    // Pembagian yang diharapkan DIHITUNG ULANG dari tiap baris buku besar (bukan dari total): 20% dibulatkan ke
    // bawah per bonus, sehingga pembulatan per baris ikut diuji.
    const expectedLocked = ledger.reduce(
      (sum, row) => sum.plus(row.amount.times(20).div(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN)),
      new Prisma.Decimal(0),
    );
    const markerLocked = ledger.reduce(
      (sum, row) => sum.plus(new Prisma.Decimal(String((row.metadata as { lockedBonus?: string } | null)?.lockedBonus ?? "0"))),
      new Prisma.Decimal(0),
    );
    rows.push({
      balance: Number(wallet.balance),
      cash: Number(wallet.cashBalance),
      locked: Number(wallet.lockedBonusBalance),
      deposit: Number(wallet.depositBalance),
      ledgerTotal: Number(ledgerTotal),
      expectedLocked: Number(expectedLocked),
      markerLocked: Number(markerLocked),
    });
  }
  return rows;
}

describe.skipIf(!runIntegration)("Kunci 20% bonus: sponsor dan level", () => {
  setupReferralWalletIntegration();

  it("MENYALA: tiap bonus terpecah 80/20, kolom dan buku besar cocok, invarian terjaga", async () => {
    env.BONUS_LOCK_ENABLED = true;
    try {
      await buildChain();
      const rows = await snapshot();
      const earners = rows.filter((r) => r.ledgerTotal > 0);
      expect(earners.length).toBeGreaterThanOrEqual(3);
      for (const r of rows) {
        // Bonus sponsor/level adalah satu-satunya sumber saldo di skenario ini.
        expect(r.balance).toBe(r.ledgerTotal);
        expect(r.locked).toBe(r.expectedLocked);
        expect(r.markerLocked).toBe(r.expectedLocked);
        expect(r.cash).toBe(r.balance - r.locked);
        expect(r.deposit).toBe(0);
        expect(r.cash + r.locked + r.deposit).toBeLessThanOrEqual(r.balance);
        expect(r.locked).toBeLessThanOrEqual(r.balance * 0.2 + 1e-9);
      }
      expect(earners.some((r) => r.locked > 0)).toBe(true);
      // Total yang dikunci = 20% dari total bonus (dibulatkan ke bawah per baris).
      const totalBonus = earners.reduce((s, r) => s + r.ledgerTotal, 0);
      const totalLocked = earners.reduce((s, r) => s + r.locked, 0);
      expect(totalLocked).toBeGreaterThan(0);
      expect(totalLocked).toBeLessThanOrEqual(totalBonus * 0.2 + 1e-9);
    } finally {
      env.BONUS_LOCK_ENABLED = false;
    }
  });

  it("MATI: seluruh bonus dapat ditarik, tanpa kunci dan tanpa penanda (perilaku lama)", async () => {
    env.BONUS_LOCK_ENABLED = false;
    await buildChain();
    const rows = await snapshot();
    expect(rows.filter((r) => r.ledgerTotal > 0).length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect(r.locked).toBe(0);
      expect(r.markerLocked).toBe(0);
      expect(r.cash).toBe(r.balance);
      expect(r.balance).toBe(r.ledgerTotal);
    }
  });

  it("persen berbeda mengikuti BONUS_LOCK_PERCENT (mis. 50%)", async () => {
    env.BONUS_LOCK_ENABLED = true;
    env.BONUS_LOCK_PERCENT = 50;
    try {
      await buildChain();
      const rows = (await snapshot()).filter((r) => r.ledgerTotal > 0);
      for (const r of rows) {
        expect(r.cash + r.locked).toBe(r.balance);
        expect(r.locked).toBeGreaterThanOrEqual(Math.floor(r.balance * 0.5) - rows.length * 1);
        expect(r.locked).toBeLessThanOrEqual(r.balance * 0.5 + 1e-9);
      }
      expect(rows.some((r) => r.locked > 0)).toBe(true);
    } finally {
      env.BONUS_LOCK_ENABLED = false;
      env.BONUS_LOCK_PERCENT = 20;
    }
  });
});
