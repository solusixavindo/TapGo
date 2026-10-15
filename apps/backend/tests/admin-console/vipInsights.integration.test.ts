import { Prisma, User, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import { seedInsightsData } from "../helpers/insightsSeed.js";
import { bucketLabels, chooseBucket, ageOn } from "../../src/modules/admin-console/application/AdminInsightsService.js";

/**
 * Wawasan Beranda Super Admin VIP: pertumbuhan, pendapatan, perjalanan, wilayah, usia pengemudi, rating dan ulasan, serta
 * hal yang butuh perhatian. Hanya VIP; nama penumpang pada ulasan disamarkan; angka dihitung dari data, tanpa karangan.
 */
type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;
let server: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let seq = 0;

describe("pembuat deret waktu WIB", () => {
  it("memilih granularitas menurut panjang rentang", () => {
    const at = (iso: string) => new Date(iso);
    expect(chooseBucket({ from: at("2026-10-14T00:00:00Z"), to: at("2026-10-14T20:00:00Z") })).toBe("hour");
    expect(chooseBucket({ from: at("2026-10-01T00:00:00Z"), to: at("2026-10-31T00:00:00Z") })).toBe("day");
    expect(chooseBucket({ from: at("2026-01-01T00:00:00Z"), to: at("2026-12-31T00:00:00Z") })).toBe("month");
  });

  it("label bucket mengikuti hari WIB dan tidak bolong", () => {
    // 17:00 UTC sudah hari berikutnya di WIB.
    const labels = bucketLabels({ from: new Date("2026-10-13T20:00:00Z"), to: new Date("2026-10-15T17:30:00Z") }, "day");
    expect(labels).toEqual(["2026-10-14 00:00", "2026-10-15 00:00", "2026-10-16 00:00"]);
    const months = bucketLabels({ from: new Date("2026-01-20T00:00:00Z"), to: new Date("2026-04-02T00:00:00Z") }, "month");
    expect(months).toEqual(["2026-01-01 00:00", "2026-02-01 00:00", "2026-03-01 00:00", "2026-04-01 00:00"]);
    expect(bucketLabels({ from: new Date("2026-10-14T00:00:00Z"), to: new Date("2026-10-14T03:00:00Z") }, "hour")).toHaveLength(4);
  });

  it("menghitung usia dengan benar di sekitar ulang tahun", () => {
    const now = new Date("2026-10-14T00:00:00Z");
    expect(ageOn(new Date("2000-10-14"), now)).toBe(26);
    expect(ageOn(new Date("2000-10-15"), now)).toBe(25);
    expect(ageOn(new Date("2000-01-01"), now)).toBe(26);
  });
});

describe.skipIf(!runIntegration)("Wawasan Beranda VIP", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "test-access-secret-vip-insights-0";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-vip-insights-";
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
    await prisma.ppobProduct.deleteMany();
    await prisma.driver.deleteMany();
    // cleanDatabase tidak menghapus peristiwa registrasi; sisa uji lain akan ikut terhitung di sumber pendaftaran.
    await prisma.registrationEvent.deleteMany();
    await seedMemberships();
  });

  afterAll(async () => {
    await cleanDatabase();
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  async function insights(user: User, query?: string) {
    const now = Date.now();
    const range = query ?? `dateFrom=${new Date(now - 7 * 86_400_000).toISOString()}&dateTo=${new Date(now).toISOString()}`;
    const response = await fetch(`${baseUrl}/api/v1/admin/dashboard/insights?${range}`, {
      headers: { authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` })}` }
    });
    const text = await response.text();
    return { status: response.status, text, data: response.status === 200 ? JSON.parse(text).data : null };
  }

  async function createUser(role: UserRole): Promise<User> {
    seq += 1;
    return prisma.user.create({ data: { fullName: `Peminta ${role} ${seq}`, phone: `+62899${String(seq).padStart(8, "0")}`, referralCode: `REQ${String(seq).padStart(6, "0")}`, role } });
  }

  it("hanya Super Admin VIP; Super Admin, Admin, dan pengguna biasa ditolak", async () => {
    expect((await insights(await createUser("SUPER_ADMIN"))).status).toBe(403);
    expect((await insights(await createUser("ADMIN"))).status).toBe(403);
    expect((await insights(await createUser("USER"))).status).toBe(403);
    expect((await insights(await createUser("SUPER_ADMIN_VIP"))).status).toBe(200);
  });

  it("menolak tanggal yang tidak valid dan rentang terbalik", async () => {
    const vip = await createUser("SUPER_ADMIN_VIP");
    expect((await insights(vip, "dateFrom=bukan-tanggal")).status).toBe(400);
    expect((await insights(vip, "dateFrom=2026-10-10T00:00:00Z&dateTo=2026-10-01T00:00:00Z")).status).toBe(400);
  });

  it("database kosong: semua nol dan tidak galat", async () => {
    const { data } = await insights(await createUser("SUPER_ADMIN_VIP"));
    expect(data.totals).toMatchObject({ members: 0, drivers: 0, driversOnline: 0, rating: { average: null, count: 0 } });
    expect(data.rides).toMatchObject({ total: 0, completionRate: null });
    expect(data.driverAges).toMatchObject({ counted: 0, average: null });
    expect(data.regions.members).toMatchObject({ total: 0, cities: [] });
    expect(data.ratings.recent).toEqual([]);
    expect(data.period.labels.length).toBeGreaterThan(1);
  });

  describe("dengan data", () => {
    it("pertumbuhan, pendapatan, dan perbandingan dengan periode sebelumnya", async () => {
      await seedInsightsData(prisma);
      const { data } = await insights(await createUser("SUPER_ADMIN_VIP"));

      expect(data.period.bucket).toBe("day");
      expect(data.period.labels).toHaveLength(8);
      const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
      // 4 member dan 4 pengemudi dalam 7 hari; "Member Lama" (40 hari lalu) di luar rentang.
      expect(sum(data.series.registrations.members)).toBe(4);
      expect(sum(data.series.registrations.drivers)).toBe(4);
      expect(data.totals.registrations).toEqual({ current: 8, previous: 0 });
      expect(data.totals.members).toBe(5);

      // Upgrade Rp190.000 + selisih PPOB (2 x (11.000 - 10.200)) = 191.600; transaksi tertahan tidak dihitung.
      expect(data.revenueBreakdown).toMatchObject({ membership: 190000, ppobSales: 22000, ppobMargin: 1600, rideCommission: 0 });
      expect(data.totals.revenue).toEqual({ current: 191600, previous: 0 });
      expect(sum(data.series.revenue.membership)).toBe(190000);
      expect(sum(data.series.revenue.ppobMargin)).toBe(1600);
    });

    it("perjalanan: status, layanan, tingkat selesai, dan peta jam", async () => {
      await seedInsightsData(prisma);
      const { data } = await insights(await createUser("SUPER_ADMIN_VIP"));
      expect(data.rides).toMatchObject({ total: 10, completed: 6, cancelled: 2, completionRate: 60 });
      expect(data.totals.ridesCompleted.current).toBe(6);
      expect(Object.fromEntries(data.composition.rideServices.map((row: any) => [row.type, row.count]))).toEqual({ MOTORCYCLE: 9, CAR: 1 });
      expect(Object.fromEntries(data.composition.rideStatus.map((row: any) => [row.status, row.count]))).toEqual({
        COMPLETED: 6, CANCELLED_BY_PASSENGER: 2, NO_DRIVER: 1, IN_TRIP: 1
      });
      expect(data.rides.heatmap).toHaveLength(7);
      expect(data.rides.heatmap[0]).toHaveLength(24);
      expect(data.rides.heatmap.flat().reduce((total: number, value: number) => total + value, 0)).toBe(10);
      expect(data.series.rides.total.reduce((total: number, value: number) => total + value, 0)).toBe(10);
    });

    it("komposisi: paket, sumber pendaftaran, dan status pengemudi", async () => {
      await seedInsightsData(prisma);
      const { data } = await insights(await createUser("SUPER_ADMIN_VIP"));
      expect(Object.fromEntries(data.composition.tiers.map((row: any) => [row.tier, row.count]))).toMatchObject({ BASIC: 5, SILVER: 0 });
      expect(data.composition.signupSources).toEqual({ play: 3, other: 1, unknown: 1 });
      expect(data.totals).toMatchObject({ drivers: 4, driversActive: 3, driversOnline: 2 });
    });

    it("wilayah dari alamat dan usia pengemudi", async () => {
      await seedInsightsData(prisma);
      const { data } = await insights(await createUser("SUPER_ADMIN_VIP"));

      expect(data.regions.members).toMatchObject({ total: 3, unreadable: 0 });
      expect(data.regions.members.cities).toEqual([{ name: "Surabaya", count: 2 }, { name: "Bandung", count: 1 }]);
      expect(data.regions.members.provinces).toEqual([{ name: "Jawa Barat", count: 1 }, { name: "Jawa Timur", count: 1 }]);
      expect(data.regions.drivers).toMatchObject({ total: 6, unreadable: 1 });
      expect(data.regions.drivers.cities.slice(0, 2)).toEqual([{ name: "Surabaya", count: 2 }, { name: "Bandung", count: 1 }]);
      expect(data.regions.pickups).toMatchObject({ total: 10, unreadable: 1 });
      expect(data.regions.pickups.cities).toEqual([{ name: "Surabaya", count: 6 }, { name: "Bandung", count: 3 }]);

      // Usia 22, 27, 27, 41, 60 dan satu tanpa tanggal lahir.
      const counts = Object.fromEntries(data.driverAges.buckets.map((row: any) => [row.label, row.count]));
      expect(counts).toMatchObject({ "20–24": 1, "25–29": 2, "35–44": 1, "55+": 1, "< 20": 0, "30–34": 0, "45–54": 0 });
      expect(data.driverAges).toMatchObject({ counted: 5, unknown: 1, average: 35.4, youngest: 22, oldest: 60 });
    });

    it("rating: sebaran bintang, pengemudi terbaik dan perlu perhatian, ulasan dengan nama penumpang disamarkan", async () => {
      await seedInsightsData(prisma);
      const { data, text } = await insights(await createUser("SUPER_ADMIN_VIP"));
      expect(data.totals.rating).toEqual({ average: 3.67, count: 6 });
      expect(data.ratings).toMatchObject({ periodAverage: 3.67, periodCount: 6 });
      expect(data.ratings.distribution).toEqual([
        { stars: 1, count: 1 }, { stars: 2, count: 1 }, { stars: 3, count: 0 }, { stars: 4, count: 1 }, { stars: 5, count: 3 }
      ]);
      // Eko (3,2) tidak masuk "terbaik" walau minimal 3 penilaiannya terpenuhi; ia ada di daftar perhatian.
      expect(data.ratings.topDrivers.map((row: any) => [row.name, row.average, row.count])).toEqual([
        ["Dedi Kurniawan", 4.9, 10], ["Fajar Nugroho", 4.6, 4]
      ]);
      expect(data.ratings.attentionDrivers.map((row: any) => row.name)).toEqual(["Eko Wahyudi"]);

      // Hanya yang ber-catatan, terbaru dulu.
      expect(data.ratings.recent.map((row: any) => row.stars)).toEqual([5, 4, 1, 2]);
      expect(data.ratings.recent[0]).toMatchObject({ note: "Driver ramah dan tepat waktu.", driverName: "Dedi Kurniawan", passengerName: "Budi S.", service: "MOTORCYCLE" });
      // Nama lengkap penumpang tidak pernah keluar.
      expect(text).not.toContain("Budi Santoso");
      expect(text).not.toContain("Siti Rahma");
      // Nomor telepon tidak ikut.
      expect(text).not.toContain("+62813");
    });

    it("perlu perhatian: transaksi tertahan, penarikan, pengajuan, tiket, dan rating rendah", async () => {
      await seedInsightsData(prisma);
      const { data } = await insights(await createUser("SUPER_ADMIN_VIP"));
      expect(data.attention).toMatchObject({
        stuckPpob: 1,
        withdrawalsPending: 1,
        withdrawalsPendingAmount: 150000,
        memberRequestsAwaiting: 3,
        driverApplicationsPending: 1,
        overdueOnlinePayments: 0,
        openSupportTickets: 1,
        lowRatingsThisWeek: 2
      });
      // PPOB_PROVIDER bukan Digiflazz di uji: statusnya tidak diketahui, bukan galat.
      expect(data.attention.digiflazz).toEqual({ level: "UNKNOWN", balance: null });
    });

    it("perlu perhatian: sinyal SOS driver yang belum ditutup dihitung; yang sudah selesai tidak", async () => {
      const { profiles } = await seedInsightsData(prisma);
      const vip = await createUser("SUPER_ADMIN_VIP");
      expect((await insights(vip)).data.attention.openSos).toBe(0);
      const sos = (status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED") =>
        prisma.rideSosAlert.create({ data: { driverProfileId: profiles[0]!.id, lat: new Prisma.Decimal("-6.2000000"), lng: new Prisma.Decimal("106.8000000"), status } });
      await sos("OPEN");
      await sos("ACKNOWLEDGED");
      await sos("RESOLVED");
      expect((await insights(vip)).data.attention.openSos).toBe(2);
    });

    it("perlu perhatian: transaksi PPOB rugi atau di bawah target untung bersih dalam 7 hari", async () => {
      await seedInsightsData(prisma);
      const vip = await createUser("SUPER_ADMIN_VIP");
      // Seed dasar: dua penjualan 11.000/10.200 (bersih 666, memenuhi target Rp500) -> tidak ada peringatan.
      const base = (await insights(vip)).data.attention;
      expect(base).toMatchObject({ ppobLossWeek: 0, ppobBelowTargetWeek: 0 });

      const buyer = await prisma.user.findFirstOrThrow({ where: { role: "USER" } });
      const product = await prisma.ppobProduct.findFirstOrThrow({ where: { sku: "PULSA_INS_10" } });
      const add = (reference: string, category: "PULSA" | "BPJS", total: number, cost: number, daysAgo: number) =>
        prisma.ppobTransaction.create({
          data: {
            publicReference: reference, userId: buyer.id, productId: product.id, skuSnapshot: product.sku, productNameSnapshot: product.name,
            brandSnapshot: product.brand, category, targetNumber: "081298765432", amount: new Prisma.Decimal(total), totalAmount: new Prisma.Decimal(total),
            status: "SUCCESS", provider: "digiflazz", providerCost: new Prisma.Decimal(cost), createdAt: new Date(Date.now() - daysAgo * 86_400_000)
          }
        });
      await add("INS-LOSS", "PULSA", 11_000, 11_000, 1); // bersih -55
      await add("INS-LOW", "PULSA", 11_000, 10_500, 2); // bersih 396 < 500
      await add("INS-POST-LOW", "BPJS", 101_000, 100_000, 3); // bersih 896 < 1.000
      await add("INS-OLD-LOSS", "PULSA", 11_000, 11_000, 10); // di luar 7 hari: tidak dihitung
      const { data } = await insights(vip);
      expect(data.attention).toMatchObject({ ppobLossWeek: 1, ppobBelowTargetWeek: 2 });
    });

    it("rentang harian memakai bucket per jam, tahunan per bulan", async () => {
      await seedInsightsData(prisma);
      const vip = await createUser("SUPER_ADMIN_VIP");
      const now = Date.now();
      const day = await insights(vip, `dateFrom=${new Date(now - 5 * 3_600_000).toISOString()}&dateTo=${new Date(now).toISOString()}`);
      expect(day.data.period.bucket).toBe("hour");
      const year = await insights(vip, `dateFrom=${new Date(now - 300 * 86_400_000).toISOString()}&dateTo=${new Date(now).toISOString()}`);
      expect(year.data.period.bucket).toBe("month");
      // "Member Lama" (40 hari lalu) masuk rentang tahunan.
      expect(year.data.totals.registrations.current).toBe(9);
    });
  });
});
