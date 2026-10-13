import { MembershipTier, Prisma, User, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Upgrade member harus muncul di pendapatan DAN di pengeluaran laporan laba rugi.
 * Skenario nyata: pembeli punya Silver, sponsornya Gold; pembeli upgrade ke Gold (Rp3.000.000, harga penuh).
 * Pendapatan naik Rp3.000.000; pengeluaran naik HPP Gold, bonus sponsor 8%, bonus tingkat 1 (8%), dan pajak 11%.
 */
type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;
let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let seq = 0;

describe.skipIf(!runIntegration)("Laba rugi: upgrade member memengaruhi pendapatan dan pengeluaran", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.PL_SERVER_COST_MONTHLY = "0";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-pl-upgrade-0000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-pl-upgrade-000000";
    process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = "true";
    process.env.MEMBERSHIP_PURCHASE_APP_ENABLED = "true";
    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    backendEnv = envModule.env;
    backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = true;
    backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED = true;
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    // HPP final per paket (keputusan 19 Sep 2026).
    for (const [tier, hpp] of [["SILVER", 190_000], ["GOLD", 1_230_000], ["PLATINUM", 1_870_000]] as const) {
      await prisma.membership.update({ where: { tier }, data: { hppTotal: new Prisma.Decimal(hpp) } });
    }
  });

  afterAll(async () => {
    delete process.env.PL_SERVER_COST_MONTHLY;
    backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = false;
    backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED = false;
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("pembelian Silver lalu upgrade ke Gold: setiap transaksi menambah pendapatan dan pengeluaran yang sesuai", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const sponsor = await createUser("USER");
    const buyer = await createUser("USER");
    await activatePackage(sponsor.id, "GOLD");
    await prisma.referral.create({ data: { sponsorId: sponsor.id, userId: buyer.id } });
    await prisma.referralLevel.create({ data: { ancestorId: sponsor.id, descendantId: buyer.id, level: 1 } });

    const empty = await report(vip);
    expect(empty.revenue.total).toBe("0.00");

    await buy(buyer, "SILVER");
    const afterSilver = await report(vip);
    // Silver Rp500.000: pendapatan; HPP 190.000; bonus sponsor 8% = 40.000; pajak 11% = 55.000.
    expect(afterSilver.revenue.membershipNet).toBe("500000.00");
    expect(afterSilver.expenses.hppPackages).toBe("190000.00");
    expect(afterSilver.expenses.sponsorBonus).toBe("40000.00");
    expect(afterSilver.expenses.levelBonus).toBe("40000.00");
    expect(afterSilver.expenses.tax).toBe("55000.00");

    await buy(buyer, "GOLD");
    const afterGold = await report(vip);
    // Upgrade ke Gold membayar harga penuh Rp3.000.000.
    expect(afterGold.revenue.membershipNet).toBe("3500000.00");
    expect(afterGold.revenue.total).toBe("3500000.00");
    // Pengeluaran bertambah: HPP Gold 1.230.000, bonus sponsor 8% (240.000), bonus tingkat 1 8% (240.000), pajak 11% (330.000).
    expect(afterGold.expenses.hppPackages).toBe("1420000.00");
    expect(afterGold.expenses.sponsorBonus).toBe("280000.00");
    expect(afterGold.expenses.levelBonus).toBe("280000.00");
    expect(afterGold.expenses.tax).toBe("385000.00");
    const added = 1_230_000 + 240_000 + 240_000 + 330_000;
    expect(Number(afterGold.expenses.total) - Number(afterSilver.expenses.total)).toBe(added);
    expect(Number(afterGold.operatingProfit) - Number(afterSilver.operatingProfit)).toBe(3_000_000 - added);
  });

  it("upgrade yang membuat sponsor mencapai milestone reward menambah pengeluaran saat tercapai, walau belum dibayar", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const sponsor = await createUser("USER");
    await activatePackage(sponsor.id, "GOLD");
    // 9 anggota Silver langsung yang sudah aktif; yang ke-10 membeli Silver lewat API.
    for (let i = 0; i < 9; i += 1) {
      const member = await createUser("USER");
      await prisma.referral.create({ data: { sponsorId: sponsor.id, userId: member.id } });
      await prisma.referralLevel.create({ data: { ancestorId: sponsor.id, descendantId: member.id, level: 1 } });
      await activatePackage(member.id, "SILVER");
    }
    const tenth = await createUser("USER");
    await prisma.referral.create({ data: { sponsorId: sponsor.id, userId: tenth.id } });
    await prisma.referralLevel.create({ data: { ancestorId: sponsor.id, descendantId: tenth.id, level: 1 } });

    await buy(tenth, "SILVER");

    const reward = await prisma.rewardTransaction.findFirstOrThrow({ where: { userId: sponsor.id } });
    expect(reward.status).toBe("PENDING");
    expect(reward.amount.toFixed(2)).toBe("500000.00");

    const data = await report(vip);
    expect(data.expenses.rewardAccrued).toBe("500000.00");
    expect(data.expenses.rewardPaid).toBe("0.00");
    // Ditolak tidak dihitung; dibayar tetap dihitung sekali.
    await prisma.rewardTransaction.update({ where: { id: reward.id }, data: { status: "REJECTED" } });
    expect((await report(vip)).expenses.rewardAccrued).toBe("0.00");
    await prisma.rewardTransaction.update({ where: { id: reward.id }, data: { status: "PAID", paidAt: new Date() } });
    const paid = await report(vip);
    expect(paid.expenses.rewardAccrued).toBe("500000.00");
    expect(paid.expenses.rewardPaid).toBe("500000.00");
  });
});

async function buy(user: User, tier: MembershipTier) {
  const pkg = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  const created = await api("/api/v1/membership/orders", { method: "POST", token: tokenFor(user), body: { packageId: pkg.id } });
  expect(created.status).toBe(201);
  const order = ((await created.json()) as { data: { id: string } }).data;
  const paid = await api(`/api/v1/membership/orders/${order.id}/payment-success`, {
    method: "POST",
    token: tokenFor(user),
    body: { paymentReference: `pay-${tier}-${seq}` }
  });
  expect(paid.status).toBe(200);
}

async function report(vip: User) {
  const response = await api("/api/v1/admin/reports/profit-loss", { token: tokenFor(vip) });
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: any }).data;
}

async function activatePackage(userId: string, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  await prisma.userMembership.create({ data: { userId, membershipId: membership.id, status: "ACTIVE", activeAt: new Date() } });
  await prisma.user.update({ where: { id: userId }, data: { membershipId: membership.id } });
}

async function createUser(role: UserRole): Promise<User> {
  seq += 1;
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: { fullName: `Up ${seq}`, phone: `+628${String(seq).padStart(9, "0")}`, referralCode: `UPG${String(seq).padStart(6, "0")}`, role, membershipId: basic.id }
  });
}

function tokenFor(user: User) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: randomUUID() });
}

function api(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
}
