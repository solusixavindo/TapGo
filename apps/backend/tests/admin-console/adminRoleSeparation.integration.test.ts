import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  testDatabaseUrl
} from "../helpers/referralWalletHarness.js";

/**
 * Pemisahan peran konsol admin:
 *  - ADMIN memverifikasi dan membantu, tidak pernah memindahkan uang, dan
 *    hanya melihat nomor HP/rekening yang disamarkan.
 *  - SUPER_ADMIN memegang persetujuan uang.
 *  - Penarikan >= ambang hanya boleh disetujui SUPER_ADMIN_VIP.
 */

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let seq = 0;

describe.skipIf(!runIntegration)("Admin role separation", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-admin-role-separation";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-admin-role-separation";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("ADMIN tidak dapat menyetujui atau menolak penarikan dana", async () => {
    const admin = await createUser("ADMIN");
    const withdrawal = await createWithdrawal(500_000);

    for (const path of [
      `/api/v1/admin/withdrawals/${withdrawal.id}/approve`,
      `/api/v1/admin/withdrawals/${withdrawal.id}/reject`,
      `/api/v1/admin/withdraw-requests/${withdrawal.id}/approve`,
      `/api/v1/wallet/admin/withdrawals/${withdrawal.id}/approve`,
      `/api/v1/wallet/admin/withdrawals/${withdrawal.id}/reject`
    ]) {
      const response = await call(admin, path, "POST", {});
      expect(response.status, path).toBe(403);
    }
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } })).status).toBe("PENDING");
  });

  it("ADMIN tidak dapat melihat data keuangan, log audit, atau mengonfirmasi pembayaran membership", async () => {
    const admin = await createUser("ADMIN");
    for (const path of [
      "/api/v1/admin/withdrawals",
      "/api/v1/admin/wallets",
      "/api/v1/admin/payments",
      "/api/v1/admin/rewards",
      "/api/v1/admin/commissions",
      "/api/v1/admin/audit-logs",
      "/api/v1/admin/reports/wallet-liability"
    ]) {
      expect((await call(admin, path)).status, path).toBe(403);
    }
    expect((await call(admin, "/api/v1/admin/member-requests/00000000-0000-4000-8000-000000000000/approve", "POST", {})).status).toBe(403);
  });

  it("SUPER_ADMIN dapat menyetujui penarikan di bawah ambang dan tindakannya tercatat di audit", async () => {
    const superAdmin = await createUser("SUPER_ADMIN");
    const withdrawal = await createWithdrawal(1_500_000);

    const response = await call(superAdmin, `/api/v1/admin/withdrawals/${withdrawal.id}/approve`, "POST", {});
    expect(response.status).toBe(200);
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } })).status).toBe("APPROVED");
    expect(await prisma.auditLog.count({ where: { action: "WITHDRAWAL_APPROVED", actorId: superAdmin.id } })).toBe(1);
  });

  it("penarikan Rp2.000.000 ke atas hanya dapat disetujui SUPER_ADMIN_VIP", async () => {
    const superAdmin = await createUser("SUPER_ADMIN");
    const vip = await createUser("SUPER_ADMIN_VIP");
    const withdrawal = await createWithdrawal(2_000_000);

    const denied = await call(superAdmin, `/api/v1/admin/withdrawals/${withdrawal.id}/approve`, "POST", {});
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { code?: string }).code).toBe("WITHDRAWAL_VIP_REQUIRED");
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } })).status).toBe("PENDING");

    // Menolak tetap boleh oleh Super Admin (tidak memindahkan uang keluar).
    const other = await createWithdrawal(3_000_000);
    expect((await call(superAdmin, `/api/v1/admin/withdrawals/${other.id}/reject`, "POST", {})).status).toBe(200);

    const approved = await call(vip, `/api/v1/admin/withdrawals/${withdrawal.id}/approve`, "POST", {});
    expect(approved.status).toBe(200);
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } })).status).toBe("APPROVED");
  });

  it("nominal tepat di bawah ambang (Rp1.999.999) masih cukup SUPER_ADMIN", async () => {
    const superAdmin = await createUser("SUPER_ADMIN");
    const withdrawal = await createWithdrawal(1_999_999);
    expect((await call(superAdmin, `/api/v1/admin/withdrawals/${withdrawal.id}/approve`, "POST", {})).status).toBe(200);
  });

  it("ADMIN melihat nomor HP disamarkan, SUPER_ADMIN melihat utuh", async () => {
    const admin = await createUser("ADMIN");
    const superAdmin = await createUser("SUPER_ADMIN");
    await createUser("USER", { phone: "085863268373" });

    const asAdmin = JSON.stringify(await (await call(admin, "/api/v1/admin/members")).json());
    expect(asAdmin).toContain("0858*****373");
    expect(asAdmin).not.toContain("085863268373");

    const asSuper = JSON.stringify(await (await call(superAdmin, "/api/v1/admin/members")).json());
    expect(asSuper).toContain("085863268373");
  });

  it("log audit: SUPER_ADMIN tidak melihat aksi otoritas, VIP melihat semuanya", async () => {
    const superAdmin = await createUser("SUPER_ADMIN");
    const vip = await createUser("SUPER_ADMIN_VIP");
    await prisma.auditLog.createMany({
      data: [
        { actorId: vip.id, action: "WITHDRAWAL_APPROVED", entityType: "Withdrawal", entityId: "w1" },
        { actorId: vip.id, action: "ADMIN_ROLE_ASSIGNED", entityType: "User", entityId: "u1" },
        { actorId: vip.id, action: "admin.scope.granted", entityType: "User", entityId: "u2" }
      ]
    });

    const forSuper = (await (await call(superAdmin, "/api/v1/admin/audit-logs")).json()) as {
      data: { items: Array<{ action: string }> };
    };
    const superActions = forSuper.data.items.map((item) => item.action);
    expect(superActions).toContain("WITHDRAWAL_APPROVED");
    expect(superActions).not.toContain("ADMIN_ROLE_ASSIGNED");
    expect(superActions).not.toContain("admin.scope.granted");

    const forVip = (await (await call(vip, "/api/v1/admin/audit-logs")).json()) as {
      data: { items: Array<{ action: string }> };
    };
    const vipActions = forVip.data.items.map((item) => item.action);
    expect(vipActions).toEqual(expect.arrayContaining(["WITHDRAWAL_APPROVED", "ADMIN_ROLE_ASSIGNED", "admin.scope.granted"]));
  });


  it("hanya SUPER_ADMIN_VIP yang dapat menentukan role ADMIN dan SUPER_ADMIN", async () => {
    const admin = await createUser("ADMIN");
    const superAdmin = await createUser("SUPER_ADMIN");
    const vip = await createUser("SUPER_ADMIN_VIP");
    const candidate = await createUser("USER");
    const body = { role: "ADMIN", reasonCode: "NEW_ADMIN_ASSIGNMENT" };

    // ADMIN dan SUPER_ADMIN ditolak, baik membaca daftar maupun mengubah role.
    for (const actor of [admin, superAdmin]) {
      expect((await call(actor, "/api/v1/admin/roles")).status, actor.role).toBe(403);
      expect((await call(actor, `/api/v1/admin/roles/${candidate.id}`, "PUT", body)).status, actor.role).toBe(403);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: candidate.id } })).role).toBe("USER");

    // VIP dapat mengangkat ke ADMIN lalu ke SUPER_ADMIN.
    expect((await call(vip, `/api/v1/admin/roles/${candidate.id}`, "PUT", body)).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: candidate.id } })).role).toBe("ADMIN");
    expect(
      (await call(vip, `/api/v1/admin/roles/${candidate.id}`, "PUT", { role: "SUPER_ADMIN", reasonCode: "PROMOTION" })).status
    ).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: candidate.id } })).role).toBe("SUPER_ADMIN");

    // Role puncak tidak pernah diberikan lewat HTTP, bahkan oleh VIP.
    const another = await createUser("USER");
    const escalate = await call(vip, `/api/v1/admin/roles/${another.id}`, "PUT", {
      role: "SUPER_ADMIN_VIP",
      reasonCode: "PROMOTION"
    });
    expect(escalate.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: another.id } })).role).toBe("USER");
  });

  it("laporan laba rugi hanya untuk SUPER_ADMIN_VIP dan angkanya dihitung dari data sistem", async () => {
    const admin = await createUser("ADMIN");
    const superAdmin = await createUser("SUPER_ADMIN");
    const vip = await createUser("SUPER_ADMIN_VIP");
    for (const actor of [admin, superAdmin]) {
      expect((await call(actor, "/api/v1/admin/reports/profit-loss")).status, actor.role).toBe(403);
    }

    const buyer = await createUser("USER");
    const silver = await prisma.membership.findFirstOrThrow({ where: { tier: "SILVER" } });
    const order = await prisma.membershipOrder.create({
      data: {
        userId: buyer.id,
        membershipId: silver.id,
        status: "PAID",
        totalAmount: new Prisma.Decimal(500_000),
        packageSnapshot: {}
      }
    });
    await prisma.invoice.create({
      data: { orderId: order.id, userId: buyer.id, number: "INV-PL-0001", status: "PAID", amount: new Prisma.Decimal(500_000) }
    });
    const base = { sourceUserId: buyer.id, triggerType: "TEST", triggerId: "pl" };
    await prisma.commission.createMany({
      data: [
        { ...base, beneficiaryId: buyer.id, type: "SPONSOR_BONUS", status: "POSTED", level: 1, amount: new Prisma.Decimal(40_000), triggerId: "pl-1" },
        { ...base, beneficiaryId: buyer.id, type: "LEVEL_COMMISSION", status: "POSTED", level: 2, amount: new Prisma.Decimal(10_000), triggerId: "pl-2" },
        { ...base, beneficiaryId: vip.id, type: "RIDE_COMPANY_REVENUE", status: "PENDING", amount: new Prisma.Decimal(8_000), triggerId: "pl-3" }
      ]
    });

    const response = await call(vip, "/api/v1/admin/reports/profit-loss");
    expect(response.status).toBe(200);
    const data = ((await response.json()) as { data: any }).data;
    expect(data.revenue.membershipNet).toBe("500000.00");
    expect(data.revenue.rideCommission).toBe("8000.00");
    expect(data.revenue.total).toBe("508000.00");
    expect(data.expenses.sponsorBonus).toBe("40000.00");
    expect(data.expenses.levelBonus).toBe("10000.00");
    expect(data.expenses.total).toBe("50000.00");
    expect(data.operatingProfit).toBe("458000.00");
    expect(data.operatingMarginPercent).toBe("90.2");
    expect(Array.isArray(data.notes)).toBe(true);
    expect(data.notes.length).toBeGreaterThan(0);
  });


  it("laba rugi menghitung HPP paket dari jumlah paket terjual, dan menandai HPP yang belum diisi", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const platinum = await prisma.membership.findFirstOrThrow({ where: { tier: "PLATINUM" } });
    const silver = await prisma.membership.findFirstOrThrow({ where: { tier: "SILVER" } });
    await prisma.membership.update({
      where: { id: platinum.id },
      data: {
        hppTotal: new Prisma.Decimal(2_095_000),
        hppBreakdown: [
          { name: "Kaos TAPGO", quantity: 1, unit: "pcs", cost: 70000 },
          { name: "Saldo PPOB", quantity: 1, unit: "paket", cost: 1000000 }
        ]
      }
    });

    let seq = 0;
    async function sell(membershipId: string, amount: number) {
      seq += 1;
      const buyer = await createUser("USER");
      const order = await prisma.membershipOrder.create({
        data: { userId: buyer.id, membershipId, status: "PAID", totalAmount: new Prisma.Decimal(amount), packageSnapshot: {} }
      });
      await prisma.invoice.create({
        data: { orderId: order.id, userId: buyer.id, number: `INV-HPP-${seq}`, status: "PAID", amount: new Prisma.Decimal(amount) }
      });
    }
    await sell(platinum.id, 5_500_000);
    await sell(platinum.id, 5_500_000);
    await sell(silver.id, 500_000);

    const response = await call(vip, "/api/v1/admin/reports/profit-loss");
    expect(response.status).toBe(200);
    const data = ((await response.json()) as { data: any }).data;

    // 2 paket Platinum x Rp2.095.000; Silver belum diisi HPP-nya.
    expect(data.expenses.hppPackages).toBe("4190000.00");
    expect(data.revenue.total).toBe("11500000.00");
    expect(data.operatingProfit).toBe("7310000.00");
    const platinumRow = data.hpp.tiers.find((tier: any) => tier.tier === "PLATINUM");
    expect(platinumRow.units).toBe(2);
    expect(platinumRow.unitCost).toBe("2095000.00");
    expect(platinumRow.total).toBe("4190000.00");
    expect(platinumRow.items).toHaveLength(2);
    expect(data.hpp.missingTiers).toEqual(["Silver"]);
    expect(data.notes.some((note: string) => note.includes("Silver") && note.includes("belum diisi"))).toBe(true);
  });

  it("koreksi status ojek hanya untuk SUPER_ADMIN ke atas", async () => {
    const admin = await createUser("ADMIN");
    const response = await call(admin, "/api/v1/admin/rides/RID-NONEXISTENT/status", "PATCH", {
      status: "CANCELLED_BY_SYSTEM",
      reason: "uji pemisahan peran"
    });
    expect(response.status).toBe(403);
  });
});

/* ------------------------------ helper ------------------------------ */

async function createUser(role: UserRole, overrides: { phone?: string } = {}): Promise<User> {
  seq += 1;
  return prisma.user.create({
    data: {
      fullName: `Peran ${role} ${seq}`,
      phone: overrides.phone ?? `+6281${String(seq).padStart(9, "0")}`,
      referralCode: `ROL${String(seq).padStart(6, "0")}`,
      role
    }
  });
}

async function createWithdrawal(amount: number) {
  const owner = await createUser("USER");
  const wallet = await prisma.wallet.create({
    data: {
      userId: owner.id,
      balance: new Prisma.Decimal(0),
      cashBalance: new Prisma.Decimal(0),
      ppobBalance: new Prisma.Decimal(0),
      currency: "IDR"
    }
  });
  return prisma.withdrawal.create({
    data: {
      walletId: wallet.id,
      userId: owner.id,
      amount: new Prisma.Decimal(amount),
      fee: new Prisma.Decimal(0),
      finalAmount: new Prisma.Decimal(amount),
      bankName: "BCA",
      accountNumber: "8830123456",
      accountHolderName: "Pemilik Uji",
      bankAccount: { bankName: "BCA", accountNumber: "8830123456", accountHolderName: "Pemilik Uji" }
    }
  });
}

function call(user: User, path: string, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` })}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
}
