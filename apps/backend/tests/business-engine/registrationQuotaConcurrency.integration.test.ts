import { User } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  decimalString,
  prisma,
  registerBasicUser,
  runIntegration,
  setRegistrationQuotaGranted,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";

const QUOTA_KEY = "BASIC_PPOB_FIRST_1000";

function fulfilledUsers(results: PromiseSettledResult<User>[]): User[] {
  return results
    .filter((r): r is PromiseFulfilledResult<User> => r.status === "fulfilled")
    .map((r) => r.value);
}

describe.skipIf(!runIntegration)("P1-4 Basic first-1000 registration quota concurrency", () => {
  setupReferralWalletIntegration();

  it("grants the last slot to exactly one of two racing registrations", async () => {
    // Sisa tepat 1 slot benefit.
    await setRegistrationQuotaGranted(999);

    const results = await Promise.allSettled([
      registerBasicUser("RACEA000001"),
      registerBasicUser("RACEB000002")
    ]);
    const users = fulfilledUsers(results);
    expect(users).toHaveLength(2);

    const wallets = await Promise.all(
      users.map((u) => prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } }))
    );
    const ppob = wallets.map((w) => decimalString(w.ppobBalance)).sort();
    // Tepat satu penerima Rp5.000, satu lagi Rp0 — tidak ada double credit.
    expect(ppob).toEqual(["0.00", "5000.00"]);

    const quota = await prisma.registrationQuota.findUniqueOrThrow({ where: { key: QUOTA_KEY } });
    expect(quota.granted).toBe(1000);
    expect(quota.granted).toBeLessThanOrEqual(quota.limit);

    const bonusCount = await prisma.walletTransaction.count({ where: { type: "REGISTRATION_BONUS" } });
    expect(bonusCount).toBe(1);
  });

  it("does not grant benefit once quota is full (user #1001)", async () => {
    await setRegistrationQuotaGranted(1000);

    const user = await registerBasicUser("RACEFULL0001");
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decimalString(wallet.ppobBalance)).toBe("0.00");

    const quota = await prisma.registrationQuota.findUniqueOrThrow({ where: { key: QUOTA_KEY } });
    expect(quota.granted).toBe(1000);
  });

  it("never exceeds the limit under many concurrent registrations at the boundary", async () => {
    // Sisa 5 slot, tetapi 20 registrasi berlomba bersamaan.
    await setRegistrationQuotaGranted(995);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => registerBasicUser(`RACEM${String(i).padStart(6, "0")}`))
    );
    const users = fulfilledUsers(results);
    expect(users).toHaveLength(20);

    const wallets = await Promise.all(
      users.map((u) => prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } }))
    );
    const grantedCount = wallets.filter((w) => decimalString(w.ppobBalance) === "5000.00").length;
    // Hanya 5 slot tersisa -> tepat 5 penerima, sisanya Rp0.
    expect(grantedCount).toBe(5);

    const quota = await prisma.registrationQuota.findUniqueOrThrow({ where: { key: QUOTA_KEY } });
    expect(quota.granted).toBe(1000);
    expect(quota.granted).toBeLessThanOrEqual(quota.limit);

    const bonusCount = await prisma.walletTransaction.count({ where: { type: "REGISTRATION_BONUS" } });
    expect(bonusCount).toBe(5);
  });
});
