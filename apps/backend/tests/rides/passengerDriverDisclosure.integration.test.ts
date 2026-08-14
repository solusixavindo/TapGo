import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { RideOrderStatus, UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanDatabase, prisma, runIntegration, seedMemberships } from "../helpers/referralWalletHarness.js";
import {
  GENERIC_DRIVER_NAME,
  GENERIC_PLATE_LABEL,
  toDriverDisplayName,
  toMaskedPlate
} from "../../src/modules/rides/application/passengerDriverDisclosure.js";

/**
 * Stage R2.4A — pengungkapan driver/kendaraan kepada penumpang.
 *
 * Aturan masking diuji sebagai unit murni, dan gating disclosure diuji lewat
 * HTTP sungguhan pada PostgreSQL disposable supaya jalur otorisasi ikut teruji.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

let server: Server | undefined;
let baseUrl = "";
let signAccessToken: (p: {
  sub: string;
  role: UserRole;
  sessionId: string;
  authVersion?: number;
}) => string;
let sequence = 0;

const RAW_PLATE = "B1234XYZ";
const STORED_MASKED_PLATE = "B 1234 XYZ";

type ApiResponse = { status: number; raw: string; body: any };

async function api(path: string, token?: string): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) }
  });
  const raw = await response.text();
  return { status: response.status, raw, body: raw ? JSON.parse(raw) : {} };
}

/**
 * Referensi publik yang sah: `RID-` diikuti 10 karakter dari [A-Z2-9].
 * Angka 0 dan 1 sengaja tidak ada pada charset backend (mudah tertukar
 * dengan O dan I), jadi generator ini harus mematuhinya.
 */
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
      phone: `08${String(400000000 + sequence)}`,
      referralCode: `DSC${String(sequence).padStart(6, "0")}`,
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

/** Driver lengkap dengan kendaraan; plat tersimpan sudah ter-masking. */
async function createDriverWithVehicle(fullName = "Budi Santoso Wijaya", masked = STORED_MASKED_PLATE) {
  const user = await createUser("USER", fullName);
  const profile = await prisma.rideDriverProfile.create({
    data: { userId: user.id, status: "ACTIVE", availability: "ONLINE" }
  });
  const vehicle = await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: "MOTORCYCLE",
      plateNumberHash: `hash-${profile.id.slice(0, 12)}`,
      plateNumberMasked: masked,
      brand: "Honda",
      model: "Vario 160",
      color: "Hitam",
      verificationStatus: "VERIFIED",
      isActive: true
    }
  });
  return { user, profile, vehicle };
}

/**
 * Membuat order langsung pada state yang diinginkan.
 *
 * Fixture menulis state akhir alih-alih menjalankan state machine, karena yang
 * diuji di sini adalah PENGUNGKAPAN pada tiap status — bukan transisinya, yang
 * sudah punya test sendiri.
 */
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
      pickupLat: "-6.2000000", pickupLng: "106.8166660", pickupAddress: "Titik jemput uji",
      dropoffLat: "-6.2100000", dropoffLng: "106.8266660", dropoffAddress: "Titik tujuan uji",
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

describeIntegration("Stage R2.4A — passenger driver disclosure", () => {
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
      if (!server) {
        resolve();
        return;
      }
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

  // =================================================================
  // 1-2, 8-10 — status yang WAJIB null
  // =================================================================

  it("1-2,8-9. CREATED, SEARCHING_DRIVER, NO_DRIVER, EXPIRED menghasilkan null", async () => {
    const passenger = await createUser();
    const token = tokenFor(passenger);

    for (const status of [
      "CREATED",
      "SEARCHING_DRIVER",
      "NO_DRIVER",
      "EXPIRED"
    ] as RideOrderStatus[]) {
      const order = await createOrder({ passengerId: passenger.id, status });
      const response = await api(`/api/v1/rides/${order.publicReference}`, token);

      expect(response.status, status).toBe(200);
      expect(response.body.data.driver, status).toBeNull();
      expect(response.body.data.vehicle, status).toBeNull();
    }
  });

  it("10. pembatalan SEBELUM assignment menghasilkan null", async () => {
    const passenger = await createUser();
    const order = await createOrder({
      passengerId: passenger.id,
      status: "CANCELLED_BY_PASSENGER",
      assignedAt: null
    });

    const response = await api(`/api/v1/rides/${order.publicReference}`, tokenFor(passenger));

    expect(response.body.data.driver).toBeNull();
    expect(response.body.data.vehicle).toBeNull();
  });

  it("relasi tak lengkap menghasilkan null meski status memenuhi syarat", async () => {
    const passenger = await createUser();
    const { profile } = await createDriverWithVehicle();

    // driverProfileId ada tetapi vehicleId tidak: fail-closed berpasangan.
    const order = await createOrder({
      passengerId: passenger.id,
      status: "DRIVER_ASSIGNED",
      driverProfileId: profile.id
    });

    const response = await api(`/api/v1/rides/${order.publicReference}`, tokenFor(passenger));
    expect(response.body.data.driver).toBeNull();
    expect(response.body.data.vehicle).toBeNull();
  });

  // =================================================================
  // 3-7, 11 — status yang BOLEH membuka data
  // =================================================================

  it("3-7. DRIVER_ASSIGNED sampai COMPLETED menampilkan kontrak minimal", async () => {
    const passenger = await createUser();
    const token = tokenFor(passenger);
    const { profile, vehicle } = await createDriverWithVehicle();

    for (const status of [
      "DRIVER_ASSIGNED",
      "DRIVER_TO_PICKUP",
      "DRIVER_ARRIVED",
      "IN_TRIP",
      "COMPLETED"
    ] as RideOrderStatus[]) {
      const order = await createOrder({
        passengerId: passenger.id,
        status,
        driverProfileId: profile.id,
        vehicleId: vehicle.id
      });
      const response = await api(`/api/v1/rides/${order.publicReference}`, token);

      expect(response.status, status).toBe(200);
      expect(response.body.data.driver, status).toEqual({ displayName: "Budi" });
      expect(response.body.data.vehicle, status).toEqual({
        serviceType: "MOTORCYCLE",
        model: "Vario 160",
        color: "Hitam",
        maskedPlate: "B 12•• XYZ"
      });
    }
  });

  it("11. pembatalan SETELAH assignment tetap menampilkan kontrak minimal", async () => {
    const passenger = await createUser();
    const { profile, vehicle } = await createDriverWithVehicle();

    for (const status of [
      "CANCELLED_BY_PASSENGER",
      "CANCELLED_BY_DRIVER",
      "CANCELLED_BY_SYSTEM"
    ] as RideOrderStatus[]) {
      const order = await createOrder({
        passengerId: passenger.id,
        status,
        driverProfileId: profile.id,
        vehicleId: vehicle.id,
        assignedAt: new Date()
      });
      const response = await api(`/api/v1/rides/${order.publicReference}`, tokenFor(passenger));

      expect(response.body.data.driver?.displayName, status).toBe("Budi");
      expect(response.body.data.vehicle?.maskedPlate, status).toBe("B 12•• XYZ");
    }
  });

  // =================================================================
  // 12 — IDOR
  // =================================================================

  it("12. penumpang lain tidak dapat membaca data tersebut", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const admin = await createUser("ADMIN");
    const superAdmin = await createUser("SUPER_ADMIN");
    const { profile, vehicle } = await createDriverWithVehicle();
    const order = await createOrder({
      passengerId: owner.id,
      status: "DRIVER_ASSIGNED",
      driverProfileId: profile.id,
      vehicleId: vehicle.id
    });

    // Pemilik boleh.
    expect((await api(`/api/v1/rides/${order.publicReference}`, tokenFor(owner))).status).toBe(200);

    // Penumpang lain 404, bukan 403: keberadaan resource tidak dibocorkan.
    for (const other of [intruder, admin, superAdmin]) {
      const response = await api(`/api/v1/rides/${order.publicReference}`, tokenFor(other));
      expect(response.status, other.role).toBe(404);
      expect(response.raw).not.toContain("Budi");
      expect(response.raw).not.toContain("B 12");
    }

    // Tanpa token juga ditolak.
    expect((await api(`/api/v1/rides/${order.publicReference}`)).status).toBe(401);
  });

  // =================================================================
  // 13-14 — nol kebocoran
  // =================================================================

  it("13-14. plat mentah, telepon, email, dan UUID internal tidak pernah ada di response", async () => {
    const passenger = await createUser();
    const { user: driverUser, profile, vehicle } = await createDriverWithVehicle();
    const order = await createOrder({
      passengerId: passenger.id,
      status: "IN_TRIP",
      driverProfileId: profile.id,
      vehicleId: vehicle.id
    });

    const detail = await api(`/api/v1/rides/${order.publicReference}`, tokenFor(passenger));
    const list = await api("/api/v1/rides", tokenFor(passenger));

    for (const payload of [detail.raw, list.raw]) {
      // Plat mentah dan blind index.
      expect(payload).not.toContain(RAW_PLATE);
      expect(payload).not.toContain("1234");
      expect(payload).not.toContain(vehicle.plateNumberHash);
      // Identitas driver di luar nama depan.
      expect(payload).not.toContain(driverUser.phone);
      expect(payload).not.toContain("Santoso");
      expect(payload).not.toContain("Wijaya");
      // UUID internal.
      expect(payload).not.toContain(profile.id);
      expect(payload).not.toContain(vehicle.id);
      expect(payload).not.toContain(driverUser.id);
      // Field yang sengaja tidak ada pada kontrak.
      expect(payload).not.toContain("rating");
      expect(payload).not.toContain("maskedPhone");
      expect(payload).not.toContain("verificationStatus");
      expect(payload).not.toContain("brand");
    }
  });

  // =================================================================
  // 15-18 — unit masking
  // =================================================================

  it("15-16. nama: hanya nama depan, kosong menjadi label generik", () => {
    expect(toDriverDisplayName("Budi Santoso Wijaya")).toBe("Budi");
    expect(toDriverDisplayName("  Budi   Santoso  ")).toBe("Budi");
    expect(toDriverDisplayName("Budi")).toBe("Budi");
    // Nama satu kata panjang tetap utuh; yang dilarang adalah nama LENGKAP.
    expect(toDriverDisplayName("Siti Nurhaliza Binti Abdullah")).toBe("Siti");

    for (const invalid of ["", "   ", "\t\n", "***", "--", null, undefined, 42 as never]) {
      expect(toDriverDisplayName(invalid as string | null)).toBe(GENERIC_DRIVER_NAME);
    }
  });

  it("17. plat valid dimasking sesuai aturan D-2", () => {
    expect(toMaskedPlate("B 1234 XYZ")).toBe("B 12•• XYZ");
    expect(toMaskedPlate("DK 5678 AB")).toBe("DK 56•• AB");
    expect(toMaskedPlate("b 1234 xyz")).toBe("B 12•• XYZ");
    expect(toMaskedPlate("  B   1234   XYZ  ")).toBe("B 12•• XYZ");
    // Tanpa suffix: tetap sah.
    expect(toMaskedPlate("B 1234")).toBe("B 12••");
    // Digit lebih pendek: tidak ada yang perlu di-mask.
    expect(toMaskedPlate("B 12 XY")).toBe("B 12 XY");
    expect(toMaskedPlate("B 7 A")).toBe("B 7 A");
  });

  it("18. plat malformed fail-closed ke label generik, bukan nilai mentah", () => {
    // Suffix yang sudah tersembunyi BUKAN kegagalan: bagian digit tetap dapat
    // dipetakan dengan aman, dan hasilnya justru lebih tertutup daripada nilai
    // tersimpan. Yang gagal adalah bentuk yang tidak dapat dipetakan sama sekali.
    expect(toMaskedPlate("B 1234 ***")).toBe("B 12••");
    expect(toMaskedPlate("A 1234 ***")).toBe("A 12••");

    const malformed = [
      "B •••• XYZ",      // digit sudah tersembunyi: tidak dapat dipetakan
      "1234 B XYZ",      // urutan salah
      "BBB 1234 XYZ",    // kode wilayah terlalu panjang
      "B 12345 XYZ",     // digit terlalu banyak
      "B1234XYZ",        // tanpa pemisah
      "B 1234 WXYZ",     // suffix terlalu panjang
      "",
      "   ",
      null,
      undefined
    ];
    for (const value of malformed) {
      const result = toMaskedPlate(value as string | null);
      expect(result, JSON.stringify(value)).toBe(GENERIC_PLATE_LABEL);
      // Nilai masukan tidak pernah diteruskan sebagai fallback.
      if (typeof value === "string" && value.trim() !== "") {
        expect(result).not.toBe(value);
      }
    }
  });

  it("18b. plat yang tidak dapat dipetakan tetap menghasilkan kendaraan dengan label generik", async () => {
    const passenger = await createUser();
    // Format yang dipakai fixture Ride existing: digit penuh, suffix ter-mask.
    const { profile, vehicle } = await createDriverWithVehicle("Andi", "A 1234 ***");
    const order = await createOrder({
      passengerId: passenger.id,
      status: "DRIVER_ASSIGNED",
      driverProfileId: profile.id,
      vehicleId: vehicle.id
    });

    const response = await api(`/api/v1/rides/${order.publicReference}`, tokenFor(passenger));

    // Suffix `***` pada nilai tersimpan tidak dipulihkan, dan dua digit
    // terakhir tetap tertutup — lebih tertutup daripada nilai tersimpan.
    expect(response.body.data.vehicle.maskedPlate).toBe("A 12••");
    expect(response.raw).not.toContain("1234");
    expect(response.raw).not.toContain("***");
  });

  // =================================================================
  // 19 — konsistensi list vs detail
  // =================================================================

  it("19. list history dan detail memakai kontrak yang sama", async () => {
    const passenger = await createUser();
    const { profile, vehicle } = await createDriverWithVehicle();
    const assigned = await createOrder({
      passengerId: passenger.id,
      status: "COMPLETED",
      driverProfileId: profile.id,
      vehicleId: vehicle.id
    });
    const unassigned = await createOrder({
      passengerId: passenger.id,
      status: "NO_DRIVER"
    });

    const token = tokenFor(passenger);
    const list = await api("/api/v1/rides", token);
    const detail = await api(`/api/v1/rides/${assigned.publicReference}`, token);

    const items = list.body.data as Array<Record<string, any>>;
    const listAssigned = items.find((row) => row.reference === assigned.publicReference)!;
    const listUnassigned = items.find((row) => row.reference === unassigned.publicReference)!;
    expect(listAssigned).toBeDefined();
    expect(listUnassigned).toBeDefined();

    expect(listAssigned.driver).toEqual(detail.body.data.driver);
    expect(listAssigned.vehicle).toEqual(detail.body.data.vehicle);
    expect(listUnassigned.driver).toBeNull();
    expect(listUnassigned.vehicle).toBeNull();
  });

  it("model dan color hanya muncul bila benar-benar ada", async () => {
    const passenger = await createUser();
    const driverUser = await createUser("USER", "Cahya");
    const profile = await prisma.rideDriverProfile.create({
      data: { userId: driverUser.id, status: "ACTIVE", availability: "ONLINE" }
    });
    const vehicle = await prisma.rideVehicle.create({
      data: {
        driverProfileId: profile.id,
        type: "CAR",
        plateNumberHash: `hash-nomodel-${profile.id.slice(0, 8)}`,
        plateNumberMasked: "D 5678 QQ",
        verificationStatus: "VERIFIED",
        isActive: true
      }
    });
    const order = await createOrder({
      passengerId: passenger.id,
      status: "DRIVER_ARRIVED",
      driverProfileId: profile.id,
      vehicleId: vehicle.id
    });

    const response = await api(`/api/v1/rides/${order.publicReference}`, tokenFor(passenger));

    expect(response.body.data.vehicle).toEqual({
      serviceType: "CAR",
      maskedPlate: "D 56•• QQ"
    });
    expect(Object.keys(response.body.data.vehicle)).not.toContain("model");
    expect(Object.keys(response.body.data.vehicle)).not.toContain("color");
  });

  // =================================================================
  // 21 — isolasi finansial
  // =================================================================

  it("21. snapshot finansial dan Business Engine identik", async () => {
    const passenger = await createUser();
    const { profile, vehicle } = await createDriverWithVehicle();
    const order = await createOrder({
      passengerId: passenger.id,
      status: "COMPLETED",
      driverProfileId: profile.id,
      vehicleId: vehicle.id
    });

    const snapshot = async () => ({
      wallets: await prisma.wallet.count(),
      walletTransactions: await prisma.walletTransaction.count(),
      commissions: await prisma.commission.count(),
      withdrawals: await prisma.withdrawal.count(),
      invoices: await prisma.invoice.count(),
      membershipPayments: await prisma.membershipPayment.count(),
      membershipOrders: await prisma.membershipOrder.count(),
      userMemberships: await prisma.userMembership.count(),
      rewardTransactions: await prisma.rewardTransaction.count(),
      profitSharing: await prisma.profitSharingDistribution.count(),
      referrals: await prisma.referral.count(),
      founderGrants: await prisma.founderProgramGrant.count()
    });

    const before = await snapshot();
    const orderBefore = await prisma.rideOrder.findUniqueOrThrow({ where: { id: order.id } });

    await api(`/api/v1/rides/${order.publicReference}`, tokenFor(passenger));
    await api("/api/v1/rides", tokenFor(passenger));

    // Pembacaan tidak mengubah apa pun.
    expect(await snapshot()).toEqual(before);
    expect(await prisma.rideOrder.findUniqueOrThrow({ where: { id: order.id } })).toEqual(
      orderBefore
    );
  });
});
