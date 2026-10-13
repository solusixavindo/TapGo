import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Struktur dan pengakuan laporan laba rugi menurut SAK Indonesia (keputusan Owner 13 Okt 2026):
 *  - PKP, harga jual sudah termasuk PPN 11%: pendapatan tanpa PPN, PPN keluaran hanya catatan kewajiban;
 *  - PPh final 0,5% dari pendapatan bruto (tanpa PPN), di bawah laba sebelum pajak;
 *  - tagihan pascabayar disajikan neto (hanya biaya layanan), prabayar bruto;
 *  - saldo PPOB manfaat paket = pendapatan diterima di muka, dikeluarkan dari pendapatan dan HPP paket.
 */
type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;
let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let seq = 0;

describe.skipIf(!runIntegration)("Laba rugi sesuai struktur SAK", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.PL_SERVER_COST_MONTHLY = "0";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-profit-loss-sak-0000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-profit-loss-sak-000";
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
    delete process.env.PL_PPN_MODE;
    delete process.env.PL_INCOME_TAX_MODE;
    delete process.env.PL_FINAL_TAX_RATE_PERCENT;
    delete process.env.PL_CORPORATE_TAX_RATE_PERCENT;
    await cleanDatabase();
    await seedMemberships();
    // Angka bulat setelah PPN 11%: saldo PPOB Silver 111.000 (=> 100.000 tanpa PPN), HPP paket 211.000.
    await prisma.membership.update({
      where: { tier: "SILVER" },
      data: { ppobBalance: new Prisma.Decimal(111_000), hppTotal: new Prisma.Decimal(211_000) }
    });
  });

  afterAll(async () => {
    for (const key of ["PL_SERVER_COST_MONTHLY", "PL_PPN_MODE", "PL_INCOME_TAX_MODE", "PL_FINAL_TAX_RATE_PERCENT", "PL_CORPORATE_TAX_RATE_PERCENT"]) {
      delete process.env[key];
    }
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function scenario() {
    const vip = await createUser("SUPER_ADMIN_VIP");
    const buyer = await createUser("USER");
    const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
    const order = await prisma.membershipOrder.create({
      data: { userId: buyer.id, membershipId: silver.id, status: "PAID", totalAmount: new Prisma.Decimal(1_110_000), packageSnapshot: {} }
    });
    await prisma.invoice.create({
      data: { orderId: order.id, userId: buyer.id, number: "INV-SAK-1", status: "PAID", amount: new Prisma.Decimal(1_110_000), paidAt: new Date() }
    });
    await prisma.commission.create({
      data: { sourceUserId: buyer.id, triggerType: "TEST", triggerId: "sak-ride", beneficiaryId: vip.id, type: "RIDE_COMPANY_REVENUE", status: "PENDING", amount: new Prisma.Decimal(8_000) }
    });
    const product = await prisma.ppobProduct.create({
      data: { sku: "SAK_TEST", category: "PULSA", brand: "Telkomsel", name: "Pulsa", price: new Prisma.Decimal(33_300) }
    });
    async function ppob(reference: string, category: "PULSA" | "BPJS", total: number, cost: number) {
      await prisma.ppobTransaction.create({
        data: {
          publicReference: reference, userId: buyer.id, productId: product.id, skuSnapshot: product.sku, productNameSnapshot: product.name,
          brandSnapshot: product.brand, category, targetNumber: "081200000000", amount: new Prisma.Decimal(total), adminFee: new Prisma.Decimal(0),
          totalAmount: new Prisma.Decimal(total), status: "SUCCESS", provider: "digiflazz", providerCost: new Prisma.Decimal(cost), completedAt: new Date()
        }
      });
    }
    await ppob("PPOB-SAK-1", "PULSA", 33_300, 20_000); // prabayar: bruto, tanpa PPN 30.000, modal 20.000
    await ppob("PPOB-SAK-2", "BPJS", 102_460, 101_350); // pascabayar: neto, biaya layanan 1.110 => 1.000 tanpa PPN
    return vip;
  }

  async function report(vip: User) {
    const response = await call(vip, "/api/v1/admin/reports/profit-loss");
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: any }).data;
  }

  it("bawaan (PKP, PPh final 0,5%): urutan laporan, PPN dikeluarkan, tagihan neto, saldo PPOB ditangguhkan", async () => {
    const data = await report(await scenario());

    // Pendapatan usaha, tanpa PPN: membership 1.110.000 => 1.000.000; saldo PPOB ditangguhkan 100.000.
    expect(data.revenue.membershipSales).toBe("1000000.00");
    expect(data.revenue.membershipDeferred).toBe("100000.00");
    expect(data.revenue.membershipRecognized).toBe("900000.00");
    expect(data.revenue.rideCommission).toBe("8000.00");
    expect(data.revenue.ppobPrepaid).toBe("30000.00");
    expect(data.revenue.ppobPostpaidFee).toBe("1000.00");
    expect(data.revenue.total).toBe("939000.00");

    // Beban pokok pendapatan: HPP paket 211.000 - saldo PPOB 111.000 = 100.000; modal pulsa 20.000; modal tagihan tidak jadi beban.
    expect(data.cogs.hppPackages).toBe("100000.00");
    expect(data.cogs.ppobCost).toBe("20000.00");
    expect(data.cogs.total).toBe("120000.00");
    expect(data.grossProfit).toBe("819000.00");

    // Tidak ada beban usaha; laba usaha = laba sebelum pajak; PPh final 0,5% x 939.000 = 4.695.
    expect(data.opex.total).toBe("0.00");
    expect(data.operatingProfit).toBe("819000.00");
    expect(data.profitBeforeTax).toBe("819000.00");
    expect(data.incomeTax).toEqual({ mode: "FINAL_OMZET", ratePercent: 0.5, amount: "4695.00" });
    expect(data.netProfit).toBe("814305.00");
    expect(data.totalExpenses).toBe("124695.00");

    // PPN keluaran (kewajiban, bukan pendapatan/beban): 110.000 + 3.300 + 110.
    expect(data.memo.ppnOutput).toBe("113410.00");
  });

  it("PPh badan: 22% dari laba sebelum pajak, nol bila rugi; tanpa PPN bila tidak PKP", async () => {
    process.env.PL_INCOME_TAX_MODE = "CORPORATE";
    process.env.PL_PPN_MODE = "NONE";
    const vip = await scenario();
    const data = await report(vip);
    // Tanpa PPN: membership 1.110.000 - saldo PPOB 111.000 = 999.000; ride 8.000; prabayar 33.300; tagihan neto 1.110.
    expect(data.revenue.total).toBe("1041410.00");
    expect(data.memo.ppnOutput).toBe("0.00");
    expect(data.incomeTax.mode).toBe("CORPORATE");
    const expectedTax = (Number(data.profitBeforeTax) * 0.22).toFixed(2);
    expect(data.incomeTax.amount).toBe(expectedTax);
    expect(data.netProfit).toBe((Number(data.profitBeforeTax) - Number(expectedTax)).toFixed(2));

    // Rugi: biaya server melebihi laba => pajak 0.
    process.env.PL_SERVER_COST_MONTHLY = "999999999";
    const loss = await report(vip);
    process.env.PL_SERVER_COST_MONTHLY = "0";
    expect(Number(loss.profitBeforeTax)).toBeLessThan(0);
    expect(loss.incomeTax.amount).toBe("0.00");
    expect(loss.netProfit).toBe(loss.profitBeforeTax);
  });

  it("pajak penghasilan belum ditentukan (NONE): laba bersih sama dengan laba sebelum pajak", async () => {
    process.env.PL_INCOME_TAX_MODE = "NONE";
    const data = await report(await scenario());
    expect(data.incomeTax.amount).toBe("0.00");
    expect(data.netProfit).toBe(data.profitBeforeTax);
    expect(data.notes.some((note: string) => note.includes("belum dihitung"))).toBe(true);
  });
});

async function createUser(role: UserRole): Promise<User> {
  seq += 1;
  return prisma.user.create({
    data: { fullName: `SAK ${role} ${seq}`, phone: `+6281${String(seq).padStart(9, "0")}`, referralCode: `SAK${String(seq).padStart(6, "0")}`, role }
  });
}

function call(user: User, path: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` })}` }
  });
}
