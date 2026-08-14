import { Prisma, UserRole } from "@prisma/client";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
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

/**
 * Regression untuk pengetatan batas moderasi admin (review Stage 5.3).
 *
 * Setiap test di sini memetakan satu defect yang dikonfirmasi pada commit
 * 19da0f9 dan membuktikan perbaikannya.
 */

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

function resetRateLimits() {
  for (const key of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    rideWriteRateLimiter.resetKey(key);
    rideLocationRateLimiter.resetKey(key);
    adminRateLimiter.resetKey(key);
    apiRateLimiter.resetKey(key);
  }
}

describe.skipIf(!runIntegration)("Stage 5.3 review — pengetatan moderasi admin", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET ?? "ride-admin-hardening-access-secret-00000";
    process.env.JWT_REFRESH_SECRET =
      process.env.JWT_REFRESH_SECRET ?? "ride-admin-hardening-refresh-secret-0000";

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
    await cleanTables();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!appServer) return resolve();
      appServer.close((e) => (e ? reject(e) : resolve()));
    });
  });

  // --- D1: lookup driver/vehicle tidak boleh bergantung pada limit daftar ---

  it("D1 detail driver tetap ditemukan meski di luar jendela limit daftar", async () => {
    const admin = await createUser("ADMIN");
    // Driver target dibuat PALING AWAL agar berada di luar 50 teratas
    // (daftar admin diurutkan createdAt desc dengan limit default 50).
    const target = await createDriver("MOTORCYCLE");
    // Buat 60 driver lain sesudahnya (createdAt lebih baru).
    for (let i = 0; i < 60; i += 1) {
      await createDriver("MOTORCYCLE");
    }

    const res = await api(`/api/v1/admin/rides/drivers/${target.profile.id}`, {
      token: tokenFor(admin),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { profileId: string } };
    expect(body.data.profileId).toBe(target.profile.id);
  });

  it("D1 detail kendaraan tetap ditemukan meski di luar jendela limit daftar", async () => {
    const admin = await createUser("ADMIN");
    const target = await createDriver("CAR");
    const vehicle = await prisma.rideVehicle.findFirstOrThrow({
      where: { driverProfileId: target.profile.id },
    });
    for (let i = 0; i < 60; i += 1) {
      await createDriver("MOTORCYCLE");
    }

    const res = await api(`/api/v1/admin/rides/vehicles/${vehicle.id}`, {
      token: tokenFor(admin),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(vehicle.id);
  });

  // --- A: urutan route — setiap endpoint harus sampai ke handler yang benar --

  it("A route statis /drivers tidak tertutup oleh /:reference", async () => {
    const admin = await createUser("ADMIN");
    await createDriver("MOTORCYCLE");

    const res = await api("/api/v1/admin/rides/drivers", { token: tokenFor(admin) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ profileId: string }> };
    // Handler daftar driver, bukan handler detail ride.
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0]).toHaveProperty("profileId");
  });

  it("A seluruh endpoint admin sampai ke handler yang dimaksud", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriver("MOTORCYCLE");
    const vehicle = await prisma.rideVehicle.findFirstOrThrow({
      where: { driverProfileId: driver.profile.id },
    });
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);
    const created = await createOrder(passenger, quote.quoteId);
    const reference = ((await created.json()) as { data: { reference: string } }).data
      .reference;

    // GET daftar ride -> array
    const list = await api("/api/v1/admin/rides", { token: tokenFor(admin) });
    expect(list.status).toBe(200);
    expect(
      Array.isArray(((await list.json()) as { data: unknown[] }).data),
    ).toBe(true);

    // GET detail ride -> objek dengan reference + events
    const detail = await api(`/api/v1/admin/rides/${reference}`, {
      token: tokenFor(admin),
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      data: { reference: string; events: unknown[] };
    };
    expect(detailBody.data.reference).toBe(reference);
    expect(Array.isArray(detailBody.data.events)).toBe(true);

    // GET detail driver -> objek driver (bukan ride)
    const driverDetail = await api(
      `/api/v1/admin/rides/drivers/${driver.profile.id}`,
      { token: tokenFor(admin) },
    );
    expect(driverDetail.status).toBe(200);
    expect(
      ((await driverDetail.json()) as { data: { profileId: string } }).data.profileId,
    ).toBe(driver.profile.id);

    // GET detail vehicle -> objek kendaraan
    const vehicleDetail = await api(`/api/v1/admin/rides/vehicles/${vehicle.id}`, {
      token: tokenFor(admin),
    });
    expect(vehicleDetail.status).toBe(200);
    expect(
      ((await vehicleDetail.json()) as { data: { id: string } }).data.id,
    ).toBe(vehicle.id);

    // PATCH driver status -> handler driver (bukan koreksi ride)
    const driverPatch = await api(
      `/api/v1/admin/rides/drivers/${driver.profile.id}/status`,
      {
        method: "PATCH",
        token: tokenFor(admin),
        body: { status: "SUSPENDED", reason: "uji routing" },
      },
    );
    expect(driverPatch.status).toBe(200);
    expect(
      ((await driverPatch.json()) as { data: { status: string } }).data.status,
    ).toBe("SUSPENDED");

    // PATCH vehicle verification -> handler kendaraan
    const vehiclePatch = await api(
      `/api/v1/admin/rides/vehicles/${vehicle.id}/verification`,
      {
        method: "PATCH",
        token: tokenFor(admin),
        body: { verificationStatus: "REJECTED", reason: "uji routing" },
      },
    );
    expect(vehiclePatch.status).toBe(200);
    expect(
      ((await vehiclePatch.json()) as { data: { verificationStatus: string } }).data
        .verificationStatus,
    ).toBe("REJECTED");

    // PATCH koreksi status ride -> handler ride
    const ridePatch = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "NO_DRIVER", reason: "uji routing" },
    });
    expect(ridePatch.status).toBe(200);
    expect(
      ((await ridePatch.json()) as { data: { status: string } }).data.status,
    ).toBe("NO_DRIVER");
  });

  it("A referensi ride malformed ditolak validator, tidak jatuh ke handler lain", async () => {
    const admin = await createUser("ADMIN");
    for (const bad of ["bukan-referensi", "RID-lowercase", "RID-SHORT"]) {
      const res = await api(`/api/v1/admin/rides/${bad}`, { token: tokenFor(admin) });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const text = await res.text();
      expect(text.toLowerCase()).not.toContain("prisma");
      expect(text.toLowerCase()).not.toContain("at rideservice");
    }
  });

  it("A UUID malformed pada driver/vehicle ditolak dengan aman", async () => {
    const admin = await createUser("ADMIN");
    const badDriver = await api("/api/v1/admin/rides/drivers/bukan-uuid", {
      token: tokenFor(admin),
    });
    const badVehicle = await api("/api/v1/admin/rides/vehicles/bukan-uuid", {
      token: tokenFor(admin),
    });
    for (const res of [badDriver, badVehicle]) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect((await res.text()).toLowerCase()).not.toContain("prisma");
    }
  });

  it("A reason terlalu panjang ditolak dan tidak mengubah state", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriver("MOTORCYCLE");

    const res = await api(`/api/v1/admin/rides/drivers/${driver.profile.id}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "SUSPENDED", reason: "x".repeat(500) },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const profile = await prisma.rideDriverProfile.findUniqueOrThrow({
      where: { id: driver.profile.id },
    });
    expect(profile.status).toBe("ACTIVE");
    expect(await prisma.auditLog.count()).toBe(0);
  });

  // --- D2: audit moderasi wajib ada meski driver belum punya ride ----------

  it("D2 suspend driver tanpa riwayat ride tetap tercatat di AuditLog", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriver("MOTORCYCLE");

    const res = await api(`/api/v1/admin/rides/drivers/${driver.profile.id}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "SUSPENDED", reason: "dokumen tidak valid" },
    });
    expect(res.status).toBe(200);

    const logs = await prisma.auditLog.findMany({
      where: { entityType: "RIDE_DRIVER_PROFILE", entityId: driver.profile.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorId).toBe(admin.id);
    expect(logs[0]!.action).toBe("RIDE_DRIVER_STATUS_CHANGED");
    const meta = logs[0]!.metadata as Record<string, unknown>;
    expect(meta.previousStatus).toBe("ACTIVE");
    expect(meta.newStatus).toBe("SUSPENDED");
    expect(meta.reason).toBe("dokumen tidak valid");
  });

  it("D2 moderasi berulang tercatat setiap kali (tanpa tertelan eventKey)", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriver("MOTORCYCLE");

    for (const status of ["SUSPENDED", "ACTIVE", "SUSPENDED"]) {
      const res = await api(`/api/v1/admin/rides/drivers/${driver.profile.id}/status`, {
        method: "PATCH",
        token: tokenFor(admin),
        body: { status, reason: `siklus ${status}` },
      });
      expect(res.status).toBe(200);
    }

    const logs = await prisma.auditLog.findMany({
      where: { entityType: "RIDE_DRIVER_PROFILE", entityId: driver.profile.id },
      orderBy: { createdAt: "asc" },
    });
    // Tiga perubahan status berbeda -> tiga catatan audit.
    expect(logs).toHaveLength(3);
  });

  it("D2 moderasi kendaraan tercatat di AuditLog", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriver("MOTORCYCLE");
    const vehicle = await prisma.rideVehicle.findFirstOrThrow({
      where: { driverProfileId: driver.profile.id },
    });

    const res = await api(`/api/v1/admin/rides/vehicles/${vehicle.id}/verification`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { verificationStatus: "REJECTED", isActive: false, reason: "plat tidak cocok" },
    });
    expect(res.status).toBe(200);

    const logs = await prisma.auditLog.findMany({
      where: { entityType: "RIDE_VEHICLE", entityId: vehicle.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe("RIDE_VEHICLE_VERIFICATION_CHANGED");
  });

  // --- D3: moderasi konkuren harus punya satu pemenang --------------------

  it("D3 moderasi identik konkuren hanya menghasilkan satu perubahan dan satu audit", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriver("MOTORCYCLE");

    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        api(`/api/v1/admin/rides/drivers/${driver.profile.id}/status`, {
          method: "PATCH",
          token: tokenFor(admin),
          body: { status: "SUSPENDED", reason: `aksi konkuren ${i}` },
        }),
      ),
    );

    // Setiap permintaan berakhir sukses (idempoten) atau konflik yang jelas —
    // tidak ada 5xx dan tidak ada perubahan ganda yang diam-diam berhasil.
    for (const res of results) {
      expect([200, 409]).toContain(res.status);
    }
    expect(results.some((r) => r.status === 200)).toBe(true);

    // Invariant utama: satu perubahan status = tepat satu catatan audit.
    const logs = await prisma.auditLog.findMany({
      where: { entityType: "RIDE_DRIVER_PROFILE", entityId: driver.profile.id },
    });
    expect(logs).toHaveLength(1);

    const profile = await prisma.rideDriverProfile.findUniqueOrThrow({
      where: { id: driver.profile.id },
    });
    expect(profile.status).toBe("SUSPENDED");
  });

  it("D3 transisi yang menjadi tidak sah setelah kalah balapan ditolak", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriver("MOTORCYCLE");

    // REJECTED bersifat terminal: setelah diterapkan, permintaan SUSPENDED
    // pada state yang sama harus ditolak, bukan menimpa.
    const rejected = await api(
      `/api/v1/admin/rides/drivers/${driver.profile.id}/status`,
      {
        method: "PATCH",
        token: tokenFor(admin),
        body: { status: "REJECTED", reason: "ditolak permanen" },
      },
    );
    expect(rejected.status).toBe(200);

    const late = await api(`/api/v1/admin/rides/drivers/${driver.profile.id}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "SUSPENDED", reason: "aksi terlambat" },
    });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { code?: string }).code).toBe(
      "RIDE_DRIVER_STATUS_TRANSITION_INVALID",
    );

    const logs = await prisma.auditLog.findMany({
      where: { entityType: "RIDE_DRIVER_PROFILE", entityId: driver.profile.id },
    });
    // Aksi yang ditolak tidak boleh menulis audit.
    expect(logs).toHaveLength(1);
  });

  // --- D4: koreksi status admin harus valid secara semantik ---------------

  it("D4 admin tidak dapat menetapkan NO_DRIVER pada ride yang sudah punya driver", async () => {
    const { reference } = await inTripRide();
    const admin = await createUser("ADMIN");

    const res = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "NO_DRIVER", reason: "koreksi manual" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe(
      "RIDE_ADMIN_CORRECTION_NOT_APPLICABLE",
    );

    const order = await prisma.rideOrder.findFirstOrThrow();
    expect(order.status).toBe("IN_TRIP");
  });

  it("D4 admin tidak dapat menetapkan EXPIRED pada ride yang sedang berjalan", async () => {
    const { reference } = await inTripRide();
    const admin = await createUser("ADMIN");

    const res = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "EXPIRED", reason: "koreksi manual" },
    });
    expect(res.status).toBe(409);
    const order = await prisma.rideOrder.findFirstOrThrow();
    expect(order.status).toBe("IN_TRIP");
  });

  it("D4 CANCELLED_BY_SYSTEM tetap diizinkan pada ride berjalan", async () => {
    const { reference } = await inTripRide();
    const admin = await createUser("ADMIN");

    const res = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "CANCELLED_BY_SYSTEM", reason: "insiden keselamatan" },
    });
    expect(res.status).toBe(200);
    const order = await prisma.rideOrder.findFirstOrThrow();
    expect(order.status).toBe("CANCELLED_BY_SYSTEM");
    expect(order.cancelledByRole).toBe("ADMIN");
  });

  it("D4 NO_DRIVER tetap diizinkan saat masih mencari driver", async () => {
    const admin = await createUser("ADMIN");
    const passenger = await createUser("USER");
    const quote = await createQuote(passenger);
    const created = await createOrder(passenger, quote.quoteId);
    const reference = ((await created.json()) as { data: { reference: string } }).data
      .reference;

    const res = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "NO_DRIVER", reason: "tidak ada driver tersedia" },
    });
    expect(res.status).toBe(200);
  });

  // --- D5: PAYMENT_FAILED tidak boleh lewat endpoint status ride ----------

  it("D5 admin tidak dapat menetapkan PAYMENT_FAILED melalui koreksi status ride", async () => {
    const { reference } = await inTripRide();
    const admin = await createUser("ADMIN");

    const res = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "PAYMENT_FAILED", reason: "koreksi manual" },
    });
    // Ditolak validator (di luar allowlist) — domain pembayaran terpisah.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    const order = await prisma.rideOrder.findFirstOrThrow();
    expect(order.status).toBe("IN_TRIP");
    expect(order.paymentState).toBe("CASH_EXPECTED");
  });

  // --- D6: moderasi tidak boleh membuat ride yatim ------------------------

  it("D6 driver dengan ride aktif tidak dapat langsung disuspend", async () => {
    const { driver } = await inTripRide();
    const admin = await createUser("ADMIN");

    const res = await api(`/api/v1/admin/rides/drivers/${driver.profile.id}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "SUSPENDED", reason: "investigasi" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe(
      "RIDE_DRIVER_HAS_ACTIVE_RIDE",
    );

    const profile = await prisma.rideDriverProfile.findUniqueOrThrow({
      where: { id: driver.profile.id },
    });
    expect(profile.status).toBe("ACTIVE");
  });

  it("D6 kendaraan yang dipakai ride aktif tidak dapat langsung dinonaktifkan", async () => {
    const { driver } = await inTripRide();
    const admin = await createUser("ADMIN");
    const vehicle = await prisma.rideVehicle.findFirstOrThrow({
      where: { driverProfileId: driver.profile.id },
    });

    const res = await api(`/api/v1/admin/rides/vehicles/${vehicle.id}/verification`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { verificationStatus: "REJECTED", isActive: false, reason: "investigasi" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe(
      "RIDE_VEHICLE_HAS_ACTIVE_RIDE",
    );

    const after = await prisma.rideVehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(after.verificationStatus).toBe("VERIFIED");
    expect(after.isActive).toBe(true);
  });

  it("D6 setelah ride selesai, driver dapat disuspend", async () => {
    const { driver, reference } = await inTripRide();
    const admin = await createUser("ADMIN");
    await api(`/api/v1/driver/rides/${reference}/complete`, {
      method: "POST",
      token: tokenFor(driver.user),
    });

    const res = await api(`/api/v1/admin/rides/drivers/${driver.profile.id}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "SUSPENDED", reason: "investigasi lanjutan" },
    });
    expect(res.status).toBe(200);
  });

  // --- D7: audit tidak boleh memuat koordinat presisi --------------------

  it("D7 AuditLog moderasi tidak memuat koordinat maupun PII mentah", async () => {
    const admin = await createUser("ADMIN");
    const driver = await createDriver("MOTORCYCLE");
    await api(`/api/v1/admin/rides/drivers/${driver.profile.id}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "SUSPENDED", reason: "pemeriksaan" },
    });

    const logs = await prisma.auditLog.findMany();
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("106.1");
    expect(serialized).not.toContain("-6.12");
    expect(serialized).not.toContain(driver.user.phone);
    expect(serialized.toLowerCase()).not.toContain("plateNumberHash".toLowerCase());
  });

  // --- D8: isolasi finansial tetap terjaga --------------------------------

  it("D8 seluruh moderasi admin tidak menyentuh domain finansial", async () => {
    const before = await financialSnapshot();
    const { reference, driver } = await inTripRide();
    const admin = await createUser("ADMIN");

    await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "CANCELLED_BY_SYSTEM", reason: "insiden" },
    });
    await api(`/api/v1/admin/rides/drivers/${driver.profile.id}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "SUSPENDED", reason: "investigasi" },
    });

    const after = await financialSnapshot();
    expect(after).toEqual(before);
  });

  // --- D9: bukti isolasi finansial dengan data existing NON-ZERO ----------

  it("D9 data finansial existing tetap identik nilai demi nilai setelah seluruh moderasi", async () => {
    // Seed data finansial nyata (bukan baseline nol) agar terbukti bahwa
    // moderasi tidak hanya "tidak menambah baris", tetapi juga TIDAK MENGUBAH
    // nilai baris yang sudah ada.
    const seeded = await seedExistingFinancialData();
    const before = await detailedFinancialSnapshot();

    // Pastikan baseline benar-benar tidak nol.
    expect(before.counts.wallets).toBeGreaterThan(0);
    expect(before.counts.walletTransactions).toBeGreaterThan(0);
    expect(before.counts.commissions).toBeGreaterThan(0);
    expect(before.counts.rewards).toBeGreaterThan(0);
    expect(before.counts.profitSharingDistributions).toBeGreaterThan(0);
    expect(before.counts.invoices).toBeGreaterThan(0);
    expect(before.counts.membershipPayments).toBeGreaterThan(0);
    expect(before.sums.walletBalance).not.toBe("0.00");

    // Jalankan KETIGA jenis moderasi: koreksi ride, moderasi driver, moderasi kendaraan.
    const { reference, driver } = await inTripRide();
    const admin = await createUser("ADMIN");
    const vehicle = await prisma.rideVehicle.findFirstOrThrow({
      where: { driverProfileId: driver.profile.id },
    });

    const correction = await api(`/api/v1/admin/rides/${reference}/status`, {
      method: "PATCH",
      token: tokenFor(admin),
      body: { status: "CANCELLED_BY_SYSTEM", reason: "insiden keselamatan" },
    });
    expect(correction.status).toBe(200);

    const driverMod = await api(
      `/api/v1/admin/rides/drivers/${driver.profile.id}/status`,
      {
        method: "PATCH",
        token: tokenFor(admin),
        body: { status: "SUSPENDED", reason: "investigasi lanjutan" },
      },
    );
    expect(driverMod.status).toBe(200);

    const vehicleMod = await api(
      `/api/v1/admin/rides/vehicles/${vehicle.id}/verification`,
      {
        method: "PATCH",
        token: tokenFor(admin),
        body: { verificationStatus: "REJECTED", isActive: false, reason: "audit unit" },
      },
    );
    expect(vehicleMod.status).toBe(200);

    // Bukti utama: seluruh snapshot terperinci identik.
    const after = await detailedFinancialSnapshot();
    expect(after).toEqual(before);

    // Bukti tambahan: nilai baris spesifik yang di-seed tidak berubah.
    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: seeded.userId },
    });
    expect(wallet.balance.toFixed(2)).toBe(seeded.walletBalance);
    expect(wallet.cashBalance.toFixed(2)).toBe(seeded.walletCashBalance);
    expect(wallet.ppobBalance.toFixed(2)).toBe(seeded.walletPpobBalance);

    const commission = await prisma.commission.findUniqueOrThrow({
      where: { id: seeded.commissionId },
    });
    expect(commission.amount.toFixed(2)).toBe(seeded.commissionAmount);
    expect(commission.status).toBe(seeded.commissionStatus);

    const reward = await prisma.rewardTransaction.findUniqueOrThrow({
      where: { id: seeded.rewardId },
    });
    expect(reward.amount.toFixed(2)).toBe(seeded.rewardAmount);
    expect(reward.status).toBe(seeded.rewardStatus);

    const distribution = await prisma.profitSharingDistribution.findUniqueOrThrow({
      where: { id: seeded.distributionId },
    });
    expect(distribution.amount.toFixed(2)).toBe(seeded.distributionAmount);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: seeded.invoiceId },
    });
    expect(invoice.amount.toFixed(2)).toBe(seeded.invoiceAmount);
    expect(invoice.status).toBe(seeded.invoiceStatus);

    const membershipPayment = await prisma.membershipPayment.findUniqueOrThrow({
      where: { id: seeded.membershipPaymentId },
    });
    expect(membershipPayment.amount.toFixed(2)).toBe(seeded.membershipPaymentAmount);

    const walletTx = await prisma.walletTransaction.findUniqueOrThrow({
      where: { id: seeded.walletTransactionId },
    });
    expect(walletTx.amount.toFixed(2)).toBe(seeded.walletTransactionAmount);
    expect(walletTx.type).toBe(seeded.walletTransactionType);
  });

  // --- D10: cleanup harus aman pada database yang dipakai ulang -------------

  it("D10 cleanTables idempoten meski ada baris RESTRICT (referral/withdrawal)", async () => {
    // Seed tepat baris yang FK-nya RESTRICT ke users. Sebelum perbaikan,
    // user.deleteMany() gagal dengan SQLSTATE 23001 pada
    // referrals_sponsor_id_fkey sehingga beforeEach melempar dan seluruh test
    // di file ini gagal serentak pada database yang dipakai ulang.
    const sponsor = await createUser("USER");
    const invitee = await createUser("USER");
    await prisma.referral.create({
      data: { sponsorId: sponsor.id, userId: invitee.id }
    });
    await prisma.referralLevel.create({
      data: { ancestorId: sponsor.id, descendantId: invitee.id, level: 1 }
    });
    const wallet = await prisma.wallet.create({
      data: { userId: sponsor.id, balance: new Prisma.Decimal("50000.00"), currency: "IDR" }
    });
    await prisma.withdrawal.create({
      data: {
        userId: sponsor.id,
        walletId: wallet.id,
        amount: new Prisma.Decimal("25000.00"),
        status: "PENDING",
        bankAccount: { bank: "UJI", masked: "****1234" }
      }
    });

    // Baseline non-nol: blocker benar-benar ada.
    expect(await prisma.referral.count()).toBeGreaterThan(0);
    expect(await prisma.withdrawal.count()).toBeGreaterThan(0);
    expect(await prisma.user.count()).toBeGreaterThan(0);

    // Panggilan pertama harus berhasil (bukan 23001).
    await expect(cleanTables()).resolves.toBeUndefined();
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.referral.count()).toBe(0);
    expect(await prisma.referralLevel.count()).toBe(0);
    expect(await prisma.withdrawal.count()).toBe(0);

    // Idempoten: pemanggilan berulang pada database yang sama tetap aman.
    await expect(cleanTables()).resolves.toBeUndefined();
    await expect(cleanTables()).resolves.toBeUndefined();
    expect(await prisma.user.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Membersihkan tabel agar file ini dapat dijalankan berulang pada database
 * test yang SAMA (reusable disposable DB), bukan hanya pada database baru.
 *
 * Urutan mengikuti arah foreign key: child dihapus sebelum parent. Yang
 * menentukan urutan adalah FK dengan delete_rule RESTRICT, karena hanya itu
 * yang memblokir DELETE (CASCADE/SET NULL tidak memblokir):
 *   - referrals.sponsor_id    -> users        RESTRICT
 *   - commissions.beneficiary_id -> users     RESTRICT
 *   - withdrawals.user_id     -> users        RESTRICT
 *   - ride_orders.quote_id    -> ride_quotes  RESTRICT
 * (reviews.reviewer_id dan rides.customer_id juga RESTRICT ke users, tetapi
 * tabel reviews/rides legacy tidak pernah diisi oleh test mana pun, sehingga
 * tidak dihapus di sini agar cleanup tetap minimal.)
 *
 * Tidak menonaktifkan FK constraint dan tidak memakai TRUNCATE ... CASCADE.
 */
async function cleanTables() {
  await prisma.auditLog.deleteMany();
  await prisma.profitSharingDistribution.deleteMany();
  await prisma.profitSharingPeriod.deleteMany();
  await prisma.commission.deleteMany();
  await prisma.rewardTransaction.deleteMany();
  await prisma.membershipPayment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.membershipOrder.deleteMany();
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
  // Blocker RESTRICT ke users: harus dihapus sebelum user.deleteMany().
  // Tanpa ini, database yang dipakai ulang (mis. suite dijalankan dua kali
  // tanpa recreate) menghasilkan SQLSTATE 23001 pada beforeEach sehingga
  // SELURUH test di file ini gagal serentak.
  await prisma.withdrawal.deleteMany();
  await prisma.referralLevel.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.user.deleteMany();
}

async function api(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
) {
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
      fullName: `Admin Test ${sequence}`,
      phone: `+6287${String(sequence).padStart(9, "0")}`,
      referralCode: `ADM${String(sequence).padStart(7, "0")}`,
      role,
    },
  });
}

async function createDriver(vehicleType: "MOTORCYCLE" | "CAR") {
  const user = await createUser("DRIVER");
  const profile = await prisma.rideDriverProfile.create({
    data: { userId: user.id, status: "ACTIVE", availability: "OFFLINE" },
  });
  const plate = `PLT-${profile.id.slice(0, 8)}`;
  await prisma.rideVehicle.create({
    data: {
      driverProfileId: profile.id,
      type: vehicleType,
      plateNumberHash: createHash("sha256").update(plate).digest("hex"),
      plateNumberMasked: "B 9876 ***",
      verificationStatus: "VERIFIED",
      isActive: true,
    },
  });
  return { user, profile };
}

async function createQuote(user: { id: string; role: UserRole }) {
  const res = await api("/api/v1/rides/quotes", {
    method: "POST",
    token: tokenFor(user),
    body: { serviceType: "MOTORCYCLE", pickup: PICKUP, dropoff: DROPOFF },
  });
  return ((await res.json()) as { data: { quoteId: string } }).data;
}

async function createOrder(user: { id: string; role: UserRole }, quoteId: string) {
  return api("/api/v1/rides", {
    method: "POST",
    token: tokenFor(user),
    body: { quoteId, paymentMethod: "CASH" },
  });
}

/** Membangun ride sampai status IN_TRIP dengan driver yang ditugaskan. */
async function inTripRide() {
  const passenger = await createUser("USER");
  const driver = await createDriver("MOTORCYCLE");
  await api("/api/v1/driver/availability", {
    method: "POST",
    token: tokenFor(driver.user),
    body: { availability: "ONLINE" },
  });
  const quote = await createQuote(passenger);
  const created = await createOrder(passenger, quote.quoteId);
  const reference = ((await created.json()) as { data: { reference: string } }).data
    .reference;
  await api(`/api/v1/driver/rides/${reference}/accept`, {
    method: "POST",
    token: tokenFor(driver.user),
  });
  for (const step of ["pickup", "arrived", "start"]) {
    const res = await api(`/api/v1/driver/rides/${reference}/${step}`, {
      method: "POST",
      token: tokenFor(driver.user),
    });
    expect(res.status).toBe(200);
  }
  return { passenger, driver, reference };
}

/**
 * Seed data finansial existing yang NON-ZERO: wallet bersaldo, wallet
 * transaction, commission, reward, profit-sharing distribution, serta
 * invoice + membership payment. Dipakai untuk membuktikan moderasi ride tidak
 * mengubah nilai yang sudah ada (bukan hanya tidak menambah baris).
 */
async function seedExistingFinancialData() {
  const owner = await createUser("USER");
  const basic = await ensureBasicMembership();

  const wallet = await prisma.wallet.create({
    data: {
      userId: owner.id,
      balance: new Prisma.Decimal("125000.00"),
      cashBalance: new Prisma.Decimal("75000.00"),
      ppobBalance: new Prisma.Decimal("50000.00"),
      currency: "IDR",
    },
  });

  const walletTx = await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "SPONSOR_BONUS",
      amount: new Prisma.Decimal("40000.00"),
      referenceType: "SEED_EXISTING",
      referenceId: "seed-existing-1",
    },
  });

  const commission = await prisma.commission.create({
    data: {
      beneficiaryId: owner.id,
      sourceUserId: owner.id,
      type: "SPONSOR_BONUS",
      status: "POSTED",
      level: 1,
      amount: new Prisma.Decimal("40000.00"),
      triggerType: "SEED_EXISTING",
      triggerId: "seed-existing-commission",
    },
  });

  const reward = await prisma.rewardTransaction.create({
    data: {
      userId: owner.id,
      threshold: 10,
      directSilverCount: 10,
      amount: new Prisma.Decimal("500000.00"),
      status: "PENDING",
      referenceType: "REWARD_MILESTONE",
      referenceId: "seed-existing-reward",
    },
  });

  const period = await prisma.profitSharingPeriod.create({
    data: {
      periodMonth: 6,
      periodYear: 2026,
      netProfitAmount: new Prisma.Decimal("10000000.00"),
      totalPoolAmount: new Prisma.Decimal("6000000.00"),
      status: "DISTRIBUTED",
    },
  });
  const distribution = await prisma.profitSharingDistribution.create({
    data: {
      periodId: period.id,
      userId: owner.id,
      amount: new Prisma.Decimal("1800000.00"),
      status: "POSTED",
    },
  });

  const order = await prisma.membershipOrder.create({
    data: {
      userId: owner.id,
      membershipId: basic.id,
      status: "PAID",
      totalAmount: new Prisma.Decimal("500000.00"),
      packageSnapshot: { tier: "SILVER", price: "500000.00" },
    },
  });
  const invoice = await prisma.invoice.create({
    data: {
      orderId: order.id,
      userId: owner.id,
      number: `INV-SEED-${Date.now()}`,
      status: "PAID",
      amount: new Prisma.Decimal("500000.00"),
      dueAt: new Date(Date.now() + 86_400_000),
    },
  });
  const membershipPayment = await prisma.membershipPayment.create({
    data: {
      orderId: order.id,
      invoiceId: invoice.id,
      userId: owner.id,
      amount: new Prisma.Decimal("500000.00"),
      status: "PAID",
      method: "SEED_EXISTING",
    },
  });

  return {
    userId: owner.id,
    walletBalance: wallet.balance.toFixed(2),
    walletCashBalance: wallet.cashBalance.toFixed(2),
    walletPpobBalance: wallet.ppobBalance.toFixed(2),
    walletTransactionId: walletTx.id,
    walletTransactionAmount: walletTx.amount.toFixed(2),
    walletTransactionType: walletTx.type,
    commissionId: commission.id,
    commissionAmount: commission.amount.toFixed(2),
    commissionStatus: commission.status,
    rewardId: reward.id,
    rewardAmount: reward.amount.toFixed(2),
    rewardStatus: reward.status,
    distributionId: distribution.id,
    distributionAmount: distribution.amount.toFixed(2),
    invoiceId: invoice.id,
    invoiceAmount: invoice.amount.toFixed(2),
    invoiceStatus: invoice.status,
    membershipPaymentId: membershipPayment.id,
    membershipPaymentAmount: membershipPayment.amount.toFixed(2),
  };
}

async function ensureBasicMembership() {
  return prisma.membership.upsert({
    where: { tier: "BASIC" },
    update: { name: "Basic", price: new Prisma.Decimal("0.00"), isActive: true },
    create: {
      tier: "BASIC",
      name: "Basic",
      price: new Prisma.Decimal("0.00"),
      directBonus: new Prisma.Decimal("0.00"),
      activeLevels: 1,
      ppobBalance: new Prisma.Decimal("0.00"),
      isActive: true,
    },
  });
}

/** Snapshot lengkap: jumlah baris, agregat nilai, dan sidik jari per baris. */
async function detailedFinancialSnapshot() {
  const [
    wallets,
    walletTransactions,
    commissions,
    rewards,
    profitSharingDistributions,
    profitSharingPeriods,
    invoices,
    membershipPayments,
    membershipOrders,
    payments,
    userMemberships,
    referrals,
  ] = await Promise.all([
    prisma.wallet.count(),
    prisma.walletTransaction.count(),
    prisma.commission.count(),
    prisma.rewardTransaction.count(),
    prisma.profitSharingDistribution.count(),
    prisma.profitSharingPeriod.count(),
    prisma.invoice.count(),
    prisma.membershipPayment.count(),
    prisma.membershipOrder.count(),
    prisma.payment.count(),
    prisma.userMembership.count(),
    prisma.referral.count(),
  ]);

  const walletAgg = await prisma.wallet.aggregate({
    _sum: { balance: true, cashBalance: true, ppobBalance: true },
  });
  const txAgg = await prisma.walletTransaction.aggregate({ _sum: { amount: true } });
  const commissionAgg = await prisma.commission.aggregate({ _sum: { amount: true } });
  const rewardAgg = await prisma.rewardTransaction.aggregate({ _sum: { amount: true } });
  const distAgg = await prisma.profitSharingDistribution.aggregate({ _sum: { amount: true } });
  const invoiceAgg = await prisma.invoice.aggregate({ _sum: { amount: true } });
  const mpAgg = await prisma.membershipPayment.aggregate({ _sum: { amount: true } });

  const dec = (v: Prisma.Decimal | null) => new Prisma.Decimal(v ?? 0).toFixed(2);

  // Sidik jari per baris agar mutasi nilai (bukan hanya jumlah baris) terdeteksi.
  const walletRows = (
    await prisma.wallet.findMany({ orderBy: { id: "asc" } })
  ).map((w) => `${w.id}:${w.balance.toFixed(2)}:${w.cashBalance.toFixed(2)}:${w.ppobBalance.toFixed(2)}`);
  const txRows = (
    await prisma.walletTransaction.findMany({ orderBy: { id: "asc" } })
  ).map((t) => `${t.id}:${t.type}:${t.amount.toFixed(2)}`);
  const commissionRows = (
    await prisma.commission.findMany({ orderBy: { id: "asc" } })
  ).map((c) => `${c.id}:${c.type}:${c.status}:${c.amount.toFixed(2)}`);
  const rewardRows = (
    await prisma.rewardTransaction.findMany({ orderBy: { id: "asc" } })
  ).map((r) => `${r.id}:${r.status}:${r.amount.toFixed(2)}`);
  const distRows = (
    await prisma.profitSharingDistribution.findMany({ orderBy: { id: "asc" } })
  ).map((d) => `${d.id}:${d.status}:${d.amount.toFixed(2)}`);
  const invoiceRows = (
    await prisma.invoice.findMany({ orderBy: { id: "asc" } })
  ).map((i) => `${i.id}:${i.status}:${i.amount.toFixed(2)}`);
  const mpRows = (
    await prisma.membershipPayment.findMany({ orderBy: { id: "asc" } })
  ).map((m) => `${m.id}:${m.status}:${m.amount.toFixed(2)}`);

  return {
    counts: {
      wallets,
      walletTransactions,
      commissions,
      rewards,
      profitSharingDistributions,
      profitSharingPeriods,
      invoices,
      membershipPayments,
      membershipOrders,
      payments,
      userMemberships,
      referrals,
    },
    sums: {
      walletBalance: dec(walletAgg._sum.balance),
      walletCashBalance: dec(walletAgg._sum.cashBalance),
      walletPpobBalance: dec(walletAgg._sum.ppobBalance),
      walletTransactionAmount: dec(txAgg._sum.amount),
      commissionAmount: dec(commissionAgg._sum.amount),
      rewardAmount: dec(rewardAgg._sum.amount),
      distributionAmount: dec(distAgg._sum.amount),
      invoiceAmount: dec(invoiceAgg._sum.amount),
      membershipPaymentAmount: dec(mpAgg._sum.amount),
    },
    rows: {
      walletRows,
      txRows,
      commissionRows,
      rewardRows,
      distRows,
      invoiceRows,
      mpRows,
    },
  };
}

async function financialSnapshot() {
  const [wallets, walletTx, commissions, rewards, profitSharing, invoices, payments] =
    await Promise.all([
      prisma.wallet.count(),
      prisma.walletTransaction.count(),
      prisma.commission.count(),
      prisma.rewardTransaction.count(),
      prisma.profitSharingDistribution.count(),
      prisma.invoice.count(),
      prisma.payment.count(),
    ]);
  return { wallets, walletTx, commissions, rewards, profitSharing, invoices, payments };
}

function tokenFor(user: { id: string; role: UserRole }) {
  return signAccessToken({
    sub: user.id,
    role: user.role,
    sessionId: `session-${user.id}`,
  });
}
