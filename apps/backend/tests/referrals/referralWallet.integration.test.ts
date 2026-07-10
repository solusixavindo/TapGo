import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  claim,
  createUser,
  decimalString,
  prisma,
  registerBasicUser,
  referralRepository,
  referralService,
  runIntegration,
  setupReferralWalletIntegration,
  walletService
} from "../helpers/referralWalletHarness.js";

describe.skipIf(!runIntegration)("TapGo referral and wallet integration", () => {
  setupReferralWalletIntegration();

  it("credits Basic registration bonus Rp5.000 for first 1.000 users", async () => {
    const user = await registerBasicUser("BASIC001");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    const transactions = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id } });

    expect(decimalString(wallet.balance)).toBe("0.00");
    expect(decimalString(wallet.cashBalance)).toBe("0.00");
    expect(decimalString(wallet.ppobBalance)).toBe("5000.00");
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.type).toBe("REGISTRATION_BONUS");
    expect(decimalString(transactions[0]!.amount)).toBe("5000.00");
  });

  it("does not credit Basic sponsor bonus during referral registration", async () => {
    const sponsor = await registerBasicUser("BASICSP");
    const user = await registerBasicUser("BASICRF");

    await claim(user.id, sponsor.referralCode, "basic:referral", "0.00");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sponsor.id } });
    const sponsorBonusCount = await prisma.commission.count({
      where: { beneficiaryId: sponsor.id, type: "BASIC_SPONSOR_BONUS" }
    });

    expect(sponsorBonusCount).toBe(0);
    expect(decimalString(wallet.cashBalance)).toBe("0.00");
    expect(decimalString(wallet.ppobBalance)).toBe("5000.00");
  });

  it("credits Basic register bonus to new users and stores referral genealogy without sponsor payout", async () => {
    const a = await registerBasicUser("BASICA");
    const b = await registerBasicUser("BASICB", a.referralCode);
    const c = await registerBasicUser("BASICC", a.referralCode);

    const walletA = await prisma.wallet.findUniqueOrThrow({ where: { userId: a.id } });
    const walletB = await prisma.wallet.findUniqueOrThrow({ where: { userId: b.id } });
    const walletC = await prisma.wallet.findUniqueOrThrow({ where: { userId: c.id } });
    const commissionsA = await prisma.commission.findMany({
      where: { beneficiaryId: a.id },
      orderBy: { createdAt: "asc" }
    });
    const commissionsB = await prisma.commission.findMany({ where: { beneficiaryId: b.id } });
    const downlinesA = await referralService.getDownlines(a.id, 10, 1, 100);

    expect(decimalString(walletA.cashBalance)).toBe("0.00");
    expect(decimalString(walletA.ppobBalance)).toBe("5000.00");
    expect(decimalString(walletB.cashBalance)).toBe("0.00");
    expect(decimalString(walletB.ppobBalance)).toBe("5000.00");
    expect(decimalString(walletC.cashBalance)).toBe("0.00");
    expect(decimalString(walletC.ppobBalance)).toBe("5000.00");
    expect(commissionsA).toHaveLength(0);
    expect(commissionsB).toHaveLength(0);
    expect(downlinesA.map((item) => item.userId).sort()).toEqual([b.id, c.id].sort());
  });

  it("claims a referral and writes recursive levels without payout", async () => {
    const sponsor = await createUser("SPONSOR1");
    const user = await createUser("NEWUSER1");

    await claim(user.id, sponsor.referralCode, "join:new-user-1", "500000.00");

    const referral = await prisma.referral.findUniqueOrThrow({ where: { userId: user.id } });
    const levels = await prisma.referralLevel.findMany({ where: { descendantId: user.id } });
    const commissions = await prisma.commission.findMany({ where: { sourceUserId: user.id }, orderBy: { type: "asc" } });
    const wallet = await prisma.wallet.findUnique({ where: { userId: sponsor.id } });

    expect(referral.sponsorId).toBe(sponsor.id);
    expect(levels).toHaveLength(1);
    expect(commissions).toHaveLength(0);
    expect(wallet).toBeNull();
  });

  it("prevents duplicate commission payout and keeps wallet balance unchanged", async () => {
    const sponsor = await createUser("DUPSPONS");
    const user = await createUser("DUPUSER1");
    const referral = await claim(user.id, sponsor.referralCode, "join:duplicate", "500000.00");
    const distribution = {
      beneficiaryId: sponsor.id,
      sourceUserId: user.id,
      referralId: referral.id,
      type: "SPONSOR_BONUS" as const,
      level: 1,
      amount: new Prisma.Decimal(10),
      triggerType: "REFERRAL_JOIN",
      triggerId: "join:duplicate",
      metadata: { reason: "duplicate-test" }
    };

    await referralRepository.transaction((tx) => referralRepository.creditCommission(distribution, tx));
    const before = await prisma.wallet.findUniqueOrThrow({ where: { userId: sponsor.id } });

    await expect(
      referralRepository.transaction((tx) => referralRepository.creditCommission(distribution, tx))
    ).rejects.toThrow();

    const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: sponsor.id } });
    const walletTransactionCount = await prisma.walletTransaction.count({ where: { walletId: after.id } });
    const commissionCount = await prisma.commission.count({ where: { beneficiaryId: sponsor.id } });

    expect(decimalString(after.balance)).toBe(decimalString(before.balance));
    expect(walletTransactionCount).toBe(1);
    expect(commissionCount).toBe(1);
  });

  it("rolls back wallet updates when a transaction fails", async () => {
    const sponsor = await createUser("ROLLSPON");
    const user = await createUser("ROLLUSER");
    const referral = await prisma.referral.create({
      data: { sponsorId: sponsor.id, userId: user.id }
    });

    await expect(
      referralRepository.transaction(async (tx) => {
        await referralRepository.creditCommission(
          {
            beneficiaryId: sponsor.id,
            sourceUserId: user.id,
            referralId: referral.id,
            type: "SPONSOR_BONUS",
            level: 1,
            amount: new Prisma.Decimal(999),
            triggerType: "ROLLBACK_TEST",
            triggerId: "rollback-1",
            metadata: { reason: "forced rollback" }
          },
          tx
        );

        throw new Error("force rollback");
      })
    ).rejects.toThrow("force rollback");

    const wallet = await prisma.wallet.findUnique({ where: { userId: sponsor.id } });
    expect(wallet).toBeNull();
    expect(await prisma.commission.count()).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(0);
  });

  it("blocks self referral", async () => {
    const user = await createUser("SELFREF1");

    await expect(claim(user.id, user.referralCode, "join:self")).rejects.toMatchObject({
      code: "SELF_REFERRAL_BLOCKED"
    });

    expect(await prisma.referral.count()).toBe(0);
  });

  it("blocks circular referral attempts", async () => {
    const a = await createUser("CIRCLEA1");
    const b = await createUser("CIRCLEB1");

    await claim(b.id, a.referralCode, "join:b");

    await expect(claim(a.id, b.referralCode, "join:a")).rejects.toMatchObject({
      code: "CIRCULAR_REFERRAL_BLOCKED"
    });
  });

  it("caps recursive referral levels at 10", async () => {
    const users = [];
    for (let index = 0; index < 12; index += 1) {
      users.push(await createUser(`CHAIN${index.toString().padStart(2, "0")}`));
    }

    for (let index = 1; index < users.length; index += 1) {
      await claim(users[index]!.id, users[index - 1]!.referralCode, `chain:${index}`, "10.00");
    }

    const levelsForLast = await prisma.referralLevel.findMany({
      where: { descendantId: users.at(-1)!.id },
      orderBy: { level: "asc" }
    });
    const downlines = await referralService.getDownlines(users[0]!.id, 10, 1, 100);

    expect(levelsForLast).toHaveLength(10);
    expect(levelsForLast.at(-1)?.level).toBe(10);
    expect(downlines).toHaveLength(10);
  });

  it("allows only one concurrent claim without referral-claim payout", async () => {
    const sponsor = await createUser("CONCSPON");
    const user = await createUser("CONCUSER");

    const results = await Promise.allSettled([
      claim(user.id, sponsor.referralCode, "join:concurrent", "500000.00"),
      claim(user.id, sponsor.referralCode, "join:concurrent", "500000.00")
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.referral.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.commission.count({ where: { sourceUserId: user.id } })).toBe(0);
    expect(await prisma.wallet.findUnique({ where: { userId: sponsor.id } })).toBeNull();
  });

  it("prevents negative wallet balance during concurrent withdrawal requests", async () => {
    const user = await createUser("WITHDRAW");
    await prisma.wallet.create({
      data: {
        userId: user.id,
        balance: new Prisma.Decimal(100000),
        cashBalance: new Prisma.Decimal(100000),
        ppobBalance: new Prisma.Decimal(0),
        currency: "IDR"
      }
    });

    const results = await Promise.allSettled([
      walletService.requestWithdrawal({
        userId: user.id,
        amount: new Prisma.Decimal(80000),
        bankName: "BCA",
        accountNumber: "1234567890",
        accountHolderName: "TapGo Test"
      }),
      walletService.requestWithdrawal({
        userId: user.id,
        amount: new Prisma.Decimal(60000),
        bankName: "BCA",
        accountNumber: "1234567890",
        accountHolderName: "TapGo Test"
      })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const fulfilled = results.find((result) => result.status === "fulfilled");
    if (fulfilled?.status !== "fulfilled") {
      throw new Error("Expected one withdrawal request to be fulfilled.");
    }

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    const withdrawals = await prisma.withdrawal.findMany({ where: { userId: user.id } });
    const expectedBalance = new Prisma.Decimal(100000).minus(fulfilled.value.amount);

    expect(decimalString(wallet.cashBalance)).toBe(decimalString(expectedBalance));
    expect(decimalString(wallet.balance)).toBe(decimalString(expectedBalance));
    expect(wallet.cashBalance.gte(0)).toBe(true);
    expect(withdrawals).toHaveLength(1);
  });

  it("refunds reserved withdrawal exactly once when rejected", async () => {
    const user = await createUser("REFUND01");
    const admin = await createUser("ADMIN001");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    await prisma.wallet.create({
      data: {
        userId: user.id,
        balance: new Prisma.Decimal(100000),
        cashBalance: new Prisma.Decimal(100000),
        ppobBalance: new Prisma.Decimal(0),
        currency: "IDR"
      }
    });

    const withdrawal = await walletService.requestWithdrawal({
      userId: user.id,
      amount: new Prisma.Decimal(60000),
      bankName: "BRI",
      accountNumber: "987654321",
      accountHolderName: "TapGo Test"
    });
    await walletService.rejectWithdrawal({ withdrawalId: withdrawal.id, adminId: admin.id, note: "test reject" });

    await expect(
      walletService.rejectWithdrawal({ withdrawalId: withdrawal.id, adminId: admin.id, note: "duplicate reject" })
    ).rejects.toThrow();

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    const transactions = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id } });

    expect(decimalString(wallet.cashBalance)).toBe("100000.00");
    expect(decimalString(wallet.balance)).toBe("100000.00");
    expect(transactions).toHaveLength(2);
  });

  it("does not credit reward during referral claim", async () => {
    const sponsor = await createUser("REWARDSP", "PLATINUM");

    for (let index = 0; index < 10; index += 1) {
      const user = await createUser(`RWDU${index.toString().padStart(4, "0")}`);
      await claim(user.id, sponsor.referralCode, `reward-direct:${index}`, "0.00");
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId: sponsor.id } });
    const commissions = await prisma.commission.findMany({
      where: {
        beneficiaryId: sponsor.id,
        type: "REWARD_BONUS",
        triggerType: "REWARD_MILESTONE",
        triggerId: "PLATINUM_10_DIRECT",
        level: 1
      }
    });

    expect(wallet).toBeNull();
    expect(commissions).toHaveLength(0);
  });
});
