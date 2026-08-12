import { RideServiceType, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  prisma,
  runIntegration,
  testDatabaseUrl,
} from "../helpers/referralWalletHarness.js";
import {
  apiRateLimiter,
  rideWriteRateLimiter,
} from "../../src/core/security/rateLimit.js";

/**
 * Pengerasan permukaan ride penumpang (Stage R2.4).
 *
 * rideFoundation.integration.test.ts sudah menjaga alur utama, isolasi antar
 * penumpang, dan state machine. Berkas ini menutup penjaga yang ditegakkan
 * backend tetapi belum punya test sama sekali:
 *
 *   - RIDE_QUOTE_ALREADY_USED — satu estimasi hanya boleh menjadi satu order.
 *     Tanpa penjaga ini, satu quote dapat dipakai berkali-kali pada tarif yang
 *     sudah basi.
 *   - rideWriteRateLimiter — batas 20 permintaan tulis per menit.
 *   - Isolasi dan batas pada riwayat perjalanan penumpang.
 *   - Mass assignment: tarif tidak boleh dapat disuntik dari body.
 */

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    apiRateLimiter.resetKey(key);
    rideWriteRateLimiter.resetKey(key);
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

describe.skipIf(!runIntegration)("R2.4 — passenger ride hardening", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error(
        "TAPGO_TEST_DATABASE_URL must point to a dedicated test database.",
      );
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "ride-hardening-access-secret-000000000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "ride-hardening-refresh-secret-00000000";

    const [{ createApp }, tokenService] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/core/security/tokenService.js"),
    ]);
    signAccessToken = tokenService.signAccessToken;

    appServer = http.createServer(createApp());
    await new Promise<void>((resolve) =>
      appServer!.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    resetRateLimits();
    await cleanRideTables();
  });

  afterAll(async () => {
    await cleanRideTables();
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  it("estimasi yang sudah dipakai tidak dapat dipakai lagi meski tidak ada perjalanan aktif", async () => {
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);

    const first = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });
    expect(first.status).toBe(201);
    const reference = ((await first.json()) as { data: { reference: string } })
      .data.reference;

    // Perjalanan pertama dibatalkan sehingga penjaga RIDE_ACTIVE_ORDER_EXISTS
    // tidak lagi ikut menghalangi. Tanpa langkah ini, test tidak dapat
    // membedakan penjaga quote dari penjaga perjalanan aktif — dan terbukti
    // vakum saat penjaga quote dimatikan.
    const cancelled = await api(`/api/v1/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(passenger),
      body: { reason: "CHANGE_OF_PLAN" },
    });
    expect(cancelled.status).toBeLessThan(400);

    const second = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });
    expect(second.status).toBeGreaterThanOrEqual(400);
    const body = (await second.json()) as { code?: string };
    expect(body.code).toBe("RIDE_QUOTE_ALREADY_USED");

    // Yang menentukan: satu estimasi tetap menghasilkan tepat satu order.
    expect(await prisma.rideOrder.count()).toBe(1);
  });

  it("idempotency key yang sama tidak menghasilkan order ganda", async () => {
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);
    const key = `hardening-${randomUUID()}`;

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
    const firstRef = ((await first.json()) as { data: { reference: string } })
      .data.reference;

    // Percobaan ulang WAJIB berhasil dan mengembalikan perjalanan yang sama.
    // Inilah yang membedakan replay idempoten dari penolakan biasa: bila header
    // Idempotency-Key diabaikan, permintaan kedua akan tertolak 4xx oleh
    // penjaga quote/perjalanan aktif dan test ini gagal.
    expect(second.status).toBeLessThan(400);
    const secondRef = ((await second.json()) as { data: { reference: string } })
      .data.reference;
    expect(secondRef).toBe(firstRef);
    expect(await prisma.rideOrder.count()).toBe(1);
  });

  it("tarif tidak dapat disuntik dari body permintaan", async () => {
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);

    const response = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: {
        quoteId: quote.quoteId,
        paymentMethod: "CASH",
        // Field berikut sengaja diselipkan: skema harus mengabaikannya.
        totalFare: 1,
        fare: { totalFare: 1, baseFare: 0 },
        baseFare: 0,
        distanceMeters: 1,
      },
    });
    expect(response.status).toBe(201);

    const created = await prisma.rideOrder.findFirstOrThrow();
    // Tarif tetap sama dengan yang dihitung server pada quote.
    expect(Number(created.totalFare)).toBe(quote.fare.totalFare);
    expect(Number(created.totalFare)).toBeGreaterThan(1);
  });

  it("menolak pembayaran DIGITAL dengan kode yang jelas", async () => {
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);

    const response = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "DIGITAL" },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("RIDE_DIGITAL_PAYMENT_NOT_CONFIGURED");
    expect(await prisma.rideOrder.count()).toBe(0);
  });

  it("riwayat perjalanan hanya memuat milik pemanggil", async () => {
    const alice = await createUser("USER");
    const bob = await createUser("USER");
    const aliceQuote = await createQuote(alice);
    const bobQuote = await createQuote(bob);
    await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(alice),
      body: { quoteId: aliceQuote.quoteId, paymentMethod: "CASH" },
    });
    await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(bob),
      body: { quoteId: bobQuote.quoteId, paymentMethod: "CASH" },
    });

    const aliceOrder = await prisma.rideOrder.findFirstOrThrow({
      where: { passengerId: alice.id },
    });
    const bobOrder = await prisma.rideOrder.findFirstOrThrow({
      where: { passengerId: bob.id },
    });

    const listed = await api("/api/v1/rides", { token: tokenFor(alice) });
    expect(listed.status).toBe(200);
    const raw = JSON.stringify(await listed.json());

    expect(raw).toContain(aliceOrder.publicReference);
    expect(raw).not.toContain(bobOrder.publicReference);
    expect(raw).not.toContain(bob.id);
  });

  it("membatasi jumlah baris riwayat walau limit dipaksa besar", async () => {
    const passenger = await createUser("USER");

    for (const limit of ["1000", "-5", "0", "abc"]) {
      const response = await api(
        `/api/v1/rides?limit=${encodeURIComponent(limit)}`,
        { token: tokenFor(passenger) },
      );
      // Limit tidak wajar ditolak, atau dijepit — yang penting tidak pernah
      // membuka jalan membaca seluruh tabel.
      if (response.status === 200) {
        const body = (await response.json()) as { data?: unknown[] };
        expect(Array.isArray(body.data)).toBe(true);
        expect((body.data ?? []).length).toBeLessThanOrEqual(50);
      } else {
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it("menolak alasan pembatalan di luar allowlist dan catatan terlalu panjang", async () => {
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);
    const created = await api("/api/v1/rides", {
      method: "POST",
      token: tokenFor(passenger),
      body: { quoteId: quote.quoteId, paymentMethod: "CASH" },
    });
    const reference = (
      (await created.json()) as { data: { reference: string } }
    ).data.reference;

    const rejected = await api(`/api/v1/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(passenger),
      body: { reason: "ALASAN_KARANGAN_SENDIRI" },
    });
    expect(rejected.status).toBeGreaterThanOrEqual(400);

    const tooLongNote = await api(`/api/v1/rides/${reference}/cancel`, {
      method: "POST",
      token: tokenFor(passenger),
      body: { reason: "CHANGE_OF_PLAN", note: "x".repeat(501) },
    });
    expect(tooLongNote.status).toBeGreaterThanOrEqual(400);

    // Perjalanan tetap hidup: penolakan tidak boleh mengubah status.
    const stored = await prisma.rideOrder.findFirstOrThrow({
      where: { publicReference: reference },
    });
    expect(stored.status).not.toBe("CANCELLED_BY_PASSENGER");
  });

  it("menerapkan rate limit pada penulisan ride", async () => {
    const passenger = await createUser("USER");
    let limited = false;

    // Batas tulis ride adalah 20 per menit.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await api("/api/v1/rides/quotes", {
        method: "POST",
        token: tokenFor(passenger),
        body: { serviceType: "MOTORCYCLE", pickup: PICKUP, dropoff: DROPOFF },
      });
      if (response.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited, "penulisan ride harus dibatasi rate limit").toBe(true);
    resetRateLimits();
  });

  it("menolak koordinat dan alamat di luar batas wajar", async () => {
    const passenger = await createUser("USER");
    const invalid: ReadonlyArray<Record<string, unknown>> = [
      { lat: -91, lng: 106.15, address: "Di luar batas lintang" },
      { lat: -6.12, lng: 181, address: "Di luar batas bujur" },
      { lat: -6.12, lng: 106.15, address: "ab" },
      { lat: -6.12, lng: 106.15, address: "x".repeat(256) },
      { lat: "bukan-angka", lng: 106.15, address: "Alamat sah" },
    ];

    for (const pickup of invalid) {
      const response = await api("/api/v1/rides/quotes", {
        method: "POST",
        token: tokenFor(passenger),
        body: { serviceType: "MOTORCYCLE", pickup, dropoff: DROPOFF },
      });
      expect(
        response.status,
        `koordinat/alamat tidak sah harus ditolak: ${JSON.stringify(pickup)}`,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(await prisma.rideQuote.count()).toBe(0);
  });

  it("menolak referensi perjalanan berformat salah tanpa membocorkan keberadaan data", async () => {
    const passenger = await createUser("USER");

    for (const reference of [
      "RID-0000000000",
      "bukan-referensi",
      "../../etc/passwd",
      "RID-AAAAAAAAAAAAAAAAAA",
    ]) {
      const response = await api(
        `/api/v1/rides/${encodeURIComponent(reference)}`,
        { token: tokenFor(passenger) },
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      const raw = JSON.stringify(await response.json().catch(() => ({})));
      // Pesan tidak boleh membocorkan detail internal.
      for (const forbidden of ["prisma", "SELECT", "passengerId", "stack"]) {
        expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });
});

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
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function createUser(role: UserRole) {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `Hardening User ${sequence}`,
      phone: `+6289${String(sequence).padStart(9, "0")}`,
      referralCode: `HARD${String(sequence).padStart(6, "0")}`,
      role,
    },
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
  expect(res.status, "prasyarat: quote harus berhasil dibuat").toBe(201);
  return (
    (await res.json()) as {
      data: { quoteId: string; fare: { totalFare: number } };
    }
  ).data;
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`,
  });
}

async function cleanRideTables() {
  await prisma.rideEvent.deleteMany();
  await prisma.rideDriverLocation.deleteMany();
  await prisma.rideOrder.deleteMany();
  await prisma.rideQuote.deleteMany();
  await prisma.rideVehicle.deleteMany();
  await prisma.rideDriverProfile.deleteMany();
  await prisma.rideIdempotencyRecord.deleteMany();
  await prisma.rideDriverApplication.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
}
