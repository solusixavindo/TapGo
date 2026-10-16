import { DriverIncentiveClaimStatus, Prisma, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { haversineMeters } from "../infrastructure/LocalDistanceAdapter.js";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_RULES = 10;
export const INCENTIVE_MIN_BONUS = 1_000;
export const INCENTIVE_MAX_BONUS = 500_000;

// ---- Ambang anti-kecurangan (lihat DriverIncentiveService.analyzeDay) ---------------------------------------------
/** Perjalanan yang lebih singkat dari ini (mulai -> selesai) tidak dihitung: pesanan rekayasa biasanya diselesaikan seketika. */
export const INCENTIVE_MIN_TRIP_SECONDS = 180;
/** Jarak rencana minimum perjalanan yang dihitung. */
export const INCENTIVE_MIN_PLANNED_METERS = 800;
/** Jejak GPS driver selama perjalanan harus bergerak setidaknya sejauh ini dari titik pertamanya. */
export const INCENTIVE_MIN_MOVEMENT_METERS = 300;
/** Penumpang yang sama sudah >= sekian kali bepergian dengan driver ini dalam 6 hari sebelumnya: tidak dihitung lagi. */
export const INCENTIVE_MAX_REPEAT_PAIR_TRIPS = 3;
const NEW_ACCOUNT_HOURS = 72;
const HIGH_VOLUME_TRIPS = 30;
const SUSPICIOUS_SHARE = 0.5;

/** Hari kalender WIB (UTC+7, tanpa DST): kunci "YYYY-MM-DD" dan batas [start, end) dalam UTC. */
export function wibDay(date: Date) {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS);
  return wibDayFromKey(shifted.toISOString().slice(0, 10));
}

export function wibDayFromKey(key: string) {
  const start = new Date(Date.parse(`${key}T00:00:00.000Z`) - WIB_OFFSET_MS);
  return { key, start, end: new Date(start.getTime() + DAY_MS) };
}

type RuleRow = Prisma.DriverIncentiveRuleGetPayload<object>;
type Day = { key: string; start: Date; end: Date };

function isEffective(rule: RuleRow, now: Date) {
  if (!rule.isActive) return false;
  if (rule.startsAt && rule.startsAt > now) return false;
  if (rule.endsAt && rule.endsAt <= now) return false;
  return true;
}

export type IncentiveRuleInput = {
  name: string;
  targetTrips: number;
  bonusAmount: number;
  minTripFare?: number;
  dailyBudget?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  isActive?: boolean;
};

type EligibleOrder = {
  id: string;
  passengerId: string;
  cluster: string;
  totalFare: number;
  completedAt: Date;
  routeCell: string;
};

type DayAnalysis = {
  eligible: EligibleOrder[];
  passengerInfo: Map<string, { createdAt: Date; verified: boolean }>;
  totalTripsToday: number;
  priorFraud: boolean;
};

const CLAIM_COUNTS_AGAINST_BUDGET: DriverIncentiveClaimStatus[] = ["PENDING", "REVIEW", "PAID"];

/**
 * Insentif harian driver: selesaikan N perjalanan SAH (tarif >= minimum) dalam satu hari WIB, dapatkan bonus.
 *
 * ALUR UANG. Bonus tidak pernah langsung masuk saldo. Saat target tercapai dibuat klaim PENDING (atau REVIEW bila ada
 * tanda kecurigaan). Setelah masa tahan (INCENTIVE_HOLD_HOURS), setiap perjalanan diverifikasi ULANG (masih selesai,
 * belum dikembalikan dananya, masih lolos semua syarat anti-kecurangan); baru lalu dikreditkan ke saldo yang dapat
 * ditarik. Klaim REVIEW hanya dibayar bila Super Admin menyetujui. Bonus yang sudah dibayar dapat ditarik kembali
 * oleh Super Admin. Klaim unik per (aturan, driver, hari), jadi evaluasi berulang tidak pernah membayar dua kali, dan
 * anggaran harian dijaga dengan mengunci baris aturan.
 *
 * ANTI-KECURANGAN (pesanan rekayasa; pesanan TUNAI tidak memindahkan uang sungguhan, sedangkan bonus adalah uang nyata).
 * Perjalanan DIHITUNG hanya bila: selesai; tarif >= minimum aturan; jarak rencana cukup; mulai -> selesai >= 3 menit;
 * jejak GPS driver selama perjalanan benar-benar bergerak; penumpang bukan sponsor/downline driver; penumpang tidak berbagi
 * perangkat dengan akun driver; belum menjadi penumpang langganan driver ini (>=3 perjalanan dalam 6 hari sebelumnya).
 * Penumpang yang berbagi perangkat satu sama lain dihitung SATU (satu HP banyak akun = satu penumpang).
 * Tanda kecurigaan (menahan klaim untuk tinjauan): mayoritas penumpang akun baru (<72 jam) atau belum terverifikasi,
 * pola rute yang sama berulang, volume perjalanan tidak wajar, atau driver pernah punya klaim ditolak/ditarik kembali.
 */
export class DriverIncentiveService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly holdHours: number = env.INCENTIVE_HOLD_HOURS
  ) {}

  // ---------------------------------------------------------------- Admin

  async listRules() {
    const rules = await this.prisma.driverIncentiveRule.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] });
    const today = wibDay(new Date()).key;
    const claimsToday = await this.prisma.driverIncentiveClaim.groupBy({
      by: ["ruleId"],
      where: { dayKey: today, status: { in: CLAIM_COUNTS_AGAINST_BUDGET } },
      _sum: { amount: true },
      _count: { _all: true }
    });
    const byRule = new Map(claimsToday.map((row) => [row.ruleId, row]));
    return rules.map((rule) => ({
      ...this.formatRule(rule),
      paidTodayCount: byRule.get(rule.id)?._count._all ?? 0,
      paidTodayAmount: Number(byRule.get(rule.id)?._sum.amount ?? 0)
    }));
  }

  async createRule(input: IncentiveRuleInput, actorId: string) {
    this.assertValid(input);
    if (input.isActive !== false) await this.assertRoomForActiveRule();
    const rule = await this.prisma.$transaction(async (tx) => {
      const created = await tx.driverIncentiveRule.create({
        data: {
          name: input.name.trim(),
          targetTrips: input.targetTrips,
          bonusAmount: new Prisma.Decimal(input.bonusAmount),
          minTripFare: new Prisma.Decimal(input.minTripFare ?? 0),
          dailyBudget: input.dailyBudget != null ? new Prisma.Decimal(input.dailyBudget) : null,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          isActive: input.isActive ?? true,
          createdById: actorId
        }
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "DRIVER_INCENTIVE_RULE_CREATED",
          entityType: "DriverIncentiveRule",
          entityId: created.id,
          metadata: { name: created.name, targetTrips: created.targetTrips, bonusAmount: Number(created.bonusAmount) }
        }
      });
      return created;
    });
    return this.formatRule(rule);
  }

  async updateRule(id: string, patch: Partial<IncentiveRuleInput>, actorId: string) {
    const existing = await this.prisma.driverIncentiveRule.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError("Aturan insentif tidak ditemukan", StatusCodes.NOT_FOUND, "INCENTIVE_RULE_NOT_FOUND");
    }
    const merged: IncentiveRuleInput = {
      name: patch.name ?? existing.name,
      targetTrips: patch.targetTrips ?? existing.targetTrips,
      bonusAmount: patch.bonusAmount ?? Number(existing.bonusAmount),
      minTripFare: patch.minTripFare ?? Number(existing.minTripFare),
      dailyBudget: patch.dailyBudget !== undefined ? patch.dailyBudget : existing.dailyBudget ? Number(existing.dailyBudget) : null,
      startsAt: patch.startsAt !== undefined ? patch.startsAt : existing.startsAt,
      endsAt: patch.endsAt !== undefined ? patch.endsAt : existing.endsAt,
      isActive: patch.isActive ?? existing.isActive
    };
    this.assertValid(merged);
    if (merged.isActive && !existing.isActive) await this.assertRoomForActiveRule();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.driverIncentiveRule.update({
        where: { id },
        data: {
          name: merged.name.trim(),
          targetTrips: merged.targetTrips,
          bonusAmount: new Prisma.Decimal(merged.bonusAmount),
          minTripFare: new Prisma.Decimal(merged.minTripFare ?? 0),
          dailyBudget: merged.dailyBudget != null ? new Prisma.Decimal(merged.dailyBudget) : null,
          startsAt: merged.startsAt ?? null,
          endsAt: merged.endsAt ?? null,
          isActive: merged.isActive ?? true
        }
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "DRIVER_INCENTIVE_RULE_UPDATED",
          entityType: "DriverIncentiveRule",
          entityId: id,
          metadata: JSON.parse(JSON.stringify({ patch })) as Prisma.InputJsonValue
        }
      });
      return row;
    });
    return this.formatRule(updated);
  }

  /** Daftar klaim untuk tinjauan admin. Tanpa filter: yang perlu tindakan (REVIEW) dan yang masih menunggu (PENDING). */
  async listClaims(status?: DriverIncentiveClaimStatus) {
    const claims = await this.prisma.driverIncentiveClaim.findMany({
      where: status ? { status } : { status: { in: ["REVIEW", "PENDING"] } },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: { rule: { select: { name: true } } }
    });
    const profiles = await this.prisma.rideDriverProfile.findMany({
      where: { id: { in: claims.map((claim) => claim.driverProfileId) } },
      select: { id: true, user: { select: { fullName: true, phone: true } } }
    });
    const byProfile = new Map(profiles.map((profile) => [profile.id, profile.user]));
    return claims.map((claim) => ({
      id: claim.id,
      ruleName: claim.rule.name,
      dayKey: claim.dayKey,
      tripCount: claim.tripCount,
      amount: Number(claim.amount),
      status: claim.status,
      flags: Array.isArray(claim.flags) ? (claim.flags as string[]) : [],
      settleAfter: claim.settleAfter,
      settledAt: claim.settledAt,
      reviewNote: claim.reviewNote,
      createdAt: claim.createdAt,
      driver: { fullName: byProfile.get(claim.driverProfileId)?.fullName ?? "-", phone: byProfile.get(claim.driverProfileId)?.phone ?? "" }
    }));
  }

  /** Menyetujui klaim yang ditahan: diverifikasi ulang (syarat keras tetap berlaku), lalu dibayar. */
  async approveClaim(claimId: string, actorId: string, note?: string) {
    const outcome = await this.settleClaim(claimId, new Date(), { adminApproval: { actorId, note } });
    if (!outcome) throw this.claimNotActionable();
    return outcome;
  }

  async rejectClaim(claimId: string, actorId: string, note: string) {
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      throw new AppError("Tulis alasan penolakan (minimal 3 huruf).", StatusCodes.BAD_REQUEST, "INCENTIVE_NOTE_REQUIRED");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM driver_incentive_claims WHERE id = ${claimId}::uuid FOR UPDATE`;
      const claim = await tx.driverIncentiveClaim.findUnique({ where: { id: claimId } });
      if (!claim) throw new AppError("Klaim tidak ditemukan", StatusCodes.NOT_FOUND, "INCENTIVE_CLAIM_NOT_FOUND");
      if (claim.status !== "PENDING" && claim.status !== "REVIEW") throw this.claimNotActionable();
      const updated = await tx.driverIncentiveClaim.update({
        where: { id: claimId },
        data: { status: "REJECTED", settledAt: new Date(), reviewedById: actorId, reviewNote: trimmed.slice(0, 280) }
      });
      await tx.auditLog.create({
        data: { actorId, action: "DRIVER_INCENTIVE_CLAIM_REJECTED", entityType: "DriverIncentiveClaim", entityId: claimId, metadata: { note: trimmed.slice(0, 280) } }
      });
      return { id: updated.id, status: updated.status };
    });
  }

  /** Menarik kembali bonus yang sudah dibayar (mis. ditemukan kecurangan setelahnya). Hanya bila saldo cukup. */
  async reverseClaim(claimId: string, actorId: string, note: string) {
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      throw new AppError("Tulis alasan penarikan kembali (minimal 3 huruf).", StatusCodes.BAD_REQUEST, "INCENTIVE_NOTE_REQUIRED");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM driver_incentive_claims WHERE id = ${claimId}::uuid FOR UPDATE`;
      const claim = await tx.driverIncentiveClaim.findUnique({ where: { id: claimId } });
      if (!claim) throw new AppError("Klaim tidak ditemukan", StatusCodes.NOT_FOUND, "INCENTIVE_CLAIM_NOT_FOUND");
      if (claim.status !== "PAID") throw this.claimNotActionable();
      const debited = await tx.wallet.updateMany({
        where: { userId: claim.userId, cashBalance: { gte: claim.amount }, balance: { gte: claim.amount } },
        data: { cashBalance: { decrement: claim.amount }, balance: { decrement: claim.amount } }
      });
      if (debited.count !== 1) {
        throw new AppError(
          "Saldo driver yang dapat ditarik tidak cukup untuk menarik kembali bonus ini.",
          StatusCodes.CONFLICT,
          "INCENTIVE_REVERSE_INSUFFICIENT"
        );
      }
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: claim.userId }, select: { id: true } });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "ADJUSTMENT",
          amount: claim.amount.neg(),
          referenceType: "DRIVER_INCENTIVE_REVERSAL",
          referenceId: claim.id,
          metadata: { dayKey: claim.dayKey, note: trimmed.slice(0, 280) }
        }
      });
      const updated = await tx.driverIncentiveClaim.update({
        where: { id: claimId },
        data: { status: "REVERSED", reviewedById: actorId, reviewNote: trimmed.slice(0, 280) }
      });
      await tx.auditLog.create({
        data: { actorId, action: "DRIVER_INCENTIVE_CLAIM_REVERSED", entityType: "DriverIncentiveClaim", entityId: claimId, metadata: { note: trimmed.slice(0, 280), amount: Number(claim.amount) } }
      });
      return { id: updated.id, status: updated.status };
    });
  }

  // --------------------------------------------------------------- Driver

  /** Progres hari ini untuk driver. Sebelumnya klaim jatuh tempo milik driver ini dicairkan dan klaim yang tertinggal dibuat. */
  async progressForDriver(driverProfileId: string, userId: string, now = new Date()) {
    await this.settleDueClaims(now, driverProfileId).catch(() => undefined);
    await this.evaluateForDriver(driverProfileId, userId, now).catch(() => undefined);
    const day = wibDay(now);
    const rules = (await this.prisma.driverIncentiveRule.findMany({ orderBy: { targetTrips: "asc" } })).filter((rule) =>
      isEffective(rule, now)
    );
    const [claims, waiting] = await Promise.all([
      this.prisma.driverIncentiveClaim.findMany({ where: { driverProfileId, dayKey: day.key } }),
      this.prisma.driverIncentiveClaim.aggregate({
        where: { driverProfileId, status: { in: ["PENDING", "REVIEW"] } },
        _sum: { amount: true },
        _count: { _all: true }
      })
    ]);
    const claimByRule = new Map(claims.map((claim) => [claim.ruleId, claim]));
    const analysis = rules.length > 0 ? await this.analyzeDay(driverProfileId, userId, day) : null;
    const items = [];
    for (const rule of rules) {
      const claim = claimByRule.get(rule.id);
      const tripCount = analysis ? this.countForRule(analysis, rule).count : 0;
      let budgetExhausted = false;
      if (rule.dailyBudget && !claim) {
        const paid = await this.prisma.driverIncentiveClaim.aggregate({
          where: { ruleId: rule.id, dayKey: day.key, status: { in: CLAIM_COUNTS_AGAINST_BUDGET } },
          _sum: { amount: true }
        });
        budgetExhausted = new Prisma.Decimal(paid._sum.amount ?? 0).plus(rule.bonusAmount).gt(rule.dailyBudget);
      }
      items.push({
        ruleId: rule.id,
        name: rule.name,
        targetTrips: rule.targetTrips,
        bonusAmount: Number(rule.bonusAmount),
        minTripFare: Number(rule.minTripFare),
        tripCount: Math.min(tripCount, rule.targetTrips),
        // PENDING/REVIEW = target tercapai, menunggu verifikasi; PAID = sudah masuk saldo; null = belum ada klaim.
        claimStatus: claim?.status ?? null,
        claimed: claim?.status === "PAID",
        budgetExhausted
      });
    }
    return {
      dayKey: day.key,
      holdHours: this.holdHours,
      waiting: { count: waiting._count._all, amount: Number(waiting._sum.amount ?? 0) },
      items
    };
  }

  /** Membuat klaim untuk aturan yang targetnya sudah tercapai (belum ada uang yang bergerak). Mengembalikan jumlah klaim baru. */
  async evaluateForDriver(driverProfileId: string, userId: string, now = new Date()) {
    const day = wibDay(now);
    const rules = (await this.prisma.driverIncentiveRule.findMany()).filter((rule) => isEffective(rule, now));
    if (rules.length === 0) return 0;
    const analysis = await this.analyzeDay(driverProfileId, userId, day);
    let created = 0;
    for (const rule of rules) {
      const result = this.countForRule(analysis, rule);
      if (result.count < rule.targetTrips) continue;
      if (await this.createClaim(rule, driverProfileId, userId, day.key, result, now)) created += 1;
    }
    return created;
  }

  /** Mencairkan klaim PENDING yang sudah lewat masa tahan (verifikasi ulang dulu). Dipanggil berkala dan saat driver membuka progres. */
  async settleDueClaims(now = new Date(), driverProfileId?: string, limit = 100) {
    const due = await this.prisma.driverIncentiveClaim.findMany({
      where: { status: "PENDING", settleAfter: { lte: now }, ...(driverProfileId ? { driverProfileId } : {}) },
      orderBy: { settleAfter: "asc" },
      take: limit,
      select: { id: true }
    });
    let settled = 0;
    for (const row of due) {
      try {
        const outcome = await this.settleClaim(row.id, now, {});
        if (outcome?.status === "PAID") settled += 1;
      } catch {
        // Satu klaim bermasalah tidak menghentikan yang lain; dicoba lagi pada putaran berikutnya.
      }
    }
    return settled;
  }

  // ------------------------------------------------------------- Internal

  /**
   * Menganalisis perjalanan driver pada satu hari WIB: menyaring perjalanan yang sah (syarat keras) dan menyiapkan data
   * untuk tanda kecurigaan. Hasilnya dipakai semua aturan hari itu (tarif minimum diterapkan per aturan sesudahnya).
   */
  private async analyzeDay(driverProfileId: string, driverUserId: string, day: Day): Promise<DayAnalysis> {
    const orders = await this.prisma.rideOrder.findMany({
      where: {
        driverProfileId,
        status: "COMPLETED",
        completedAt: { gte: day.start, lt: day.end },
        startedAt: { not: null },
        paymentState: { not: "DIGITAL_REFUNDED" }
      },
      orderBy: { completedAt: "asc" },
      take: 500,
      select: {
        id: true,
        passengerId: true,
        totalFare: true,
        startedAt: true,
        completedAt: true,
        distanceMeters: true,
        pickupLat: true,
        pickupLng: true,
        dropoffLat: true,
        dropoffLng: true
      }
    });
    const base = orders.filter(
      (order) =>
        order.startedAt &&
        order.completedAt &&
        (order.completedAt.getTime() - order.startedAt.getTime()) / 1000 >= INCENTIVE_MIN_TRIP_SECONDS &&
        order.distanceMeters >= INCENTIVE_MIN_PLANNED_METERS
    );
    const empty: DayAnalysis = { eligible: [], passengerInfo: new Map(), totalTripsToday: orders.length, priorFraud: false };
    if (base.length === 0) return empty;

    const passengerIds = Array.from(new Set(base.map((order) => order.passengerId)));
    const orderIds = base.map((order) => order.id);
    const [locations, users, referrals, driverTokens, passengerTokens, repeats, prior] = await Promise.all([
      this.prisma.rideDriverLocation.findMany({
        where: { rideOrderId: { in: orderIds } },
        orderBy: { capturedAt: "asc" },
        take: 20_000,
        select: { rideOrderId: true, lat: true, lng: true }
      }),
      this.prisma.user.findMany({
        where: { id: { in: passengerIds } },
        select: { id: true, createdAt: true, phoneVerifiedAt: true, emailVerifiedAt: true }
      }),
      this.prisma.referral.findMany({
        where: {
          OR: [
            { userId: driverUserId, sponsorId: { in: passengerIds } },
            { sponsorId: driverUserId, userId: { in: passengerIds } }
          ]
        },
        select: { userId: true, sponsorId: true }
      }),
      this.prisma.pushToken.findMany({ where: { userId: driverUserId, deviceId: { not: null } }, select: { deviceId: true } }),
      this.prisma.pushToken.findMany({ where: { userId: { in: passengerIds }, deviceId: { not: null } }, select: { userId: true, deviceId: true } }),
      this.prisma.rideOrder.groupBy({
        by: ["passengerId"],
        where: {
          driverProfileId,
          status: "COMPLETED",
          passengerId: { in: passengerIds },
          completedAt: { gte: new Date(day.start.getTime() - 6 * DAY_MS), lt: day.start }
        },
        _count: { _all: true }
      }),
      this.prisma.driverIncentiveClaim.count({
        where: {
          driverProfileId,
          status: { in: ["REJECTED", "REVERSED"] },
          createdAt: { gte: new Date(day.start.getTime() - 30 * DAY_MS) }
        }
      })
    ]);

    // Jejak GPS: titik pertama sebagai acuan, lalu jarak terjauh yang pernah dicapai selama perjalanan.
    const trail = new Map<string, { first: { lat: number; lng: number }; maxMeters: number; samples: number }>();
    for (const point of locations) {
      if (!point.rideOrderId) continue;
      const here = { lat: Number(point.lat), lng: Number(point.lng) };
      const entry = trail.get(point.rideOrderId);
      if (!entry) trail.set(point.rideOrderId, { first: here, maxMeters: 0, samples: 1 });
      else {
        entry.samples += 1;
        entry.maxMeters = Math.max(entry.maxMeters, haversineMeters(entry.first, here));
      }
    }

    // Penumpang yang dikecualikan keras: keluarga referral driver atau berbagi perangkat dengan akun driver.
    const excluded = new Set<string>();
    for (const row of referrals) excluded.add(row.userId === driverUserId ? row.sponsorId : row.userId);
    for (const row of repeats) if (row._count._all >= INCENTIVE_MAX_REPEAT_PAIR_TRIPS) excluded.add(row.passengerId);
    const driverDevices = new Set(driverTokens.map((row) => row.deviceId!));
    const devicesByUser = new Map<string, Set<string>>();
    for (const row of passengerTokens) {
      if (driverDevices.has(row.deviceId!)) excluded.add(row.userId);
      const set = devicesByUser.get(row.userId) ?? new Set<string>();
      set.add(row.deviceId!);
      devicesByUser.set(row.userId, set);
    }

    // Kelompok perangkat: penumpang yang berbagi perangkat (langsung atau berantai) dihitung satu.
    const parent = new Map<string, string>(passengerIds.map((id) => [id, id]));
    const find = (id: string): string => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root)!;
      parent.set(id, root);
      return root;
    };
    const ownerOfDevice = new Map<string, string>();
    for (const [userId, devices] of devicesByUser) {
      for (const device of devices) {
        const other = ownerOfDevice.get(device);
        if (other === undefined) ownerOfDevice.set(device, userId);
        else parent.set(find(userId), find(other));
      }
    }

    const eligible: EligibleOrder[] = [];
    for (const order of base) {
      if (excluded.has(order.passengerId)) continue;
      const moved = trail.get(order.id);
      if (!moved || moved.samples < 2 || moved.maxMeters < INCENTIVE_MIN_MOVEMENT_METERS) continue;
      const cell = (lat: Prisma.Decimal, lng: Prisma.Decimal) => `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
      eligible.push({
        id: order.id,
        passengerId: order.passengerId,
        cluster: find(order.passengerId),
        totalFare: order.totalFare,
        completedAt: order.completedAt!,
        routeCell: `${cell(order.pickupLat, order.pickupLng)}>${cell(order.dropoffLat, order.dropoffLng)}`
      });
    }
    const passengerInfo = new Map(
      users.map((user) => [user.id, { createdAt: user.createdAt, verified: user.phoneVerifiedAt !== null || user.emailVerifiedAt !== null }])
    );
    return { eligible, passengerInfo, totalTripsToday: orders.length, priorFraud: prior > 0 };
  }

  /** Perjalanan yang dihitung untuk satu aturan (satu per kelompok penumpang) dan tanda kecurigaannya. */
  private countForRule(analysis: DayAnalysis, rule: RuleRow) {
    const minFare = Math.ceil(Number(rule.minTripFare));
    const byCluster = new Map<string, EligibleOrder>();
    for (const order of analysis.eligible) {
      if (order.totalFare < minFare) continue;
      if (!byCluster.has(order.cluster)) byCluster.set(order.cluster, order);
    }
    const counted = Array.from(byCluster.values());
    const flags: string[] = [];
    if (counted.length > 0) {
      const share = (predicate: (order: EligibleOrder) => boolean) => counted.filter(predicate).length / counted.length;
      const newAccount = (order: EligibleOrder) => {
        const info = analysis.passengerInfo.get(order.passengerId);
        return !info || order.completedAt.getTime() - info.createdAt.getTime() < NEW_ACCOUNT_HOURS * 3600_000;
      };
      const unverified = (order: EligibleOrder) => !(analysis.passengerInfo.get(order.passengerId)?.verified ?? false);
      if (share(newAccount) >= SUSPICIOUS_SHARE) flags.push("NEW_ACCOUNTS");
      if (share(unverified) >= SUSPICIOUS_SHARE) flags.push("UNVERIFIED_PASSENGERS");
      if (counted.length >= 3) {
        const cells = new Map<string, number>();
        for (const order of counted) cells.set(order.routeCell, (cells.get(order.routeCell) ?? 0) + 1);
        if (Math.max(...cells.values()) / counted.length >= 0.6) flags.push("SAME_ROUTE");
      }
    }
    if (analysis.totalTripsToday >= HIGH_VOLUME_TRIPS) flags.push("HIGH_VOLUME");
    if (analysis.priorFraud) flags.push("PRIOR_FRAUD");
    return { count: counted.length, countedOrderIds: counted.map((order) => order.id), flags };
  }

  private async createClaim(
    rule: RuleRow,
    driverProfileId: string,
    userId: string,
    dayKey: string,
    result: { count: number; countedOrderIds: string[]; flags: string[] },
    now: Date
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Kunci aturan agar pengecekan anggaran harian dan penulisan klaim tidak balapan antar driver.
        await tx.$queryRaw`SELECT id FROM driver_incentive_rules WHERE id = ${rule.id}::uuid FOR UPDATE`;
        const existing = await tx.driverIncentiveClaim.findUnique({
          where: { ruleId_driverProfileId_dayKey: { ruleId: rule.id, driverProfileId, dayKey } },
          select: { id: true }
        });
        if (existing) return false;
        if (rule.dailyBudget) {
          const reserved = await tx.driverIncentiveClaim.aggregate({
            where: { ruleId: rule.id, dayKey, status: { in: CLAIM_COUNTS_AGAINST_BUDGET } },
            _sum: { amount: true }
          });
          if (new Prisma.Decimal(reserved._sum.amount ?? 0).plus(rule.bonusAmount).gt(rule.dailyBudget)) return false;
        }
        await tx.driverIncentiveClaim.create({
          data: {
            ruleId: rule.id,
            driverProfileId,
            userId,
            dayKey,
            tripCount: result.count,
            amount: rule.bonusAmount,
            status: result.flags.length > 0 ? "REVIEW" : "PENDING",
            settleAfter: new Date(now.getTime() + this.holdHours * 3600_000),
            countedOrderIds: result.countedOrderIds,
            ...(result.flags.length > 0 ? { flags: result.flags } : {})
          }
        });
        return true;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  }

  /**
   * Mencairkan satu klaim: verifikasi ulang SEMUA syarat atas perjalanan hari itu, lalu kredit saldo yang dapat ditarik.
   * Tanpa persetujuan admin hanya klaim PENDING yang lolos tanpa tanda kecurigaan yang dibayar; tanda baru memindahkannya ke REVIEW.
   */
  private async settleClaim(
    claimId: string,
    now: Date,
    options: { adminApproval?: { actorId: string; note?: string | undefined } }
  ) {
    const probe = await this.prisma.driverIncentiveClaim.findUnique({ where: { id: claimId }, include: { rule: true } });
    if (!probe) throw new AppError("Klaim tidak ditemukan", StatusCodes.NOT_FOUND, "INCENTIVE_CLAIM_NOT_FOUND");
    const actionable = options.adminApproval ? ["PENDING", "REVIEW"] : ["PENDING"];
    if (!actionable.includes(probe.status)) return null;
    // Analisis dilakukan di luar transaksi (banyak baca); hasilnya diperiksa ulang terhadap status klaim di bawah kunci.
    const profile = await this.prisma.rideDriverProfile.findUniqueOrThrow({ where: { id: probe.driverProfileId }, select: { userId: true } });
    const analysis = await this.analyzeDay(probe.driverProfileId, profile.userId, wibDayFromKey(probe.dayKey));
    const result = this.countForRule(analysis, probe.rule);
    const stillQualifies = result.count >= probe.rule.targetTrips;

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM driver_incentive_claims WHERE id = ${claimId}::uuid FOR UPDATE`;
      const claim = await tx.driverIncentiveClaim.findUniqueOrThrow({ where: { id: claimId } });
      if (!actionable.includes(claim.status)) return null;

      if (!stillQualifies) {
        const rejected = await tx.driverIncentiveClaim.update({
          where: { id: claimId },
          data: {
            status: "REJECTED",
            settledAt: now,
            reviewNote: "Tidak lagi memenuhi syarat saat verifikasi ulang.",
            ...(options.adminApproval ? { reviewedById: options.adminApproval.actorId } : {})
          }
        });
        return { id: rejected.id, status: rejected.status };
      }
      if (!options.adminApproval && result.flags.length > 0) {
        const held = await tx.driverIncentiveClaim.update({ where: { id: claimId }, data: { status: "REVIEW", flags: result.flags } });
        return { id: held.id, status: held.status };
      }

      const wallet = await tx.wallet.upsert({
        where: { userId: claim.userId },
        update: {},
        create: { userId: claim.userId, balance: new Prisma.Decimal(0), cashBalance: new Prisma.Decimal(0), ppobBalance: new Prisma.Decimal(0), currency: "IDR" },
        select: { id: true }
      });
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { cashBalance: { increment: claim.amount }, balance: { increment: claim.amount } }
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "INCENTIVE_BONUS",
          amount: claim.amount,
          referenceType: "DRIVER_INCENTIVE",
          referenceId: claim.id,
          metadata: { ruleId: claim.ruleId, ruleName: probe.rule.name, dayKey: claim.dayKey, tripCount: result.count }
        }
      });
      const paid = await tx.driverIncentiveClaim.update({
        where: { id: claimId },
        data: {
          status: "PAID",
          settledAt: now,
          tripCount: result.count,
          countedOrderIds: result.countedOrderIds,
          ...(options.adminApproval
            ? { reviewedById: options.adminApproval.actorId, ...(options.adminApproval.note ? { reviewNote: options.adminApproval.note.slice(0, 280) } : {}) }
            : {})
        }
      });
      if (options.adminApproval) {
        await tx.auditLog.create({
          data: {
            actorId: options.adminApproval.actorId,
            action: "DRIVER_INCENTIVE_CLAIM_APPROVED",
            entityType: "DriverIncentiveClaim",
            entityId: claimId,
            metadata: { flags: Array.isArray(claim.flags) ? (claim.flags as string[]) : [], amount: Number(claim.amount) }
          }
        });
      }
      return { id: paid.id, status: paid.status };
    });
  }

  private claimNotActionable() {
    return new AppError("Klaim ini tidak dapat diproses pada statusnya sekarang.", StatusCodes.CONFLICT, "INCENTIVE_CLAIM_NOT_ACTIONABLE");
  }

  private async assertRoomForActiveRule() {
    const active = await this.prisma.driverIncentiveRule.count({ where: { isActive: true } });
    if (active >= MAX_ACTIVE_RULES) {
      throw new AppError(
        `Maksimal ${MAX_ACTIVE_RULES} aturan insentif aktif. Nonaktifkan salah satu dulu.`,
        StatusCodes.CONFLICT,
        "INCENTIVE_TOO_MANY_ACTIVE_RULES"
      );
    }
  }

  private assertValid(input: IncentiveRuleInput) {
    const bad = (message: string) => new AppError(message, StatusCodes.BAD_REQUEST, "INCENTIVE_RULE_INVALID");
    if (!input.name.trim()) throw bad("Nama aturan wajib diisi.");
    if (!Number.isInteger(input.targetTrips) || input.targetTrips < 1 || input.targetTrips > 100) {
      throw bad("Target perjalanan harus 1 sampai 100.");
    }
    if (!(input.bonusAmount >= INCENTIVE_MIN_BONUS && input.bonusAmount <= INCENTIVE_MAX_BONUS)) {
      throw bad(`Bonus harus Rp${INCENTIVE_MIN_BONUS.toLocaleString("id-ID")} sampai Rp${INCENTIVE_MAX_BONUS.toLocaleString("id-ID")}.`);
    }
    if ((input.minTripFare ?? 0) < 0) throw bad("Tarif minimum tidak boleh negatif.");
    if (input.dailyBudget != null && input.dailyBudget < input.bonusAmount) {
      throw bad("Anggaran harian tidak boleh lebih kecil dari satu bonus.");
    }
    if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
      throw bad("Tanggal berakhir harus setelah tanggal mulai.");
    }
  }

  private formatRule(rule: RuleRow) {
    return {
      id: rule.id,
      name: rule.name,
      targetTrips: rule.targetTrips,
      bonusAmount: Number(rule.bonusAmount),
      minTripFare: Number(rule.minTripFare),
      dailyBudget: rule.dailyBudget ? Number(rule.dailyBudget) : null,
      startsAt: rule.startsAt,
      endsAt: rule.endsAt,
      isActive: rule.isActive,
      createdAt: rule.createdAt
    };
  }
}
