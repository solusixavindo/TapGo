import { Prisma, RideOrderStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration, seedMemberships, testDatabaseUrl, cleanDatabase } from "../helpers/referralWalletHarness.js";
import type { PushNotifier } from "../../src/modules/notifications/application/rideNotifications.js";
import type { PushMessage } from "../../src/modules/notifications/infrastructure/FcmClient.js";

/**
 * Stage D2: tawaran berbasis jarak dan batas waktu pencarian.
 * Titik driver P = (-6.2000, 106.8166). 1 derajat lintang ~ 111,19 km.
 */
const P = { lat: -6.2, lng: 106.8166 };
const north = (km: number) => ({ lat: P.lat + km / 111.19, lng: P.lng });

class RecordingPush implements PushNotifier {
  enabled = true;
  sent: Array<{ userId: string; message: PushMessage }> = [];
  async notifyUser(userId: string, message: PushMessage) {
    this.sent.push({ userId, message });
  }
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 40));

let RideServiceClass: typeof import("../../src/modules/rides/application/RideService.js").RideService;
let expireStaleRideSearches: typeof import("../../src/modules/rides/application/rideSearchExpiry.js").expireStaleRideSearches;
let backendEnv: typeof import("../../src/config/env.js").env;
let sequence = 0;

function service(push?: PushNotifier) {
  return new RideServiceClass(prisma as never, {} as never, {} as never, undefined, push);
}

describe.skipIf(!runIntegration)("Komisi pesanan tunai dari saldo driver (D4)", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl?.toLowerCase().includes("test")) {
      throw new Error("TAPGO_TEST_DATABASE_URL must point to a dedicated test database.");
    }
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "offers-proximity-access-secret-0000";
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "offers-proximity-refresh-secret-000";
    backendEnv = (await import("../../src/config/env.js")).env;
    backendEnv.RIDE_OFFER_PROXIMITY_ENABLED = false;
    ({ RideService: RideServiceClass } = await import("../../src/modules/rides/application/RideService.js"));
    ({ expireStaleRideSearches } = await import("../../src/modules/rides/application/rideSearchExpiry.js"));
  });

  afterAll(() => {
    backendEnv.DRIVER_COMMISSION_ENABLED = false;
  });

  beforeEach(async () => {
    await cleanDatabase();
    await seedMemberships();
    backendEnv.DRIVER_COMMISSION_ENABLED = true;
    backendEnv.DRIVER_COMMISSION_PERCENT = 8;
    await prisma.rideEvent.deleteMany();
    await prisma.rideDriverLocation.deleteMany();
    await prisma.rideOrder.deleteMany();
    await prisma.rideQuote.deleteMany();
    await prisma.rideVehicle.deleteMany();
    await prisma.rideDriverProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createUser() {
    sequence += 1;
    const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
    return prisma.user.create({
      data: {
        fullName: `User ${sequence}`,
        phone: `+6285${String(sequence).padStart(9, "0")}`,
        referralCode: `OFP${String(sequence).padStart(6, "0")}`,
        membershipId: basic.id
      }
    });
  }

  async function createDriver(fixAgeSeconds: number | null = 5) {
    const user = await createUser();
    const profile = await prisma.rideDriverProfile.create({
      data: { userId: user.id, status: "ACTIVE", availability: "ONLINE" }
    });
    await prisma.rideVehicle.create({
      data: {
        driverProfileId: profile.id,
        type: "MOTORCYCLE",
        plateNumberHash: createHash("sha256").update(`P${sequence}`).digest("hex"),
        plateNumberMasked: "B 12•• XX",
        verificationStatus: "VERIFIED",
        isActive: true
      }
    });
    if (fixAgeSeconds !== null) {
      await prisma.rideDriverLocation.create({
        data: {
          driverProfileId: profile.id,
          lat: new Prisma.Decimal(P.lat),
          lng: new Prisma.Decimal(P.lng),
          accuracyMeters: 10,
          sequence: sequence,
          capturedAt: new Date(Date.now() - fixAgeSeconds * 1000)
        }
      });
    }
    return { user, profile };
  }

  async function createOrder(pickup: { lat: number; lng: number }, options: { ageSeconds?: number; status?: RideOrderStatus; method?: "CASH" } = {}) {
    const passenger = await createUser();
    const quote = await prisma.rideQuote.create({
      data: {
        userId: passenger.id,
        serviceType: "MOTORCYCLE",
        pickupLat: new Prisma.Decimal(pickup.lat.toFixed(7)),
        pickupLng: new Prisma.Decimal(pickup.lng.toFixed(7)),
        pickupAddress: "Titik jemput uji",
        dropoffLat: new Prisma.Decimal("-6.1000000"),
        dropoffLng: new Prisma.Decimal("106.9000000"),
        dropoffAddress: "Tujuan uji",
        distanceMeters: 3000,
        durationSeconds: 600,
        etaSeconds: 300,
        baseFare: 5000,
        distanceFare: 3000,
        serviceFee: 1000,
        subtotalFare: 9000,
        totalFare: 9000,
        fareRuleVersion: "RIDE_FARE_RULE_V1",
        roundingRule: "ROUND_TO_NEAREST_100_HALF_UP",
        distanceSource: "HAVERSINE_LOCAL_V1",
        expiresAt: new Date(Date.now() + 3600_000)
      }
    });
    const order = await prisma.rideOrder.create({
      data: {
        publicReference: `RID-${String(sequence).replace(/\d/g, (d) => "ABCDEFGHJK".charAt(Number(d))).padStart(10, "M").slice(-10)}`,
        passengerId: passenger.id,
        quoteId: quote.id,
        serviceType: "MOTORCYCLE",
        status: options.status ?? "SEARCHING_DRIVER",
        pickupLat: quote.pickupLat,
        pickupLng: quote.pickupLng,
        pickupAddress: quote.pickupAddress,
        dropoffLat: quote.dropoffLat,
        dropoffLng: quote.dropoffLng,
        dropoffAddress: quote.dropoffAddress,
        distanceMeters: 3000,
        durationSeconds: 600,
        baseFare: 5000,
        distanceFare: 3000,
        serviceFee: 1000,
        subtotalFare: 9000,
        totalFare: 9000,
        fareRuleVersion: "RIDE_FARE_RULE_V1",
        paymentMethod: "CASH",
        paymentState: "CASH_EXPECTED",
        createdAt: new Date(Date.now() - (options.ageSeconds ?? 10) * 1000)
      }
    });
    return { order, passenger };
  }

  async function fund(userId: string, amount: number) {
    await prisma.wallet.upsert({
      where: { userId },
      update: { balance: amount, cashBalance: amount },
      create: { userId, balance: amount, cashBalance: amount }
    });
  }
  const walletOf = (userId: string) => prisma.wallet.findUniqueOrThrow({ where: { userId } });
  async function drive(userId: string, reference: string) {
    for (const next of ["DRIVER_TO_PICKUP", "DRIVER_ARRIVED", "IN_TRIP", "COMPLETED"] as const) {
      await service().advanceByDriver({ userId, publicReference: reference, next });
    }
  }

  it("saldo kurang: pesanan tunai ditolak dengan 402 dan pesan jelas; pesanan tetap terbuka", async () => {
    const { user } = await createDriver();
    await fund(user.id, 500);
    const { order } = await createOrder(north(1));
    await expect(service().acceptOrder({ userId: user.id, publicReference: order.publicReference })).rejects.toMatchObject({
      code: "RIDE_COMMISSION_BALANCE_INSUFFICIENT",
      statusCode: 402
    });
    expect((await prisma.rideOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SEARCHING_DRIVER");
  });

  it("driver tanpa dompet sama sekali juga ditolak", async () => {
    const { user } = await createDriver();
    const { order } = await createOrder(north(1));
    await expect(service().acceptOrder({ userId: user.id, publicReference: order.publicReference })).rejects.toMatchObject({
      code: "RIDE_COMMISSION_BALANCE_INSUFFICIENT"
    });
  });

  it("saldo cukup: selesai memotong 8% (dibulatkan ke atas) tepat sekali; ledger debit; saldo berkurang", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order } = await createOrder(north(1)); // tarif 9000 -> komisi 720
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    await drive(user.id, order.publicReference);
    // ulang penyelesaian (idempoten) tidak memotong lagi
    await service().advanceByDriver({ userId: user.id, publicReference: order.publicReference, next: "COMPLETED" });

    const wallet = await walletOf(user.id);
    expect(wallet.balance.toNumber()).toBe(9_280);
    expect(wallet.cashBalance.toNumber()).toBe(9_280);
    const rows = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id, referenceType: "RIDE_COMMISSION_FEE" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount.toNumber()).toBe(-720);
    expect(rows[0]!.referenceId).toBe(order.id);
    // M2: hold difinalkan (bukan lagi shortfall) — sekali terisi HELD saat
    // accept, sekali FINALIZED saat complete, baris ledger yang SAMA.
    expect((rows[0]!.metadata as { status: string }).status).toBe("FINALIZED");
    expect(await prisma.commission.count()).toBe(0);
  });

  // --- M2 (audit keamanan 30 September 2026): komisi ditahan saat ACCEPT ------

  it("komisi ditahan (didebit) SAAT ACCEPT, bukan menunggu complete", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order } = await createOrder(north(1)); // tarif 9000 -> komisi 720
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });

    // Saldo SUDAH berkurang tepat setelah accept — sebelum satu pun
    // transisi perjalanan berikutnya terjadi. Ini jaminan inti M2: saldo
    // yang dipakai untuk komisi tidak bisa ikut ditarik withdraw selama
    // perjalanan berlangsung, karena sudah keluar dari `balance` seketika.
    const afterAccept = await walletOf(user.id);
    expect(afterAccept.balance.toNumber()).toBe(9_280);
    expect(afterAccept.cashBalance.toNumber()).toBe(9_280);
    const held = await prisma.walletTransaction.findFirstOrThrow({
      where: { walletId: afterAccept.id, referenceType: "RIDE_COMMISSION_FEE" }
    });
    expect(held.amount.toNumber()).toBe(-720);
    expect((held.metadata as { status: string }).status).toBe("HELD");

    // Complete TIDAK memotong saldo lagi — hanya memfinalkan hold yang sama.
    await drive(user.id, order.publicReference);
    const afterComplete = await walletOf(user.id);
    expect(afterComplete.balance.toNumber()).toBe(9_280);
    const rows = await prisma.walletTransaction.findMany({
      where: { walletId: afterAccept.id, referenceType: "RIDE_COMMISSION_FEE" }
    });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.metadata as { status: string }).status).toBe("FINALIZED");
  });

  it("accept berulang oleh driver yang sama TIDAK menahan komisi dua kali", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order } = await createOrder(north(1)); // komisi 720
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    // Accept ulang (idempoten di RideService: driver yang sama menerima
    // ulang order miliknya) tidak boleh menahan komisi kedua kalinya.
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });

    const wallet = await walletOf(user.id);
    expect(wallet.balance.toNumber()).toBe(10_000 - 720);
    const rows = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id, referenceType: "RIDE_COMMISSION_FEE" }
    });
    expect(rows).toHaveLength(1);
  });

  it("complete DITOLAK bila hold hilang/tidak utuh — tidak menyelesaikan trip dengan shortfall diam-diam", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order } = await createOrder(north(1));
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });

    // Simulasikan hold yang hilang/rusak (mis. data tidak konsisten) dengan
    // menghapus baris ledger-nya secara langsung.
    const wallet = await walletOf(user.id);
    await prisma.walletTransaction.deleteMany({
      where: { walletId: wallet.id, referenceType: "RIDE_COMMISSION_FEE" }
    });

    await service().advanceByDriver({ userId: user.id, publicReference: order.publicReference, next: "DRIVER_TO_PICKUP" });
    await service().advanceByDriver({ userId: user.id, publicReference: order.publicReference, next: "DRIVER_ARRIVED" });
    await service().advanceByDriver({ userId: user.id, publicReference: order.publicReference, next: "IN_TRIP" });
    await expect(
      service().advanceByDriver({ userId: user.id, publicReference: order.publicReference, next: "COMPLETED" })
    ).rejects.toMatchObject({ code: "RIDE_COMMISSION_HOLD_MISSING" });

    // Trip TIDAK boleh berpindah ke COMPLETED tanpa hold yang utuh.
    expect((await prisma.rideOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("IN_TRIP");
  });

  it("pembulatan ke atas: tarif 9050 -> 724", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order } = await createOrder(north(1));
    await prisma.rideOrder.update({ where: { id: order.id }, data: { totalFare: 9050 } });
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    await drive(user.id, order.publicReference);
    expect((await walletOf(user.id)).balance.toNumber()).toBe(10_000 - 724);
  });

  it("M2: withdraw sebesar saldo TIDAK bisa menghabiskan bagian komisi yang ditahan", async () => {
    // Jaminan inti M2: begitu accept berhasil, dana komisi sudah keluar dari
    // `balance` — withdraw untuk seluruh SISA saldo (yang tampak) tidak bisa
    // ikut menyentuh bagian yang sudah ditahan, karena bagian itu sudah tidak
    // ada lagi di `balance` sama sekali (bukan sekadar ditandai "terkunci").
    const { user } = await createDriver();
    // Nominal cukup besar untuk melewati minimum withdrawal (Rp50.000).
    await fund(user.id, 100_000);
    const { order } = await createOrder(north(1)); // komisi 720
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });

    const afterAccept = await walletOf(user.id);
    expect(afterAccept.balance.toNumber()).toBe(99_280);

    const { walletService } = await import("../helpers/referralWalletHarness.js");
    // Coba tarik SELURUH 100.000 (termasuk 720 yang seharusnya sudah ditahan)
    // -> ditolak karena balance sungguhan cuma 99.280.
    await expect(
      walletService.requestWithdrawal({
        userId: user.id,
        amount: new Prisma.Decimal(100_000),
        bankName: "BCA",
        accountNumber: "1234567890",
        accountHolderName: "Driver Uji"
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    // Tarik PERSIS sisa yang benar (99.280) berhasil — membuktikan 720 itu
    // sungguh sudah keluar dari balance yang bisa ditarik, bukan cuma dicatat.
    await walletService.requestWithdrawal({
      userId: user.id,
      amount: new Prisma.Decimal(99_280),
      bankName: "BCA",
      accountNumber: "1234567890",
      accountHolderName: "Driver Uji"
    });
    expect((await walletOf(user.id)).balance.toNumber()).toBe(0);
  });

  it("pesanan dibatalkan driver melepaskan hold komisi — saldo kembali utuh, hold tercatat RELEASED", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order } = await createOrder(north(1)); // komisi 720
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    expect((await walletOf(user.id)).balance.toNumber()).toBe(9_280); // hold aktif

    await service().cancelByDriver({ userId: user.id, publicReference: order.publicReference, reason: "OTHER" });

    const wallet = await walletOf(user.id);
    expect(wallet.balance.toNumber()).toBe(10_000);
    expect(wallet.cashBalance.toNumber()).toBe(10_000);
    // Dua baris: hold asli (kini RELEASED) + refund yang membalikkannya —
    // BUKAN nol baris. Audit trail hold+pelepasannya tetap ada, bukan seolah
    // tidak pernah terjadi.
    const rows = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id, referenceType: "RIDE_COMMISSION_FEE" },
      orderBy: { createdAt: "asc" }
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.type).toBe("PAYMENT");
    expect(rows[0]!.amount.toNumber()).toBe(-720);
    expect((rows[0]!.metadata as { status: string }).status).toBe("RELEASED");
    expect(rows[1]!.type).toBe("REFUND");
    expect(rows[1]!.amount.toNumber()).toBe(720);
    expect((rows[1]!.metadata as { reversedFrom: string }).reversedFrom).toBe(rows[0]!.id);
  });

  it("pesanan dibatalkan PENUMPANG setelah driver ditugaskan juga melepaskan hold", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order, passenger } = await createOrder(north(1));
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    expect((await walletOf(user.id)).balance.toNumber()).toBe(9_280);

    await service().cancelByPassenger({
      userId: passenger.id,
      publicReference: order.publicReference,
      reason: "CHANGE_OF_PLAN"
    });

    expect((await walletOf(user.id)).balance.toNumber()).toBe(10_000);
  });

  it("koreksi admin ke CANCELLED_BY_SYSTEM setelah driver ditugaskan juga melepaskan hold", async () => {
    const { user } = await createDriver();
    const admin = await createUser();
    await fund(user.id, 10_000);
    const { order } = await createOrder(north(1));
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    expect((await walletOf(user.id)).balance.toNumber()).toBe(9_280);

    await service().correctStatusByAdmin({
      adminUserId: admin.id,
      publicReference: order.publicReference,
      status: "CANCELLED_BY_SYSTEM",
      reason: "uji M2"
    });

    expect((await walletOf(user.id)).balance.toNumber()).toBe(10_000);
  });

  // --- Sisa review audit (1 Oktober 2026): pelepasan hold harus diklaim sekali ---

  it("dua pembatalan PENUMPANG bersamaan untuk order tunai (komisi HELD) hanya mengembalikan fee satu kali", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order, passenger } = await createOrder(north(1)); // komisi 720
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    expect((await walletOf(user.id)).balance.toNumber()).toBe(9_280);

    // Dua pemanggilan cancelByPassenger BERSAMAAN (duplikat/double-tap). Baik
    // keduanya sukses (satu menang klaim status, satu lagi idempoten karena
    // statusnya sudah sama) maupun salah satu gagal RIDE_ALREADY_FINAL
    // (SELECT-nya kebetulan terjadi setelah commit pemenang) sama-sama AMAN
    // — yang diverifikasi adalah HASIL AKHIR (saldo, jumlah baris ledger),
    // bukan kombinasi fulfilled/rejected yang bergantung timing race.
    await Promise.allSettled([
      service().cancelByPassenger({ userId: passenger.id, publicReference: order.publicReference, reason: "CHANGE_OF_PLAN" }),
      service().cancelByPassenger({ userId: passenger.id, publicReference: order.publicReference, reason: "CHANGE_OF_PLAN" })
    ]);

    const wallet = await walletOf(user.id);
    // Persis saldo SEBELUM accept — bukan 10_720 (kredit ganda).
    expect(wallet.balance.toNumber()).toBe(10_000);
    expect(wallet.cashBalance.toNumber()).toBe(10_000);

    const rows = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id, referenceType: "RIDE_COMMISSION_FEE" }
    });
    // HELD (kini RELEASED) + tepat SATU REFUND — bukan dua REFUND.
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.type === "REFUND")).toHaveLength(1);

    const finalOrder = await prisma.rideOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(finalOrder.status).toBe("CANCELLED_BY_PASSENGER");
  });

  it("releaseCashCommissionHold kedua (setelah yang pertama sukses) adalah no-op — saldo tidak bertambah lagi", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const { order } = await createOrder(north(1)); // komisi 720
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    expect((await walletOf(user.id)).balance.toNumber()).toBe(9_280);

    // Verifikasi langsung invarian level-ledger releaseCashCommissionHold:
    // klaim JSON-path pada baris HELD (lihat RideService.ts) membuat
    // pemanggilan KEDUA (setelah yang pertama sukses mengubahnya jadi
    // RELEASED) menjadi no-op murni — terpisah dari klaim status order yang
    // sudah diuji end-to-end pada test sebelumnya.
    const svc = service() as unknown as {
      releaseCashCommissionHold: (tx: typeof prisma, orderId: string) => Promise<void>;
    };
    await prisma.$transaction((tx) => svc.releaseCashCommissionHold(tx as never, order.id));
    expect((await walletOf(user.id)).balance.toNumber()).toBe(10_000); // pelepasan pertama, sungguhan

    await prisma.$transaction((tx) => svc.releaseCashCommissionHold(tx as never, order.id));
    expect((await walletOf(user.id)).balance.toNumber()).toBe(10_000); // TIDAK bertambah lagi

    const wallet = await walletOf(user.id);
    const rows = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id, referenceType: "RIDE_COMMISSION_FEE" }
    });
    expect(rows.filter((r) => r.type === "REFUND")).toHaveLength(1);
  });

  it("accept dua driver BERSAMAAN untuk order tunai yang sama tetap hanya menahan komisi pada pemenang", async () => {
    const driverA = await createDriver();
    const driverB = await createDriver();
    await fund(driverA.user.id, 10_000);
    await fund(driverB.user.id, 10_000);
    const { order } = await createOrder(north(1)); // komisi 720

    const results = await Promise.allSettled([
      service().acceptOrder({ userId: driverA.user.id, publicReference: order.publicReference }),
      service().acceptOrder({ userId: driverB.user.id, publicReference: order.publicReference })
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "RIDE_ALREADY_TAKEN" });

    const finalOrder = await prisma.rideOrder.findUniqueOrThrow({ where: { id: order.id } });
    const winner = finalOrder.driverProfileId === driverA.profile.id ? driverA : driverB;
    const loser = finalOrder.driverProfileId === driverA.profile.id ? driverB : driverA;

    expect((await walletOf(winner.user.id)).balance.toNumber()).toBe(9_280);
    expect((await walletOf(loser.user.id)).balance.toNumber()).toBe(10_000); // tidak tersentuh sama sekali

    const winnerHolds = await prisma.walletTransaction.findMany({
      where: { walletId: (await walletOf(winner.user.id)).id, referenceType: "RIDE_COMMISSION_FEE" }
    });
    expect(winnerHolds).toHaveLength(1);
    const loserHolds = await prisma.walletTransaction.findMany({
      where: { walletId: (await walletOf(loser.user.id)).id, referenceType: "RIDE_COMMISSION_FEE" }
    });
    expect(loserHolds).toHaveLength(0);
  });

  it("flag mati: perilaku lama — tanpa dompet pun bisa terima, tidak ada potongan", async () => {
    backendEnv.DRIVER_COMMISSION_ENABLED = false;
    const { user } = await createDriver();
    const { order } = await createOrder(north(1));
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    await drive(user.id, order.publicReference);
    expect(await prisma.wallet.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(0);
  });

  it("ringkasan saldo driver: saldo, aturan komisi, riwayat komisi dan isi saldo", async () => {
    const { user } = await createDriver();
    await fund(user.id, 10_000);
    const wallet = await walletOf(user.id);
    await prisma.walletTransaction.create({ data: { walletId: wallet.id, type: "TOPUP", amount: 10_000, referenceType: "WALLET_TOPUP", referenceId: "x" } });
    const { order } = await createOrder(north(1));
    await service().acceptOrder({ userId: user.id, publicReference: order.publicReference });
    await drive(user.id, order.publicReference);
    const summary = await service().walletSummary(user.id);
    expect(summary.balance).toBe(9_280);
    expect(summary.commissionEnabled).toBe(true);
    expect(summary.commissionPercent).toBe(8);
    const fee = summary.entries.find((e) => e.kind === "COMMISSION")!;
    expect(fee.amount).toBe(-720);
    expect(fee.rideReference).toBe(order.publicReference);
    expect(fee.shortfall).toBe(0);
    expect(summary.entries.some((e) => e.kind === "TOPUP" && e.amount === 10_000)).toBe(true);
  });

  it("ringkasan saldo untuk driver tanpa dompet: nol dan riwayat kosong", async () => {
    const { user } = await createDriver();
    expect(await service().walletSummary(user.id)).toMatchObject({ balance: 0, entries: [] });
  });
});
