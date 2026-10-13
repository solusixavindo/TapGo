import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Laporan keuangan menurut periode (harian, mingguan, bulanan, tahunan: konsol mengirim dateFrom/dateTo) dan
 * ringkasan PPOB yang menjawab "dari mana uang PPOB berasal": penjualan dari saldo pelanggan, modal Digiflazz,
 * selisih, dan satu-satunya sumber uang tunai (top up PPOB lunas).
 */
type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;
let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let seq = 0;

const JAN = { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T23:59:59.999Z" };
const inJan = new Date("2026-01-15T05:00:00Z");
const inDec = new Date("2025-12-20T05:00:00Z");

describe.skipIf(!runIntegration)("Laporan keuangan menurut periode", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-period-reports-0";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-period-reports-";
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
    await prisma.ppobTransaction.deleteMany();
    await seedMemberships();
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  describe("ringkasan PPOB: penjualan, modal, dan sumber uang", () => {
    async function seedPpob() {
      const buyer = await createUser("USER", "+6281234567890");
      const product = await prisma.ppobProduct.create({
        data: { sku: "PULSA_TSEL_10", category: "PULSA", brand: "Telkomsel", name: "Pulsa 10.000", price: new Prisma.Decimal(11000) }
      });
      const tx = (reference: string, data: Partial<Prisma.PpobTransactionUncheckedCreateInput>) =>
        prisma.ppobTransaction.create({
          data: {
            publicReference: reference, userId: buyer.id, productId: product.id, skuSnapshot: product.sku,
            productNameSnapshot: product.name, brandSnapshot: product.brand, category: "PULSA", targetNumber: "081298765432",
            amount: new Prisma.Decimal(11000), totalAmount: new Prisma.Decimal(11000), status: "SUCCESS", provider: "digiflazz",
            createdAt: inJan, ...data
          }
        });
      await tx("PS-OK1", { providerCost: new Prisma.Decimal(10200) });
      await tx("PS-OK2", { providerCost: new Prisma.Decimal(10300) });
      await tx("PS-NOCOST", {});
      await tx("PS-FAIL", { status: "FAILED" });
      await tx("PS-OPEN", { status: "PROCESSING" });
      await tx("PS-DEC", { providerCost: new Prisma.Decimal(10200), createdAt: inDec });

      const topUp = (reference: string, data: Partial<Prisma.WalletTopUpOrderUncheckedCreateInput>) =>
        prisma.walletTopUpOrder.create({
          data: {
            userId: buyer.id, reference, amount: new Prisma.Decimal(25000), status: "PAID", provider: "MIDTRANS",
            paidAt: inJan, createdAt: inJan, metadata: { target: "PPOB" }, ...data
          }
        });
      await topUp("TU-ONLINE", {});
      await topUp("TU-MANUAL", { provider: "MANUAL_BANK", amount: new Prisma.Decimal(50000) });
      await topUp("TU-WALLET", { metadata: { target: "WALLET" } });
      await topUp("TU-PENDING", { status: "PENDING", paidAt: null });
      await topUp("TU-DEC", { paidAt: inDec, createdAt: inDec });
    }

    it("menghitung penjualan, modal, selisih, dan sumber saldo untuk periode yang dipilih", async () => {
      await seedPpob();
      const admin = await createUser("SUPER_ADMIN");
      const response = await call(admin, `/api/v1/admin/reports/ppob-summary?dateFrom=${JAN.from}&dateTo=${JAN.to}`);
      expect(response.status).toBe(200);
      const { sales, funding } = ((await response.json()) as { data: any }).data;

      // Januari: 3 sukses x 11.000 = 33.000; modal tercatat pada 2 (20.500), jadi selisih = 22.000 - 20.500 = 1.500.
      expect(sales).toMatchObject({
        successCount: 3, salesTotal: "33000.00", costedCount: 2, providerCost: "20500.00", margin: "1500.00",
        withoutCostCount: 1, openCount: 1, openAmount: "11000.00", failedCount: 1, failedAmount: "11000.00"
      });
      // Hanya top up PPOB yang LUNAS dan dibayar dalam Januari: online 25.000 dan manual 50.000.
      expect(funding).toEqual({ topUpOnlineCount: 1, topUpOnline: "25000.00", topUpManualCount: 1, topUpManual: "50000.00" });
    });

    it("tanpa rentang: seluruh waktu", async () => {
      await seedPpob();
      const admin = await createUser("SUPER_ADMIN_VIP");
      const { sales, funding } = ((await (await call(admin, "/api/v1/admin/reports/ppob-summary")).json()) as { data: any }).data;
      expect(sales).toMatchObject({ successCount: 4, salesTotal: "44000.00", costedCount: 3, providerCost: "30700.00", margin: "2300.00" });
      expect(funding).toMatchObject({ topUpOnlineCount: 2, topUpOnline: "50000.00", topUpManualCount: 1 });
    });

    it("tanpa transaksi: semua nol, bukan galat", async () => {
      const admin = await createUser("SUPER_ADMIN");
      const { sales, funding } = ((await (await call(admin, "/api/v1/admin/reports/ppob-summary")).json()) as { data: any }).data;
      expect(sales).toMatchObject({ successCount: 0, salesTotal: "0.00", margin: "0.00", withoutCostCount: 0 });
      expect(funding).toEqual({ topUpOnlineCount: 0, topUpOnline: "0.00", topUpManualCount: 0, topUpManual: "0.00" });
    });
  });

  describe("pendapatan membership mengikuti tanggal dibayar", () => {
    it("invoice dibuat Desember tetapi dibayar Januari masuk laporan Januari saja", async () => {
      const buyer = await createUser("USER");
      const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
      const order = await prisma.membershipOrder.create({
        data: { userId: buyer.id, membershipId: silver.id, status: "PAID", totalAmount: new Prisma.Decimal(500000), packageSnapshot: {} }
      });
      await prisma.invoice.create({
        data: {
          orderId: order.id, userId: buyer.id, number: "INV-PERIOD-1", status: "PAID", amount: new Prisma.Decimal(500000),
          createdAt: inDec, paidAt: inJan
        }
      });
      const admin = await createUser("SUPER_ADMIN");
      const january = await call(admin, `/api/v1/admin/reports/financial-summary?dateFrom=${JAN.from}&dateTo=${JAN.to}`);
      const december = await call(admin, "/api/v1/admin/reports/financial-summary?dateFrom=2025-12-01T00:00:00.000Z&dateTo=2025-12-31T23:59:59.999Z");
      expect(((await january.json()) as { data: any }).data.totalMembershipRevenuePaid).toBe("500000.00");
      expect(((await december.json()) as { data: any }).data.totalMembershipRevenuePaid).toBe("0.00");
    });
  });

  describe("penarikan dan top up manual menurut periode", () => {
    it("daftar penarikan hanya memuat permintaan dalam rentang", async () => {
      const member = await createUser("USER");
      const wallet = await prisma.wallet.create({ data: { userId: member.id } });
      const make = (requestedAt: Date, amount: number) =>
        prisma.withdrawal.create({
          data: {
            walletId: wallet.id, userId: member.id, amount: new Prisma.Decimal(amount), finalAmount: new Prisma.Decimal(amount),
            bankAccount: {}, requestedAt
          }
        });
      await make(inJan, 100000);
      await make(inDec, 200000);
      const admin = await createUser("SUPER_ADMIN");

      const january = (await (await call(admin, `/api/v1/admin/withdrawals?dateFrom=${JAN.from}&dateTo=${JAN.to}`)).json()) as { data: { items: any[] } };
      expect(january.data.items.map((row) => row.amount)).toEqual(["100000"]);
      const all = (await (await call(admin, "/api/v1/admin/withdrawals")).json()) as { data: { items: any[] } };
      expect(all.data.items).toHaveLength(2);
    });

    it("daftar top up manual hanya memuat pesanan dalam rentang", async () => {
      const member = await createUser("USER");
      const make = (reference: string, createdAt: Date) =>
        prisma.walletTopUpOrder.create({
          data: { userId: member.id, reference, amount: new Prisma.Decimal(25000), provider: "MANUAL_BANK", status: "PENDING", createdAt }
        });
      await make("MTOP-JAN", inJan);
      await make("MTOP-DEC", inDec);
      const admin = await createUser("SUPER_ADMIN");

      const january = (await (await call(admin, `/api/v1/admin/manual-topups?status=PENDING&dateFrom=${JAN.from}&dateTo=${JAN.to}`)).json()) as { data: any[] };
      expect(january.data.map((row) => row.reference)).toEqual(["MTOP-JAN"]);
      const all = (await (await call(admin, "/api/v1/admin/manual-topups?status=PENDING")).json()) as { data: any[] };
      expect(all.data).toHaveLength(2);
    });

    it("tanggal yang bukan tanggal ditolak", async () => {
      const admin = await createUser("SUPER_ADMIN");
      expect((await call(admin, "/api/v1/admin/withdrawals?dateFrom=bukan-tanggal")).status).toBe(400);
      expect((await call(admin, "/api/v1/admin/manual-topups?dateFrom=bukan-tanggal")).status).toBe(400);
    });
  });
});

async function createUser(role: UserRole, phone?: string): Promise<User> {
  seq += 1;
  return prisma.user.create({
    data: { fullName: `Periode ${role} ${seq}`, phone: phone ?? `+6281${String(300000000 + seq)}`, referralCode: `PER${String(seq).padStart(6, "0")}`, role }
  });
}

function call(user: User, path: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` })}` }
  });
}
