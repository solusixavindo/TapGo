import { MembershipTier, Prisma, User } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import { WalletService } from "../../src/modules/wallets/application/WalletService.js";
import { PrismaWalletRepository } from "../../src/modules/wallets/infrastructure/PrismaWalletRepository.js";
import {
  prisma,
  registerBasicUser,
  runIntegration,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";

/**
 * Uji acuan (golden) mesin bisnis. Satu skenario keuangan deterministik —
 * rantai sponsor 8 tingkat, cabang, upgrade berulang, dan transfer P2P —
 * dijalankan lewat layanan sungguhan, lalu SELURUH hasilnya (komisi, bonus
 * level, reward, dompet, mutasi, keanggotaan, pesanan, pembayaran) dibandingkan
 * dengan berkas acuan.
 *
 * Dibuat saat Program Founder dihapus (2026-09-25) dan terbukti identik
 * byte-demi-byte dengan hasil kode sebelum penghapusan. Bila sebuah perubahan
 * SENGAJA mengubah aturan bisnis, perbarui acuan dengan:
 *   UPDATE_GOLDEN=1 npx vitest run tests/business-engine/businessEngineGolden.integration.test.ts
 * dan tinjau selisihnya di git diff sebelum commit.
 */
const GOLDEN = fileURLToPath(new URL("./golden/business-engine-scenario.json", import.meta.url));
const membership = new MembershipOrderService(prisma);
const wallets = new WalletService(new PrismaWalletRepository(prisma));
let seq = 0;

async function reg(code: string, sponsor?: string): Promise<User> {
  return registerBasicUser(code, sponsor);
}
async function pay(user: User, tier: MembershipTier) {
  seq += 1;
  const pkg = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  const order = await membership.createOrder({ userId: user.id, packageId: pkg.id });
  await membership.markPaymentSuccess({ userId: user.id, role: "USER", orderId: order.id, paymentReference: `diff-${seq}` });
}

describe.skipIf(!runIntegration)("Mesin bisnis: skenario acuan (golden)", () => {
  setupReferralWalletIntegration();

  it("seluruh hasil keuangan sama persis dengan acuan", async () => {
    // Rantai sponsor 8 tingkat dengan paket berbeda-beda, termasuk upgrade berulang.
    const chain: User[] = [];
    let sponsorCode: string | undefined;
    const tiers: MembershipTier[] = ["PLATINUM", "GOLD", "SILVER", "PLATINUM", "SILVER", "GOLD", "SILVER", "PLATINUM"];
    for (let i = 0; i < tiers.length; i += 1) {
      const u = await reg(`DIFF${i + 1}`, sponsorCode);
      await pay(u, tiers[i]!);
      chain.push(u);
      sponsorCode = u.referralCode;
    }
    // Cabang: beberapa Basic dan Silver di bawah simpul berbeda.
    for (let i = 0; i < 4; i += 1) {
      const branch = await reg(`BR${i + 1}`, chain[i]!.referralCode);
      if (i % 2 === 0) await pay(branch, "SILVER");
      const leaf = await reg(`LF${i + 1}`, branch.referralCode);
      if (i === 1) await pay(leaf, "GOLD");
    }
    // Upgrade berulang.
    await pay(chain[2]!, "GOLD");
    await pay(chain[2]!, "PLATINUM");
    // Transfer P2P.
    await prisma.wallet.updateMany({ where: { userId: chain[0]!.id }, data: { cashBalance: { increment: new Prisma.Decimal(500000) }, balance: { increment: new Prisma.Decimal(500000) } } });
    await wallets.transfer({ fromUserId: chain[0]!.id, recipientPhone: chain[1]!.phone, amount: new Prisma.Decimal(123000), idempotencyKey: "diff-transfer-1" });

    // ---- Snapshot ternormalisasi ----
    const users = await prisma.user.findMany({ select: { id: true, referralCode: true } });
    const label = new Map<string, string>(users.map((u) => [u.id, `U:${u.referralCode}`]));
    const orders = await prisma.membershipOrder.findMany({ include: { user: { select: { referralCode: true } }, membership: { select: { tier: true } } } });
    orders.forEach((o) => label.set(o.id, `ORDER:${o.user.referralCode}:${o.membership.tier}:${o.totalAmount.toFixed(2)}`));
    const wl = await prisma.wallet.findMany();
    wl.forEach((w) => label.set(w.id, `W:${label.get(w.userId)}`));

    const norm = (value: unknown): unknown => {
      if (value instanceof Prisma.Decimal) return value.toFixed(2);
      if (value instanceof Date) return "<date>";
      if (Array.isArray(value)) return value.map(norm);
      if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (k === "id" || /At$/.test(k) || k === "reference" || k === "providerReference" || k === "number") continue;
          out[k] = norm(v);
        }
        return out;
      }
      if (typeof value === "string") {
        if (label.has(value)) return label.get(value);
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return "<uuid>";
        if (/^(INV|TGM|WTX|TXN|TRF|RID|WTU)-/i.test(value)) return "<kode-acak>";
      }
      return value;
    };
    const sorted = (rows: unknown[]) => rows.map(norm).map((r) => JSON.stringify(r)).sort();

    const dump = {
      commissions: sorted(await prisma.commission.findMany()),
      rewards: sorted(await prisma.rewardTransaction.findMany()),
      wallets: sorted(await prisma.wallet.findMany()),
      walletTransactions: sorted(await prisma.walletTransaction.findMany()),
      userMemberships: sorted(await prisma.userMembership.findMany({ select: { userId: true, membershipId: true, status: true } })),
      referralLevels: sorted(await prisma.referralLevel.findMany()),
      orders: sorted(orders.map((o) => ({ u: o.user.referralCode, tier: o.membership.tier, status: o.status, total: o.totalAmount, channel: o.channel }))),
      payments: sorted(await prisma.membershipPayment.findMany({ select: { amount: true, status: true, method: true } })),
      profitSharing: sorted(await prisma.profitSharingDistribution.findMany())
    };
    const actual = JSON.stringify(dump, null, 1);
    if (process.env.UPDATE_GOLDEN === "1") {
      writeFileSync(GOLDEN, actual);
      return;
    }
    expect(actual === readFileSync(GOLDEN, "utf8")).toBe(true);
  }, 120000);
});
