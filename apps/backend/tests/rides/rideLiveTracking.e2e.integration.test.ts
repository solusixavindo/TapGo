import { Prisma, RideServiceType, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";

/**
 * Uji ujung-ke-ujung (HTTP sungguhan, waktu nyata) satu perjalanan lengkap dengan posisi hidup:
 * pesan -> tawaran -> terima -> menuju titik jemput -> tiba -> mulai -> selesai -> nilai.
 *
 * Syarat Owner 16 Okt 2026: gerak driver menuju titik jemput tidak boleh terlihat di ponsel penumpang
 * lebih lambat dari 3 detik. Di sini driver mengirim posisi tiap 1 detik (selang driver_app saat menuju
 * titik jemput) dan penumpang mengambil tiap 1,5 detik (selang user_app). Yang diukur adalah umur
 * informasi di saat penumpang menerimanya: waktu sekarang dikurangi capturedAt yang dikirim driver.
 * Waktu radio seluler tidak ikut terukur; itu ditambahkan di atas angka ini di lapangan.
 */
type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let appServer: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let sequence = 0;
const saved = { commission: false, digital: false };

const PICKUP = { lat: -6.12, lng: 106.15, address: "Alun-Alun Serang (uji)" };
const DROPOFF = { lat: -6.131, lng: 106.141, address: "Pasar Rau (uji)" };
const DRIVER_DRIVE_INTERVAL_MS = 1000; // selang kirim driver_app menuju titik jemput
const PASSENGER_POLL_INTERVAL_MS = 1500; // kRideDriverTrackInterval di user_app
const MAX_VISIBLE_AGE_MS = 3000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!runIntegration)("E2E perjalanan lengkap + posisi hidup", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "ride-e2e-access-secret-0000000000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "ride-e2e-refresh-secret-000000000000";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js"),
    ]);
    signAccessToken = tokenService.signAccessToken;
    backendEnv = envModule.env;
    saved.commission = backendEnv.DRIVER_COMMISSION_ENABLED;
    saved.digital = backendEnv.RIDE_DIGITAL_PAYMENT_ENABLED;

    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    backendEnv.DRIVER_COMMISSION_ENABLED = true;
    backendEnv.DRIVER_COMMISSION_PERCENT = 8;
    backendEnv.RIDE_DIGITAL_PAYMENT_ENABLED = true;
    await clean();
  });

  afterAll(async () => {
    backendEnv.DRIVER_COMMISSION_ENABLED = saved.commission;
    backendEnv.RIDE_DIGITAL_PAYMENT_ENABLED = saved.digital;
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  it("TUNAI: komisi 8% ditahan saat terima, posisi driver terlihat penumpang <= 3 dtk, komisi final saat selesai", async () => {
    const passenger = await createUser("USER");
    const driver = await createDriver({ balance: 20000 });
    await setOnline(driver);
    await postLocation(driver, offsetFrom(PICKUP, -0.004)); // ~440 m di selatan titik jemput

    const quote = await createQuote(passenger);
    const created = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });
    expect(created.status).toBe(201);
    const reference = ((await created.json()) as { data: { reference: string } }).data.reference;

    // Tawaran memuat rincian untuk driver: tunai => komisi ditahan.
    const offers = (await (await api("/api/v1/driver/rides/offers", { token: tokenFor(driver.user) })).json()) as {
      data: Array<{ reference: string; commissionFee?: number; commissionKind?: string; payment?: { method: string } }>;
    };
    const offer = offers.data.find((item) => item.reference === reference);
    expect(offer, "tawaran harus muncul bagi driver terdekat").toBeDefined();
    const fee = Math.ceil((quote.fare.totalFare * 8) / 100);
    expect(offer!.commissionFee).toBe(fee);
    expect(offer!.commissionKind).toBe("HELD");
    expect(offer!.payment?.method).toBe("CASH");

    // Terima: komisi ditahan dari Saldo TapGo.
    expect((await driverStep(driver, reference, "accept")).status).toBe(200);
    expect((await walletOf(driver.user))!.balance).toBe(String(20000 - fee));

    expect((await driverStep(driver, reference, "pickup")).status).toBe(200);

    // --- Posisi hidup: driver 1 dtk sekali, penumpang 1,5 dtk sekali, selama ~7 dtk. ---
    const observed: Array<{ lagMs: number; distance: number; stale: boolean; target: string }> = [];
    const stepsDeg = [-0.004, -0.0033, -0.0026, -0.0019, -0.0012, -0.0006, -0.0002, 0];
    let driverDone = false;
    const driverLoop = (async () => {
      for (const offset of stepsDeg) {
        const response = await postLocation(driver, offsetFrom(PICKUP, offset));
        expect(response.status).toBe(200);
        await sleep(DRIVER_DRIVE_INTERVAL_MS);
      }
      driverDone = true;
    })();
    const passengerLoop = (async () => {
      await sleep(300); // penumpang membuka layar sesaat setelah driver mulai bergerak
      while (!driverDone) {
        const res = await api(`/api/v1/rides/${reference}/driver-location`, { token: tokenFor(passenger) });
        const body = (await res.json()) as {
          data: { available: boolean; capturedAt: string; stale: boolean; target: string; distanceMeters: number };
        };
        const receivedAt = Date.now();
        expect(res.status).toBe(200);
        expect(body.data.available).toBe(true);
        observed.push({
          lagMs: receivedAt - Date.parse(body.data.capturedAt),
          distance: body.data.distanceMeters,
          stale: body.data.stale,
          target: body.data.target,
        });
        await sleep(PASSENGER_POLL_INTERVAL_MS);
      }
    })();
    await Promise.all([driverLoop, passengerLoop]);

    if (process.env.E2E_VERBOSE) {
      console.info("UMUR POSISI SAAT DITERIMA PENUMPANG (ms):", observed.map((sample) => sample.lagMs).join(", "));
    }
    expect(observed.length).toBeGreaterThanOrEqual(5);
    for (const sample of observed) {
      expect(sample.stale).toBe(false);
      expect(sample.target).toBe("PICKUP");
      expect(sample.lagMs, `umur posisi saat diterima penumpang: ${sample.lagMs} ms`).toBeLessThanOrEqual(MAX_VISIBLE_AGE_MS);
    }
    // Posisi benar-benar bergerak mendekat (jarak ke titik jemput tidak membesar dan akhirnya jauh lebih kecil).
    const distances = observed.map((sample) => sample.distance);
    expect(distances[distances.length - 1]!).toBeLessThan(distances[0]!);
    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i]!, `jarak ke-${i}`).toBeLessThanOrEqual(distances[i - 1]! + 30);
    }

    for (const step of ["arrived", "start", "complete"]) {
      expect((await driverStep(driver, reference, step)).status, step).toBe(200);
    }

    // Selesai: komisi menjadi final, saldo driver tetap berkurang sebesar komisi (tunai tidak dikredit).
    expect((await walletOf(driver.user))!.balance).toBe(String(20000 - fee));
    const ledger = await prisma.walletTransaction.findMany({ where: { type: "PAYMENT" } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount.toString()).toBe(String(-fee));
    expect((ledger[0]!.metadata as { status?: string } | null)?.status ?? "FINALIZED").toBe("FINALIZED");
    expect((await prisma.rideOrder.findFirstOrThrow()).status).toBe("COMPLETED");

    const rating = await api(`/api/v1/rides/${reference}/rating`, {
      method: "POST",
      token: tokenFor(passenger),
      body: { stars: 5, note: "Cepat dan sopan" },
    });
    expect(rating.status).toBe(201);
  }, 60_000);

  it("DIGITAL: tarif ditahan dari penumpang, driver menerima 92%, tawaran menandai komisi dipotong dari tarif", async () => {
    const passenger = await createUser("USER", { balance: 100000 });
    const driver = await createDriver({ balance: 0 });
    await setOnline(driver);
    await postLocation(driver, offsetFrom(PICKUP, -0.002));

    const quote = await createQuote(passenger);
    const created = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "DIGITAL" },
    });
    expect(created.status).toBe(201);
    const reference = ((await created.json()) as { data: { reference: string } }).data.reference;

    const offers = (await (await api("/api/v1/driver/rides/offers", { token: tokenFor(driver.user) })).json()) as {
      data: Array<{ reference: string; commissionKind?: string; commissionFee?: number; payment?: { method: string } }>;
    };
    const offer = offers.data.find((item) => item.reference === reference);
    expect(offer?.payment?.method).toBe("DIGITAL");
    expect(offer?.commissionKind).toBe("DEDUCTED");

    for (const step of ["accept", "pickup", "arrived", "start", "complete"]) {
      expect((await driverStep(driver, reference, step)).status, step).toBe(200);
    }
    const total = quote.fare.totalFare;
    expect((await walletOf(passenger))!.balance).toBe(String(100000 - total));
    const driverShare = String((total * 92) / 100);
    expect(await walletOf(driver.user)).toEqual({ balance: driverShare, cash: driverShare });
  }, 30_000);

  it("TUNAI dibatalkan driver setelah terima: komisi yang ditahan dikembalikan utuh", async () => {
    const passenger = await createUser("USER");
    const driver = await createDriver({ balance: 20000 });
    await setOnline(driver);
    await postLocation(driver, offsetFrom(PICKUP, -0.002));
    const quote = await createQuote(passenger);
    const created = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });
    const reference = ((await created.json()) as { data: { reference: string } }).data.reference;
    expect((await driverStep(driver, reference, "accept")).status).toBe(200);
    expect(Number((await walletOf(driver.user))!.balance)).toBeLessThan(20000);

    const cancel = await api(`/api/v1/driver/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(driver.user),
      body: { reason: "OTHER" },
    });
    expect(cancel.status).toBe(200);
    expect((await walletOf(driver.user))!.balance).toBe("20000");

    // Setelah batal, posisi driver tidak lagi diungkap ke penumpang.
    const after = await api(`/api/v1/rides/${reference}/driver-location`, { token: tokenFor(passenger) });
    expect(((await after.json()) as { data: { available: boolean } }).data.available).toBe(false);
  }, 30_000);

  it("saldo driver kurang dari komisi: tawaran tunai ditolak dengan pesan jelas, saldo tak berubah", async () => {
    const passenger = await createUser("USER");
    const driver = await createDriver({ balance: 100 });
    await setOnline(driver);
    await postLocation(driver, offsetFrom(PICKUP, -0.002));
    const quote = await createQuote(passenger);
    const created = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });
    const reference = ((await created.json()) as { data: { reference: string } }).data.reference;
    const accept = await driverStep(driver, reference, "accept");
    expect(accept.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await accept.json())).toContain("Saldo TapGo");
    expect((await walletOf(driver.user))!.balance).toBe("100");
    expect((await prisma.rideOrder.findFirstOrThrow()).status).toBe("SEARCHING_DRIVER");
  }, 30_000);
});

/* ------------------------------- helper ------------------------------- */

function offsetFrom(point: { lat: number; lng: number }, latOffset: number) {
  return { lat: point.lat + latOffset, lng: point.lng };
}

async function clean() {
  await prisma.rideEvent.deleteMany();
  await prisma.rideDriverLocation.deleteMany();
  await prisma.rideRating?.deleteMany?.();
  await prisma.rideOrder.deleteMany();
  await prisma.rideQuote.deleteMany();
  await prisma.rideVehicle.deleteMany();
  await prisma.rideDriverProfile.deleteMany();
  await prisma.rideIdempotencyRecord.deleteMany();
  await prisma.rideDriverApplication.deleteMany();
  await prisma.commission.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({ sub: user.id, role: user.role, sessionId: `session-${user.id}` });
}

async function api(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function createUser(role: UserRole, wallet?: { balance: number }) {
  sequence += 1;
  const user = await prisma.user.create({
    data: {
      fullName: `E2E ${sequence}`,
      phone: `+6281${String(sequence).padStart(9, "0")}`,
      referralCode: `E2E${String(sequence).padStart(6, "0")}`,
      role,
    },
  });
  if (wallet) {
    await prisma.wallet.create({
      data: {
        userId: user.id,
        balance: new Prisma.Decimal(wallet.balance),
        cashBalance: new Prisma.Decimal(0),
        ppobBalance: new Prisma.Decimal(0),
        currency: "IDR",
      },
    });
  }
  return user;
}

async function createDriver(wallet: { balance: number }, type: RideServiceType = "MOTORCYCLE") {
  const user = await createUser("DRIVER", wallet);
  const profile = await prisma.rideDriverProfile.create({
    data: { userId: user.id, status: "ACTIVE", availability: "OFFLINE" },
  });
  await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type,
      plateNumberHash: createHash("sha256").update(`PLATE-${profile.id}`).digest("hex"),
      plateNumberMasked: "A 1234 ***",
      verificationStatus: "VERIFIED",
      isActive: true,
    },
  });
  return { user, profile };
}

function setOnline(driver: { user: { id: string; role: UserRole } }) {
  return api("/api/v1/driver/availability", {
    method: "POST",
    token: tokenFor(driver.user),
    body: { availability: "ONLINE" },
  });
}

function postLocation(driver: { user: { id: string; role: UserRole } }, point: { lat: number; lng: number }) {
  return api("/api/v1/driver/location", {
    method: "POST",
    token: tokenFor(driver.user),
    body: { lat: point.lat, lng: point.lng, accuracyMeters: 8, capturedAt: new Date().toISOString() },
  });
}

async function createQuote(user: { id: string; role: UserRole }) {
  const res = await api("/api/v1/rides/quotes", {
    method: "POST",
    token: tokenFor(user),
    body: { serviceType: "MOTORCYCLE", pickup: PICKUP, dropoff: DROPOFF },
  });
  return ((await res.json()) as { data: { quoteId: string; fare: { totalFare: number } } }).data;
}

function driverStep(driver: { user: { id: string; role: UserRole } }, reference: string, step: string) {
  return api(`/api/v1/driver/rides/${reference}/${step}`, { method: "POST", token: tokenFor(driver.user) });
}

async function walletOf(user: { id: string }) {
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  return wallet ? { balance: wallet.balance.toString(), cash: wallet.cashBalance.toString() } : null;
}
