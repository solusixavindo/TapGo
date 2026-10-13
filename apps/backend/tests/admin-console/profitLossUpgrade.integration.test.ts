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
    // Uji ini mengukur logika pembukuan, bukan perlakuan pajak: tanpa PPN, pajak penghasilan 11% dari pendapatan.
    process.env.PL_PPN_MODE = "NONE";
    process.env.PL_INCOME_TAX_MODE = "FINAL_OMZET";
    process.env.PL_FINAL_TAX_RATE_PERCENT = "11";
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
    delete process.env.PL_PPN_MODE;
    delete process.env.PL_INCOME_TAX_MODE;
    delete process.env.PL_FINAL_TAX_RATE_PERCENT;
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
    // Silver Rp500.000: saldo PPOB 100.000 ditangguhkan => pendapatan diakui 400.000; HPP 190.000 - saldo PPOB 100.000 = 90.000;
    // bonus sponsor 8% = 40.000; bonus tingkat 1 = 40.000; pajak (uji ini 11%) x 400.000 = 44.000.
    expect(afterSilver.revenue.membershipNet).toBe("500000.00");
    expect(afterSilver.revenue.membershipRecognized).toBe("400000.00");
    expect(afterSilver.cogs.hppPackages).toBe("90000.00");
    expect(afterSilver.opex.sponsorBonus).toBe("40000.00");
    expect(afterSilver.opex.levelBonus).toBe("40000.00");
    expect(afterSilver.incomeTax.amount).toBe("44000.00");

    await buy(buyer, "GOLD");
    const afterGold = await report(vip);
    // Upgrade ke Gold membayar harga penuh Rp3.000.000; saldo PPOB Gold 600.000 ditangguhkan => diakui 2.400.000.
    expect(afterGold.revenue.membershipNet).toBe("3500000.00");
    expect(afterGold.revenue.membershipRecognized).toBe("2800000.00");
    expect(afterGold.revenue.total).toBe("2800000.00");
    // Pengeluaran bertambah: HPP Gold 1.230.000 - saldo PPOB 600.000 = 630.000, bonus sponsor 8% (240.000),
    // bonus tingkat 1 8% (240.000), pajak (uji ini 11%) x 2.400.000 = 264.000.
    expect(afterGold.cogs.hppPackages).toBe("720000.00");
    expect(afterGold.opex.sponsorBonus).toBe("280000.00");
    expect(afterGold.opex.levelBonus).toBe("280000.00");
    expect(afterGold.incomeTax.amount).toBe("308000.00");
    const added = 630_000 + 240_000 + 240_000 + 264_000;
    expect(Number(afterGold.totalExpenses) - Number(afterSilver.totalExpenses)).toBe(added);
    expect(Number(afterGold.netProfit) - Number(afterSilver.netProfit)).toBe(2_400_000 - added);
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
    expect(data.opex.rewardAccrued).toBe("500000.00");
    expect(data.opex.rewardPaid).toBe("0.00");
    // Ditolak tidak dihitung; dibayar tetap dihitung sekali.
    await prisma.rewardTransaction.update({ where: { id: reward.id }, data: { status: "REJECTED" } });
    expect((await report(vip)).opex.rewardAccrued).toBe("0.00");
    await prisma.rewardTransaction.update({ where: { id: reward.id }, data: { status: "PAID", paidAt: new Date() } });
    const paid = await report(vip);
    expect(paid.opex.rewardAccrued).toBe("500000.00");
    expect(paid.opex.rewardPaid).toBe("500000.00");
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
