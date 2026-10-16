import { Prisma, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const MAX_ACTIVE_RULES = 10;
export const INCENTIVE_MIN_BONUS = 1_000;
export const INCENTIVE_MAX_BONUS = 500_000;

/** Hari kalender WIB (UTC+7, tanpa DST): kunci "YYYY-MM-DD" dan batas [start, end) dalam UTC. */
export function wibDay(date: Date) {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS);
  const key = shifted.toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${key}T00:00:00.000Z`) - WIB_OFFSET_MS);
  return { key, start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

type RuleRow = Prisma.DriverIncentiveRuleGetPayload<object>;

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

/**
 * Insentif harian driver: selesaikan N perjalanan (tarif >= minimum) dalam satu hari WIB, dapatkan bonus.
 *
 * Uang: bonus dikreditkan ke saldo yang DAPAT DITARIK (penghasilan) dengan catatan buku saldo INCENTIVE_BONUS.
 * Aman diulang: klaim unik per (aturan, driver, hari), jadi evaluasi berulang tidak membayar dua kali, dan
 * kegagalan evaluasi setelah perjalanan selesai diperbaiki oleh evaluasi berikutnya (mis. saat driver membuka progres).
 * Anggaran harian aturan dijaga dengan mengunci baris aturan selama klaim.
 */
export class DriverIncentiveService {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------------------------------------------------------------- Admin

  async listRules() {
    const rules = await this.prisma.driverIncentiveRule.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] });
    const today = wibDay(new Date()).key;
    const paidToday = await this.prisma.driverIncentiveClaim.groupBy({
      by: ["ruleId"],
      where: { dayKey: today },
      _sum: { amount: true },
      _count: { _all: true }
    });
    const byRule = new Map(paidToday.map((row) => [row.ruleId, row]));
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

  // --------------------------------------------------------------- Driver

  /** Progres hari ini untuk driver. Sebelum menghitung, klaim yang tertinggal (kegagalan sebelumnya) diselesaikan. */
  async progressForDriver(driverProfileId: string, userId: string, now = new Date()) {
    await this.evaluateForDriver(driverProfileId, userId, now).catch(() => undefined);
    const day = wibDay(now);
    const rules = (await this.prisma.driverIncentiveRule.findMany({ orderBy: { targetTrips: "asc" } })).filter((rule) =>
      isEffective(rule, now)
    );
    const claims = await this.prisma.driverIncentiveClaim.findMany({ where: { driverProfileId, dayKey: day.key } });
    const claimed = new Set(claims.map((claim) => claim.ruleId));
    const items = [];
    for (const rule of rules) {
      const tripCount = await this.countTrips(driverProfileId, rule, day);
      let budgetExhausted = false;
      if (rule.dailyBudget && !claimed.has(rule.id)) {
        const paid = await this.prisma.driverIncentiveClaim.aggregate({
          where: { ruleId: rule.id, dayKey: day.key },
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
        claimed: claimed.has(rule.id),
        budgetExhausted
      });
    }
    return { dayKey: day.key, items };
  }

  /** Membayar bonus yang sudah tercapai tetapi belum diklaim. Mengembalikan jumlah bonus yang dibayarkan. */
  async evaluateForDriver(driverProfileId: string, userId: string, now = new Date()) {
    const day = wibDay(now);
    const rules = (await this.prisma.driverIncentiveRule.findMany()).filter((rule) => isEffective(rule, now));
    let paid = 0;
    for (const rule of rules) {
      const tripCount = await this.countTrips(driverProfileId, rule, day);
      if (tripCount < rule.targetTrips) continue;
      if (await this.claim(rule, driverProfileId, userId, day.key, tripCount)) paid += 1;
    }
    return paid;
  }

  // ------------------------------------------------------------- Internal

  private countTrips(driverProfileId: string, rule: RuleRow, day: { start: Date; end: Date }) {
    return this.prisma.rideOrder.count({
      where: {
        driverProfileId,
        status: "COMPLETED",
        completedAt: { gte: day.start, lt: day.end },
        totalFare: { gte: Math.ceil(Number(rule.minTripFare)) }
      }
    });
  }

  private async claim(rule: RuleRow, driverProfileId: string, userId: string, dayKey: string, tripCount: number) {
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
          const paid = await tx.driverIncentiveClaim.aggregate({
            where: { ruleId: rule.id, dayKey },
            _sum: { amount: true }
          });
          if (new Prisma.Decimal(paid._sum.amount ?? 0).plus(rule.bonusAmount).gt(rule.dailyBudget)) return false;
        }
        const claim = await tx.driverIncentiveClaim.create({
          data: { ruleId: rule.id, driverProfileId, userId, dayKey, tripCount, amount: rule.bonusAmount }
        });
        const wallet = await tx.wallet.upsert({
          where: { userId },
          update: {},
          create: {
            userId,
            balance: new Prisma.Decimal(0),
            cashBalance: new Prisma.Decimal(0),
            ppobBalance: new Prisma.Decimal(0),
            currency: "IDR"
          },
          select: { id: true }
        });
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { cashBalance: { increment: rule.bonusAmount }, balance: { increment: rule.bonusAmount } }
        });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "INCENTIVE_BONUS",
            amount: rule.bonusAmount,
            referenceType: "DRIVER_INCENTIVE",
            referenceId: claim.id,
            metadata: { ruleId: rule.id, ruleName: rule.name, dayKey, tripCount }
          }
        });
        return true;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
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
