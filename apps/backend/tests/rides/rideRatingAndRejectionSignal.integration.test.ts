import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { RideDriverAvailability, RideOrderStatus, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships } from "../helpers/referralWalletHarness.js";


let server: Server | undefined;
let baseUrl = "";
let signAccessToken: (p: {
  sub: string;
  role: UserRole;
  sessionId: string;
  authVersion?: number;
}) => string;
let sequence = 0;

type ApiResponse = { status: number; raw: string; body: any };

async function api(path: string, token?: string, init?: RequestInit): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) }
  });
  const raw = await response.text();
  return { status: response.status, raw, body: raw ? JSON.parse(raw) : {} };
}

const REFERENCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789";
function makeReference(): string {
  sequence += 1;
  let suffix = "";
  let value = sequence;
  for (let index = 0; index < 10; index += 1) {
    suffix += REFERENCE_CHARS[value % REFERENCE_CHARS.length];
    value = Math.floor(value / REFERENCE_CHARS.length) + index + 7;
  }
  return `RID-${suffix}`;
}

async function createUser(role: UserRole = "USER", fullName?: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: fullName ?? `Penumpang ${sequence}`,
      phone: `08${String(500000000 + sequence)}`,
      referralCode: `DPD${String(sequence).padStart(6, "0")}`,
      role
    }
  });
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `sess-${user.id}`,
    authVersion: 0
  });
}

async function createDriverWithVehicle(fullName = "Dedi Kurniawan") {
  const user = await createUser("USER", fullName);
  const profile = await prisma.rideDriverProfile.create({
    data: { userId: user.id, status: "ACTIVE", availability: "BUSY" }
  });
  const vehicle = await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: "MOTORCYCLE",
      plateNumberHash: `hash-${profile.id.slice(0, 12)}`,
      plateNumberMasked: "B 1234 XYZ",
      brand: "Honda",
      model: "Vario 160",
      color: "Hitam",
      verificationStatus: "VERIFIED",
      isActive: true
    }
  });
  return { user, profile, vehicle };
}

const PICKUP_LAT = "-6.2000000";
const PICKUP_LNG = "106.8166660";
const DROPOFF_LAT = "-6.2100000";
const DROPOFF_LNG = "106.8266660";

async function createOrder(options: {
  passengerId: string;
  status: RideOrderStatus;
  driverProfileId?: string;
  vehicleId?: string;
  assignedAt?: Date | null;
}) {
  sequence += 1;
  const quote = await prisma.rideQuote.create({
    data: {
      userId: options.passengerId,
      serviceType: "MOTORCYCLE",
      pickupLat: PICKUP_LAT, pickupLng: PICKUP_LNG, pickupAddress: "Titik jemput uji",
      dropoffLat: DROPOFF_LAT, dropoffLng: DROPOFF_LNG, dropoffAddress: "Titik tujuan uji",
      distanceMeters: 1500, durationSeconds: 600, etaSeconds: 300,
      baseFare: 5000, distanceFare: 6000, serviceFee: 1000,
      subtotalFare: 12000, totalFare: 12000,
      fareRuleVersion: "test", roundingRule: "test", distanceSource: "test",
      expiresAt: new Date(Date.now() + 600_000)
    }
  });
  return prisma.rideOrder.create({
    data: {
      publicReference: makeReference(),
      passengerId: options.passengerId,
      quoteId: quote.id,
      serviceType: "MOTORCYCLE",
      status: options.status,
      pickupLat: quote.pickupLat, pickupLng: quote.pickupLng, pickupAddress: quote.pickupAddress,
      dropoffLat: quote.dropoffLat, dropoffLng: quote.dropoffLng, dropoffAddress: quote.dropoffAddress,
      distanceMeters: quote.distanceMeters, durationSeconds: quote.durationSeconds,
      baseFare: quote.baseFare, distanceFare: quote.distanceFare, serviceFee: quote.serviceFee,
      subtotalFare: quote.subtotalFare, totalFare: quote.totalFare,
      fareRuleVersion: quote.fareRuleVersion,
      ...(options.driverProfileId ? { driverProfileId: options.driverProfileId } : {}),
      ...(options.vehicleId ? { vehicleId: options.vehicleId } : {}),
      ...(options.assignedAt !== undefined
        ? { assignedAt: options.assignedAt }
        : options.driverProfileId
          ? { assignedAt: new Date() }
          : {})
    }
  });
}


/**
 * Uji HP 5 Okt 2026 (butir 4 dan 7): (a) detail order penumpang memuat sinyal
 * penolakan (hitungan) tanpa identitas driver, supaya layar penumpang berubah
 * walau push tidak sampai; (b) penilaian setelah perjalanan selesai — satu per
 * order, hanya penumpang order itu, tabel baru yang menempel ke RideOrder, dan
 * rata-rata RideDriverProfile dihitung ulang dalam transaksi yang sama.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("sinyal penolakan dan penilaian perjalanan", () => {
  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "test-access-secret-please-change-000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-please-change-00000";
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
    const limiters = await import("../../src/core/security/rateLimit.js");
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      limiters.apiRateLimiter.resetKey(key);
      limiters.rideWriteRateLimiter.resetKey(key);
    }
  });

  const rate = (token: string, reference: string, body: unknown) =>
    api(`/api/v1/rides/${reference}/rating`, token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

  const detail = (token: string, reference: string) => api(`/api/v1/rides/${reference}`, token);

  async function completedOrder() {
    const passenger = await createUser("USER", "Penumpang Uji");
    const driver = await createDriverWithVehicle();
    const order = await createOrder({
      passengerId: passenger.id,
      status: "COMPLETED",
      driverProfileId: driver.profile.id,
      vehicleId: driver.vehicle.id
    });
    return { passenger, driver, order };
  }

  describe("sinyal penolakan pada detail order penumpang", () => {
    async function searchingOrder() {
      const passenger = await createUser("USER", "Penumpang Cari");
      const order = await createOrder({ passengerId: passenger.id, status: "SEARCHING_DRIVER" });
      return { passenger, order };
    }

    async function activeDriver(name: string) {
      const d = await createDriverWithVehicle(name);
      await prisma.rideDriverProfile.update({
        where: { id: d.profile.id },
        data: { availability: "ONLINE" }
      });
      return d;
    }

    const reject = (token: string, reference: string) =>
      api(`/api/v1/driver/rides/${reference}/reject`, token, { method: "POST" });

    it("awalnya 0; naik satu per driver yang menolak; menolak ulang oleh driver yang sama tidak menaikkan", async () => {
      const { passenger, order } = await searchingOrder();
      const a = await activeDriver("Driver Alpha");
      const b = await activeDriver("Driver Beta");

      let view = await detail(tokenFor(passenger), order.publicReference);
      expect(view.status).toBe(200);
      expect(view.body.data.searchRejectionCount).toBe(0);

      expect((await reject(tokenFor(a.user), order.publicReference)).status).toBe(200);
      view = await detail(tokenFor(passenger), order.publicReference);
      expect(view.body.data.searchRejectionCount).toBe(1);

      await reject(tokenFor(a.user), order.publicReference);
      view = await detail(tokenFor(passenger), order.publicReference);
      expect(view.body.data.searchRejectionCount).toBe(1);

      await reject(tokenFor(b.user), order.publicReference);
      view = await detail(tokenFor(passenger), order.publicReference);
      expect(view.body.data.searchRejectionCount).toBe(2);
      expect(view.body.data.status).toBe("SEARCHING_DRIVER");
    });

    it("tidak membuka identitas driver yang menolak (nama, id profil, id pengguna)", async () => {
      const { passenger, order } = await searchingOrder();
      const a = await activeDriver("Driver Rahasia Nama");
      await reject(tokenFor(a.user), order.publicReference);
      const view = await detail(tokenFor(passenger), order.publicReference);
      expect(view.body.data.driver).toBeNull();
      for (const secret of ["Driver Rahasia Nama", a.profile.id, a.user.id]) {
        expect(view.raw).not.toContain(secret);
      }
    });

    it("hanya bermakna saat masih SEARCHING_DRIVER: setelah ada driver yang menerima kembali 0", async () => {
      const { passenger, order } = await searchingOrder();
      const a = await activeDriver("Driver Alpha");
      await reject(tokenFor(a.user), order.publicReference);
      const taker = await activeDriver("Driver Penerima");
      await prisma.rideOrder.update({
        where: { id: order.id },
        data: {
          status: "DRIVER_ASSIGNED",
          driverProfileId: taker.profile.id,
          vehicleId: taker.vehicle.id,
          assignedAt: new Date()
        }
      });
      const view = await detail(tokenFor(passenger), order.publicReference);
      expect(view.body.data.searchRejectionCount).toBe(0);
    });

    it("penumpang lain tetap 404 (tidak membocorkan order)", async () => {
      const { order } = await searchingOrder();
      const stranger = await createUser("USER", "Orang Lain");
      const view = await detail(tokenFor(stranger), order.publicReference);
      expect(view.status).toBe(404);
    });
  });

  describe("POST /rides/:reference/rating", () => {
    it("menyimpan satu penilaian untuk order selesai dan menghitung ulang rata-rata driver", async () => {
      const { passenger, driver, order } = await completedOrder();
      const response = await rate(tokenFor(passenger), order.publicReference, {
        stars: 4,
        note: "  Ramah dan tepat waktu  "
      });
      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({ stars: 4, note: "Ramah dan tepat waktu" });

      const rows = await prisma.rideRating.findMany({ where: { rideOrderId: order.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ stars: 4, driverProfileId: driver.profile.id });

      const profile = await prisma.rideDriverProfile.findUniqueOrThrow({
        where: { id: driver.profile.id }
      });
      expect(profile.ratingCount).toBe(1);
      expect(Number(profile.ratingAverage)).toBe(4);
    });

    it("rata-rata dihitung dari seluruh penilaian driver itu (5 lalu 2 = 3,50)", async () => {
      const first = await completedOrder();
      await rate(tokenFor(first.passenger), first.order.publicReference, { stars: 5 });
      const passenger2 = await createUser("USER", "Penumpang Dua");
      const second = await createOrder({
        passengerId: passenger2.id,
        status: "COMPLETED",
        driverProfileId: first.driver.profile.id,
        vehicleId: first.driver.vehicle.id
      });
      await rate(tokenFor(passenger2), second.publicReference, { stars: 2 });
      const profile = await prisma.rideDriverProfile.findUniqueOrThrow({
        where: { id: first.driver.profile.id }
      });
      expect(profile.ratingCount).toBe(2);
      expect(Number(profile.ratingAverage)).toBe(3.5);
    });

    it("sepuluh penilaian bersamaan untuk driver yang sama: hitungan dan rata-rata tidak saling menimpa", async () => {
      const first = await completedOrder();
      const entries = [{ passenger: first.passenger, reference: first.order.publicReference }];
      for (let index = 1; index < 10; index += 1) {
        const passenger = await createUser("USER", `Penumpang ${index}`);
        const order = await createOrder({
          passengerId: passenger.id,
          status: "COMPLETED",
          driverProfileId: first.driver.profile.id,
          vehicleId: first.driver.vehicle.id
        });
        entries.push({ passenger, reference: order.publicReference });
      }
      // 5 penilaian bintang 5 dan 5 penilaian bintang 1 => rata-rata 3,00.
      const results = await Promise.all(
        entries.map((entry, index) =>
          rate(tokenFor(entry.passenger), entry.reference, { stars: index % 2 === 0 ? 5 : 1 })
        )
      );
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
      const profile = await prisma.rideDriverProfile.findUniqueOrThrow({
        where: { id: first.driver.profile.id }
      });
      expect(profile.ratingCount).toBe(10);
      expect(Number(profile.ratingAverage)).toBe(3);
    });

    it("penilaian kedua untuk order yang sama ditolak (409), tidak membuat baris kedua dan tidak mengubah rata-rata", async () => {
      const { passenger, driver, order } = await completedOrder();
      expect((await rate(tokenFor(passenger), order.publicReference, { stars: 5 })).status).toBe(201);
      const again = await rate(tokenFor(passenger), order.publicReference, { stars: 1, note: "ubah" });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe("RIDE_RATING_ALREADY_SUBMITTED");
      expect(await prisma.rideRating.count({ where: { rideOrderId: order.id } })).toBe(1);
      const row = await prisma.rideRating.findFirstOrThrow({ where: { rideOrderId: order.id } });
      expect(row.stars).toBe(5);
      const profile = await prisma.rideDriverProfile.findUniqueOrThrow({
        where: { id: driver.profile.id }
      });
      expect(profile.ratingCount).toBe(1);
      expect(Number(profile.ratingAverage)).toBe(5);
    });

    it.each(["IN_TRIP", "SEARCHING_DRIVER", "DRIVER_ARRIVED"] as const)(
      "order berstatus %s belum boleh dinilai (409) dan tidak menulis apa pun",
      async (status) => {
        const passenger = await createUser("USER", "Penumpang Uji");
        const driver = await createDriverWithVehicle();
        const order = await createOrder({
          passengerId: passenger.id,
          status,
          ...(status === "SEARCHING_DRIVER"
            ? {}
            : { driverProfileId: driver.profile.id, vehicleId: driver.vehicle.id })
        });
        const response = await rate(tokenFor(passenger), order.publicReference, { stars: 5 });
        expect(response.status).toBe(409);
        expect(response.body.code).toBe("RIDE_NOT_COMPLETED");
        expect(await prisma.rideRating.count()).toBe(0);
      }
    );

    it("order dibatalkan tidak boleh dinilai", async () => {
      const passenger = await createUser("USER", "Penumpang Uji");
      const order = await createOrder({ passengerId: passenger.id, status: "CANCELLED_BY_PASSENGER" });
      const response = await rate(tokenFor(passenger), order.publicReference, { stars: 5 });
      expect(response.status).toBe(409);
      expect(await prisma.rideRating.count()).toBe(0);
    });

    it("hanya penumpang order itu: orang lain dan driver mendapat 404", async () => {
      const { driver, order } = await completedOrder();
      const stranger = await createUser("USER", "Orang Lain");
      expect((await rate(tokenFor(stranger), order.publicReference, { stars: 5 })).status).toBe(404);
      expect((await rate(tokenFor(driver.user), order.publicReference, { stars: 5 })).status).toBe(404);
      expect(await prisma.rideRating.count()).toBe(0);
    });

    it("tanpa token: 401", async () => {
      const { order } = await completedOrder();
      expect((await rate("", order.publicReference, { stars: 5 })).status).toBe(401);
    });

    it.each([
      [{ stars: 0 }],
      [{ stars: 6 }],
      [{ stars: 3.5 }],
      [{ stars: "5" }],
      [{}],
      [{ stars: 5, note: "x".repeat(281) }]
    ])("masukan tidak sah %j ditolak (400)", async (body) => {
      const { passenger, order } = await completedOrder();
      const response = await rate(tokenFor(passenger), order.publicReference, body);
      expect(response.status).toBe(400);
      expect(await prisma.rideRating.count()).toBe(0);
    });

    it("catatan kosong atau spasi saja disimpan sebagai null; catatan 280 karakter diterima", async () => {
      const first = await completedOrder();
      const blank = await rate(tokenFor(first.passenger), first.order.publicReference, {
        stars: 3,
        note: "   "
      });
      expect(blank.status).toBe(201);
      expect(blank.body.data.note).toBeNull();

      const second = await completedOrder();
      const max = await rate(tokenFor(second.passenger), second.order.publicReference, {
        stars: 3,
        note: "y".repeat(280)
      });
      expect(max.status).toBe(201);
    });

    it("detail order penumpang memuat penilaiannya sendiri (null sebelum, bintang sesudahnya) dan tidak memuat rating driver", async () => {
      const { passenger, order } = await completedOrder();
      let view = await detail(tokenFor(passenger), order.publicReference);
      expect(view.body.data.rating).toBeNull();
      await rate(tokenFor(passenger), order.publicReference, { stars: 4, note: "Bagus" });
      view = await detail(tokenFor(passenger), order.publicReference);
      expect(view.body.data.rating).toMatchObject({ stars: 4, note: "Bagus" });
      expect(view.body.data.driver).not.toHaveProperty("rating");
      // Selama perjalanan berjalan, kata "rating" tidak boleh ada di respons sama sekali.
      const live = await createOrder({
        passengerId: passenger.id,
        status: "IN_TRIP",
        driverProfileId: (await prisma.rideDriverProfile.findFirstOrThrow()).id
      });
      const running = await detail(tokenFor(passenger), live.publicReference);
      expect(running.raw).not.toContain("rating");
      expect(view.body.data.driver).not.toHaveProperty("ratingAverage");
    });

    it("database menolak bintang di luar 1..5 walau lewat jalur lain (CHECK)", async () => {
      const { driver, order } = await completedOrder();
      await expect(
        prisma.rideRating.create({
          data: { rideOrderId: order.id, driverProfileId: driver.profile.id, stars: 6 }
        })
      ).rejects.toThrow();
    });
  });
});
