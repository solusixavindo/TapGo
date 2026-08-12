import { User, UserRole } from "@prisma/client";
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

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let originalExternalPaymentGateEnv: string | undefined;

describe.skipIf(!runIntegration)("Admin console API", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }

    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-for-tapgo-admin-api";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-for-tapgo-admin-api";
    process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? "15m";
    process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS ?? "30";
    originalExternalPaymentGateEnv =
      process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
    process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = "true";
    process.env.MEMBERSHIP_PURCHASE_APP_ENABLED = "true";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js")
    ]);
    backendEnv = envModule.env;
    // Stage R2.6 memisahkan kanal pembelian. Test ini menguji perilaku
    // distribusi direct, di mana pembelian dari dalam aplikasi diizinkan.
    backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = true;
    backendEnv.MEMBERSHIP_PURCHASE_APP_ENABLED = true;
    signAccessToken = tokenService.signAccessToken;

    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  afterAll(async () => {
    if (backendEnv) {
      backendEnv.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED =
        originalExternalPaymentGateEnv?.trim().toLowerCase() === "true";
    }
    if (originalExternalPaymentGateEnv == null) {
      delete process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
    } else {
      process.env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED =
        originalExternalPaymentGateEnv;
    }
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("allows admins to read summary and member list", async () => {
    const admin = await createUser("ADMIN001", "ADMIN");
    await createUser("USER001", "USER");

    const summary = await api("/api/v1/admin/dashboard/summary", { token: tokenFor(admin) });
    const members = await api("/api/v1/admin/members", { token: tokenFor(admin) });
    const summaryBody = await summary.json() as { data: { totalMembers: number } };
    const membersBody = await members.json() as { data: { items: unknown[] } };

    expect(summary.status).toBe(200);
    expect(summaryBody.data.totalMembers).toBe(1);
    expect(members.status).toBe(200);
    expect(membersBody.data.items).toHaveLength(1);
  });

  it("blocks normal users from admin endpoints", async () => {
    const user = await createUser("USER002", "USER");

    const response = await api("/api/v1/admin/dashboard/summary", { token: tokenFor(user) });

    expect(response.status).toBe(403);
  });

  it("allows only Super Admin to grant Founder Platinum without invoice, revenue, or PPOB benefit", async () => {
    const admin = await createUser("ADMINFP1", "ADMIN");
    const superAdmin = await createUser("SUPERFP1", "SUPER_ADMIN");
    const sponsor = await createUser("SPONSORFP1", "USER");

    const blocked = await api("/api/v1/admin/founder-platinum/grants", {
      method: "POST",
      token: tokenFor(admin),
      body: {
        fullName: "Founder Blocked",
        phone: "081300000991",
        password: "Founder123"
      }
    });
    expect(blocked.status).toBe(403);

    const granted = await api("/api/v1/admin/founder-platinum/grants", {
      method: "POST",
      token: tokenFor(superAdmin),
      body: {
        fullName: "Founder Platinum One",
        phone: "+62 813-0000-0992",
        password: "Founder123",
        founderId: "FND-001",
        sponsorReferralCode: sponsor.referralCode,
        reason: "10 founder appreciation accounts"
      }
    });

    expect(granted.status).toBe(201);
    const body = await granted.json() as {
      data: {
        user: { id: string; phone: string; referralCode: string };
        userMembership: { founderRole: string; membership: { tier: string } };
        founderGrant: { id: string; founderRole: string; grantedBy: string };
      };
    };

    expect(body.data.user.phone).toBe("081300000992");
    expect(body.data.user.referralCode).toBe("FND-001");
    expect(body.data.userMembership.founderRole).toBe("FOUNDER_PLATINUM");
    expect(body.data.userMembership.membership.tier).toBe("PLATINUM");
    expect(body.data.founderGrant.founderRole).toBe("FOUNDER_PLATINUM");
    expect(body.data.founderGrant.grantedBy).toBe(superAdmin.id);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: body.data.user.id } });
    expect(wallet.cashBalance.toFixed(2)).toBe("0.00");
    expect(wallet.ppobBalance.toFixed(2)).toBe("0.00");
    expect(await prisma.walletTransaction.count({ where: { walletId: wallet.id } })).toBe(0);
    expect(await prisma.membershipOrder.count({ where: { userId: body.data.user.id } })).toBe(0);
    expect(await prisma.invoice.count({ where: { userId: body.data.user.id } })).toBe(0);
    expect(await prisma.membershipPayment.count({ where: { userId: body.data.user.id } })).toBe(0);

    expect(await prisma.referral.count({ where: { sponsorId: sponsor.id, userId: body.data.user.id } })).toBe(1);
    expect(await prisma.referralLevel.count({ where: { ancestorId: sponsor.id, descendantId: body.data.user.id, level: 1 } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "FOUNDER_PLATINUM_GRANTED", entityId: body.data.founderGrant.id } })).toBe(1);
    expect(await prisma.commission.count({ where: { sourceUserId: body.data.user.id } })).toBe(0);
    expect(await prisma.rewardTransaction.count({ where: { userId: body.data.user.id } })).toBe(0);

    const buyer = await createUser("BUYERFP1", "USER");
    await prisma.referral.create({
      data: {
        sponsorId: body.data.user.id,
        userId: buyer.id,
        metadata: { source: "founder_platinum_test" }
      }
    });
    await prisma.referralLevel.create({
      data: {
        ancestorId: body.data.user.id,
        descendantId: buyer.id,
        level: 1
      }
    });

    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
    const orderResponse = await api("/api/v1/membership/orders", {
      method: "POST",
      token: tokenFor(buyer),
      body: { packageId: silver.id }
    });
    expect(orderResponse.status).toBe(201);
    const orderBody = await orderResponse.json() as { data: { id: string } };

    const paidResponse = await api(`/api/v1/membership/orders/${orderBody.data.id}/payment-success`, {
      method: "POST",
      token: tokenFor(buyer),
      body: { paymentReference: "FOUNDER-DOWNLINE-PAID" }
    });
    expect(paidResponse.status).toBe(200);

    const sponsorBonus = await prisma.commission.findFirstOrThrow({
      where: {
        beneficiaryId: body.data.user.id,
        sourceUserId: buyer.id,
        type: "SPONSOR_BONUS",
        triggerId: orderBody.data.id
      }
    });
    expect(sponsorBonus.amount.toFixed(2)).toBe("40000.00");
    expect(sponsorBonus.rate?.toFixed(2)).toBe("8.00");

    const levelBonus = await prisma.commission.findFirstOrThrow({
      where: {
        beneficiaryId: body.data.user.id,
        sourceUserId: buyer.id,
        type: "LEVEL_BONUS",
        triggerId: orderBody.data.id
      }
    });
    expect(levelBonus.amount.toFixed(2)).toBe("40000.00");
    expect(levelBonus.rate?.toFixed(2)).toBe("8.00");

    const founderWalletAfterBonus = await prisma.wallet.findUniqueOrThrow({ where: { userId: body.data.user.id } });
    expect(founderWalletAfterBonus.cashBalance.toFixed(2)).toBe("80000.00");
    expect(founderWalletAfterBonus.ppobBalance.toFixed(2)).toBe("0.00");

    for (let index = 2; index <= 10; index += 1) {
      const grant = await api("/api/v1/admin/founder-platinum/grants", {
        method: "POST",
        token: tokenFor(superAdmin),
        body: {
          fullName: `Founder Platinum ${index}`,
          phone: `0813000010${String(index).padStart(2, "0")}`,
          password: "Founder123",
          founderId: `FND-${String(index).padStart(3, "0")}`
        }
      });
      expect(grant.status).toBe(201);
    }

    const rejectedEleventh = await api("/api/v1/admin/founder-platinum/grants", {
      method: "POST",
      token: tokenFor(superAdmin),
      body: {
        fullName: "Founder Platinum Eleven",
        phone: "081300001111",
        password: "Founder123",
        founderId: "FND-011"
      }
    });
    expect(rejectedEleventh.status).toBe(409);
    expect(await prisma.founderProgramGrant.count({ where: { founderRole: "FOUNDER_PLATINUM", revokedAt: null } })).toBe(10);
  });

  it("manages Founder Platinum console status without deleting history or paying suspended founders", async () => {
    const superAdmin = await createUser("SUPERFP2", "SUPER_ADMIN");
    const normalUser = await createUser("USERFP2", "USER");

    const granted = await api("/api/v1/admin/founder-platinum/grants", {
      method: "POST",
      token: tokenFor(superAdmin),
      body: {
        fullName: "Founder Lifecycle",
        phone: "081300002001",
        password: "Founder123",
        founderId: "FND-001",
        reason: "Founder lifecycle UAT"
      }
    });
    expect(granted.status).toBe(201);
    const grantBody = await granted.json() as { data: { user: { id: string; referralCode: string }; founderGrant: { id: string } } };
    const founderId = grantBody.data.user.referralCode;
    const founderUserId = grantBody.data.user.id;

    expect((await api("/api/v1/admin/founder-platinum", { token: tokenFor(normalUser) })).status).toBe(403);

    const list = await api("/api/v1/admin/founder-platinum", { token: tokenFor(superAdmin) });
    expect(list.status).toBe(200);
    const listBody = await list.json() as { data: { totalSlot: number; usedSlot: number; availableSlot: number; statusSummary: { ACTIVE: number; SUSPENDED: number; REVOKED: number }; items: Array<{ founderId: string; status: string }> } };
    expect(listBody.data.totalSlot).toBe(10);
    expect(listBody.data.usedSlot).toBe(1);
    expect(listBody.data.availableSlot).toBe(9);
    expect(listBody.data.statusSummary.ACTIVE).toBe(1);
    expect(listBody.data.items[0]?.founderId).toBe("FND-001");
    expect(listBody.data.items[0]?.status).toBe("ACTIVE");

    const detail = await api(`/api/v1/admin/founder-platinum/${founderId}`, { token: tokenFor(superAdmin) });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as { data: { founderId: string; walletCash: string; walletPpob: string; auditTrail: unknown[] } };
    expect(detailBody.data.founderId).toBe("FND-001");
    expect(detailBody.data.walletCash).toBe("0.00");
    expect(detailBody.data.walletPpob).toBe("0.00");
    expect(detailBody.data.auditTrail.length).toBeGreaterThan(0);

    const firstPaidOrderId = await createPaidSilverDownline(founderUserId, "FND-BUYER-A", "FOUNDER-ACTIVE-PAID");
    expect(await prisma.commission.count({ where: { beneficiaryId: founderUserId, triggerId: firstPaidOrderId } })).toBe(2);

    const emptyReasonSuspend = await api(`/api/v1/admin/founder-platinum/${founderId}/status`, {
      method: "PATCH",
      token: tokenFor(superAdmin),
      body: { status: "SUSPENDED" }
    });
    expect(emptyReasonSuspend.status).toBe(400);

    const suspended = await api(`/api/v1/admin/founder-platinum/${founderId}/status`, {
      method: "PATCH",
      token: tokenFor(superAdmin),
      body: { status: "SUSPENDED", reason: "temporary compliance review" }
    });
    expect(suspended.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: founderUserId } })).status).toBe("SUSPENDED");

    const suspendedPaidOrderId = await createPaidSilverDownline(founderUserId, "FND-BUYER-B", "FOUNDER-SUSPENDED-PAID");
    expect(await prisma.commission.count({ where: { beneficiaryId: founderUserId, triggerId: suspendedPaidOrderId } })).toBe(0);

    const reactivated = await api(`/api/v1/admin/founder-platinum/${founderId}/status`, {
      method: "PATCH",
      token: tokenFor(superAdmin),
      body: { status: "ACTIVE" }
    });
    expect(reactivated.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: founderUserId } })).status).toBe("ACTIVE");

    const activeAgainPaidOrderId = await createPaidSilverDownline(founderUserId, "FND-BUYER-C", "FOUNDER-REACTIVE-PAID");
    expect(await prisma.commission.count({ where: { beneficiaryId: founderUserId, triggerId: activeAgainPaidOrderId } })).toBe(2);

    const emptyReasonRevoke = await api(`/api/v1/admin/founder-platinum/${founderId}/status`, {
      method: "PATCH",
      token: tokenFor(superAdmin),
      body: { status: "REVOKED" }
    });
    expect(emptyReasonRevoke.status).toBe(400);

    const revoked = await api(`/api/v1/admin/founder-platinum/${founderId}/status`, {
      method: "PATCH",
      token: tokenFor(superAdmin),
      body: { status: "REVOKED", reason: "owner request" }
    });
    expect(revoked.status).toBe(200);
    const revokedGrant = await prisma.founderProgramGrant.findUniqueOrThrow({ where: { id: grantBody.data.founderGrant.id } });
    expect(revokedGrant.revokedAt).toBeTruthy();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: founderUserId } })).status).toBe("SUSPENDED");

    const revokedPaidOrderId = await createPaidSilverDownline(founderUserId, "FND-BUYER-D", "FOUNDER-REVOKED-PAID");
    expect(await prisma.commission.count({ where: { beneficiaryId: founderUserId, triggerId: revokedPaidOrderId } })).toBe(0);

    const reactivateRevoked = await api(`/api/v1/admin/founder-platinum/${founderId}/status`, {
      method: "PATCH",
      token: tokenFor(superAdmin),
      body: { status: "ACTIVE" }
    });
    expect(reactivateRevoked.status).toBe(409);

    const deleteAttempt = await api(`/api/v1/admin/founder-platinum/${founderId}`, {
      method: "DELETE",
      token: tokenFor(superAdmin)
    });
    expect(deleteAttempt.status).toBe(404);

    const auditCount = await prisma.auditLog.count({
      where: {
        entityType: "FOUNDER_PROGRAM_GRANT",
        entityId: grantBody.data.founderGrant.id,
        action: { in: ["FOUNDER_PLATINUM_SUSPENDED", "FOUNDER_PLATINUM_ACTIVE", "FOUNDER_PLATINUM_REVOKED"] }
      }
    });
    expect(auditCount).toBe(3);
  });

  it("manages the single Founder Chairman without revenue, PPOB benefit, duplicate grant, or unmasked bank data", async () => {
    const admin = await createUser("ADMINFCH1", "ADMIN");
    const superAdmin = await createUser("SUPERFCH1", "SUPER_ADMIN");
    const normalUser = await createUser("USERFCH1", "USER");

    const blocked = await api("/api/v1/admin/founder-chairman/grant", {
      method: "POST",
      token: tokenFor(normalUser),
      body: {
        fullName: "Founder Chairman Blocked",
        phone: "083890700001",
        email: "blocked-chairman@example.com",
        password: "Founder123",
        reason: "blocked"
      }
    });
    expect(blocked.status).toBe(403);

    const adminBlocked = await api("/api/v1/admin/founder-chairman/grant", {
      method: "POST",
      token: tokenFor(admin),
      body: {
        fullName: "Founder Chairman Admin Blocked",
        phone: "083890700099",
        email: "admin-blocked-chairman@example.com",
        password: "Founder123",
        reason: "admin blocked"
      }
    });
    expect(adminBlocked.status).toBe(403);

    const granted = await api("/api/v1/admin/founder-chairman/grant", {
      method: "POST",
      token: tokenFor(superAdmin),
      body: {
        fullName: "Ahmad Zulhi",
        phone: "083890782273",
        email: "ahmadzulhi87@example.com",
        password: "Founder1234",
        reason: "Founder Chairman official single founder account",
        bankAccount: {
          bankName: "Test Bank",
          accountHolderName: "TEST ACCOUNT HOLDER",
          accountNumber: "1234567890123"
        }
      }
    });

    expect(granted.status).toBe(201);
    const grantedBody = await granted.json() as {
      data: {
        founderId: string;
        userId: string;
        founderRole: string;
        membership: string;
        membershipTier: string;
        status: string;
        walletCash: string;
        walletPpob: string;
        bankAccountMasked: string | null;
      };
    };

    expect(grantedBody.data.founderId).toBe("FCH-001");
    expect(grantedBody.data.founderRole).toBe("FOUNDER_CHAIRMAN");
    expect(grantedBody.data.membership).toBe("Founder Chairman / Platinum");
    expect(grantedBody.data.membershipTier).toBe("PLATINUM");
    expect(grantedBody.data.status).toBe("ACTIVE");
    expect(grantedBody.data.walletCash).toBe("0.00");
    expect(grantedBody.data.walletPpob).toBe("0.00");
    expect(grantedBody.data.bankAccountMasked).toBe("*********0123");
    expect(JSON.stringify(grantedBody)).not.toContain("1234567890123");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: grantedBody.data.userId } });
    expect(wallet.cashBalance.toFixed(2)).toBe("0.00");
    expect(wallet.ppobBalance.toFixed(2)).toBe("0.00");
    expect(await prisma.walletTransaction.count({ where: { walletId: wallet.id } })).toBe(0);
    expect(await prisma.membershipOrder.count({ where: { userId: grantedBody.data.userId } })).toBe(0);
    expect(await prisma.invoice.count({ where: { userId: grantedBody.data.userId } })).toBe(0);
    expect(await prisma.membershipPayment.count({ where: { userId: grantedBody.data.userId } })).toBe(0);
    expect(await prisma.commission.count({ where: { sourceUserId: grantedBody.data.userId } })).toBe(0);
    expect(await prisma.rewardTransaction.count({ where: { userId: grantedBody.data.userId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "FOUNDER_CHAIRMAN_GRANTED" } })).toBe(1);

    const duplicate = await api("/api/v1/admin/founder-chairman/grant", {
      method: "POST",
      token: tokenFor(superAdmin),
      body: {
        fullName: "Second Chairman",
        phone: "083890700002",
        email: "second-chairman@example.com",
        password: "Founder1234",
        reason: "second attempt"
      }
    });
    expect(duplicate.status).toBe(409);
    const duplicateBody = await duplicate.json() as { code: string };
    expect(duplicateBody.code).toBe("FOUNDER_CHAIRMAN_ALREADY_EXISTS");

    const list = await api("/api/v1/admin/founder-chairman", { token: tokenFor(superAdmin) });
    expect(list.status).toBe(200);
    const listBody = await list.json() as { data: { totalSlot: number; usedSlot: number; availableSlot: number; item: { founderId: string; bankAccountMasked: string | null } } };
    expect(listBody.data.totalSlot).toBe(1);
    expect(listBody.data.usedSlot).toBe(1);
    expect(listBody.data.availableSlot).toBe(0);
    expect(listBody.data.item.founderId).toBe("FCH-001");
    expect(listBody.data.item.bankAccountMasked).toBe("*********0123");
    expect(JSON.stringify(listBody)).not.toContain("1234567890123");

    const activePaidOrderId = await createPaidSilverDownline(grantedBody.data.userId, "FCH-BUYER-A", "CHAIRMAN-ACTIVE-PAID");
    expect(await prisma.commission.count({ where: { beneficiaryId: grantedBody.data.userId, triggerId: activePaidOrderId } })).toBe(2);

    const emptyReasonSuspend = await api("/api/v1/admin/founder-chairman/FCH-001/status", {
      method: "PATCH",
      token: tokenFor(superAdmin),
      body: { status: "SUSPENDED" }
    });
    expect(emptyReasonSuspend.status).toBe(400);

    const suspended = await api("/api/v1/admin/founder-chairman/FCH-001/status", {
      method: "PATCH",
      token: tokenFor(superAdmin),
      body: { status: "SUSPENDED", reason: "temporary compliance review" }
    });
    expect(suspended.status).toBe(200);

    const suspendedPaidOrderId = await createPaidSilverDownline(grantedBody.data.userId, "FCH-BUYER-B", "CHAIRMAN-SUSPENDED-PAID");
    expect(await prisma.commission.count({ where: { beneficiaryId: grantedBody.data.userId, triggerId: suspendedPaidOrderId } })).toBe(0);

    const reactivated = await api("/api/v1/admin/founder-chairman/FCH-001/status", {
      method: "PATCH",
      token: tokenFor(superAdmin),
      body: { status: "ACTIVE" }
    });
    expect(reactivated.status).toBe(200);

    const activeAgainPaidOrderId = await createPaidSilverDownline(grantedBody.data.userId, "FCH-BUYER-C", "CHAIRMAN-REACTIVE-PAID");
    expect(await prisma.commission.count({ where: { beneficiaryId: grantedBody.data.userId, triggerId: activeAgainPaidOrderId } })).toBe(2);

    const emptyReasonRevoke = await api("/api/v1/admin/founder-chairman/FCH-001/status", {
      method: "PATCH",
      token: tokenFor(superAdmin),
      body: { status: "REVOKED" }
    });
    expect(emptyReasonRevoke.status).toBe(400);

    const revoked = await api("/api/v1/admin/founder-chairman/FCH-001/status", {
      method: "PATCH",
      token: tokenFor(superAdmin),
      body: { status: "REVOKED", reason: "owner request" }
    });
    expect(revoked.status).toBe(200);

    const revokedPaidOrderId = await createPaidSilverDownline(grantedBody.data.userId, "FCH-BUYER-D", "CHAIRMAN-REVOKED-PAID");
    expect(await prisma.commission.count({ where: { beneficiaryId: grantedBody.data.userId, triggerId: revokedPaidOrderId } })).toBe(0);

    const deleteAttempt = await api("/api/v1/admin/founder-chairman/FCH-001", {
      method: "DELETE",
      token: tokenFor(superAdmin)
    });
    expect(deleteAttempt.status).toBe(404);
  });

  it("allows only one Founder Chairman grant under concurrent requests", async () => {
    const superAdmin = await createUser("SUPERFCH2", "SUPER_ADMIN");
    const token = tokenFor(superAdmin);
    const firstBody = {
      fullName: "Ahmad Zulhi",
      phone: "083890782273",
      email: "ahmadzulhi87@example.com",
      password: "Founder1234",
      reason: "Founder Chairman concurrent grant A"
    };
    const secondBody = {
      fullName: "Second Chairman",
      phone: "083890700003",
      email: "second-chairman-concurrent@example.com",
      password: "Founder1234",
      reason: "Founder Chairman concurrent grant B"
    };

    const responses = await Promise.all([
      api("/api/v1/admin/founder-chairman/grant", { method: "POST", token, body: firstBody }),
      api("/api/v1/admin/founder-chairman/grant", { method: "POST", token, body: secondBody })
    ]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);

    const conflict = responses.find((response) => response.status === 409);
    const conflictBody = await conflict!.json() as { code: string };
    expect(conflictBody.code).toBe("FOUNDER_CHAIRMAN_ALREADY_EXISTS");
    expect(await prisma.founderProgramGrant.count({ where: { founderRole: "FOUNDER_CHAIRMAN" } })).toBe(1);
    expect(await prisma.user.count({ where: { referralCode: "FCH-001" } })).toBe(1);
  });

  it("manages reward lifecycle without double cash ledger", async () => {
    const admin = await createUser("ADMIN002", "ADMIN");
    const user = await createUser("REWARD001", "USER");
    const rejectedUser = await createUser("REWARD002", "USER");
    const userToken = tokenFor(user);
    const adminToken = tokenFor(admin);

    const reward = await prisma.rewardTransaction.create({
      data: {
        userId: user.id,
        threshold: 10,
        directSilverCount: 10,
        amount: "500000.00",
        referenceId: "DIRECT_SILVER_10"
      }
    });
    const rejectedReward = await prisma.rewardTransaction.create({
      data: {
        userId: rejectedUser.id,
        threshold: 100,
        directSilverCount: 100,
        amount: "5000000.00",
        referenceId: "DIRECT_SILVER_100"
      }
    });

    expect((await api("/api/v1/admin/rewards", { token: userToken })).status).toBe(403);

    const list = await api("/api/v1/admin/rewards?status=PENDING", { token: adminToken });
    expect(list.status).toBe(200);
    const listBody = await list.json() as { data: { items: Array<{ id: string }> } };
    expect(listBody.data.items.some((item) => item.id === reward.id)).toBe(true);

    const approved = await api(`/api/v1/admin/rewards/${reward.id}/approve`, {
      method: "POST",
      token: adminToken,
      body: { note: "approved for UAT" }
    });
    expect(approved.status).toBe(200);
    expect((await prisma.rewardTransaction.findUniqueOrThrow({ where: { id: reward.id } })).status).toBe("APPROVED");

    const paid = await api(`/api/v1/admin/rewards/${reward.id}/mark-paid`, {
      method: "POST",
      token: adminToken,
      body: { note: "paid by admin" }
    });
    expect(paid.status).toBe(200);
    const paidReward = await prisma.rewardTransaction.findUniqueOrThrow({ where: { id: reward.id } });
    expect(paidReward.status).toBe("PAID");
    expect(paidReward.walletTransactionId).toBeTruthy();
    expect(await prisma.walletTransaction.count({ where: { type: "REWARD_BONUS", referenceId: "DIRECT_SILVER_10" } })).toBe(1);

    const duplicatePaid = await api(`/api/v1/admin/rewards/${reward.id}/mark-paid`, {
      method: "POST",
      token: adminToken
    });
    expect(duplicatePaid.status).toBe(200);
    expect(await prisma.walletTransaction.count({ where: { type: "REWARD_BONUS", referenceId: "DIRECT_SILVER_10" } })).toBe(1);

    const rejectPaid = await api(`/api/v1/admin/rewards/${reward.id}/reject`, {
      method: "POST",
      token: adminToken,
      body: { reason: "too late" }
    });
    expect(rejectPaid.status).toBe(409);

    const rejected = await api(`/api/v1/admin/rewards/${rejectedReward.id}/reject`, {
      method: "POST",
      token: adminToken,
      body: { reason: "not eligible" }
    });
    expect(rejected.status).toBe(200);
    expect((await prisma.rewardTransaction.findUniqueOrThrow({ where: { id: rejectedReward.id } })).status).toBe("REJECTED");

    const approveRejected = await api(`/api/v1/admin/rewards/${rejectedReward.id}/approve`, {
      method: "POST",
      token: adminToken
    });
    expect(approveRejected.status).toBe(409);
  });

  it("serves financial admin reports with separated cash and PPOB liability", async () => {
    const admin = await createUser("ADMIN003", "ADMIN");
    const superAdmin = await createUser("SUPER003", "SUPER_ADMIN");
    const user = await createUser("USER003", "USER");
    const adminToken = tokenFor(admin);
    const superAdminToken = tokenFor(superAdmin);
    const userToken = tokenFor(user);

    const wallet = await prisma.wallet.create({
      data: {
        userId: user.id,
        balance: "2000.00",
        cashBalance: "2000.00",
        ppobBalance: "105000.00"
      }
    });
    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "REGISTRATION_BONUS",
        amount: "5000.00",
        referenceType: "BASIC_REGISTRATION",
        referenceId: user.id
      }
    });
    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "PPOB_BENEFIT",
        amount: "100000.00",
        referenceType: "MEMBERSHIP_ORDER",
        referenceId: "order-silver-report",
        metadata: { packageName: "Silver" }
      }
    });
    await prisma.commission.create({
      data: {
        beneficiaryId: user.id,
        sourceUserId: admin.id,
        type: "BASIC_SPONSOR_BONUS",
        status: "POSTED",
        amount: "2000.00",
        triggerType: "MEMBERSHIP_ORDER",
        triggerId: "commission-report"
      }
    });
    await prisma.rewardTransaction.create({
      data: {
        userId: user.id,
        threshold: 10,
        directSilverCount: 10,
        amount: "500000.00",
        status: "PENDING",
        referenceId: "DIRECT_SILVER_10"
      }
    });
    const period = await prisma.profitSharingPeriod.create({
      data: {
        periodMonth: 6,
        periodYear: 2026,
        netProfitAmount: "100000000.00",
        totalPoolAmount: "60000000.00",
        silverAllocation: "18000000.00",
        goldAllocation: "12000000.00",
        platinumAllocation: "6000000.00",
        retainedAmount: "24000000.00",
        status: "DISTRIBUTED"
      }
    });
    await prisma.profitSharingDistribution.create({
      data: {
        periodId: period.id,
        userId: user.id,
        amount: "1000000.00",
        status: "POSTED"
      }
    });
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
    const order = await prisma.membershipOrder.create({
      data: {
        userId: user.id,
        membershipId: silver.id,
        status: "PAID",
        totalAmount: "500000.00",
        packageSnapshot: {},
        paidAt: new Date()
      }
    });
    await prisma.invoice.create({
      data: {
        orderId: order.id,
        userId: user.id,
        number: "INV-ADMIN-REPORT-001",
        status: "PAID",
        amount: "500000.00",
        paidAt: new Date()
      }
    });
    await prisma.withdrawal.create({
      data: {
        userId: user.id,
        walletId: wallet.id,
        amount: "50000.00",
        finalAmount: "50000.00",
        status: "PENDING",
        bankAccount: {}
      }
    });

    expect((await api("/api/v1/admin/reports/financial-summary", { token: userToken })).status).toBe(403);
    expect((await api("/api/v1/admin/reports/financial-summary", { token: superAdminToken })).status).toBe(200);

    const walletReport = await api("/api/v1/admin/reports/wallet-liability", { token: adminToken });
    expect(walletReport.status).toBe(200);
    const walletBody = await walletReport.json() as { data: { totalCashBalance: string; totalPpobBalance: string; totalWithdrawableBalance: string } };
    expect(walletBody.data.totalCashBalance).toBe("2000.00");
    expect(walletBody.data.totalPpobBalance).toBe("105000.00");
    expect(walletBody.data.totalWithdrawableBalance).toBe("2000.00");

    const rewardReport = await api("/api/v1/admin/reports/reward-summary", { token: adminToken });
    const rewardBody = await rewardReport.json() as { data: { countPending: number; totalPending: string } };
    expect(rewardReport.status).toBe(200);
    expect(rewardBody.data.countPending).toBe(1);
    expect(rewardBody.data.totalPending).toBe("500000.00");

    const profitReport = await api("/api/v1/admin/reports/profit-sharing-summary", { token: adminToken });
    const profitBody = await profitReport.json() as { data: { totalNetProfitInput: string; totalPoolAmount: string; totalPaid: string } };
    expect(profitReport.status).toBe(200);
    expect(profitBody.data.totalNetProfitInput).toBe("100000000.00");
    expect(profitBody.data.totalPoolAmount).toBe("60000000.00");
    expect(profitBody.data.totalPaid).toBe("1000000.00");

    const ppobReport = await api("/api/v1/admin/reports/ppob-summary", { token: adminToken });
    const ppobBody = await ppobReport.json() as { data: { basicRegistrationPpobTotal: string; silverPpobTotal: string; totalPpobLiability: string } };
    expect(ppobReport.status).toBe(200);
    expect(ppobBody.data.basicRegistrationPpobTotal).toBe("5000.00");
    expect(ppobBody.data.silverPpobTotal).toBe("100000.00");
    expect(ppobBody.data.totalPpobLiability).toBe("105000.00");

    const summary = await api("/api/v1/admin/reports/financial-summary", { token: adminToken });
    const summaryBody = await summary.json() as { data: { totalMembershipRevenuePaid: string; totalWithdrawalPending: string; totalRewardPending: string } };
    expect(summary.status).toBe(200);
    expect(summaryBody.data.totalMembershipRevenuePaid).toBe("500000.00");
    expect(summaryBody.data.totalWithdrawalPending).toBe("50000.00");
    expect(summaryBody.data.totalRewardPending).toBe("500000.00");
  });
});

async function api(path: string, options: { token?: string; method?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {})
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
}

async function createUser(referralCode: string, role: UserRole): Promise<User> {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  return prisma.user.create({
    data: {
      fullName: `User ${referralCode}`,
      phone: `+628${referralCode.padStart(9, "0")}`,
      referralCode,
      role,
      membershipId: basic.id
    }
  });
}

async function createPaidSilverDownline(sponsorId: string, referralCode: string, paymentReference: string) {
  const buyer = await createUser(referralCode, "USER");
  await prisma.referral.create({
    data: {
      sponsorId,
      userId: buyer.id,
      metadata: { source: "founder_platinum_status_test" }
    }
  });
  await prisma.referralLevel.create({
    data: {
      ancestorId: sponsorId,
      descendantId: buyer.id,
      level: 1
    }
  });

  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  const orderResponse = await api("/api/v1/membership/orders", {
    method: "POST",
    token: tokenFor(buyer),
    body: { packageId: silver.id }
  });
  expect(orderResponse.status).toBe(201);
  const orderBody = await orderResponse.json() as { data: { id: string } };

  const paidResponse = await api(`/api/v1/membership/orders/${orderBody.data.id}/payment-success`, {
    method: "POST",
    token: tokenFor(buyer),
    body: { paymentReference }
  });
  expect(paidResponse.status).toBe(200);

  return orderBody.data.id;
}

function tokenFor(user: User) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`
  });
}
