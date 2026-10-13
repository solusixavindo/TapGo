import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Ketepatan hitungan laporan laba rugi (audit 13 Okt 2026):
 *  - pengembalian dana mengubah invoice PAID -> REFUNDED, jadi penjualan kotor = PAID + REFUNDED
 *    dan pendapatan bersih = PAID; sebelumnya pengembalian terpotong dua kali;
 *  - penjualan dicatat pada tanggal DIBAYAR, sama dengan biaya gateway;
 *  - biaya gateway tetap dihitung untuk pembayaran yang kemudian dikembalikan.
 */
type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;
let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let seq = 0;
const DAY = 86_400_000;

describe.skipIf(!runIntegration)("Laporan laba rugi: ketepatan hitungan", () => {
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
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-profit-loss-accuracy";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-profit-loss-accuracy";
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
    delete process.env.PL_SERVER_COST_MONTHLY;
    delete process.env.PL_PPN_MODE;
    delete process.env.PL_INCOME_TAX_MODE;
    delete process.env.PL_FINAL_TAX_RATE_PERCENT;
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function report(vip: User, range?: { from: Date; to: Date }) {
    const query = range ? `?dateFrom=${encodeURIComponent(range.from.toISOString())}&dateTo=${encodeURIComponent(range.to.toISOString())}` : "";
    const response = await call(vip, `/api/v1/admin/reports/profit-loss${query}`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: any }).data;
  }

  it("pengembalian dana dikurangkan SEKALI: penjualan kotor = PAID + REFUNDED, pendapatan bersih = PAID", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    await sale({ status: "PAID", amount: 500_000 });
    await sale({ status: "REFUNDED", amount: 500_000 });

    const data = await report(vip);
    expect(data.revenue.membershipSales).toBe("1000000.00");
    expect(data.revenue.membershipRefunds).toBe("500000.00");
    expect(data.revenue.membershipNet).toBe("500000.00");
    // Saldo PPOB Silver Rp100.000 ditangguhkan: diakui 400.000.
    expect(data.revenue.membershipRecognized).toBe("400000.00");
    expect(data.revenue.total).toBe("400000.00");
    // Pajak (uji ini 11%) x 400.000 = 44.000; laba bersih = 400.000 - 44.000.
    expect(data.netProfit).toBe("356000.00");
  });

  it("penjualan dicatat pada tanggal dibayar, bukan tanggal invoice dibuat", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const now = Date.now();
    // Dibuat 40 hari lalu, dibayar kemarin: masuk periode 7 hari terakhir.
    await sale({ status: "PAID", amount: 500_000, createdAt: new Date(now - 40 * DAY), paidAt: new Date(now - DAY) });
    // Dibuat kemarin, dibayar 40 hari lalu: di luar periode.
    await sale({ status: "PAID", amount: 700_000, createdAt: new Date(now - DAY), paidAt: new Date(now - 40 * DAY) });
    // Data lama tanpa paidAt: memakai tanggal dibuat.
    await sale({ status: "PAID", amount: 300_000, createdAt: new Date(now - 2 * DAY), paidAt: null });

    const data = await report(vip, { from: new Date(now - 7 * DAY), to: new Date(now) });
    expect(data.revenue.membershipNet).toBe("800000.00");
  });

  it("biaya gateway tetap dihitung untuk pembayaran Midtrans yang dikembalikan; manual dan biaya yang dibayar pelanggan tidak", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const paidAt = new Date();
    await sale({ status: "PAID", amount: 500_000, payment: { provider: "MIDTRANS", paymentType: "bank_transfer", paidAt } });
    await sale({ status: "REFUNDED", amount: 500_000, payment: { provider: "MIDTRANS", paymentType: "bank_transfer", paidAt } });
    await sale({ status: "PAID", amount: 500_000, payment: { provider: "MANUAL_BANK", paymentType: "bank_transfer", paidAt } });
    const topUpUser = await createUser("USER");
    for (const [index, borne] of [true, false].entries()) {
      await prisma.walletTopUpOrder.create({
        data: {
          userId: topUpUser.id,
          reference: `TOPUP-PL-${index}`,
          status: "PAID",
          amount: new Prisma.Decimal(50_000),
          provider: "MIDTRANS",
          paidAt,
          metadata: { paymentType: "bank_transfer", ...(borne ? { feeBorneByCustomer: true } : {}) }
        }
      });
    }

    const data = await report(vip);
    // Dihitung: 2 pembayaran membership Midtrans (PAID + REFUNDED) + 1 top up tanpa penanda = 3 x Rp4.440.
    expect(data.opex.gatewayFee).toBe("13320.00");
    expect(data.operating.gateway.byMethod).toEqual([{ type: "bank_transfer", count: 3, gross: "1050000.00", fee: "13320.00" }]);
  });
});

/* ------------------------------ helper ------------------------------ */

async function createUser(role: UserRole): Promise<User> {
  seq += 1;
  return prisma.user.create({
    data: {
      fullName: `PL ${role} ${seq}`,
      phone: `+6281${String(seq).padStart(9, "0")}`,
      referralCode: `PLA${String(seq).padStart(6, "0")}`,
      role
    }
  });
}

async function sale(input: {
  status: "PAID" | "REFUNDED";
  amount: number;
  createdAt?: Date;
  paidAt?: Date | null;
  payment?: { provider: string; paymentType: string; paidAt: Date };
}) {
  const buyer = await createUser("USER");
  const silver = await prisma.membership.findFirstOrThrow({ where: { tier: "SILVER" } });
  const order = await prisma.membershipOrder.create({
    data: { userId: buyer.id, membershipId: silver.id, status: "PAID", totalAmount: new Prisma.Decimal(input.amount), packageSnapshot: {} }
  });
  const invoice = await prisma.invoice.create({
    data: {
      orderId: order.id,
      userId: buyer.id,
      number: `INV-PLA-${buyer.referralCode}`,
      status: input.status,
      amount: new Prisma.Decimal(input.amount),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      ...(input.paidAt !== undefined ? { paidAt: input.paidAt } : { paidAt: new Date() })
    }
  });
  if (input.payment) {
    await prisma.membershipPayment.create({
      data: {
        orderId: order.id,
        invoiceId: invoice.id,
        userId: buyer.id,
        status: input.status,
        amount: new Prisma.Decimal(input.amount),
        provider: input.payment.provider,
        paidAt: input.payment.paidAt,
        metadata: { paymentType: input.payment.paymentType }
      }
    });
  }
}

function call(user: User, path: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` })}` }
  });
}
