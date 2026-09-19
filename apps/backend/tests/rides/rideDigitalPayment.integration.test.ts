import { Prisma, RideServiceType, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, testDatabaseUrl } from "../helpers/referralWalletHarness.js";
import {
  adminRateLimiter,
  apiRateLimiter,
  rideLocationRateLimiter,
  rideWriteRateLimiter,
} from "../../src/core/security/rateLimit.js";

/**
 * Pembayaran perjalanan dengan TapGoPay: tarif ditahan saat memesan, dilunasi
 * ke driver (92%) saat selesai, dan dikembalikan utuh pada setiap pembatalan.
 * Yang dijaga di sini adalah uangnya: tidak ada saldo yang lahir atau hilang.
 */

type SignAccessToken = (payload: { sub: string; role: UserRole; sessionId: string }) => string;

let appServer: Server | undefined;
let baseUrl = "";
let signAccessToken: SignAccessToken;
let backendEnv: typeof import("../../src/config/env.js").env;
let originalFlag = false;
let sequence = 0;

const PICKUP = { lat: -6.12, lng: 106.15, address: "Alun-Alun Serang (uji)" };
const DROPOFF = { lat: -6.131, lng: 106.141, address: "Pasar Rau (uji)" };

describe.skipIf(!runIntegration)("Ride digital payment (TapGoPay)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "ride-digital-access-secret-0000000000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "ride-digital-refresh-secret-000000000";

    const [{ createApp }, tokenService, envModule] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
      import("../../src/config/env.js"),
    ]);
    signAccessToken = tokenService.signAccessToken;
    backendEnv = envModule.env;
    originalFlag = backendEnv.RIDE_DIGITAL_PAYMENT_ENABLED;

    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) => appServer!.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      adminRateLimiter.resetKey(key);
      apiRateLimiter.resetKey(key);
      rideWriteRateLimiter.resetKey(key);
      rideLocationRateLimiter.resetKey(key);
    }
    backendEnv.RIDE_DIGITAL_PAYMENT_ENABLED = true;
    await clean();
  });

  afterAll(async () => {
    backendEnv.RIDE_DIGITAL_PAYMENT_ENABLED = originalFlag;
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  it("saldo kurang: pesanan ditolak dan saldo tidak berubah", async () => {
    const passenger = await createPassenger({ balance: 1000, cash: 0 });
    const quote = await createQuote(passenger);

    const res = await order(passenger, quote.quoteId);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("RIDE_INSUFFICIENT_BALANCE");
    expect(await prisma.rideOrder.count()).toBe(0);
    expect(await walletOf(passenger)).toEqual({ balance: "1000", cash: "0" });
  });

  it("flag mati: pembayaran digital tetap ditolak", async () => {
    backendEnv.RIDE_DIGITAL_PAYMENT_ENABLED = false;
    const passenger = await createPassenger({ balance: 100000, cash: 0 });
    const quote = await createQuote(passenger);
    const res = await order(passenger, quote.quoteId);
    expect(res.status).toBe(403);
    expect(await prisma.rideOrder.count()).toBe(0);
    expect(await walletOf(passenger)).toEqual({ balance: "100000", cash: "0" });
  });

  it("menahan tarif dari saldo non-tarik lebih dulu, saldo tarik tidak tersentuh", async () => {
    const passenger = await createPassenger({ balance: 100000, cash: 30000 });
    const quote = await createQuote(passenger);

    const res = await order(passenger, quote.quoteId);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { payment: { method: string; state: string } } };
    expect(body.data.payment).toEqual({ method: "DIGITAL", state: "DIGITAL_HELD" });

    expect(await walletOf(passenger)).toEqual({
      balance: String(100000 - quote.fare.totalFare),
      cash: "30000",
    });
    const ledger = await prisma.walletTransaction.findFirstOrThrow({ where: { referenceType: "RIDE_ORDER" } });
    expect(ledger.type).toBe("PAYMENT");
    expect(ledger.amount.toString()).toBe(String(-quote.fare.totalFare));
  });

  it("memakai saldo tarik hanya bila saldo non-tarik habis, lalu refund mengembalikan komposisi yang sama", async () => {
    const fare = (await createQuoteFare());
    // Saldo non-tarik hanya 4.000; sisanya harus diambil dari saldo tarik.
    const passenger = await createPassenger({ balance: 4000 + 50000, cash: 50000 });
    const quote = await createQuote(passenger);
    expect(quote.fare.totalFare).toBe(fare);

    const created = await order(passenger, quote.quoteId);
    expect(created.status).toBe(201);
    const reference = ((await created.json()) as { data: { reference: string } }).data.reference;
    expect(await walletOf(passenger)).toEqual({
      balance: String(54000 - fare),
      cash: String(50000 - (fare - 4000)),
    });

    const cancel = await api(`/api/v1/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(passenger),
      body: { reason: "CHANGE_OF_PLAN" },
    });
    expect(cancel.status).toBe(200);
    expect(await walletOf(passenger)).toEqual({ balance: "54000", cash: "50000" });
  });

  it("batal sebelum ada driver: dana kembali penuh, dan batal ulang tidak menggandakan", async () => {
    const passenger = await createPassenger({ balance: 100000, cash: 0 });
    const quote = await createQuote(passenger);
    const reference = await orderRef(passenger, quote.quoteId);

    const cancel = await api(`/api/v1/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(passenger),
      body: { reason: "CHANGE_OF_PLAN" },
    });
    expect(cancel.status).toBe(200);
    expect(await walletOf(passenger)).toEqual({ balance: "100000", cash: "0" });
    expect((await prisma.rideOrder.findFirstOrThrow()).paymentState).toBe("DIGITAL_REFUNDED");

    const again = await api(`/api/v1/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(passenger),
      body: { reason: "CHANGE_OF_PLAN" },
    });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(await walletOf(passenger)).toEqual({ balance: "100000", cash: "0" });
    expect(await prisma.walletTransaction.count({ where: { type: "REFUND" } })).toBe(1);
  });

  it("driver membatalkan setelah menerima: penumpang dikembalikan penuh", async () => {
    const passenger = await createPassenger({ balance: 100000, cash: 0 });
    const driver = await createDriver();
    await setOnline(driver);
    const quote = await createQuote(passenger);
    const reference = await orderRef(passenger, quote.quoteId);
    expect((await driverStep(driver, reference, "accept")).status).toBe(200);

    const cancel = await api(`/api/v1/driver/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(driver.user),
      body: { reason: "OTHER" },
    });
    expect(cancel.status).toBe(200);
    expect(await walletOf(passenger)).toEqual({ balance: "100000", cash: "0" });
    expect(await walletOf(driver.user)).toBeNull();
  });

  it("selesai: driver menerima 92%, penumpang tidak dipotong lagi, state DIGITAL_PAID", async () => {
    const passenger = await createPassenger({ balance: 100000, cash: 0 });
    const driver = await createDriver();
    await setOnline(driver);
    const quote = await createQuote(passenger);
    const reference = await orderRef(passenger, quote.quoteId);
    for (const step of ["accept", "pickup", "arrived", "start", "complete"]) {
      expect((await driverStep(driver, reference, step)).status).toBe(200);
    }

    const total = quote.fare.totalFare;
    expect(await walletOf(passenger)).toEqual({ balance: String(100000 - total), cash: "0" });
    const driverShare = (total * 92) / 100;
    expect(await walletOf(driver.user)).toEqual({ balance: String(driverShare), cash: String(driverShare) });
    expect((await prisma.rideOrder.findFirstOrThrow()).paymentState).toBe("DIGITAL_PAID");

    // Diselesaikan ulang tidak menggandakan saldo driver.
    const again = await driverStep(driver, reference, "complete");
    expect(again.status).toBe(200);
    expect(await walletOf(driver.user)).toEqual({ balance: String(driverShare), cash: String(driverShare) });
  });

  it("pembatalan setelah lunas tidak mengembalikan apa pun", async () => {
    const passenger = await createPassenger({ balance: 100000, cash: 0 });
    const driver = await createDriver();
    await setOnline(driver);
    const quote = await createQuote(passenger);
    const reference = await orderRef(passenger, quote.quoteId);
    for (const step of ["accept", "pickup", "arrived", "start", "complete"]) {
      await driverStep(driver, reference, step);
    }
    const cancel = await api(`/api/v1/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(passenger),
      body: { reason: "CHANGE_OF_PLAN" },
    });
    expect(cancel.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.walletTransaction.count({ where: { type: "REFUND" } })).toBe(0);
  });

  it("koreksi admin ke batal mengembalikan dana penumpang", async () => {
    const passenger = await createPassenger({ balance: 100000, cash: 0 });
    const admin = await createUser("SUPER_ADMIN");
    const quote = await createQuote(passenger);
    const reference = await orderRef(passenger, quote.quoteId);

    const res = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "NO_DRIVER", reason: "Tidak ada driver tersedia" },
    });
    expect(res.status).toBe(200);
    expect(await walletOf(passenger)).toEqual({ balance: "100000", cash: "0" });
  });

  it("perjalanan tunai tidak menyentuh wallet sama sekali", async () => {
    const passenger = await createPassenger({ balance: 100000, cash: 0 });
    const driver = await createDriver();
    await setOnline(driver);
    const quote = await createQuote(passenger);
    const created = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });
    const reference = ((await created.json()) as { data: { reference: string } }).data.reference;
    for (const step of ["accept", "pickup", "arrived", "start", "complete"]) {
      await driverStep(driver, reference, step);
    }
    expect(await walletOf(passenger)).toEqual({ balance: "100000", cash: "0" });
    expect(await walletOf(driver.user)).toBeNull();
    expect(await prisma.walletTransaction.count()).toBe(0);
  });
});

/* ------------------------------- helper ------------------------------- */

async function clean() {
  await prisma.rideEvent.deleteMany();
  await prisma.rideDriverLocation.deleteMany();
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

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Digital ${sequence}`,
      phone: `+6289${String(sequence).padStart(9, "0")}`,
      referralCode: `DIG${String(sequence).padStart(6, "0")}`,
      role,
    },
  });
}

async function createPassenger(wallet: { balance: number; cash: number }) {
  const user = await createUser("USER");
  await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: new Prisma.Decimal(wallet.balance),
      cashBalance: new Prisma.Decimal(wallet.cash),
      ppobBalance: new Prisma.Decimal(0),
      currency: "IDR",
    },
  });
  return user;
}

async function createDriver(type: RideServiceType = "MOTORCYCLE") {
  const user = await createUser("DRIVER");
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

async function createQuote(user: { id: string; role: UserRole }) {
  const res = await api("/api/v1/rides/quotes", {
    method: "POST",
    token: tokenFor(user),
    body: { serviceType: "MOTORCYCLE", pickup: PICKUP, dropoff: DROPOFF },
  });
  return ((await res.json()) as { data: { quoteId: string; fare: { totalFare: number } } }).data;
}

async function createQuoteFare() {
  const probe = await createUser("USER");
  const quote = await createQuote(probe);
  return quote.fare.totalFare;
}

function order(user: { id: string; role: UserRole }, quoteId: string) {
  return api("/api/v1/rides", {
    method: "POST",
    token: tokenFor(user),
    body: { quoteId, paymentMethod: "DIGITAL" },
  });
}

async function orderRef(user: { id: string; role: UserRole }, quoteId: string) {
  const res = await order(user, quoteId);
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { reference: string } }).data.reference;
}

function driverStep(driver: { user: { id: string; role: UserRole } }, reference: string, step: string) {
  return api(`/api/v1/driver/rides/${reference}/${step}`, { method: "POST", token: tokenFor(driver.user) });
}

async function walletOf(user: { id: string }) {
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  return wallet
    ? { balance: wallet.balance.toString(), cash: wallet.cashBalance.toString() }
    : null;
}
