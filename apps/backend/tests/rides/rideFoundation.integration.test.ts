import { Prisma, RideServiceType, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  prisma,
  runIntegration,
  testDatabaseUrl,
} from "../helpers/referralWalletHarness.js";
import {
  adminRateLimiter,
  apiRateLimiter,
  rideLocationRateLimiter,
  rideWriteRateLimiter,
} from "../../src/core/security/rateLimit.js";

/** Reset kuota rate limit antar test agar tiap test berdiri sendiri. */
function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    adminRateLimiter.resetKey(key);
    apiRateLimiter.resetKey(key);
    rideWriteRateLimiter.resetKey(key);
    rideLocationRateLimiter.resetKey(key);
  }
}

type SignAccessToken = (payload: {
  sub: string;
  role: UserRole;
  sessionId: string;
}) => string;

let appServer: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let sequence = 0;

const PICKUP = { lat: -6.12, lng: 106.15, address: "Alun-Alun Serang (uji)" };
const DROPOFF = { lat: -6.131, lng: 106.141, address: "Pasar Rau (uji)" };

describe.skipIf(!runIntegration)("Stage 5.2 — Ride backend foundation", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "ride-foundation-access-secret-0000000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "ride-foundation-refresh-secret-000000000";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
    ]);
    signAccessToken = tokenService.signAccessToken;

    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    resetRateLimits();
    await cleanRideTables();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  // --- Quote ---------------------------------------------------------------

  it("penumpang membuat quote dengan tarif integer rupiah dan pembulatan deterministik", async () => {
    const passenger = await createUser("USER");
    const res = await api("/api/v1/rides/quotes", {
      method: "POST",
      token: tokenFor(passenger),
      body: { serviceType: "MOTORCYCLE", pickup: PICKUP, dropoff: DROPOFF },
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { data: any };
    const fare = body.data.fare;

    for (const key of ["baseFare", "distanceFare", "serviceFee", "subtotalFare", "totalFare"]) {
      expect(Number.isInteger(fare[key])).toBe(true);
    }
    expect(fare.currency).toBe("IDR");
    expect(fare.totalFare % 100).toBe(0);
    expect(fare.totalFare).toBeGreaterThan(0);
    expect(body.data.fareRuleVersion).toBe("RIDE_FARE_RULE_V1");
    expect(body.data.roundingRule).toBe("ROUND_TO_NEAREST_100_HALF_UP");
    // Jarak berasal dari server, bukan client.
    expect(body.data.distanceSource).toBe("HAVERSINE_LOCAL_V1");
  });

  it("tarif tidak dapat ditentukan client (field fare pada body diabaikan)", async () => {
    const passenger = await createUser("USER");
    const res = await api("/api/v1/rides/quotes", {
      method: "POST",
      token: tokenFor(passenger),
      body: {
        serviceType: "MOTORCYCLE",
        pickup: PICKUP,
        dropoff: DROPOFF,
        totalFare: 1,
        distanceMeters: 1,
      },
    });
    const body = (await res.json()) as { data: any };
    expect(body.data.fare.totalFare).toBeGreaterThan(1);
    expect(body.data.distanceMeters).toBeGreaterThan(1);
  });

  it("quote kedaluwarsa ditolak saat membuat order", async () => {
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);
    await prisma.rideQuote.update({
      where: { id: quote.quoteId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe("RIDE_QUOTE_EXPIRED");
  });

  it("quote milik penumpang lain tidak dapat dipakai", async () => {
    const owner = await createUser("USER");
    const other = await createUser("USER");
    const quote = await createQuote(owner);

    const res = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(other),
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("RIDE_QUOTE_FORBIDDEN");
  });

  // --- Order ---------------------------------------------------------------

  it("pembuatan order idempoten dengan Idempotency-Key yang sama", async () => {
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);
    const key = randomUUID();

    const first = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      idempotencyKey: key,
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });
    const second = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      idempotencyKey: key,
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = ((await first.json()) as { data: { reference: string } }).data.reference;
    const b = ((await second.json()) as { data: { reference: string } }).data.reference;
    expect(a).toBe(b);
    expect(await prisma.rideOrder.count()).toBe(1);
  });

  it("satu quote tidak dapat membuat dua order aktif", async () => {
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);

    const first = await createOrder(passenger, quote.quoteId);
    expect(first.status).toBe(201);

    // Order kedua dari quote yang sama (tanpa idempotency key).
    const second = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });
    expect(second.status).toBe(409);
    expect(await prisma.rideOrder.count()).toBe(1);
  });

  it("pembayaran digital fail-closed", async () => {
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);
    const res = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "DIGITAL" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("RIDE_DIGITAL_PAYMENT_NOT_CONFIGURED");
    expect(await prisma.rideOrder.count()).toBe(0);
  });

  // --- Matching & eligibility ---------------------------------------------

  it("driver mobil tidak menerima tawaran order motor", async () => {
    const passenger = await createUser("USER");
    const carDriver = await createDriver("CAR");
    await setOnline(carDriver);

    const quote = await createQuote(passenger, "MOTORCYCLE");
    await createOrder(passenger, quote.quoteId);

    const offers = await api("/api/v1/driver/rides/offers", {
      token: tokenFor(carDriver.user),
    });
    expect(((await offers.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  it("driver suspended ditolak dan driver offline tidak menerima tawaran", async () => {
    const passenger = await createUser("USER");
    const suspended = await createDriver("MOTORCYCLE", { status: "SUSPENDED" });
    const offline = await createDriver("MOTORCYCLE");

    const quote = await createQuote(passenger);
    await createOrder(passenger, quote.quoteId);

    // Stage 5.11: kapabilitas driver otoritatif dari database. Driver yang
    // di-suspend TIDAK lagi menerima 200 dengan daftar kosong, melainkan
    // ditolak 403 — seluruh operasi driver gagal seketika.
    const suspendedOffers = await api("/api/v1/driver/rides/offers", {
      token: tokenFor(suspended.user),
    });
    expect(suspendedOffers.status).toBe(403);
    expect(((await suspendedOffers.json()) as { code?: string }).code).toBe(
      "RIDE_DRIVER_NOT_ACTIVE",
    );

    // Driver ACTIVE yang sedang OFFLINE tetap 200 dengan daftar kosong:
    // ketersediaan bukan kondisi error.
    const offlineOffers = await api("/api/v1/driver/rides/offers", {
      token: tokenFor(offline.user),
    });
    expect(offlineOffers.status).toBe(200);
    expect(((await offlineOffers.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  it("driver suspended tidak dapat online", async () => {
    const suspended = await createDriver("MOTORCYCLE", { status: "SUSPENDED" });
    const res = await api("/api/v1/driver/availability", {
      method: "POST",
      token: tokenFor(suspended.user),
      body: { availability: "ONLINE" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("RIDE_DRIVER_NOT_ACTIVE");
  });

  it("tanpa driver online, tidak ada tawaran (hasil no-driver)", async () => {
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);
    const order = await createOrder(passenger, quote.quoteId);
    expect(((await order.json()) as { data: { status: string } }).data.status).toBe("SEARCHING_DRIVER");

    const driver = await createDriver("MOTORCYCLE");
    const offers = await api("/api/v1/driver/rides/offers", {
      token: tokenFor(driver.user),
    });
    expect(((await offers.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  it("accept konkuren: tepat satu driver menang", async () => {
    const passenger = await createUser("USER");
    const d1 = await createDriver("MOTORCYCLE");
    const d2 = await createDriver("MOTORCYCLE");
    const d3 = await createDriver("MOTORCYCLE");
    await Promise.all([setOnline(d1), setOnline(d2), setOnline(d3)]);

    const quote = await createQuote(passenger);
    const created = await createOrder(passenger, quote.quoteId);
    const reference = ((await created.json()) as { data: { reference: string } }).data.reference;

    const results = await Promise.all(
      [d1, d2, d3].map((d) =>
        api(`/api/v1/driver/rides/${reference}/accept`, {
          method: "POST",
          token: tokenFor(d.user),
        }),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);

    const order = await prisma.rideOrder.findFirstOrThrow();
    expect(order.driverProfileId).not.toBeNull();
    expect(order.status).toBe("DRIVER_ASSIGNED");
  });

  // --- Ownership -----------------------------------------------------------

  it("driver lain tidak dapat mengubah ride yang bukan miliknya", async () => {
    const { reference, other } = await assignedRideWithForeignDriver();
    const res = await api(`/api/v1/driver/rides/${reference}/pickup`, {
      method: "POST",
      token: tokenFor(other.user),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe("RIDE_DRIVER_FORBIDDEN");
  });

  it("penumpang lain tidak dapat membaca atau membatalkan ride", async () => {
    const passenger = await createUser("USER");
    const stranger = await createUser("USER");
    const quote = await createQuote(passenger);
    const reference = ((await (await createOrder(passenger, quote.quoteId)).json()) as { data: { reference: string } }).data.reference;

    const read = await api(`/api/v1/rides/${reference}`, { token: tokenFor(stranger) });
    expect(read.status).toBe(404);

    const cancel = await api(`/api/v1/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(stranger),
      body: { reason: "CHANGE_OF_PLAN" },
    });
    expect(cancel.status).toBe(404);

    // Pemilik tetap bisa membaca.
    const own = await api(`/api/v1/rides/${reference}`, { token: tokenFor(passenger) });
    expect(own.status).toBe(200);
  });

  it("endpoint ride menolak permintaan tanpa autentikasi", async () => {
    const res = await api("/api/v1/rides", { method: "GET" });
    expect(res.status).toBe(401);
  });

  // --- State machine -------------------------------------------------------

  it("transisi tidak sah ditolak (start sebelum arrived, complete sebelum in-trip)", async () => {
    const { reference, driver } = await assignedRide();

    const startTooEarly = await api(`/api/v1/driver/rides/${reference}/start`, {
      method: "POST",
      token: tokenFor(driver.user),
    });
    expect(startTooEarly.status).toBe(409);
    expect(((await startTooEarly.json()) as { code?: string }).code).toBe("RIDE_INVALID_TRANSITION");

    const completeTooEarly = await api(`/api/v1/driver/rides/${reference}/complete`, {
      method: "POST",
      token: tokenFor(driver.user),
    });
    expect(completeTooEarly.status).toBe(409);
  });

  it("alur lengkap ASSIGNED -> TO_PICKUP -> ARRIVED -> IN_TRIP -> COMPLETED", async () => {
    const { reference, driver } = await assignedRide();

    for (const [step, expected] of [
      ["pickup", "DRIVER_TO_PICKUP"],
      ["arrived", "DRIVER_ARRIVED"],
      ["start", "IN_TRIP"],
      ["complete", "COMPLETED"],
    ] as const) {
      const res = await api(`/api/v1/driver/rides/${reference}/${step}`, {
        method: "POST",
        token: tokenFor(driver.user),
      });
      expect(res.status).toBe(200);
      expect(
        ((await res.json()) as { data: { status: string } }).data.status,
      ).toBe(expected);
    }

    const order = await prisma.rideOrder.findFirstOrThrow();
    expect(order.completedAt).not.toBeNull();
    // Driver dibebaskan kembali.
    const profile = await prisma.rideDriverProfile.findUniqueOrThrow({
      where: { id: order.driverProfileId! },
    });
    expect(profile.availability).toBe("ONLINE");
  });

  it("status terminal tidak dapat dibuka kembali", async () => {
    const { reference, driver, passenger } = await completedRide();

    const reopen = await api(`/api/v1/driver/rides/${reference}/start`, {
      method: "POST",
      token: tokenFor(driver.user),
    });
    expect(reopen.status).toBe(409);
    expect(((await reopen.json()) as { code?: string }).code).toBe("RIDE_ALREADY_FINAL");

    const cancel = await api(`/api/v1/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(passenger),
      body: { reason: "CHANGE_OF_PLAN" },
    });
    expect(cancel.status).toBe(409);
  });

  it("accept/pickup berulang bersifat idempoten", async () => {
    const { reference, driver } = await assignedRide();

    const acceptAgain = await api(`/api/v1/driver/rides/${reference}/accept`, {
      method: "POST",
      token: tokenFor(driver.user),
    });
    expect(acceptAgain.status).toBe(200);

    await api(`/api/v1/driver/rides/${reference}/pickup`, {
      method: "POST",
      token: tokenFor(driver.user),
    });
    const repeat = await api(`/api/v1/driver/rides/${reference}/pickup`, {
      method: "POST",
      token: tokenFor(driver.user),
    });
    expect(repeat.status).toBe(200);
    expect(((await repeat.json()) as { data: { status: string } }).data.status).toBe("DRIVER_TO_PICKUP");
  });

  it("pembatalan penumpang mencatat alasan, fee, dan versi kebijakan", async () => {
    const { reference, passenger } = await assignedRide();
    const res = await api(`/api/v1/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(passenger),
      body: { reason: "WAIT_TOO_LONG", note: "menunggu lama" },
    });
    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: any }).data;
    expect(data.status).toBe("CANCELLED_BY_PASSENGER");
    expect(data.cancellation.reason).toBe("WAIT_TOO_LONG");
    expect(Number.isInteger(data.cancellation.fee)).toBe(true);
    expect(data.cancellation.fee).toBe(2000);

    const order = await prisma.rideOrder.findFirstOrThrow();
    expect(order.cancellationPolicy).toBe("RIDE_CANCEL_POLICY_V1");
  });

  it("alasan pembatalan di luar allowlist ditolak", async () => {
    const { reference, passenger } = await assignedRide();
    const res = await api(`/api/v1/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(passenger),
      body: { reason: "ALASAN_TIDAK_DIKENAL" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // --- Lokasi --------------------------------------------------------------

  it("lokasi basi, koordinat tidak valid, dan urutan mundur ditolak", async () => {
    const driver = await createDriver("MOTORCYCLE");
    await setOnline(driver);

    const stale = await api("/api/v1/driver/location", {
      method: "POST",
      token: tokenFor(driver.user),
      body: {
        lat: -6.12,
        lng: 106.15,
        accuracyMeters: 10,
        capturedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code?: string }).code).toBe("RIDE_LOCATION_STALE");

    const invalid = await api("/api/v1/driver/location", {
      method: "POST",
      token: tokenFor(driver.user),
      body: { lat: 999, lng: 106.15, accuracyMeters: 10, capturedAt: new Date().toISOString() },
    });
    expect(invalid.status).toBeGreaterThanOrEqual(400);
    expect(invalid.status).toBeLessThan(500);

    const ok = await api("/api/v1/driver/location", {
      method: "POST",
      token: tokenFor(driver.user),
      body: {
        lat: -6.12,
        lng: 106.15,
        accuracyMeters: 10,
        capturedAt: new Date().toISOString(),
        sequence: 5,
      },
    });
    expect(ok.status).toBe(200);
    // Respons tidak membocorkan koordinat.
    expect(JSON.stringify(await ok.json())).not.toContain("106.15");

    const backwards = await api("/api/v1/driver/location", {
      method: "POST",
      token: tokenFor(driver.user),
      body: {
        lat: -6.12,
        lng: 106.15,
        accuracyMeters: 10,
        capturedAt: new Date().toISOString(),
        sequence: 3,
      },
    });
    expect(backwards.status).toBe(409);
    expect(((await backwards.json()) as { code?: string }).code).toBe("RIDE_LOCATION_OUT_OF_ORDER");
  });

  it("pesan error tidak membocorkan koordinat presisi atau stack trace", async () => {
    const passenger = await createUser("USER");
    const res = await api("/api/v1/rides/RID-AAAAAAAAAA", { token: tokenFor(passenger) });
    const text = await res.text();
    expect(res.status).toBe(404);
    expect(text).not.toContain("106.1");
    expect(text.toLowerCase()).not.toContain("at rideservice");
    expect(text.toLowerCase()).not.toContain("prisma");
  });

  it("event audit tidak menyimpan koordinat presisi", async () => {
    const { } = await completedRide();
    const events = await prisma.rideEvent.findMany();
    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events.map((e) => e.metadata));
    expect(serialized).not.toContain("106.1");
    expect(serialized).not.toContain("-6.12");
  });

  // --- Isolasi Business Engine --------------------------------------------

  it("menyelesaikan ride tunai TIDAK mengubah wallet maupun Business Engine", async () => {
    const before = await businessEngineSnapshot();
    const { passenger } = await completedRide();

    const after = await businessEngineSnapshot();
    expect(after).toEqual(before);

    // Wallet penumpang tidak dibuat/diubah oleh ride.
    const wallet = await prisma.wallet.findUnique({ where: { userId: passenger.id } });
    expect(wallet).toBeNull();

    const order = await prisma.rideOrder.findFirstOrThrow();
    expect(order.paymentMethod).toBe("CASH");
    // Tunai hanya dilaporkan; tidak ada saldo digital yang tercipta.
    expect(order.paymentState).toBe("CASH_REPORTED");
  });

  // --- Admin / Moderasi ----------------------------------------------------

  it("endpoint admin ride hanya dapat diakses ADMIN/SUPER_ADMIN", async () => {
    const passenger = await createUser("USER");
    const driver = await createDriver("MOTORCYCLE");
    const admin = await createUser("ADMIN");
    const superAdmin = await createUser("SUPER_ADMIN");

    const unauthenticated = await api("/api/v1/admin/rides");
    const regularUser = await api("/api/v1/admin/rides", {
      token: tokenFor(passenger),
    });
    const driverUser = await api("/api/v1/admin/rides", {
      token: tokenFor(driver.user),
    });
    const adminUser = await api("/api/v1/admin/rides", {
      token: tokenFor(admin),
    });
    const superAdminUser = await api("/api/v1/admin/rides", {
      token: tokenFor(superAdmin),
    });

    expect(unauthenticated.status).toBe(401);
    expect(regularUser.status).toBe(403);
    expect(driverUser.status).toBe(403);
    expect(adminUser.status).toBe(200);
    expect(superAdminUser.status).toBe(200);
  });

  it("admin dapat melihat ringkasan ride dengan data kontak termasking", async () => {
    const admin = await createUser("ADMIN");
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);
    const created = await createOrder(passenger, quote.quoteId);
    expect(created.status).toBe(201);

    const res = await api("/api/v1/admin/rides", {
      token: tokenFor(admin),
    });
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(await res.json());
    expect(serialized).toContain("phoneMasked");
    expect(serialized).toContain("••••");
    expect(serialized).not.toContain(passenger.phone);
    expect(serialized).not.toContain(passenger.id);
    expect(serialized).not.toContain("pickupLat");
    expect(serialized).not.toContain("pickupLng");
    expect(serialized).not.toContain("dropoffLat");
    expect(serialized).not.toContain("dropoffLng");
    expect(serialized).not.toContain("plateNumberHash");
    expect(serialized.toLowerCase()).not.toContain("token");
    expect(serialized.toLowerCase()).not.toContain("password");
  });

  it("admin dapat mengoreksi ride aktif ke terminal tanpa mengubah Business Engine", async () => {
    const admin = await createUser("ADMIN");
    const before = await businessEngineSnapshot();
    const { reference, driver } = await assignedRide();

    const res = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: {
        status: "CANCELLED_BY_SYSTEM",
        reason: "moderasi perjalanan uji",
        note: "dibatalkan oleh admin test",
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; isFinal: boolean } };
    expect(body.data.status).toBe("CANCELLED_BY_SYSTEM");
    expect(body.data.isFinal).toBe(true);

    const order = await prisma.rideOrder.findUniqueOrThrow({
      where: { publicReference: reference },
      include: { events: true },
    });
    expect(order.cancelledByRole).toBe("ADMIN");
    expect(order.cancellationFee).toBe(0);
    expect(order.events.some((event) => event.actorRole === "ADMIN")).toBe(true);

    const profile = await prisma.rideDriverProfile.findUniqueOrThrow({
      where: { id: driver.profile.id },
    });
    expect(profile.availability).toBe("ONLINE");
    expect(await businessEngineSnapshot()).toEqual(before);
  });

  it("koreksi admin duplikat idempoten dan hanya membuat satu RideEvent admin", async () => {
    const admin = await createUser("ADMIN");
    const { reference } = await assignedRide();

    const payload = {
      status: "CANCELLED_BY_SYSTEM",
      reason: "duplikasi permintaan moderasi",
    };
    const first = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: payload,
    });
    const second = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: payload,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const order = await prisma.rideOrder.findUniqueOrThrow({
      where: { publicReference: reference },
      include: { events: true },
    });
    expect(order.status).toBe("CANCELLED_BY_SYSTEM");
    expect(
      order.events.filter(
        (event) =>
          event.actorRole === "ADMIN" &&
          event.newStatus === "CANCELLED_BY_SYSTEM",
      ),
    ).toHaveLength(1);
  });

  it("koreksi admin konkuren tidak menciptakan hasil konflik ganda", async () => {
    const admin = await createUser("ADMIN");
    const { reference } = await assignedRide();

    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        api(`/api/v1/admin/rides/${reference}/status`, {
          method: "PATCH",
          token: tokenFor(admin),
          body: {
            status: "CANCELLED_BY_SYSTEM",
            reason: "koreksi paralel uji",
          },
        }),
      ),
    );

    expect(results.map((result) => result.status)).toEqual([200, 200]);
    const order = await prisma.rideOrder.findUniqueOrThrow({
      where: { publicReference: reference },
      include: { events: true },
    });
    expect(order.status).toBe("CANCELLED_BY_SYSTEM");
    expect(
      order.events.filter(
        (event) =>
          event.actorRole === "ADMIN" &&
          event.newStatus === "CANCELLED_BY_SYSTEM",
      ),
    ).toHaveLength(1);
  });

  it("admin tidak dapat membuka kembali atau mengoreksi ride terminal", async () => {
    const admin = await createUser("ADMIN");
    const { reference } = await completedRide();

    const res = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: {
        status: "CANCELLED_BY_SYSTEM",
        reason: "permintaan koreksi terminal",
      },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe("RIDE_ALREADY_FINAL");
  });

  it("admin correction menolak status non-allowlist dan reason kosong dengan error aman", async () => {
    const admin = await createUser("ADMIN");
    const { reference } = await assignedRide();

    const invalidStatus = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: {
        status: "COMPLETED",
        reason: "tidak boleh melewati state machine",
      },
    });
    const missingReason = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "CANCELLED_BY_SYSTEM", reason: "" },
    });

    expect(invalidStatus.status).toBe(400);
    expect(missingReason.status).toBe(400);
    const combined = `${await invalidStatus.text()} ${await missingReason.text()}`.toLowerCase();
    expect(combined).not.toContain("prisma");
    expect(combined).not.toContain("at rideservice");
  });

  it("admin detail unknown ride/driver/vehicle mengembalikan 404 aman", async () => {
    const admin = await createUser("ADMIN");
    const missingRide = await api("/api/v1/admin/rides/RID-AAAAAAAAAA", {
      token: tokenFor(admin),
    });
    const missingDriver = await api(`/api/v1/admin/rides/drivers/${randomUUID()}`, {
      token: tokenFor(admin),
    });
    const missingVehicle = await api(`/api/v1/admin/rides/vehicles/${randomUUID()}`, {
      token: tokenFor(admin),
    });

    expect(missingRide.status).toBe(404);
    expect(missingDriver.status).toBe(404);
    expect(missingVehicle.status).toBe(404);
    const text = `${await missingRide.text()} ${await missingDriver.text()} ${await missingVehicle.text()}`;
    expect(text.toLowerCase()).not.toContain("prisma");
    expect(text.toLowerCase()).not.toContain("stack");
  });

  it("list admin ride mendukung filter, limit bounded, dan urutan terbaru", async () => {
    const admin = await createUser("ADMIN");
    const passengerA = await createUser("USER");
    const passengerB = await createUser("USER");
    await createOrder(passengerA, (await createQuote(passengerA)).quoteId);
    await createOrder(passengerB, (await createQuote(passengerB, "CAR")).quoteId);

    const res = await api("/api/v1/admin/rides?serviceType=CAR&status=SEARCHING_DRIVER&limit=1", {
      token: tokenFor(admin),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ serviceType: string; status: string }> };
    expect(body.data).toHaveLength(1);
    const [order] = body.data;
    expect(order).toBeDefined();
    expect(order!.serviceType).toBe("CAR");
    expect(order!.status).toBe("SEARCHING_DRIVER");

    const invalidLimit = await api("/api/v1/admin/rides?limit=101", {
      token: tokenFor(admin),
    });
    expect(invalidLimit.status).toBe(400);
  });

  it("admin dapat suspend driver dan driver tersebut tidak dapat online", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriver("MOTORCYCLE");
    await setOnline(driver);

    const res = await api(`/api/v1/admin/rides/drivers/${driver.profile.id}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "SUSPENDED", reason: "dokumen belum valid" },
    });
    expect(res.status).toBe(200);
    const data = ((await res.json()) as { data: { status: string; availability: string } }).data;
    expect(data.status).toBe("SUSPENDED");
    expect(data.availability).toBe("OFFLINE");

    const online = await setOnline(driver);
    expect(online.status).toBe(403);
    expect(((await online.json()) as { code?: string }).code).toBe("RIDE_DRIVER_NOT_ACTIVE");
  });

  it("admin dapat reactivate driver suspended tetapi rejected bersifat terminal", async () => {
    const admin = await createUser("ADMIN");
    const suspended = await createDriver("MOTORCYCLE", { status: "SUSPENDED" });
    const rejected = await createDriver("MOTORCYCLE", { status: "REJECTED" });

    const reactivate = await api(`/api/v1/admin/rides/drivers/${suspended.profile.id}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "ACTIVE", reason: "dokumen sudah valid" },
    });
    expect(reactivate.status).toBe(200);
    expect(((await reactivate.json()) as { data: { status: string } }).data.status).toBe("ACTIVE");

    const invalid = await api(`/api/v1/admin/rides/drivers/${rejected.profile.id}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "ACTIVE", reason: "uji transisi invalid" },
    });
    expect(invalid.status).toBe(409);
    expect(((await invalid.json()) as { code?: string }).code).toBe(
      "RIDE_DRIVER_STATUS_TRANSITION_INVALID",
    );
  });

  it("admin dapat menolak kendaraan sehingga driver tidak menerima offer baru", async () => {
    const admin = await createUser("ADMIN");
    const passenger = await createUser("USER");
    const driver = await createDriver("MOTORCYCLE");
    const vehicle = await prisma.rideVehicle.findFirstOrThrow({
      where: { driverProfileId: driver.profile.id },
    });

    const moderation = await api(`/api/v1/admin/rides/vehicles/${vehicle.id}/verification`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: {
        verificationStatus: "REJECTED",
        isActive: false,
        reason: "kendaraan tidak lolos verifikasi",
      },
    });
    expect(moderation.status).toBe(200);
    const updated = (await moderation.json()) as {
      data: { verificationStatus: string; isActive: boolean };
    };
    expect(updated.data.verificationStatus).toBe("REJECTED");
    expect(updated.data.isActive).toBe(false);

    await setOnline(driver);
    const quote = await createQuote(passenger);
    await createOrder(passenger, quote.quoteId);
    const offers = await api("/api/v1/driver/rides/offers", {
      token: tokenFor(driver.user),
    });
    expect(((await offers.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  it("kendaraan rejected tidak dapat langsung verified tanpa review ulang pending", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriver("MOTORCYCLE");
    const vehicle = await prisma.rideVehicle.findFirstOrThrow({
      where: { driverProfileId: driver.profile.id },
    });
    await prisma.rideVehicle.update({
      where: { id: vehicle.id },
      data: { verificationStatus: "REJECTED", isActive: false },
    });

    const invalid = await api(`/api/v1/admin/rides/vehicles/${vehicle.id}/verification`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: {
        verificationStatus: "VERIFIED",
        isActive: true,
        reason: "uji transisi invalid",
      },
    });
    expect(invalid.status).toBe(409);
    expect(((await invalid.json()) as { code?: string }).code).toBe(
      "RIDE_VEHICLE_STATUS_TRANSITION_INVALID",
    );
  });

  it("rate limit aktif pada endpoint tulis ride", async () => {
    const passenger = await createUser("USER");
    let limited = false;
    for (let i = 0; i < 30; i += 1) {
      const res = await api("/api/v1/rides/quotes", {
        method: "POST",
        token: tokenFor(passenger),
        body: { serviceType: "MOTORCYCLE", pickup: PICKUP, dropoff: DROPOFF },
      });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function cleanRideTables() {
  await prisma.rideEvent.deleteMany();
  await prisma.rideDriverLocation.deleteMany();
  await prisma.rideOrder.deleteMany();
  await prisma.rideQuote.deleteMany();
  await prisma.rideVehicle.deleteMany();
  await prisma.rideDriverProfile.deleteMany();
  await prisma.rideIdempotencyRecord.deleteMany();
  // RideDriverApplication memakai ON DELETE RESTRICT: tanpa baris ini
  // user.deleteMany() di bawah akan gagal dengan SQLSTATE 23001.
  await prisma.rideDriverApplication.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
}

async function api(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    idempotencyKey?: string;
  } = {},
) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Ride User ${sequence}`,
      phone: `+6288${String(sequence).padStart(9, "0")}`,
      referralCode: `RIDE${String(sequence).padStart(6, "0")}`,
      role,
    },
  });
}

async function createDriver(
  vehicleType: RideServiceType,
  options: { status?: "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED" } = {},
) {
  const user = await createUser("DRIVER");
  const profile = await prisma.rideDriverProfile.create({
    data: {
      userId: user.id,
      status: options.status ?? "ACTIVE",
      availability: "OFFLINE",
    },
  });
  const plate = `PLATE-${profile.id.slice(0, 8)}`;
  await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: vehicleType,
      plateNumberHash: createHash("sha256").update(plate).digest("hex"),
      plateNumberMasked: "A 1234 ***",
      verificationStatus: "VERIFIED",
      isActive: true,
    },
  });
  return { user, profile };
}

async function setOnline(driver: { user: { id: string; role: UserRole } }) {
  return api("/api/v1/driver/availability", {
    method: "POST",
    token: tokenFor(driver.user),
    body: { availability: "ONLINE" },
  });
}

async function createQuote(
  user: { id: string; role: UserRole },
  serviceType: RideServiceType = "MOTORCYCLE",
) {
  const res = await api("/api/v1/rides/quotes", {
    method: "POST",
    token: tokenFor(user),
    body: { serviceType, pickup: PICKUP, dropoff: DROPOFF },
  });
  return ((await res.json()) as { data: { quoteId: string; fare: { totalFare: number } } }).data;
}

async function createOrder(user: { id: string; role: UserRole }, quoteId: string) {
  return api("/api/v1/rides", {
    method: "POST",
    token: tokenFor(user),
    body: { quoteId, paymentMethod: "CASH" },
  });
}

async function assignedRide() {
  const passenger = await createUser("USER");
  const driver = await createDriver("MOTORCYCLE");
  await setOnline(driver);
  const quote = await createQuote(passenger);
  const created = await createOrder(passenger, quote.quoteId);
  const reference = ((await created.json()) as { data: { reference: string } }).data.reference;
  const accept = await api(`/api/v1/driver/rides/${reference}/accept`, {
    method: "POST",
    token: tokenFor(driver.user),
  });
  expect(accept.status).toBe(200);
  return { passenger, driver, reference };
}

async function assignedRideWithForeignDriver() {
  const base = await assignedRide();
  const other = await createDriver("MOTORCYCLE");
  await setOnline(other);
  return { ...base, other };
}

async function completedRide() {
  const base = await assignedRide();
  for (const step of ["pickup", "arrived", "start", "complete"]) {
    const res = await api(`/api/v1/driver/rides/${base.reference}/${step}`, {
      method: "POST",
      token: tokenFor(base.driver.user),
    });
    expect(res.status).toBe(200);
  }
  return base;
}

/** Cuplikan seluruh state Business Engine untuk membuktikan tidak berubah. */
async function businessEngineSnapshot() {
  const [
    wallets,
    walletTransactions,
    commissions,
    rewards,
    profitSharing,
    referrals,
    userMemberships,
    membershipOrders,
    invoices,
  ] = await Promise.all([
    prisma.wallet.count(),
    prisma.walletTransaction.count(),
    prisma.commission.count(),
    prisma.rewardTransaction.count(),
    prisma.profitSharingDistribution.count(),
    prisma.referral.count(),
    prisma.userMembership.count(),
    prisma.membershipOrder.count(),
    prisma.invoice.count(),
  ]);
  const balances = await prisma.wallet.aggregate({
    _sum: { balance: true, cashBalance: true, ppobBalance: true },
  });
  return {
    wallets,
    walletTransactions,
    commissions,
    rewards,
    profitSharing,
    referrals,
    userMemberships,
    membershipOrders,
    invoices,
    balance: new Prisma.Decimal(balances._sum.balance ?? 0).toFixed(2),
    cashBalance: new Prisma.Decimal(balances._sum.cashBalance ?? 0).toFixed(2),
    ppobBalance: new Prisma.Decimal(balances._sum.ppobBalance ?? 0).toFixed(2),
  };
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`,
  });
}
