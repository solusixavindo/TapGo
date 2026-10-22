import { MembershipTier } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../../src/core/security/passwordHasher.js";
import { MembershipOrderService } from "../../src/modules/memberships/application/MembershipOrderService.js";
import {
  cleanDatabase,
  prisma,
  registerBasicUser,
  runIntegration,
  setupReferralWalletIntegration
} from "../helpers/referralWalletHarness.js";

/**
 * Bukti ujung ke ujung untuk laporan admin TapGo (22 Okt 2026): "daftar lewat tautan referral, kenapa sponsornya
 * tidak dapat bonus?". Akarnya: kode referral dari tautan tidak pernah tercatat di sistem. Test ini memakai backend
 * ASLI lewat HTTP, persis seperti yang dilakukan situs:
 *   masuk lewat kanal WEB -> POST /referrals/claim dengan kode dari tautan -> pembelian membership -> bonus sponsor.
 */
const describeIntegration = runIntegration ? describe : describe.skip;
const orders = new MembershipOrderService(prisma);
const PASSWORD = "PasswordUser12";

let server: Server | undefined;
let baseUrl = "";
let sequence = 0;

async function api(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as { code?: string; data?: Record<string, unknown> } };
}

async function createAccount(label: string) {
  sequence += 1;
  const user = await registerBasicUser(`${label}${sequence}`);
  // Nomor HP yang sah agar bisa masuk lewat /web/auth/login (nomor bawaan harness berisi huruf).
  const phone = `0812${String(30000000 + sequence * 7919)}`;
  return prisma.user.update({ where: { id: user.id }, data: { phone, passwordHash: await hashPassword(PASSWORD) } });
}

async function webToken(phone: string) {
  const response = await api("POST", "/api/v1/web/auth/login", { phone, password: PASSWORD });
  expect(response.status).toBe(200);
  return response.body.data?.accessToken as string;
}

async function activateUserPackage(userId: string, tier: MembershipTier) {
  const membership = await prisma.membership.findUniqueOrThrow({ where: { tier } });
  await prisma.userMembership.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "EXPIRED" } });
  await prisma.userMembership.create({ data: { userId, membershipId: membership.id, status: "ACTIVE", activeAt: new Date() } });
  await prisma.user.update({ where: { id: userId }, data: { membershipId: membership.id } });
}

async function buySilverOnWeb(userId: string) {
  const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
  const order = await orders.createOrder({ userId, packageId: silver.id, channel: "WEB" });
  await orders.markPaymentSuccess({ userId, role: "USER", orderId: order.id, paymentReference: `web-${order.id}` });
  const verifier = await createAccount("WFVERIFIER");
  await orders.activateVerifiedOrder({ orderId: order.id, adminId: verifier.id });
  return order;
}

async function cashBalance(userId: string) {
  return (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).cashBalance.toFixed(2);
}

describeIntegration("Tautan referral -> klaim di kanal WEB -> bonus sponsor (backend asli)", () => {
  setupReferralWalletIntegration();

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-please-change-000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-please-change-00000";
    const { createApp } = await import("../../src/app.js");
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("akun yang sudah ada masuk lewat web, mengklaim kode dari tautan (huruf kecil pun), lalu sponsor Platinum dibayar", async () => {
    const sponsor = await createAccount("WFSPONSOR");
    await activateUserPackage(sponsor.id, "PLATINUM");
    const buyer = await createAccount("WFBUYER");
    const token = await webToken(buyer.phone);

    // Persis badan permintaan yang dikirim situs (src/app/upgrade/api.ts: claimRememberedReferral).
    const claim = await api(
      "POST",
      "/api/v1/referrals/claim",
      { sponsorCode: sponsor.referralCode.toLowerCase(), triggerType: "REFERRAL_JOIN" },
      token
    );
    expect(claim.status).toBe(201);
    expect((await prisma.referral.findUniqueOrThrow({ where: { userId: buyer.id } })).sponsorId).toBe(sponsor.id);

    await buySilverOnWeb(buyer.id);

    // Silver Rp500.000: bonus sponsor 8% + bonus level 1 8% untuk sponsor Platinum.
    expect(await cashBalance(sponsor.id)).toBe("80000.00");
  });

  it("sponsor Basic menerima bonus tetap Rp2.000 dari pembelian yang kodenya diklaim lewat web", async () => {
    const sponsor = await createAccount("WFBASIC");
    const buyer = await createAccount("WFBBUYER");
    const token = await webToken(buyer.phone);

    expect((await api("POST", "/api/v1/referrals/claim", { sponsorCode: sponsor.referralCode, triggerType: "REFERRAL_JOIN" }, token)).status).toBe(201);
    await buySilverOnWeb(buyer.id);

    expect(await cashBalance(sponsor.id)).toBe("2000.00");
  });

  it("tanpa klaim, tidak ada bonus (kondisi sebelum perbaikan, kini hanya bila pelanggan tidak memakai tautan)", async () => {
    const sponsor = await createAccount("WFNOCLAIM");
    await activateUserPackage(sponsor.id, "PLATINUM");
    const buyer = await createAccount("WFNCBUYER");

    await buySilverOnWeb(buyer.id);

    expect(await cashBalance(sponsor.id)).toBe("0.00");
  });

  it("setelah membeli, klaim ditolak (409) dan tidak mengubah apa pun; klaim kedua juga ditolak", async () => {
    const first = await createAccount("WFFIRST");
    const second = await createAccount("WFSECOND");
    const buyer = await createAccount("WFLATE");
    await buySilverOnWeb(buyer.id);
    const token = await webToken(buyer.phone);

    const late = await api("POST", "/api/v1/referrals/claim", { sponsorCode: first.referralCode, triggerType: "REFERRAL_JOIN" }, token);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("REFERRAL_AFTER_PURCHASE_BLOCKED");
    expect(await prisma.referral.count({ where: { userId: buyer.id } })).toBe(0);

    const other = await createAccount("WFOTHER");
    const otherToken = await webToken(other.phone);
    expect((await api("POST", "/api/v1/referrals/claim", { sponsorCode: first.referralCode, triggerType: "REFERRAL_JOIN" }, otherToken)).status).toBe(201);
    const again = await api("POST", "/api/v1/referrals/claim", { sponsorCode: second.referralCode, triggerType: "REFERRAL_JOIN" }, otherToken);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("REFERRAL_ALREADY_CLAIMED");
  });

  it("menolak kode tak dikenal (400), tanpa token (401), dan kode milik sendiri", async () => {
    const buyer = await createAccount("WFREJECT");
    const token = await webToken(buyer.phone);

    expect((await api("POST", "/api/v1/referrals/claim", { sponsorCode: "TIDAKADA999", triggerType: "REFERRAL_JOIN" }, token)).body.code).toBe("SPONSOR_NOT_FOUND");
    expect((await api("POST", "/api/v1/referrals/claim", { sponsorCode: buyer.referralCode, triggerType: "REFERRAL_JOIN" }, token)).body.code).toBe("SELF_REFERRAL_BLOCKED");
    expect((await api("POST", "/api/v1/referrals/claim", { sponsorCode: "ABCD1234", triggerType: "REFERRAL_JOIN" })).status).toBe(401);
  });
});
