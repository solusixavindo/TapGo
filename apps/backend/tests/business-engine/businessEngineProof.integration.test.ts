import { MembershipTier, Prisma, User } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import {
  registerBasicUser,
  prisma,
  runIntegration,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";

const service = new MembershipOrderService(prisma);
let proofUserSequence = 0;

describe.skipIf(!runIntegration)("Business engine proof scenarios", () => {
  setupReferralWalletIntegration();

  it("produces the expected sponsor and level payout matrix for A > ... > K purchases", async () => {
    const users: User[] = [];
    for (const label of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]) {
      users.push(await createProofUser(label));
    }

    for (const user of users.slice(0, 10)) {
      await activateUserPackage(user.id, "PLATINUM");
    }
    await createReferralGenealogy(users);

    const buyer = users[10]!;
    const silver = await payPackage(buyer, "SILVER", "proof-k-silver");
    const gold = await payPackage(buyer, "GOLD", "proof-k-gold");
    const platinum = await payPackage(buyer, "PLATINUM", "proof-k-platinum");

    const matrix = {
      silver: await payoutMatrix(silver.id),
      gold: await payoutMatrix(gold.id),
      platinum: await payoutMatrix(platinum.id)
    };
    const ledger = {
      silver: await walletLedgerMatrix(silver.id),
      gold: await walletLedgerMatrix(gold.id),
      platinum: await walletLedgerMatrix(platinum.id)
    };

    expect(matrix.silver).toEqual([
      row("J", "SPONSOR_BONUS", 1, "40000.00", "8.00"),
      row("J", "LEVEL_BONUS", 1, "40000.00", "8.00"),
      row("I", "LEVEL_BONUS", 2, "20000.00", "4.00"),
      row("H", "LEVEL_BONUS", 3, "10000.00", "2.00"),
      row("G", "LEVEL_BONUS", 4, "10000.00", "2.00"),
      row("F", "LEVEL_BONUS", 5, "10000.00", "2.00"),
      row("E", "LEVEL_BONUS", 6, "5000.00", "1.00"),
      row("D", "LEVEL_BONUS", 7, "5000.00", "1.00"),
      row("C", "LEVEL_BONUS", 8, "5000.00", "1.00"),
      row("B", "LEVEL_BONUS", 9, "5000.00", "1.00"),
      row("A", "LEVEL_BONUS", 10, "5000.00", "1.00")
    ]);

    expect(matrix.gold).toEqual([
      row("J", "SPONSOR_BONUS", 1, "240000.00", "8.00"),
      row("J", "LEVEL_BONUS", 1, "240000.00", "8.00"),
      row("I", "LEVEL_BONUS", 2, "120000.00", "4.00"),
      row("H", "LEVEL_BONUS", 3, "60000.00", "2.00"),
      row("G", "LEVEL_BONUS", 4, "60000.00", "2.00"),
      row("F", "LEVEL_BONUS", 5, "60000.00", "2.00"),
      row("E", "LEVEL_BONUS", 6, "30000.00", "1.00"),
      row("D", "LEVEL_BONUS", 7, "30000.00", "1.00"),
      row("C", "LEVEL_BONUS", 8, "30000.00", "1.00"),
      row("B", "LEVEL_BONUS", 9, "30000.00", "1.00"),
      row("A", "LEVEL_BONUS", 10, "30000.00", "1.00")
    ]);

    expect(matrix.platinum).toEqual([
      row("J", "SPONSOR_BONUS", 1, "440000.00", "8.00"),
      row("J", "LEVEL_BONUS", 1, "440000.00", "8.00"),
      row("I", "LEVEL_BONUS", 2, "220000.00", "4.00"),
      row("H", "LEVEL_BONUS", 3, "110000.00", "2.00"),
      row("G", "LEVEL_BONUS", 4, "110000.00", "2.00"),
      row("F", "LEVEL_BONUS", 5, "110000.00", "2.00"),
      row("E", "LEVEL_BONUS", 6, "55000.00", "1.00"),
      row("D", "LEVEL_BONUS", 7, "55000.00", "1.00"),
      row("C", "LEVEL_BONUS", 8, "55000.00", "1.00"),
      row("B", "LEVEL_BONUS", 9, "55000.00", "1.00"),
      row("A", "LEVEL_BONUS", 10, "55000.00", "1.00")
    ]);

    expect(await walletLedgerForOrder(silver.id)).toHaveLength(12);
    expect(await walletLedgerForOrder(gold.id)).toHaveLength(12);
    expect(await walletLedgerForOrder(platinum.id)).toHaveLength(12);

    console.log("BUSINESS_ENGINE_PROOF_REFERRAL_PAYOUT_MATRIX", JSON.stringify(matrix, null, 2));
    console.log("BUSINESS_ENGINE_PROOF_WALLET_LEDGER_MATRIX", JSON.stringify(ledger, null, 2));
  });

  it("validates tier level limits for Silver, Gold, and Platinum uplines", async () => {
    const buyerForSilver = await createProofUser("LIMIT-SILVER-BUYER");
    const silverUplines = await createUplines("LIMIT-SILVER", 4, "SILVER");
    await createUplineChain(buyerForSilver, silverUplines);
    const silverOrder = await payPackage(buyerForSilver, "SILVER", "proof-limit-silver");

    const buyerForGold = await createProofUser("LIMIT-GOLD-BUYER");
    const goldUplines = await createUplines("LIMIT-GOLD", 6, "GOLD");
    await createUplineChain(buyerForGold, goldUplines);
    const goldOrder = await payPackage(buyerForGold, "SILVER", "proof-limit-gold");

    const buyerForPlatinum = await createProofUser("LIMIT-PLATINUM-BUYER");
    const platinumUplines = await createUplines("LIMIT-PLATINUM", 10, "PLATINUM");
    await createUplineChain(buyerForPlatinum, platinumUplines);
    const platinumOrder = await payPackage(buyerForPlatinum, "SILVER", "proof-limit-platinum");

    const silverLevels = await levelNumbersForOrder(silverOrder.id);
    const goldLevels = await levelNumbersForOrder(goldOrder.id);
    const platinumLevels = await levelNumbersForOrder(platinumOrder.id);

    expect(silverLevels).toEqual([1, 2, 3]);
    expect(goldLevels).toEqual([1, 2, 3, 4, 5]);
    expect(platinumLevels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const matrix = [
      { tier: "SILVER", expected: "level 1-3", actual: silverLevels.join(",") },
      { tier: "GOLD", expected: "level 1-5", actual: goldLevels.join(",") },
      { tier: "PLATINUM", expected: "level 1-10", actual: platinumLevels.join(",") }
    ];

    console.log("BUSINESS_ENGINE_PROOF_LEVEL_LIMIT_MATRIX", JSON.stringify(matrix, null, 2));
  });

  it("validates Basic sponsor bonus only after paid membership upgrade", async () => {
    const sponsor = await registerBasicUser("PROOFBASICSPONSOR");
    const buyer = await registerBasicUser("PROOFBASICBUYER", sponsor.referralCode);

    expect(await prisma.commission.count({
      where: {
        beneficiaryId: sponsor.id,
        type: { in: ["BASIC_SPONSOR_BONUS", "SPONSOR_BONUS"] }
      }
    })).toBe(0);

    const order = await payPackage(buyer, "SILVER", "proof-basic-sponsor-silver");
    const basicSponsorBonus = await prisma.commission.findUniqueOrThrow({
      where: {
        beneficiaryId_triggerType_triggerId_type_level: {
          beneficiaryId: sponsor.id,
          triggerType: "MEMBERSHIP_ORDER",
          triggerId: order.id,
          type: "BASIC_SPONSOR_BONUS",
          level: 1
        }
      }
    });

    expect(basicSponsorBonus.amount.toFixed(2)).toBe("2000.00");
    expect(await prisma.commission.count({
      where: {
        beneficiaryId: sponsor.id,
        triggerType: "MEMBERSHIP_ORDER",
        triggerId: order.id,
        type: "SPONSOR_BONUS"
      }
    })).toBe(0);

    const matrix = [
      { case: "Basic sponsor mengajak user baru register", expected: "Rp0", actual: "Rp0" },
      { case: "User baru membeli Silver", expected: "BASIC_SPONSOR_BONUS Rp2.000", actual: `BASIC_SPONSOR_BONUS Rp${basicSponsorBonus.amount.toFixed(2)}` },
      { case: "Basic sponsor tidak menerima 8%", expected: "Tidak ada SPONSOR_BONUS", actual: "Tidak ada SPONSOR_BONUS" }
    ];

    console.log("BUSINESS_ENGINE_PROOF_BASIC_SPONSOR_MATRIX", JSON.stringify(matrix, null, 2));
  });

  it("validates idempotency and audits Basic registration bonus wallet placement", async () => {
    const sponsor = await createProofUser("IDEMP-SPONSOR");
    await activateUserPackage(sponsor.id, "PLATINUM");
    const buyer = await createProofUser("IDEMP-BUYER");
    await createDirectReferral(sponsor.id, buyer.id);

    const order = await createPendingOrder(buyer, "PLATINUM");
    await service.markPaymentSuccess({
      userId: buyer.id,
      role: "USER",
      orderId: order.id,
      paymentReference: "proof-idempotency-first"
    });
    await expect(service.markPaymentSuccess({
      userId: buyer.id,
      role: "USER",
      orderId: order.id,
      paymentReference: "proof-idempotency-second"
    })).rejects.toMatchObject({ code: "MEMBERSHIP_INVOICE_ALREADY_FINALIZED" });

    const orderLedgerCount = await prisma.walletTransaction.count({
      where: {
        referenceType: "MEMBERSHIP_ORDER",
        referenceId: order.id
      }
    });
    const orderCommissionCount = await prisma.commission.count({
      where: {
        triggerType: "MEMBERSHIP_ORDER",
        triggerId: order.id
      }
    });

    expect(orderLedgerCount).toBe(3);
    expect(orderCommissionCount).toBe(2);

    const basicUser = await registerBasicUser("PROOFPPOBAUDIT");
    const basicWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: basicUser.id },
      include: { ledger: true }
    });
    const registrationLedger = basicWallet.ledger.find((item) => item.type === "REGISTRATION_BONUS");

    expect(registrationLedger?.amount.toFixed(2)).toBe("5000.00");
    expect(basicWallet.balance.toFixed(2)).toBe("0.00");
    expect(basicWallet.cashBalance.toFixed(2)).toBe("0.00");
    expect(basicWallet.ppobBalance.toFixed(2)).toBe("5000.00");

    const matrix = {
      idempotency: [
        { case: "Same invoice processed twice", expected: "Second call rejected", actual: "MEMBERSHIP_INVOICE_ALREADY_FINALIZED" },
        { case: "Membership order ledger count", expected: "3", actual: String(orderLedgerCount) },
        { case: "Membership order commission count", expected: "2", actual: String(orderCommissionCount) }
      ],
      ppobVsWallet: [
        { case: "Basic registration bonus final rule", expected: "PPOB Rp5.000", actual: "PPOB balance Rp5.000, cash Rp0", status: "PASS" }
      ]
    };

    console.log("BUSINESS_ENGINE_PROOF_IDEMPOTENCY_AND_PPOB_MATRIX", JSON.stringify(matrix, null, 2));
  });

  it("validates auto upgrade thresholds and pending-membership exclusion", async () => {
    const silverSponsor = await createProofUser("AUTO-SILVER-SPONSOR");
    await activateUserPackage(silverSponsor.id, "SILVER");
    await addDirectSilverReferrals(silverSponsor.id, 4, "AUTO-GOLD-ACTIVE");
    const fifthSilver = await createProofUser("AUTO-GOLD-5TH");
    await createDirectReferral(silverSponsor.id, fifthSilver.id);
    await payPackage(fifthSilver, "SILVER", "proof-auto-gold");
    expect(await activeTier(silverSponsor.id)).toBe("GOLD");

    const goldSponsor = await createProofUser("AUTO-GOLD-SPONSOR");
    await activateUserPackage(goldSponsor.id, "GOLD");
    await addDirectSilverReferrals(goldSponsor.id, 9, "AUTO-PLATINUM-ACTIVE");
    const tenthSilver = await createProofUser("AUTO-PLATINUM-10TH");
    await createDirectReferral(goldSponsor.id, tenthSilver.id);
    await payPackage(tenthSilver, "SILVER", "proof-auto-platinum");
    expect(await activeTier(goldSponsor.id)).toBe("PLATINUM");

    const pendingSponsor = await createProofUser("AUTO-PENDING-SPONSOR");
    await activateUserPackage(pendingSponsor.id, "SILVER");
    await addDirectSilverReferrals(pendingSponsor.id, 4, "AUTO-PENDING-ACTIVE");
    const pendingSilver = await createProofUser("AUTO-PENDING-5TH");
    await createDirectReferral(pendingSponsor.id, pendingSilver.id);
    await createPendingOrder(pendingSilver, "SILVER");
    expect(await activeTier(pendingSponsor.id)).toBe("SILVER");

    const platinumSponsor = await createProofUser("AUTO-PLATINUM-SPONSOR");
    await activateUserPackage(platinumSponsor.id, "PLATINUM");
    await addDirectSilverReferrals(platinumSponsor.id, 20, "AUTO-PLATINUM-STAY");
    expect(await activeTier(platinumSponsor.id)).toBe("PLATINUM");

    const matrix = [
      { case: "Silver + 5 direct active Silver", expected: "GOLD", actual: await activeTier(silverSponsor.id) },
      { case: "Gold + 10 direct active Silver", expected: "PLATINUM", actual: await activeTier(goldSponsor.id) },
      { case: "Silver + 4 active Silver + 1 pending Silver", expected: "SILVER", actual: await activeTier(pendingSponsor.id) },
      { case: "Platinum + 20 direct active Silver", expected: "PLATINUM", actual: await activeTier(platinumSponsor.id) }
    ];

    console.log("BUSINESS_ENGINE_PROOF_AUTO_UPGRADE_MATRIX", JSON.stringify(matrix, null, 2));
  });

  it("rejects downgrade membership orders", async () => {
    const platinum = await createProofUser("DOWNGRADE-PLATINUM");
    await activateUserPackage(platinum.id, "PLATINUM");
    const gold = await createProofUser("DOWNGRADE-GOLD");
    await activateUserPackage(gold.id, "GOLD");

    await expect(createPendingOrder(platinum, "SILVER")).rejects.toMatchObject({ code: "MEMBERSHIP_DOWNGRADE_NOT_ALLOWED" });
    await expect(createPendingOrder(gold, "SILVER")).rejects.toMatchObject({ code: "MEMBERSHIP_DOWNGRADE_NOT_ALLOWED" });
    await expect(createPendingOrder(platinum, "GOLD")).rejects.toMatchObject({ code: "MEMBERSHIP_DOWNGRADE_NOT_ALLOWED" });

    const matrix = [
      { case: "Platinum membeli Silver", expected: "DITOLAK", actual: "DITOLAK" },
      { case: "Gold membeli Silver", expected: "DITOLAK", actual: "DITOLAK" },
      { case: "Platinum membeli Gold", expected: "DITOLAK", actual: "DITOLAK" }
    ];

    console.log("BUSINESS_ENGINE_PROOF_DOWNGRADE_MATRIX", JSON.stringify(matrix, null, 2));
  });
});

function row(user: string, type: "SPONSOR_BONUS" | "LEVEL_BONUS", level: number, amount: string, rate: string) {
  return { user, type, level, amount, rate };
}

async function createProofUser(label: string) {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  proofUserSequence += 1;
  const code = `${label.replaceAll("-", "").slice(0, 14).toUpperCase()}${proofUserSequence.toString().padStart(4, "0")}`;

  return prisma.user.create({
    data: {
      fullName: label,
      phone: `+629${Math.random().toString().slice(2, 13)}`,
      referralCode: code,
      role: "USER",
      membershipId: basic.id,
      wallet: {
        create: {
          balance: new Prisma.Decimal(0),
          currency: "IDR"
        }
      }
    }
  });
}

async function activateUserPackage(userId: string, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  await prisma.userMembership.updateMany({
    where: { userId, status: "ACTIVE" },
    data: {
      status: "EXPIRED",
      expiresAt: new Date()
    }
  });
  await prisma.userMembership.create({
    data: {
      userId,
      membershipId: membership.id,
      status: "ACTIVE",
      activeAt: new Date()
    }
  });
  await prisma.user.update({
    where: { id: userId },
    data: { membershipId: membership.id }
  });
}

async function createReferralGenealogy(users: User[]) {
  for (let descendantIndex = 1; descendantIndex < users.length; descendantIndex += 1) {
    await prisma.referral.create({
      data: {
        sponsorId: users[descendantIndex - 1]!.id,
        userId: users[descendantIndex]!.id
      }
    });

    await prisma.referralLevel.createMany({
      data: Array.from({ length: descendantIndex }, (_, ancestorIndex) => ({
        ancestorId: users[ancestorIndex]!.id,
        descendantId: users[descendantIndex]!.id,
        level: descendantIndex - ancestorIndex
      }))
    });
  }
}

async function createUplineChain(buyer: User, uplinesByLevel: User[]) {
  if (uplinesByLevel.length === 0) {
    return;
  }

  await createDirectReferral(uplinesByLevel[0]!.id, buyer.id);

  for (let index = 1; index < uplinesByLevel.length; index += 1) {
    await prisma.referral.create({
      data: {
        sponsorId: uplinesByLevel[index]!.id,
        userId: uplinesByLevel[index - 1]!.id
      }
    });

    await prisma.referralLevel.create({
      data: {
        ancestorId: uplinesByLevel[index]!.id,
        descendantId: buyer.id,
        level: index + 1
      }
    });
  }
}

async function createDirectReferral(sponsorId: string, userId: string) {
  await prisma.referral.create({
    data: {
      sponsorId,
      userId
    }
  });
  await prisma.referralLevel.create({
    data: {
      ancestorId: sponsorId,
      descendantId: userId,
      level: 1
    }
  });
}

async function createUplines(prefix: string, count: number, tier: MembershipTier) {
  const users: User[] = [];

  for (let index = 1; index <= count; index += 1) {
    const user = await createProofUser(`${prefix}-${index}`);
    await activateUserPackage(user.id, tier);
    users.push(user);
  }

  return users;
}

async function addDirectSilverReferrals(sponsorId: string, count: number, prefix: string) {
  for (let index = 1; index <= count; index += 1) {
    const user = await createProofUser(`${prefix}-${index}`);
    await activateUserPackage(user.id, "SILVER");
    await createDirectReferral(sponsorId, user.id);
  }
}

async function createPendingOrder(user: User, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  return service.createOrder({
    userId: user.id,
    packageId: membership.id
  });
}

async function payPackage(user: User, tier: MembershipTier, paymentReference: string) {
  const order = await createPendingOrder(user, tier);
  await service.markPaymentSuccess({
    userId: user.id,
    role: "USER",
    orderId: order.id,
    paymentReference
  });
  return order;
}

async function payoutMatrix(orderId: string) {
  const commissions = await prisma.commission.findMany({
    where: {
      triggerType: "MEMBERSHIP_ORDER",
      triggerId: orderId,
      type: { in: ["SPONSOR_BONUS", "LEVEL_BONUS"] }
    },
    include: {
      beneficiary: {
        select: {
          fullName: true
        }
      }
    }
  });

  return commissions
    .map((commission) => ({
      user: commission.beneficiary.fullName,
      type: commission.type as "SPONSOR_BONUS" | "LEVEL_BONUS",
      level: commission.level ?? 0,
      amount: commission.amount.toFixed(2),
      rate: commission.rate?.toFixed(2) ?? "8.00"
    }))
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "SPONSOR_BONUS" ? -1 : 1;
      }
      return left.level - right.level;
    });
}

async function walletLedgerMatrix(orderId: string) {
  const transactions = await prisma.walletTransaction.findMany({
    where: {
      referenceType: "MEMBERSHIP_ORDER",
      referenceId: orderId
    },
    include: {
      wallet: {
        include: {
          user: {
            select: {
              fullName: true
            }
          }
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  return transactions.map((transaction) => ({
    transactionId: transaction.id,
    user: transaction.wallet.user.fullName,
    type: transaction.type,
    amount: transaction.amount.toFixed(2),
    timestamp: transaction.createdAt.toISOString()
  }));
}

async function walletLedgerForOrder(orderId: string) {
  return prisma.walletTransaction.findMany({
    where: {
      referenceType: "MEMBERSHIP_ORDER",
      referenceId: orderId
    }
  });
}

async function levelNumbersForOrder(orderId: string) {
  const commissions = await prisma.commission.findMany({
    where: {
      triggerType: "MEMBERSHIP_ORDER",
      triggerId: orderId,
      type: "LEVEL_BONUS"
    },
    orderBy: { level: "asc" }
  });

  return commissions.map((commission) => commission.level ?? 0);
}

async function activeTier(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { membership: true }
  });

  return user.membership?.tier ?? "BASIC";
}
