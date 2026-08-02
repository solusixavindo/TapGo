import { Prisma, RideDriverApplicationStatus, UserRole } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, runIntegration } from "../helpers/referralWalletHarness.js";

/**
 * Stage 5.14B — fondasi schema RideDriverApplication.
 *
 * Test ini membuktikan perilaku constraint NYATA pada PostgreSQL, bukan mock.
 * Yang diuji adalah database, bukan application logic: Stage 5.14B sengaja
 * belum memiliki endpoint, service, maupun admin workflow. Seluruh row
 * dimasukkan langsung lewat Prisma sebagai test fixture.
 *
 * CATATAN KEJUJURAN: direct fixture insertion di bawah ini BUKAN production
 * workflow. Workflow sebenarnya (draft, submit, withdraw, resubmit, approve,
 * reject) adalah Stage 5.14C dan belum ada.
 */

const describeIntegration = runIntegration ? describe : describe.skip;

let sequence = 0;

/** Status yang dianggap "open" oleh partial unique index. */
const OPEN_STATUSES: RideDriverApplicationStatus[] = ["DRAFT", "SUBMITTED", "UNDER_REVIEW"];

/** Status terminal beserta timestamp wajibnya (biconditional CHECK). */
const TERMINAL_TIMESTAMP: Record<string, "approvedAt" | "rejectedAt" | "withdrawnAt"> = {
  APPROVED: "approvedAt",
  REJECTED: "rejectedAt",
  WITHDRAWN: "withdrawnAt",
};

async function createUser(role: UserRole = "USER") {
  sequence += 1;
  return prisma.user.create({
    data: {
      fullName: `App User ${sequence}`,
      phone: `+6288${String(sequence).padStart(9, "0")}`,
      referralCode: `APP${String(sequence).padStart(6, "0")}`,
      role,
    },
  });
}

/** Membangun payload yang konsisten dengan CHECK constraint terminal. */
function applicationData(
  userId: string,
  cycleNumber: number,
  status: RideDriverApplicationStatus
): Prisma.RideDriverApplicationUncheckedCreateInput {
  const data: Prisma.RideDriverApplicationUncheckedCreateInput = {
    userId,
    cycleNumber,
    status,
  };
  if (status !== "DRAFT") {
    data.submittedAt = new Date();
  }
  const terminalField = TERMINAL_TIMESTAMP[status];
  if (terminalField) {
    data[terminalField] = new Date();
  }
  return data;
}

function createApplication(
  userId: string,
  cycleNumber: number,
  status: RideDriverApplicationStatus
) {
  return prisma.rideDriverApplication.create({
    data: applicationData(userId, cycleNumber, status),
  });
}

/**
 * Menormalkan error database menjadi bentuk yang aman untuk di-assert.
 *
 * WAJIB dipakai untuk setiap error database pada file ini. Pesan mentah
 * Prisma untuk pelanggaran CHECK memuat blok `Failing row contains (...)`
 * berisi SELURUH nilai kolom baris yang ditolak. Fungsi ini hanya
 * mengembalikan kode error dan nama constraint, tidak pernah pesan mentah,
 * connection string, parameter query, maupun isi baris.
 */
function safeDbError(error: unknown): { kind: string; detail: string } {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = error.meta?.target;
    return {
      kind: error.code,
      detail: Array.isArray(target) ? target.join(",") : String(target ?? ""),
    };
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    // Prisma 5 tidak memetakan SQLSTATE 23514 ke known error, sehingga
    // pelanggaran CHECK tiba sebagai unknown request error. Tanda kutip di
    // sekitar nama constraint ter-escape oleh formatting Rust (\"nama\"),
    // karena itu backslash-nya opsional pada pola berikut.
    const isCheckViolation = /code: "23514"/.test(error.message);
    const match = /violates check constraint \\?"([a-z0-9_]+)\\?"/i.exec(error.message);
    if (isCheckViolation || match) {
      return { kind: "CHECK_VIOLATION", detail: match?.[1] ?? "unknown_check" };
    }
    return { kind: "UNKNOWN_DB_ERROR", detail: "" };
  }
  return { kind: "UNEXPECTED", detail: error instanceof Error ? error.name : "unknown" };
}

/** Menangkap error insert tanpa membocorkan pesan mentah. */
async function expectInsertToFail(
  operation: () => Promise<unknown>
): Promise<{ kind: string; detail: string }> {
  try {
    await operation();
  } catch (error) {
    return safeDbError(error);
  }
  throw new Error("insert seharusnya ditolak database, tetapi berhasil");
}

describeIntegration("Stage 5.14B — RideDriverApplication schema foundation", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.rideOrder.deleteMany();
    await prisma.rideQuote.deleteMany();
    await prisma.rideDriverApplication.deleteMany();
    await prisma.rideVehicle.deleteMany();
    await prisma.rideDriverProfile.deleteMany();
    await prisma.user.deleteMany();
  });

  // ---------------------------------------------------------------------
  // Test 1–5 — penegakan satu open application per user
  // ---------------------------------------------------------------------

  it("1. user dapat memiliki satu DRAFT application", async () => {
    const user = await createUser();
    const application = await createApplication(user.id, 1, "DRAFT");

    expect(application.status).toBe("DRAFT");
    expect(application.cycleNumber).toBe(1);
    expect(application.version).toBe(0);
    expect(application.submittedAt).toBeNull();
    expect(application.approvedAt).toBeNull();
    expect(application.rejectedAt).toBeNull();
    expect(application.withdrawnAt).toBeNull();
  });

  it("2. user yang sama tidak dapat memiliki dua DRAFT application", async () => {
    const user = await createUser();
    await createApplication(user.id, 1, "DRAFT");

    const failure = await expectInsertToFail(() => createApplication(user.id, 2, "DRAFT"));

    expect(failure.kind).toBe("P2002");
    expect(await prisma.rideDriverApplication.count({ where: { userId: user.id } })).toBe(1);
  });

  it("3. user yang sama tidak dapat memiliki DRAFT + SUBMITTED sekaligus", async () => {
    const user = await createUser();
    await createApplication(user.id, 1, "DRAFT");

    const failure = await expectInsertToFail(() => createApplication(user.id, 2, "SUBMITTED"));

    expect(failure.kind).toBe("P2002");
    const open = await prisma.rideDriverApplication.count({
      where: { userId: user.id, status: { in: OPEN_STATUSES } },
    });
    expect(open).toBe(1);
  });

  it("4. user yang sama tidak dapat memiliki SUBMITTED + UNDER_REVIEW sekaligus", async () => {
    const user = await createUser();
    await createApplication(user.id, 1, "SUBMITTED");

    const failure = await expectInsertToFail(() => createApplication(user.id, 2, "UNDER_REVIEW"));

    expect(failure.kind).toBe("P2002");
    const open = await prisma.rideDriverApplication.count({
      where: { userId: user.id, status: { in: OPEN_STATUSES } },
    });
    expect(open).toBe(1);
  });

  it("5. user berbeda masing-masing dapat memiliki open application", async () => {
    const first = await createUser();
    const second = await createUser();
    const third = await createUser();

    await createApplication(first.id, 1, "DRAFT");
    await createApplication(second.id, 1, "SUBMITTED");
    await createApplication(third.id, 1, "UNDER_REVIEW");

    const open = await prisma.rideDriverApplication.count({
      where: { status: { in: OPEN_STATUSES } },
    });
    expect(open).toBe(3);
  });

  // ---------------------------------------------------------------------
  // Test 6–9 — histori terminal boleh menumpuk
  // ---------------------------------------------------------------------

  it("6. user dapat memiliki banyak cycle terminal historis", async () => {
    const user = await createUser();
    await createApplication(user.id, 1, "REJECTED");
    await createApplication(user.id, 2, "WITHDRAWN");
    await createApplication(user.id, 3, "REJECTED");
    await createApplication(user.id, 4, "WITHDRAWN");

    expect(await prisma.rideDriverApplication.count({ where: { userId: user.id } })).toBe(4);
    const open = await prisma.rideDriverApplication.count({
      where: { userId: user.id, status: { in: OPEN_STATUSES } },
    });
    expect(open).toBe(0);
  });

  it("7. cycle REJECTED dapat diikuti cycle baru", async () => {
    const user = await createUser();
    await createApplication(user.id, 1, "REJECTED");

    const next = await createApplication(user.id, 2, "DRAFT");

    expect(next.cycleNumber).toBe(2);
    expect(await prisma.rideDriverApplication.count({ where: { userId: user.id } })).toBe(2);
  });

  it("8. cycle WITHDRAWN dapat diikuti cycle baru", async () => {
    const user = await createUser();
    await createApplication(user.id, 1, "WITHDRAWN");

    const next = await createApplication(user.id, 2, "DRAFT");

    expect(next.cycleNumber).toBe(2);
    // D-20 masih PENDING: tidak ada cooldown implisit pada level schema.
    // Insert cycle berikutnya berhasil tanpa jeda waktu apa pun.
    expect(await prisma.rideDriverApplication.count({ where: { userId: user.id } })).toBe(2);
  });

  it("9. cycle APPROVED historis tetap dipertahankan", async () => {
    const user = await createUser();
    const approved = await createApplication(user.id, 1, "APPROVED");
    await createApplication(user.id, 2, "DRAFT");

    const stored = await prisma.rideDriverApplication.findUnique({ where: { id: approved.id } });
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("APPROVED");
    expect(stored?.approvedAt).not.toBeNull();
    expect(await prisma.rideDriverApplication.count({ where: { userId: user.id } })).toBe(2);
  });

  // ---------------------------------------------------------------------
  // Test 10–12 — integritas cycle number
  // ---------------------------------------------------------------------

  it("10. userId + cycleNumber duplikat ditolak", async () => {
    const user = await createUser();
    await createApplication(user.id, 1, "REJECTED");

    const failure = await expectInsertToFail(() => createApplication(user.id, 1, "WITHDRAWN"));

    expect(failure.kind).toBe("P2002");
    expect(failure.detail).toContain("cycle_number");
    expect(await prisma.rideDriverApplication.count({ where: { userId: user.id } })).toBe(1);
  });

  it("11. cycleNumber nol ditolak CHECK constraint", async () => {
    const user = await createUser();

    const failure = await expectInsertToFail(() => createApplication(user.id, 0, "DRAFT"));

    expect(failure.kind).toBe("CHECK_VIOLATION");
    expect(failure.detail).toBe("ride_driver_applications_cycle_number_check");
    expect(await prisma.rideDriverApplication.count({ where: { userId: user.id } })).toBe(0);
  });

  it("12. cycleNumber negatif ditolak CHECK constraint", async () => {
    const user = await createUser();

    const failure = await expectInsertToFail(() => createApplication(user.id, -1, "DRAFT"));

    expect(failure.kind).toBe("CHECK_VIOLATION");
    expect(failure.detail).toBe("ride_driver_applications_cycle_number_check");
    expect(await prisma.rideDriverApplication.count({ where: { userId: user.id } })).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Test 13 — concurrency nyata pada PostgreSQL
  // ---------------------------------------------------------------------

  it("13. insert open-application serentak menghasilkan tepat satu pemenang", async () => {
    const user = await createUser();

    // Dua transaksi dibuka bersamaan, lalu keduanya menunggu barrier yang sama
    // sebelum melakukan insert. Barrier hanya menjamin kedua transaksi benar-
    // benar tumpang tindih; barrier TIDAK menentukan siapa yang gagal.
    // Kegagalan murni berasal dari partial unique index PostgreSQL.
    let releaseBarrier: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    let arrived = 0;
    const arriveAndWait = async () => {
      arrived += 1;
      if (arrived === 2) {
        releaseBarrier();
      }
      await barrier;
    };

    // cycleNumber sengaja BERBEDA (1 dan 2) sehingga unique
    // (user_id, cycle_number) tidak mungkin terpicu. Satu-satunya constraint
    // yang dapat menolak adalah partial unique index one-open-per-user.
    const attempt = (cycleNumber: number) =>
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        await arriveAndWait();
        return tx.rideDriverApplication.create({
          data: applicationData(user.id, cycleNumber, "DRAFT"),
        });
      });

    const results = await Promise.allSettled([attempt(1), attempt(2)]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const failure = safeDbError((rejected[0] as PromiseRejectedResult).reason);
    expect(failure.kind).toBe("P2002");

    const openAfter = await prisma.rideDriverApplication.count({
      where: { userId: user.id, status: { in: OPEN_STATUSES } },
    });
    expect(openAfter).toBe(1);
    expect(await prisma.rideDriverApplication.count({ where: { userId: user.id } })).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Test 14–15 — objek database benar-benar ada
  // ---------------------------------------------------------------------

  it("14. partial unique index benar-benar ada di PostgreSQL", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'ride_driver_applications'
        AND indexname = 'ride_driver_applications_one_open_per_user_key'
    `;

    expect(rows).toHaveLength(1);
    const definition = rows[0]?.indexdef ?? "";
    expect(definition).toContain("CREATE UNIQUE INDEX");
    expect(definition).toContain("(user_id)");
    // Predikat WHERE membuktikan index bersifat partial, bukan unique penuh.
    expect(definition).toContain("WHERE");
    for (const status of OPEN_STATUSES) {
      expect(definition).toContain(status);
    }
    // Status terminal HARUS di luar predikat agar histori boleh menumpuk.
    for (const status of ["APPROVED", "REJECTED", "WITHDRAWN"]) {
      expect(definition).not.toContain(`'${status}'`);
    }
  });

  it("15. seluruh CHECK constraint yang diharapkan benar-benar ada", async () => {
    const rows = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'ride_driver_applications'::regclass AND contype = 'c'
      ORDER BY conname
    `;

    const names = rows.map((row) => row.conname);
    expect(names).toEqual([
      "ride_driver_applications_approved_at_check",
      "ride_driver_applications_cycle_number_check",
      "ride_driver_applications_rejected_at_check",
      "ride_driver_applications_terminal_exclusive_check",
      "ride_driver_applications_version_check",
      "ride_driver_applications_withdrawn_at_check",
    ]);
  });

  // ---------------------------------------------------------------------
  // Test 16 — relasi ke User
  // ---------------------------------------------------------------------

  it("16. relasi ke User bekerja dua arah dan cascade saat user dihapus", async () => {
    const user = await createUser();
    await createApplication(user.id, 1, "DRAFT");

    const withUser = await prisma.rideDriverApplication.findFirst({
      where: { userId: user.id },
      include: { user: true },
    });
    expect(withUser?.user.id).toBe(user.id);

    const withApplications = await prisma.user.findUnique({
      where: { id: user.id },
      include: { rideDriverApplications: true },
    });
    expect(withApplications?.rideDriverApplications).toHaveLength(1);

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.rideDriverApplication.count({ where: { userId: user.id } })).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Test 17–21 — pembuktian bahwa tidak ada hal lain yang berubah
  // ---------------------------------------------------------------------

  it("17. User.role tidak berubah karena adanya application", async () => {
    const user = await createUser("USER");
    expect(user.role).toBe("USER");

    for (const status of ["DRAFT", "SUBMITTED", "UNDER_REVIEW"] as const) {
      await prisma.rideDriverApplication.deleteMany({ where: { userId: user.id } });
      await createApplication(user.id, 1, status);
      const reloaded = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(reloaded.role).toBe("USER");
    }

    await prisma.rideDriverApplication.deleteMany({ where: { userId: user.id } });
    await createApplication(user.id, 1, "APPROVED");
    const afterApproval = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // Bahkan APPROVED tidak mengubah role. Kewenangan driver berasal dari
    // capability database Stage 5.11, bukan dari role account.
    expect(afterApproval.role).toBe("USER");
    expect(afterApproval.status).toBe("ACTIVE");
  });

  it("18. jalur penumpang tetap berfungsi dan tidak tersentuh application", async () => {
    const passenger = await createUser();

    // Jalur penumpang Release 2: RideQuote -> RideOrder. Keduanya tidak
    // memiliki hubungan apa pun dengan RideDriverApplication.
    const quote = await prisma.rideQuote.create({
      data: {
        userId: passenger.id,
        serviceType: "MOTORCYCLE",
        pickupLat: new Prisma.Decimal("-6.2000000"),
        pickupLng: new Prisma.Decimal("106.8166660"),
        pickupAddress: "Titik jemput uji",
        dropoffLat: new Prisma.Decimal("-6.2100000"),
        dropoffLng: new Prisma.Decimal("106.8266660"),
        dropoffAddress: "Titik tujuan uji",
        distanceMeters: 1500,
        durationSeconds: 600,
        etaSeconds: 300,
        baseFare: 5000,
        distanceFare: 6000,
        serviceFee: 1000,
        subtotalFare: 12000,
        totalFare: 12000,
        fareRuleVersion: "test-fare-v1",
        roundingRule: "test-round-v1",
        distanceSource: "test-source",
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const order = await prisma.rideOrder.create({
      data: {
        publicReference: `RID-TEST${String(sequence).padStart(6, "0")}`,
        passengerId: passenger.id,
        quoteId: quote.id,
        serviceType: "MOTORCYCLE",
        pickupLat: quote.pickupLat,
        pickupLng: quote.pickupLng,
        pickupAddress: quote.pickupAddress,
        dropoffLat: quote.dropoffLat,
        dropoffLng: quote.dropoffLng,
        dropoffAddress: quote.dropoffAddress,
        distanceMeters: quote.distanceMeters,
        durationSeconds: quote.durationSeconds,
        baseFare: quote.baseFare,
        distanceFare: quote.distanceFare,
        serviceFee: quote.serviceFee,
        subtotalFare: quote.subtotalFare,
        totalFare: quote.totalFare,
        fareRuleVersion: quote.fareRuleVersion,
      },
    });

    const before = await prisma.rideOrder.findUniqueOrThrow({ where: { id: order.id } });
    await createApplication(passenger.id, 1, "DRAFT");
    const after = await prisma.rideOrder.findUniqueOrThrow({ where: { id: order.id } });

    // Penumpang yang sekaligus mendaftar sebagai driver tetap memiliki order
    // yang identik: satu User boleh menjadi passenger dan pelamar sekaligus.
    expect(after).toEqual(before);
    expect(after.status).toBe("CREATED");
    expect(await prisma.rideOrder.count()).toBe(1);

    // Migration Stage 5.14B hanya menambah satu tabel: tidak ada kolom baru
    // yang disuntikkan ke tabel sisi penumpang.
    const columns = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM information_schema.columns
      WHERE table_name IN ('ride_orders', 'ride_quotes')
        AND column_name LIKE '%application%'
    `;
    expect(Number(columns[0]?.count ?? -1)).toBe(0);
  });

  it("19. RideDriverProfile tidak dibuat otomatis oleh insert application", async () => {
    const user = await createUser();

    await createApplication(user.id, 1, "DRAFT");
    expect(await prisma.rideDriverProfile.count()).toBe(0);

    await prisma.rideDriverApplication.updateMany({
      where: { userId: user.id },
      data: { status: "APPROVED", approvedAt: new Date(), submittedAt: new Date() },
    });

    // APPROVED sekalipun tidak menghasilkan driver profile: schema tidak
    // memiliki trigger, dan promosi ke driver adalah Stage 5.14C.
    expect(await prisma.rideDriverProfile.count()).toBe(0);
    expect(await prisma.rideVehicle.count()).toBe(0);
  });

  it("20. legacy Driver tidak dipakai maupun direlasikan", async () => {
    const user = await createUser();
    await createApplication(user.id, 1, "APPROVED");

    // Tabel legacy tetap ada dan tetap kosong: tidak ada backfill.
    expect(await prisma.driver.count()).toBe(0);
    expect(await prisma.driverDocument.count()).toBe(0);

    // Tidak ada foreign key dari tabel baru ke tabel legacy mana pun.
    const foreignKeys = await prisma.$queryRaw<Array<{ referenced: string }>>`
      SELECT DISTINCT confrelid::regclass::text AS referenced
      FROM pg_constraint
      WHERE conrelid = 'ride_driver_applications'::regclass AND contype = 'f'
    `;
    expect(foreignKeys.map((row) => row.referenced)).toEqual(["users"]);
  });

  it("21. state finansial dan Business Engine tidak berubah", async () => {
    const user = await createUser();

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
      profitSharingPeriods: await prisma.profitSharingPeriod.count(),
      profitSharingDistributions: await prisma.profitSharingDistribution.count(),
      referrals: await prisma.referral.count(),
    });

    const before = await snapshot();
    await createApplication(user.id, 1, "DRAFT");
    await prisma.rideDriverApplication.updateMany({
      where: { userId: user.id },
      data: { status: "APPROVED", approvedAt: new Date(), submittedAt: new Date() },
    });
    const after = await snapshot();

    expect(after).toEqual(before);
  });
});
