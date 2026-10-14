import { createHash } from "node:crypto";
import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Pemantauan untuk Super Admin ke atas: daftar pembayaran online (Midtrans) dan saldo deposit Digiflazz.
 * Keduanya hanya baca; ADMIN biasa ditolak; nomor HP disamarkan; kredensial Digiflazz tidak pernah keluar.
 */
const SERVER_KEY = "test-midtrans-server-key-monitoring";
const DIGI_USER = "tapgo-user-uji";
const DIGI_KEY = "rahasia-digiflazz-jangan-bocor";
const realFetch = globalThis.fetch;
type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;
let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let balanceService: { cache: unknown; lastAttemptAt: number };
let seq = 0;
const saved: Record<string, unknown> = {};
const digiCalls: Array<{ url: string; body: any }> = [];
let digiResponse: { status: number; body: unknown } = { status: 200, body: { data: { deposit: 750000 } } };

describe.skipIf(!runIntegration)("Pemantauan pembayaran online dan saldo Digiflazz", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-online-monitoring-0";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-online-monitoring-";
    const [{ createApp }, tokenService, envModule, balanceModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js"),
      import("../../src/modules/ppob/application/DigiflazzBalanceService.js")
    ]);
    backendEnv = envModule.env;
    balanceService = balanceModule.digiflazzBalanceService as unknown as { cache: unknown; lastAttemptAt: number };
    for (const key of ["PPOB_PROVIDER", "DIGIFLAZZ_USERNAME", "DIGIFLAZZ_API_KEY", "MIDTRANS_SERVER_KEY"] as const) {
      saved[key] = (backendEnv as Record<string, unknown>)[key];
    }
    signAccessToken = tokenService.signAccessToken;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await prisma.ppobTransaction.deleteMany();
    await seedMemberships();
    balanceService.cache = null;
    balanceService.lastAttemptAt = 0;
    digiCalls.length = 0;
    digiResponse = { status: 200, body: { data: { deposit: 750000 } } };
    (backendEnv as Record<string, unknown>).PPOB_PROVIDER = "digiflazz";
    (backendEnv as Record<string, unknown>).DIGIFLAZZ_USERNAME = DIGI_USER;
    (backendEnv as Record<string, unknown>).DIGIFLAZZ_API_KEY = DIGI_KEY;
    (backendEnv as Record<string, unknown>).MIDTRANS_SERVER_KEY = SERVER_KEY;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/cek-saldo")) return realFetch(input, init);
      digiCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify(digiResponse.body), { status: digiResponse.status });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) (backendEnv as Record<string, unknown>)[key] = value;
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  describe("daftar pembayaran online", () => {
    async function seedPayments() {
      const buyer = await createUser("USER", "+6281234567890");
      const silver = await prisma.membership.findUniqueOrThrow({ where: { tier: "SILVER" } });
      const hour = 3_600_000;
      const topUp = (reference: string, data: Partial<Prisma.WalletTopUpOrderUncheckedCreateInput>) =>
        prisma.walletTopUpOrder.create({
          data: { userId: buyer.id, reference, amount: new Prisma.Decimal(25_000), status: "PENDING", provider: "MIDTRANS", ...data }
        });
      await topUp("TOPUP-PEND", {
        createdAt: new Date(Date.now() - 2 * hour),
        expiresAt: new Date(Date.now() + 22 * hour),
        metadata: { target: "PPOB", baseAmount: 25000, feeAmount: 4440, grossAmount: 29440, paymentType: "echannel" }
      });
      await topUp("TOPUP-OVERDUE", {
        createdAt: new Date(Date.now() - 30 * hour),
        expiresAt: new Date(Date.now() - 6 * hour),
        metadata: { target: "WALLET", feeAmount: 4440, grossAmount: 54440 },
        amount: new Prisma.Decimal(50_000)
      });
      await topUp("TOPUP-PAID", {
        status: "PAID",
        paidAt: new Date(),
        createdAt: new Date(Date.now() - hour),
        metadata: { target: "PPOB", feeAmount: 4440, grossAmount: 29440, paymentType: "bank_transfer" }
      });
      await topUp("MTOP-MANUAL", { provider: "MANUAL_BANK" });
      await topUp("TOPUP-NOPROVIDER", { provider: null });

      const order = await prisma.membershipOrder.create({
        data: {
          userId: buyer.id,
          membershipId: silver.id,
          status: "PENDING",
          totalAmount: new Prisma.Decimal(500_000),
          packageSnapshot: {},
          expiresAt: new Date(Date.now() + 20 * hour)
        }
      });
      const invoice = await prisma.invoice.create({
        data: { orderId: order.id, userId: buyer.id, number: "INV-MON-1", status: "PENDING", amount: new Prisma.Decimal(500_000) }
      });
      await prisma.membershipPayment.create({
        data: {
          orderId: order.id, invoiceId: invoice.id, userId: buyer.id, status: "PENDING", amount: new Prisma.Decimal(500_000),
          provider: "MIDTRANS", metadata: { paymentType: "bank_transfer" }
        }
      });
      await prisma.membershipPayment.create({
        data: {
          orderId: order.id, invoiceId: invoice.id, userId: buyer.id, status: "PENDING", amount: new Prisma.Decimal(500_000),
          provider: "MANUAL_BANK"
        }
      });
    }

    it("hanya SUPER_ADMIN ke atas; ADMIN ditolak", async () => {
      const admin = await createUser("ADMIN");
      const superAdmin = await createUser("SUPER_ADMIN");
      const vip = await createUser("SUPER_ADMIN_VIP");
      expect((await call(admin, "/api/v1/admin/online-payments")).status).toBe(403);
      expect((await call(superAdmin, "/api/v1/admin/online-payments")).status).toBe(200);
      expect((await call(vip, "/api/v1/admin/online-payments")).status).toBe(200);
      expect((await call(admin, "/api/v1/admin/ppob/digiflazz-balance")).status).toBe(403);
      expect((await call(superAdmin, "/api/v1/admin/ppob/digiflazz-balance")).status).toBe(200);
      expect((await call(vip, "/api/v1/admin/ppob/digiflazz-balance")).status).toBe(200);
    });

    it("menggabungkan top up dan membership lewat penyedia, tanpa transfer manual dan pesanan tanpa penyedia", async () => {
      await seedPayments();
      const vip = await createUser("SUPER_ADMIN_VIP");
      const response = await call(vip, "/api/v1/admin/online-payments");
      const text = await response.text();
      const data = (JSON.parse(text) as { data: any }).data;

      expect(data.items.map((item: any) => item.reference).sort()).toEqual(["INV-MON-1", "TOPUP-OVERDUE", "TOPUP-PAID", "TOPUP-PEND"]);
      const byRef = Object.fromEntries(data.items.map((item: any) => [item.reference, item]));
      // Top up: yang ditagih = nominal + biaya; saldo yang dikredit = nominal.
      expect(byRef["TOPUP-PEND"]).toMatchObject({
        kind: "TOPUP", status: "PENDING", amount: 29440, baseAmount: 25000, feeAmount: 4440, method: "echannel", description: "Top up Saldo PPOB", overdue: false
      });
      expect(byRef["TOPUP-OVERDUE"]).toMatchObject({ amount: 54440, baseAmount: 50000, description: "Top up Saldo TapGo", overdue: true });
      expect(byRef["TOPUP-PAID"]).toMatchObject({ status: "PAID", method: "bank_transfer" });
      expect(byRef["INV-MON-1"]).toMatchObject({ kind: "MEMBERSHIP", amount: 500000, method: "bank_transfer", overdue: false });
      expect(byRef["INV-MON-1"].description).toContain("Silver");
      // Nomor HP penuh tidak pernah dikirim.
      expect(text).not.toContain("+6281234567890");
      expect(byRef["TOPUP-PEND"].phoneMasked).toBe("+628****890");
      expect(data.pagination.total).toBe(4);
      expect(data.summary).toMatchObject({ total: 4, byStatus: { PENDING: 3, PAID: 1 }, overduePending: 1 });
    });

    it("menyaring menurut jenis dan status, serta membagi halaman terbaru lebih dulu", async () => {
      await seedPayments();
      const vip = await createUser("SUPER_ADMIN_VIP");
      const topUps = ((await (await call(vip, "/api/v1/admin/online-payments?kind=TOPUP")).json()) as { data: any }).data;
      expect(topUps.items.every((item: any) => item.kind === "TOPUP")).toBe(true);
      expect(topUps.pagination.total).toBe(3);
      const paid = ((await (await call(vip, "/api/v1/admin/online-payments?status=PAID")).json()) as { data: any }).data;
      expect(paid.items.map((item: any) => item.reference)).toEqual(["TOPUP-PAID"]);
      // Ringkasan tidak ikut menyempit oleh filter status.
      expect(paid.summary.byStatus.PENDING).toBe(3);

      const page1 = ((await (await call(vip, "/api/v1/admin/online-payments?pageSize=2&page=1")).json()) as { data: any }).data;
      const page2 = ((await (await call(vip, "/api/v1/admin/online-payments?pageSize=2&page=2")).json()) as { data: any }).data;
      const all = [...page1.items, ...page2.items];
      expect(all).toHaveLength(4);
      expect(new Set(all.map((item: any) => item.reference)).size).toBe(4);
      const times = all.map((item: any) => new Date(item.createdAt).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it("notifikasi Midtrans 'pending' mencatat metode yang dipilih pembeli tanpa mengubah status", async () => {
      const buyer = await createUser("USER");
      await prisma.walletTopUpOrder.create({
        data: {
          userId: buyer.id, reference: "TOPUP-NOTIF", amount: new Prisma.Decimal(25_000), status: "PENDING", provider: "MIDTRANS",
          method: "MIDTRANS_SNAP", providerReference: "TOPUP-NOTIF", metadata: { target: "PPOB", grossAmount: 29440, feeAmount: 4440 }
        }
      });
      const gross = "29440.00";
      const signature = createHash("sha512").update(`TOPUP-NOTIF201${gross}${SERVER_KEY}`).digest("hex");
      const response = await realFetch(`${baseUrl}/api/v1/payments/midtrans/notification`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          order_id: "TOPUP-NOTIF", transaction_id: "trx-1", transaction_status: "pending", status_code: "201",
          gross_amount: gross, currency: "IDR", payment_type: "echannel", signature_key: signature
        })
      });
      expect(response.status).toBe(200);
      const order = await prisma.walletTopUpOrder.findUniqueOrThrow({ where: { reference: "TOPUP-NOTIF" } });
      expect(order.status).toBe("PENDING");
      expect(order.metadata).toMatchObject({ target: "PPOB", grossAmount: 29440, feeAmount: 4440, paymentType: "echannel" });
    });
  });

  describe("transaksi Digiflazz", () => {
    const minute = 60_000;

    async function seedTransactions() {
      const buyer = await createUser("USER", "+6281234567890");
      const pulsa = await prisma.ppobProduct.create({
        data: { sku: "PULSA_TSEL_10", category: "PULSA", brand: "Telkomsel", name: "Pulsa Telkomsel 10.000", price: new Prisma.Decimal(11_000), providerSku: "tsel10" }
      });
      const token = await prisma.ppobProduct.create({
        data: { sku: "PLN_20", category: "PLN_PREPAID", brand: "PLN", name: "Token PLN 20.000", price: new Prisma.Decimal(21_500), providerSku: "pln20" }
      });
      const make = (reference: string, data: Partial<Prisma.PpobTransactionUncheckedCreateInput>) =>
        prisma.ppobTransaction.create({
          data: {
            publicReference: reference, userId: buyer.id, productId: pulsa.id, skuSnapshot: "PULSA_TSEL_10",
            productNameSnapshot: "Pulsa Telkomsel 10.000", brandSnapshot: "Telkomsel", category: "PULSA",
            targetNumber: "081298765432", amount: new Prisma.Decimal(11_000), adminFee: new Prisma.Decimal(0),
            totalAmount: new Prisma.Decimal(11_000), status: "SUCCESS", provider: "digiflazz", ...data
          }
        });
      const created = new Date(Date.now() - 3 * 3_600_000);
      await make("PPOB-OK1", {
        createdAt: created, completedAt: new Date(created.getTime() + 7_000), providerCost: new Prisma.Decimal(10_200),
        providerReference: "DGF-OK1", serialNumber: "SN1234567890ABCD"
      });
      await make("PPOB-OK2", { createdAt: created, completedAt: new Date(created.getTime() + 3_000) });
      await make("PPOB-FAIL", {
        status: "FAILED", createdAt: created, completedAt: new Date(created.getTime() + 5_000), failureCode: "DIGIFLAZZ_RC_44",
        failureReason: "Saldo tidak cukup", refundTransactionId: "11111111-1111-4111-8111-111111111111"
      });
      await make("PPOB-WAIT", { status: "PROCESSING", createdAt: new Date(Date.now() - 2 * minute), providerReference: "PPOB-WAIT" });
      await make("PPOB-STUCK", { status: "PROCESSING", createdAt: new Date(Date.now() - 45 * minute), providerReference: "PPOB-STUCK" });
      await make("PPOB-TOKEN", {
        productId: token.id, skuSnapshot: "PLN_20", productNameSnapshot: "Token PLN 20.000", brandSnapshot: "PLN",
        category: "PLN_PREPAID", targetNumber: "14212345678", amount: new Prisma.Decimal(21_500), totalAmount: new Prisma.Decimal(21_500),
        createdAt: created, completedAt: new Date(created.getTime() + 9_000), providerCost: new Prisma.Decimal(20_900), serialNumber: "5555666677778888999"
      });
    }

    async function list(user: User, query = "") {
      const response = await call(user, `/api/v1/admin/ppob/transactions${query}`);
      const text = await response.text();
      return { status: response.status, text, data: response.status === 200 ? JSON.parse(text).data : null };
    }

    it("hanya SUPER_ADMIN ke atas; ADMIN dan pengguna biasa ditolak", async () => {
      expect((await list(await createUser("ADMIN"))).status).toBe(403);
      expect((await list(await createUser("USER"))).status).toBe(403);
      expect((await list(await createUser("SUPER_ADMIN"))).status).toBe(200);
      expect((await list(await createUser("SUPER_ADMIN_VIP"))).status).toBe(200);
    });

    it("menampilkan rincian, ringkasan per status, dan transaksi tertahan", async () => {
      await seedTransactions();
      const { data } = await list(await createUser("SUPER_ADMIN_VIP"));
      expect(data.pagination.total).toBe(6);
      expect(data.summary.byStatus).toEqual({ SUCCESS: 3, FAILED: 1, PROCESSING: 2 });
      expect(data.summary.stuck).toBe(1);
      // Penjualan sukses 11.000 + 11.000 + 21.500; modal tercatat pada 2 dari 3 (10.200 + 20.900). Selisih dihitung dari
      // penjualan yang bermodal saja (11.000 + 21.500 = 32.500), jadi 32.500 - 31.100 = 1.400, bukan 43.500 - 31.100.
      expect(data.summary.success).toMatchObject({ count: 3, sales: 43_500, costedSales: 32_500, providerCost: 31_100, withCostCount: 2 });

      const byRef = Object.fromEntries(data.items.map((item: any) => [item.reference, item]));
      expect(byRef["PPOB-OK1"]).toMatchObject({
        status: "SUCCESS", providerReference: "DGF-OK1", providerCost: 10_200, margin: 800, durationSeconds: 7, refunded: false, stuck: false
      });
      expect(byRef["PPOB-OK2"]).toMatchObject({ providerCost: null, margin: null });
      expect(byRef["PPOB-FAIL"]).toMatchObject({
        status: "FAILED", failureCode: "DIGIFLAZZ_RC_44", failureReason: "Saldo tidak cukup", refunded: true, margin: null
      });
      expect(byRef["PPOB-WAIT"]).toMatchObject({ status: "PROCESSING", stuck: false, durationSeconds: null });
      expect(byRef["PPOB-STUCK"]).toMatchObject({ status: "PROCESSING", stuck: true });
    });

    it("untung bersih per transaksi: rugi, di bawah target, memenuhi; prabayar Rp500 dan pascabayar Rp1.000", async () => {
      await seedTransactions();
      const buyer = await prisma.user.findFirstOrThrow({ where: { role: "USER" } });
      const pulsa = await prisma.ppobProduct.findUniqueOrThrow({ where: { sku: "PULSA_TSEL_10" } });
      const extra = (reference: string, category: "PULSA" | "BPJS", totalAmount: number, providerCost: number) =>
        prisma.ppobTransaction.create({
          data: {
            publicReference: reference, userId: buyer.id, productId: pulsa.id, skuSnapshot: "PULSA_TSEL_10", productNameSnapshot: "Produk uji",
            brandSnapshot: "Uji", category, targetNumber: "081298765432", amount: new Prisma.Decimal(totalAmount), totalAmount: new Prisma.Decimal(totalAmount),
            status: "SUCCESS", provider: "digiflazz", providerCost: new Prisma.Decimal(providerCost), createdAt: new Date(Date.now() - 2 * 3_600_000),
            completedAt: new Date(Date.now() - 2 * 3_600_000 + 4_000)
          }
        });
      // Angka bersih dihitung terpisah (PPN 11% inklusif atas selisih, PPh final 0,5% dari omzet):
      // prabayar 11.000/11.000 = -55; pascabayar (omzet = biaya layanan tanpa PPN) 101.150/100.000 = 1.031 dan 101.000/100.000 = 896.
      await extra("PPOB-LOSS", "PULSA", 11_000, 11_000);
      await extra("PPOB-POST-OK", "BPJS", 101_150, 100_000);
      await extra("PPOB-POST-LOW", "BPJS", 101_000, 100_000);

      const vip = await createUser("SUPER_ADMIN_VIP");
      const { data } = await list(vip);
      const byRef = Object.fromEntries(data.items.map((item: any) => [item.reference, item]));
      expect(byRef["PPOB-OK1"]).toMatchObject({ netMargin: 666, marginStatus: "OK" });
      expect(byRef["PPOB-TOKEN"]).toMatchObject({ netMargin: 433, marginStatus: "BELOW_TARGET" });
      expect(byRef["PPOB-LOSS"]).toMatchObject({ netMargin: -55, marginStatus: "LOSS" });
      expect(byRef["PPOB-POST-OK"]).toMatchObject({ netMargin: 1031, marginStatus: "OK" });
      expect(byRef["PPOB-POST-LOW"]).toMatchObject({ netMargin: 896, marginStatus: "BELOW_TARGET" });
      // Tanpa modal tercatat atau tidak sukses: tidak dinilai.
      expect(byRef["PPOB-OK2"]).toMatchObject({ netMargin: null, marginStatus: null });
      expect(byRef["PPOB-FAIL"]).toMatchObject({ netMargin: null, marginStatus: null });

      expect(data.summary.success).toMatchObject({
        netMargin: 2972,
        lossCount: 1,
        belowTargetCount: 2,
        targets: { prepaid: 500, postpaid: 1000 }
      });

      // Filter "di bawah target atau rugi" hanya memuat tiga transaksi itu; ringkasan tetap menghitung semua.
      const issues = (await list(vip, "?marginIssue=1")).data;
      expect(issues.items.map((item: any) => item.reference).sort()).toEqual(["PPOB-LOSS", "PPOB-POST-LOW", "PPOB-TOKEN"]);
      expect(issues.pagination.total).toBe(3);
      expect(issues.summary.success.lossCount).toBe(1);
      // Digabung dengan pencarian: hanya yang cocok dan bermasalah.
      expect((await list(vip, "?marginIssue=1&search=ppob-loss")).data.items.map((item: any) => item.reference)).toEqual(["PPOB-LOSS"]);
      expect((await list(vip, "?marginIssue=1&search=ppob-ok1")).data.items).toHaveLength(0);
      // Nilai marginIssue sembarang ditolak.
      expect((await list(vip, "?marginIssue=ya")).status).toBe(400);
    });

    it("menyamarkan nomor tujuan, nomor HP, dan serial/token", async () => {
      await seedTransactions();
      const { data, text } = await list(await createUser("SUPER_ADMIN"));
      const byRef = Object.fromEntries(data.items.map((item: any) => [item.reference, item]));
      expect(byRef["PPOB-OK1"].targetMasked).toBe("0812*****432");
      expect(byRef["PPOB-OK1"].phoneMasked).toBe("+628****890");
      expect(byRef["PPOB-OK1"].serialMasked).toBe("********ABCD");
      expect(byRef["PPOB-TOKEN"].serialMasked.endsWith("8999")).toBe(true);
      expect(byRef["PPOB-OK2"].serialMasked).toBeNull();
      for (const secret of ["081298765432", "14212345678", "SN1234567890ABCD", "5555666677778888999", "+6281234567890"]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toContain(DIGI_KEY);
    });

    it("menyaring menurut status, kategori, tertahan, dan pencarian referensi", async () => {
      await seedTransactions();
      const vip = await createUser("SUPER_ADMIN_VIP");
      const failed = (await list(vip, "?status=FAILED")).data;
      expect(failed.items.map((item: any) => item.reference)).toEqual(["PPOB-FAIL"]);
      // Ringkasan tidak ikut menyempit oleh filter status, supaya kartu tetap menunjukkan seluruh sebaran.
      expect(failed.summary.total).toBe(6);

      const stuck = (await list(vip, "?stuck=1")).data;
      expect(stuck.items.map((item: any) => item.reference)).toEqual(["PPOB-STUCK"]);

      const token = (await list(vip, "?category=PLN_PREPAID")).data;
      expect(token.items.map((item: any) => item.reference)).toEqual(["PPOB-TOKEN"]);
      expect(token.summary.total).toBe(1);

      expect((await list(vip, "?search=dgf-ok1")).data.items.map((item: any) => item.reference)).toEqual(["PPOB-OK1"]);
      expect((await list(vip, "?search=ppob-stuck")).data.items.map((item: any) => item.reference)).toEqual(["PPOB-STUCK"]);
      expect((await list(vip, "?search=tidak-ada-ini")).data.items).toHaveLength(0);
    });

    it("menolak nilai filter yang tidak dikenal dan membatasi ukuran halaman", async () => {
      const vip = await createUser("SUPER_ADMIN_VIP");
      expect((await list(vip, "?status=BOHONG")).status).toBe(400);
      expect((await list(vip, "?category=BOHONG")).status).toBe(400);
      expect((await list(vip, "?pageSize=101")).status).toBe(400);
    });

    it("membagi halaman dan mengurutkan dari yang terbaru", async () => {
      await seedTransactions();
      const vip = await createUser("SUPER_ADMIN_VIP");
      const first = (await list(vip, "?pageSize=2&page=1")).data;
      const second = (await list(vip, "?pageSize=2&page=2")).data;
      expect(first.pagination).toMatchObject({ total: 6, totalPages: 3 });
      expect(first.items.map((item: any) => item.reference)).toEqual(["PPOB-WAIT", "PPOB-STUCK"]);
      expect(second.items).toHaveLength(2);
    });
  });

  describe("saldo Digiflazz", () => {
    async function transaction(reference: string, status: "SUCCESS" | "PROCESSING", cost: number | null, createdAt: Date, total = 20_000) {
      const user = await createUser("USER");
      const product = await prisma.ppobProduct.upsert({
        where: { sku: "MON_PULSA" },
        update: {},
        create: { sku: "MON_PULSA", category: "PULSA", brand: "Telkomsel", name: "Pulsa", price: new Prisma.Decimal(20_000) }
      });
      await prisma.ppobTransaction.create({
        data: {
          publicReference: reference, userId: user.id, productId: product.id, skuSnapshot: product.sku, productNameSnapshot: product.name,
          brandSnapshot: product.brand, category: "PULSA", targetNumber: "081200000000", amount: new Prisma.Decimal(total), adminFee: new Prisma.Decimal(0),
          totalAmount: new Prisma.Decimal(total), status, provider: "digiflazz", createdAt,
          ...(cost !== null ? { providerCost: new Prisma.Decimal(cost) } : {})
        }
      });
    }

    async function overview(user: User, query = "") {
      const response = await call(user, `/api/v1/admin/ppob/digiflazz-balance${query}`);
      const text = await response.text();
      return { text, data: (JSON.parse(text) as { data: any }).data };
    }

    it("membaca saldo dengan sign yang benar, menghitung pemakaian dan perkiraan sisa hari, tanpa membocorkan kredensial", async () => {
      const vip = await createUser("SUPER_ADMIN_VIP");
      const now = Date.now();
      await transaction("MON-1", "SUCCESS", 19_000, new Date(now - 60_000));
      await transaction("MON-2", "SUCCESS", 38_000, new Date(now - 3 * 86_400_000), 40_000);
      await transaction("MON-3", "SUCCESS", 70_000, new Date(now - 20 * 86_400_000), 72_000);
      await transaction("MON-4", "PROCESSING", null, new Date(now - 30_000), 25_000);
      await prisma.wallet.create({
        data: { userId: (await createUser("USER")).id, balance: new Prisma.Decimal(0), cashBalance: new Prisma.Decimal(0), ppobBalance: new Prisma.Decimal(300_000) }
      });

      const { text, data } = await overview(vip);
      expect(digiCalls).toHaveLength(1);
      expect(digiCalls[0]!.url).toMatch(/\/cek-saldo$/);
      expect(digiCalls[0]!.body).toEqual({
        cmd: "deposit",
        username: DIGI_USER,
        sign: createHash("md5").update(`${DIGI_USER}${DIGI_KEY}depo`).digest("hex")
      });
      expect(data.provider).toMatchObject({ configured: true, balance: 750000, stale: false, error: null });
      expect(data.level).toBe("OK");
      expect(data.thresholds).toEqual({ warn: 500000, critical: 100000 });
      expect(data.spend.today.count).toBeGreaterThanOrEqual(1);
      // 7 hari: hanya MON-1 dan MON-2 (19.000 + 38.000); MON-3 di luar 7 hari.
      expect(data.spend.last7Days).toMatchObject({ count: 2, cost: 57000, averagePerDay: 8143 });
      expect(data.estimatedDaysLeft).toBe(92.1);
      expect(data.customerPpobLiability).toBe(300000);
      expect(data.coverageRatio).toBe(2.5);
      expect(data.inFlight).toEqual({ count: 1, amount: 25000 });
      // Kredensial tidak pernah ikut jawaban.
      expect(text).not.toContain(DIGI_KEY);
      expect(text).not.toContain(DIGI_USER);
    });

    it("menandai menipis dan kritis menurut ambang, serta memakai cache 60 detik", async () => {
      const vip = await createUser("SUPER_ADMIN_VIP");
      digiResponse = { status: 200, body: { data: { deposit: 300000 } } };
      expect((await overview(vip)).data.level).toBe("LOW");
      // Panggilan kedua memakai cache: tidak menghubungi Digiflazz lagi.
      digiResponse = { status: 200, body: { data: { deposit: 50000 } } };
      const cached = await overview(vip);
      expect(digiCalls).toHaveLength(1);
      expect(cached.data.provider).toMatchObject({ balance: 300000, stale: true });

      balanceService.cache = null;
      balanceService.lastAttemptAt = 0;
      expect((await overview(vip)).data.level).toBe("CRITICAL");
    });

    it("menampilkan galat yang dibersihkan bila Digiflazz menolak, tetap menyimpan bacaan terakhir", async () => {
      const vip = await createUser("SUPER_ADMIN_VIP");
      expect((await overview(vip)).data.provider.balance).toBe(750000);

      balanceService.lastAttemptAt = 0;
      digiResponse = { status: 200, body: { data: { rc: "83", message: "Rate limit" } } };
      const failed = await overview(vip, "?refresh=1");
      expect(failed.data.provider).toMatchObject({ balance: 750000, stale: true });
      expect(failed.data.provider.error).toContain("rc=83");
      expect(failed.text).not.toContain(DIGI_KEY);
    });

    it("tanpa penyedia Digiflazz aktif: belum dikonfigurasi dan tidak menghubungi siapa pun", async () => {
      (backendEnv as Record<string, unknown>).PPOB_PROVIDER = "stub";
      const vip = await createUser("SUPER_ADMIN_VIP");
      const { data } = await overview(vip);
      expect(data.provider).toMatchObject({ configured: false, balance: null });
      expect(data.level).toBe("UNKNOWN");
      expect(digiCalls).toHaveLength(0);
    });
  });
});

async function createUser(role: UserRole, phone?: string): Promise<User> {
  seq += 1;
  return prisma.user.create({
    data: { fullName: `Mon ${role} ${seq}`, phone: phone ?? `+6281${String(seq).padStart(9, "0")}`, referralCode: `MON${String(seq).padStart(6, "0")}`, role }
  });
}

function call(user: User, path: string) {
  return realFetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` })}` }
  });
}
