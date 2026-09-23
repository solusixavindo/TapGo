import { User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * /reports/ppob-transactions — laporan transaksi PPOB SUNGGUHAN (tabel
 * PpobTransaction), dibuat terpisah dari /reports/ppob yang sudah ada
 * (melaporkan kredit benefit PPOB gratis dari membership, tabel
 * WalletTransaction tipe PPOB_BENEFIT — laporan valid untuk tujuan berbeda,
 * TIDAK diubah). Sebelum laporan ini ada, satu-satunya "Laporan PPOB" di
 * dashboard admin selalu kosong untuk transaksi beli pulsa/token sungguhan,
 * karena memang tidak pernah membaca tabel yang benar (Owner, 2026-09-23).
 */

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

describe.skipIf(!runIntegration)("Admin console — laporan transaksi PPOB sungguhan", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-ppob-tx-report";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-ppob-tx-report";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js")
    ]);
    signAccessToken = tokenService.signAccessToken;
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

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
  });

  async function createUser(role: UserRole = "USER") {
    sequence += 1;
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    return prisma.user.create({
      data: {
        fullName: `Pembeli PPOB ${sequence}`,
        phone: `+628${String(600000000 + sequence)}`,
        referralCode: `PTX${String(sequence).padStart(6, "0")}`,
        role,
        membershipId: basic.id
      }
    });
  }

  function tokenFor(user: User) {
    return signAccessToken({ sub: user.id, role: user.role, sessionId: `sess-${user.id}` });
  }

  async function createProduct() {
    sequence += 1;
    return prisma.ppobProduct.create({
      data: {
        sku: `PULSA_TEST_${sequence}`,
        category: "PULSA",
        brand: "Telkomsel",
        name: "Pulsa 10.000",
        price: "10000.00",
        adminFee: "1000.00"
      }
    });
  }

  async function createTransaction(opts: {
    user: User;
    product: Awaited<ReturnType<typeof createProduct>>;
    status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "REFUNDED";
    totalAmount: string;
  }) {
    sequence += 1;
    return prisma.ppobTransaction.create({
      data: {
        publicReference: `PPB-TEST${String(sequence).padStart(4, "0")}`,
        userId: opts.user.id,
        productId: opts.product.id,
        skuSnapshot: opts.product.sku,
        productNameSnapshot: opts.product.name,
        brandSnapshot: opts.product.brand,
        category: opts.product.category,
        targetNumber: "081234567890",
        amount: opts.product.price,
        adminFee: opts.product.adminFee,
        totalAmount: opts.totalAmount,
        status: opts.status,
        provider: "stub"
      }
    });
  }

  it("mengembalikan transaksi PPOB sungguhan dari tabel PpobTransaction, bukan WalletTransaction", async () => {
    const admin = await createUser("SUPER_ADMIN");
    const buyer = await createUser("USER");
    const product = await createProduct();

    await createTransaction({ user: buyer, product, status: "SUCCESS", totalAmount: "11000.00" });
    await createTransaction({ user: buyer, product, status: "PENDING", totalAmount: "11000.00" });
    await createTransaction({ user: buyer, product, status: "FAILED", totalAmount: "11000.00" });

    const response = await fetch(`${baseUrl}/api/v1/admin/reports/ppob-transactions`, {
      headers: { authorization: `Bearer ${tokenFor(admin)}` }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        totalPpob: string;
        transactionCount: number;
        totalPending: string;
        totalApprovedPaid: string;
        items: Array<{ status: string; totalAmount: string; category: string; user: { fullName: string; phone: string } }>;
      };
    };

    // Total mencakup SEMUA status (SUCCESS+PENDING+FAILED) = 33000.
    expect(body.data.totalPpob).toBe("33000.00");
    expect(body.data.transactionCount).toBe(3);
    // Hanya yang PENDING/PROCESSING.
    expect(body.data.totalPending).toBe("11000.00");
    // Hanya yang SUCCESS.
    expect(body.data.totalApprovedPaid).toBe("11000.00");
    expect(body.data.items).toHaveLength(3);
    expect(body.data.items[0]!.user.fullName).toBe(buyer.fullName);
    expect(body.data.items[0]!.user.phone).toBe(buyer.phone);
    expect(body.data.items.map((i) => i.category)).toEqual(["PULSA", "PULSA", "PULSA"]);
  });

  it("CSV tidak lagi kosong — berisi baris data sungguhan, bukan cuma header", async () => {
    const admin = await createUser("SUPER_ADMIN");
    const buyer = await createUser("USER");
    const product = await createProduct();
    await createTransaction({ user: buyer, product, status: "SUCCESS", totalAmount: "21000.00" });

    const response = await fetch(`${baseUrl}/api/v1/admin/reports/ppob-transactions.csv`, {
      headers: { authorization: `Bearer ${tokenFor(admin)}` }
    });
    expect(response.status).toBe(200);
    const csv = await response.text();
    const lines = csv.trim().split("\n");

    expect(lines[0]).toBe("user,phone,type,amount,status,date");
    // Bug lama: CSV SELALU hanya 1 baris (header) meski ada transaksi PPOB
    // sungguhan, karena query membaca tabel yang salah sama sekali.
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1]).toContain(buyer.fullName);
    expect(lines[1]).toContain("PULSA");
    // CSV mengubah Decimal jadi string apa adanya (String(decimal)) — sama
    // seperti ppobRows/commissionRows yang sudah ada, nol di belakang koma
    // tidak dipertahankan di sini (beda dari respons JSON yang lewat
    // this.decimal()). Bukan bug baru, konsisten dengan pola yang sudah ada.
    expect(lines[1]).toContain("21000");
    expect(lines[1]).toContain("SUCCESS");
  });

  it("laporan benefit membership lama (/reports/ppob) TIDAK berubah — tetap membaca WalletTransaction, bukan PpobTransaction", async () => {
    const admin = await createUser("SUPER_ADMIN");
    const buyer = await createUser("USER");
    const product = await createProduct();
    // Transaksi PPOB sungguhan dibuat — laporan benefit membership yang lama
    // tidak boleh ikut menghitungnya, karena maknanya beda sama sekali.
    await createTransaction({ user: buyer, product, status: "SUCCESS", totalAmount: "15000.00" });

    const response = await fetch(`${baseUrl}/api/v1/admin/reports/ppob`, {
      headers: { authorization: `Bearer ${tokenFor(admin)}` }
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { transactionCount: number } };
    expect(body.data.transactionCount).toBe(0);
  });
});
