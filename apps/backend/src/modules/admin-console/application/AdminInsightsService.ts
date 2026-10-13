import { Prisma, PrismaClient } from "@prisma/client";
import { tallyRegions } from "../../../core/geo/indonesiaRegions.js";

/**
 * Wawasan untuk Beranda Super Admin VIP: pertumbuhan, pendapatan, perjalanan, wilayah, usia pengemudi, rating dan
 * ulasan, serta hal yang butuh perhatian. Semua dihitung dari data operasional; tidak ada angka karangan.
 *
 * Yang SENGAJA tidak ada karena datanya memang tidak disimpan: lokasi pengunduhan aplikasi (hanya Play Console yang
 * tahu) dan usia member/penumpang (tidak dikumpulkan). Usia hanya ada untuk pengemudi (tanggal lahir di data
 * pengajuan). Wilayah dibaca dari alamat yang diketik, jadi hasilnya perkiraan (lihat core/geo/indonesiaRegions.ts).
 *
 * Pengelompokan waktu memakai WIB di JavaScript, bukan SQL, supaya batas hari/bulan identik dengan konsol.
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Batas baris yang dibaca per kelompok data agar memori terjaga bila data tumbuh besar. */
const ROW_CAP = 50_000;
const ADDRESS_CAP = 5_000;
/** Transaksi PPOB terbuka lebih lama dari ini dianggap tertahan (sama dengan halaman Transaksi Digiflazz). */
const PPOB_STUCK_AFTER_MS = 10 * 60 * 1000;

export type InsightBucket = "hour" | "day" | "month";

export type InsightRange = { from: Date; to: Date };

export type InsightDeps = {
  /** Status saldo Digiflazz; gagal membaca tidak boleh menggagalkan seluruh Beranda. */
  digiflazz: () => Promise<{ level: string; balance: number | null } | null>;
};

type WibParts = { year: number; month: number; day: number; hour: number; weekday: number };

function wibParts(instant: number): WibParts {
  const shifted = new Date(instant + WIB_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    weekday: shifted.getUTCDay()
  };
}

const two = (value: number) => String(value).padStart(2, "0");

/** Label seragam "YYYY-MM-DD HH:00" menurut WIB untuk satu bucket. */
export function bucketLabel(instant: number, bucket: InsightBucket): string {
  const parts = wibParts(instant);
  const base = `${parts.year}-${two(parts.month + 1)}`;
  if (bucket === "month") return `${base}-01 00:00`;
  if (bucket === "day") return `${base}-${two(parts.day)} 00:00`;
  return `${base}-${two(parts.day)} ${two(parts.hour)}:00`;
}

export function chooseBucket(range: InsightRange): InsightBucket {
  const span = range.to.getTime() - range.from.getTime();
  if (span <= 36 * HOUR_MS) return "hour";
  if (span <= 92 * DAY_MS) return "day";
  return "month";
}

/** Semua label bucket dari awal sampai akhir rentang, berurutan, supaya deret tidak bolong. */
export function bucketLabels(range: InsightRange, bucket: InsightBucket): string[] {
  const labels: string[] = [];
  let cursor = range.from.getTime();
  const end = range.to.getTime();
  const guard = 400;
  while (cursor <= end && labels.length < guard) {
    const label = bucketLabel(cursor, bucket);
    if (labels[labels.length - 1] !== label) labels.push(label);
    if (bucket === "hour") cursor += HOUR_MS;
    else if (bucket === "day") cursor += DAY_MS;
    else {
      const parts = wibParts(cursor);
      cursor = Date.UTC(parts.year, parts.month + 1, 1) - WIB_OFFSET_MS + HOUR_MS;
    }
  }
  const last = bucketLabel(end, bucket);
  if (labels[labels.length - 1] !== last) labels.push(last);
  return labels;
}

const AGE_BRACKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "< 20", min: 15, max: 19 },
  { label: "20–24", min: 20, max: 24 },
  { label: "25–29", min: 25, max: 29 },
  { label: "30–34", min: 30, max: 34 },
  { label: "35–44", min: 35, max: 44 },
  { label: "45–54", min: 45, max: 54 },
  { label: "55+", min: 55, max: 80 }
];

export function ageOn(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (now.getUTCMonth() === dateOfBirth.getUTCMonth() && now.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

const MASK_NAME = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Penumpang";
  return parts.length === 1 ? parts[0]! : `${parts[0]} ${parts[1]!.charAt(0).toUpperCase()}.`;
};

export class AdminInsightsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly deps: InsightDeps
  ) {}

  async vipInsights(range: InsightRange, now: Date = new Date()) {
    const bucket = chooseBucket(range);
    const labels = bucketLabels(range, bucket);
    const length = range.to.getTime() - range.from.getTime();
    const previous: InsightRange = { from: new Date(range.from.getTime() - length - 1), to: new Date(range.from.getTime() - 1) };
    const inRange = { gte: range.from, lte: range.to };
    const inPrevious = { gte: previous.from, lte: previous.to };

    const [
      registrations,
      invoices,
      ppobRows,
      commissionRows,
      rideRows,
      tierCounts,
      memberships,
      registrationEvents,
      previousTotals,
      driverStatus,
      driverAvailability,
      driverRows,
      memberAddresses,
      pickupAddresses,
      ratingGroups,
      ratingAggregate,
      allTimeRating,
      topDrivers,
      attentionDrivers,
      recentRatings,
      attention,
      digiflazz,
      totalMembers
    ] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: { in: ["USER", "DRIVER"] }, createdAt: inRange },
        select: { createdAt: true, role: true },
        take: ROW_CAP
      }),
      this.prisma.invoice.findMany({
        where: {
          status: "PAID",
          OR: [{ paidAt: inRange }, { paidAt: null, createdAt: inRange }]
        },
        select: { amount: true, paidAt: true, createdAt: true },
        take: ROW_CAP
      }),
      this.prisma.ppobTransaction.findMany({
        where: { status: "SUCCESS", createdAt: inRange },
        select: { totalAmount: true, providerCost: true, createdAt: true },
        take: ROW_CAP
      }),
      this.prisma.commission.findMany({
        where: { type: "RIDE_COMPANY_REVENUE", status: { in: ["PENDING", "POSTED"] }, createdAt: inRange },
        select: { amount: true, createdAt: true },
        take: ROW_CAP
      }),
      this.prisma.rideOrder.findMany({
        where: { createdAt: inRange },
        select: { createdAt: true, status: true, serviceType: true },
        take: ROW_CAP
      }),
      this.prisma.user.groupBy({ by: ["membershipId"], where: { role: "USER", status: "ACTIVE" }, _count: { _all: true } }),
      this.prisma.membership.findMany({ select: { id: true, tier: true } }),
      this.prisma.registrationEvent.groupBy({
        by: ["distribution", "installer"],
        where: { createdAt: inRange },
        _count: { _all: true }
      }),
      this.previousTotals(previous, inPrevious),
      this.prisma.rideDriverProfile.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.rideDriverProfile.groupBy({ by: ["availability"], where: { status: "ACTIVE" }, _count: { _all: true } }),
      this.prisma.driver.findMany({
        where: { OR: [{ dateOfBirth: { not: null } }, { address: { not: null } }] },
        select: { dateOfBirth: true, address: true },
        take: ADDRESS_CAP
      }),
      this.prisma.membershipOrder.findMany({
        where: { status: "PAID" },
        select: { userId: true, registrationData: true },
        orderBy: { createdAt: "desc" },
        take: ADDRESS_CAP
      }),
      this.prisma.rideOrder.findMany({
        where: { createdAt: inRange },
        select: { pickupAddress: true },
        orderBy: { createdAt: "desc" },
        take: ADDRESS_CAP
      }),
      this.prisma.rideRating.groupBy({ by: ["stars"], where: { createdAt: inRange }, _count: { _all: true } }),
      this.prisma.rideRating.aggregate({ where: { createdAt: inRange }, _avg: { stars: true }, _count: { _all: true } }),
      this.prisma.rideRating.aggregate({ _avg: { stars: true }, _count: { _all: true } }),
      this.prisma.rideDriverProfile.findMany({
        // "Terbaik" hanya untuk yang benar-benar baik (>= 4,0); pengemudi di bawahnya masuk daftar perhatian.
        where: { status: "ACTIVE", ratingCount: { gte: 3 }, ratingAverage: { gte: 4 } },
        orderBy: [{ ratingAverage: "desc" }, { ratingCount: "desc" }],
        take: 5,
        select: { ratingAverage: true, ratingCount: true, user: { select: { fullName: true } } }
      }),
      this.prisma.rideDriverProfile.findMany({
        where: { status: "ACTIVE", ratingCount: { gte: 3 }, ratingAverage: { lt: 4 } },
        orderBy: [{ ratingAverage: "asc" }, { ratingCount: "desc" }],
        take: 5,
        select: { ratingAverage: true, ratingCount: true, user: { select: { fullName: true } } }
      }),
      this.prisma.rideRating.findMany({
        where: { note: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          stars: true,
          note: true,
          createdAt: true,
          rideOrder: { select: { serviceType: true, passenger: { select: { fullName: true } } } },
          driverProfile: { select: { user: { select: { fullName: true } } } }
        }
      }),
      this.attentionCounts(now),
      this.deps.digiflazz().catch(() => null),
      this.prisma.user.count({ where: { role: "USER" } })
    ]);

    // --- deret waktu (bucket WIB) ------------------------------------------------------------------------------
    const index = new Map(labels.map((label, position) => [label, position]));
    const zero = () => labels.map(() => 0);
    const registrationMembers = zero();
    const registrationDrivers = zero();
    for (const row of registrations) {
      const position = index.get(bucketLabel(row.createdAt.getTime(), bucket));
      if (position === undefined) continue;
      if (row.role === "DRIVER") registrationDrivers[position]! += 1;
      else registrationMembers[position]! += 1;
    }

    const membershipRevenue = zero();
    const ppobMargin = zero();
    const rideCommission = zero();
    let membershipTotal = 0;
    let ppobSalesTotal = 0;
    let ppobMarginTotal = 0;
    let ppobWithoutCost = 0;
    let rideCommissionTotal = 0;
    for (const row of invoices) {
      const at = (row.paidAt ?? row.createdAt).getTime();
      const position = index.get(bucketLabel(at, bucket));
      const amount = Number(row.amount);
      membershipTotal += amount;
      if (position !== undefined) membershipRevenue[position]! += amount;
    }
    for (const row of ppobRows) {
      const total = Number(row.totalAmount);
      ppobSalesTotal += total;
      if (row.providerCost === null) {
        ppobWithoutCost += 1;
        continue;
      }
      const margin = total - Number(row.providerCost);
      ppobMarginTotal += margin;
      const position = index.get(bucketLabel(row.createdAt.getTime(), bucket));
      if (position !== undefined) ppobMargin[position]! += margin;
    }
    for (const row of commissionRows) {
      const amount = Number(row.amount);
      rideCommissionTotal += amount;
      const position = index.get(bucketLabel(row.createdAt.getTime(), bucket));
      if (position !== undefined) rideCommission[position]! += amount;
    }

    const ridesTotal = zero();
    const ridesCompleted = zero();
    const heatmap: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    const statusCounts = new Map<string, number>();
    const serviceCounts = new Map<string, number>();
    for (const row of rideRows) {
      const position = index.get(bucketLabel(row.createdAt.getTime(), bucket));
      const done = row.status === "COMPLETED";
      if (position !== undefined) {
        ridesTotal[position]! += 1;
        if (done) ridesCompleted[position]! += 1;
      }
      const parts = wibParts(row.createdAt.getTime());
      heatmap[(parts.weekday + 6) % 7]![parts.hour]! += 1; // Senin = 0
      statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
      serviceCounts.set(row.serviceType, (serviceCounts.get(row.serviceType) ?? 0) + 1);
    }
    const ridesCompletedTotal = ridesCompleted.reduce((sum, value) => sum + value, 0);
    const cancelled = [...statusCounts.entries()].filter(([status]) => status.startsWith("CANCELLED")).reduce((sum, [, count]) => sum + count, 0);

    // --- komposisi ---------------------------------------------------------------------------------------------
    const tierByMembership = new Map(memberships.map((item) => [item.id, item.tier]));
    const tiers: Record<string, number> = { BASIC: 0, SILVER: 0, GOLD: 0, PLATINUM: 0 };
    for (const row of tierCounts) {
      const tier = row.membershipId ? tierByMembership.get(row.membershipId) : "BASIC";
      tiers[tier ?? "BASIC"]! += row._count._all;
    }
    const sources = { play: 0, other: 0, unknown: 0 };
    for (const row of registrationEvents) {
      const count = row._count._all;
      if (!row.distribution) sources.unknown += count;
      else if (row.distribution === "play" && row.installer === "com.android.vending") sources.play += count;
      else sources.other += count;
    }

    // --- wilayah dan usia --------------------------------------------------------------------------------------
    const seenMembers = new Set<string>();
    const memberAddressList: string[] = [];
    for (const order of memberAddresses) {
      if (seenMembers.has(order.userId)) continue;
      seenMembers.add(order.userId);
      const data = order.registrationData;
      const address = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).address : null;
      if (typeof address === "string") memberAddressList.push(address);
    }
    const ages = driverRows
      .map((row) => (row.dateOfBirth ? ageOn(row.dateOfBirth, now) : null))
      .filter((age): age is number => age !== null && age >= 15 && age <= 80);
    const ageBuckets = AGE_BRACKETS.map((bracket) => ({
      label: bracket.label,
      count: ages.filter((age) => age >= bracket.min && age <= bracket.max).length
    }));
    const driversWithAge = ages.length;

    // --- rating ------------------------------------------------------------------------------------------------
    const distribution = [1, 2, 3, 4, 5].map((stars) => ({
      stars,
      count: ratingGroups.find((group) => group.stars === stars)?._count._all ?? 0
    }));
    const round2 = (value: number | null | undefined) => (value === null || value === undefined ? null : Math.round(value * 100) / 100);
    const driverCard = (row: (typeof topDrivers)[number]) => ({
      name: row.user.fullName,
      average: round2(Number(row.ratingAverage)) ?? 0,
      count: row.ratingCount
    });

    const totalsNow = {
      registrations: registrations.length,
      revenue: membershipTotal + ppobMarginTotal + rideCommissionTotal,
      ridesCompleted: ridesCompletedTotal
    };

    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString(), bucket, labels },
      totals: {
        members: totalMembers,
        drivers: driverStatus.reduce((sum, row) => sum + row._count._all, 0),
        driversActive: driverStatus.find((row) => row.status === "ACTIVE")?._count._all ?? 0,
        driversOnline: driverAvailability.filter((row) => row.availability !== "OFFLINE").reduce((sum, row) => sum + row._count._all, 0),
        registrations: { current: totalsNow.registrations, previous: previousTotals.registrations },
        revenue: { current: totalsNow.revenue, previous: previousTotals.revenue },
        ridesCompleted: { current: totalsNow.ridesCompleted, previous: previousTotals.ridesCompleted },
        rating: { average: round2(allTimeRating._avg.stars), count: allTimeRating._count._all }
      },
      series: {
        registrations: { members: registrationMembers, drivers: registrationDrivers },
        revenue: { membership: membershipRevenue, ppobMargin, rideCommission },
        rides: { total: ridesTotal, completed: ridesCompleted }
      },
      revenueBreakdown: {
        membership: membershipTotal,
        ppobSales: ppobSalesTotal,
        ppobMargin: ppobMarginTotal,
        ppobWithoutCost,
        rideCommission: rideCommissionTotal
      },
      composition: {
        tiers: Object.entries(tiers).map(([tier, count]) => ({ tier, count })),
        signupSources: sources,
        rideStatus: [...statusCounts.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
        rideServices: [...serviceCounts.entries()].map(([type, count]) => ({ type, count })),
        driverStatus: driverStatus.map((row) => ({ status: row.status, count: row._count._all }))
      },
      rides: {
        total: rideRows.length,
        completed: ridesCompletedTotal,
        cancelled,
        completionRate: rideRows.length > 0 ? Math.round((ridesCompletedTotal / rideRows.length) * 1000) / 10 : null,
        heatmap
      },
      regions: {
        members: tallyRegions(memberAddressList),
        drivers: tallyRegions(driverRows.map((row) => row.address)),
        pickups: tallyRegions(pickupAddresses.map((row) => row.pickupAddress))
      },
      driverAges: {
        buckets: ageBuckets,
        counted: driversWithAge,
        unknown: driverRows.length - driversWithAge,
        average: driversWithAge > 0 ? Math.round((ages.reduce((sum, age) => sum + age, 0) / driversWithAge) * 10) / 10 : null,
        youngest: driversWithAge > 0 ? Math.min(...ages) : null,
        oldest: driversWithAge > 0 ? Math.max(...ages) : null
      },
      ratings: {
        periodAverage: round2(ratingAggregate._avg.stars),
        periodCount: ratingAggregate._count._all,
        distribution,
        topDrivers: topDrivers.map(driverCard),
        attentionDrivers: attentionDrivers.map(driverCard),
        recent: recentRatings.map((row) => ({
          stars: row.stars,
          note: row.note,
          createdAt: row.createdAt.toISOString(),
          driverName: row.driverProfile.user.fullName,
          passengerName: MASK_NAME(row.rideOrder.passenger.fullName),
          service: row.rideOrder.serviceType
        }))
      },
      attention: {
        ...attention,
        digiflazz: digiflazz ? { level: digiflazz.level, balance: digiflazz.balance } : null
      },
      notes: [
        "Lokasi pengunduhan aplikasi tidak tersimpan di database TapGo; angka itu hanya ada di Google Play Console. Yang ditampilkan di sini adalah sumber pendaftaran (Play atau di luar Play) dan wilayah dari alamat.",
        "Wilayah dibaca dari alamat yang diketik atau hasil geocoder, jadi perkiraan; alamat tanpa nama kota yang jelas dihitung sebagai tidak terbaca.",
        "Usia hanya tersedia untuk pengemudi (tanggal lahir di data pengajuan). Usia member dan penumpang tidak dikumpulkan.",
        "Pendapatan di sini kotor (belum dikurangi PPN dan biaya); angka akuntansi ada di Laba Rugi."
      ]
    };
  }

  /** Total periode sebelumnya (rentang sama panjang) untuk perbandingan kenaikan/penurunan. */
  private async previousTotals(_range: InsightRange, inPrevious: { gte: Date; lte: Date }) {
    const [registrations, invoices, ppobCosted, commissions, rides] = await Promise.all([
      this.prisma.user.count({ where: { role: { in: ["USER", "DRIVER"] }, createdAt: inPrevious } }),
      this.prisma.invoice.aggregate({
        where: { status: "PAID", OR: [{ paidAt: inPrevious }, { paidAt: null, createdAt: inPrevious }] },
        _sum: { amount: true }
      }),
      // Selisih hanya dari transaksi yang modalnya tercatat, sama dengan periode berjalan.
      this.prisma.ppobTransaction.aggregate({ where: { status: "SUCCESS", providerCost: { not: null }, createdAt: inPrevious }, _sum: { totalAmount: true, providerCost: true } }),
      this.prisma.commission.aggregate({
        where: { type: "RIDE_COMPANY_REVENUE", status: { in: ["PENDING", "POSTED"] }, createdAt: inPrevious },
        _sum: { amount: true }
      }),
      this.prisma.rideOrder.count({ where: { status: "COMPLETED", createdAt: inPrevious } })
    ]);
    const dec = (value: Prisma.Decimal | null | undefined) => Number(value ?? 0);
    const margin = dec(ppobCosted._sum.totalAmount) - dec(ppobCosted._sum.providerCost);
    return {
      registrations,
      revenue: dec(invoices._sum.amount) + margin + dec(commissions._sum.amount),
      ridesCompleted: rides
    };
  }

  /** Hal yang butuh keputusan atau tindakan, supaya Beranda menunjukkan pekerjaan tanpa membuka tiap halaman. */
  private async attentionCounts(now: Date) {
    const stuckBefore = new Date(now.getTime() - PPOB_STUCK_AFTER_MS);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const [stuckPpob, withdrawals, memberRequests, driverApplications, overduePayments, openTickets, lowRatings] = await Promise.all([
      this.prisma.ppobTransaction.count({ where: { status: { in: ["PENDING", "PROCESSING"] }, createdAt: { lt: stuckBefore } } }),
      this.prisma.withdrawal.aggregate({ where: { status: "PENDING" }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.membershipOrder.count({ where: { status: "PAID", userMembership: null } }),
      this.prisma.rideDriverProfile.count({ where: { status: "PENDING" } }),
      this.prisma.walletTopUpOrder.count({ where: { status: "PENDING", provider: { in: ["MIDTRANS", "DOKU"] }, expiresAt: { lt: now } } }),
      this.prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      this.prisma.rideRating.count({ where: { stars: { lte: 2 }, createdAt: { gte: weekAgo } } })
    ]);
    return {
      stuckPpob,
      withdrawalsPending: withdrawals._count._all,
      withdrawalsPendingAmount: Number(withdrawals._sum.amount ?? 0),
      memberRequestsAwaiting: memberRequests,
      driverApplicationsPending: driverApplications,
      overdueOnlinePayments: overduePayments,
      openSupportTickets: openTickets,
      lowRatingsThisWeek: lowRatings
    };
  }
}
