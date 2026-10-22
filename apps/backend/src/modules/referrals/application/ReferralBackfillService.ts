import { Prisma, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { MembershipOrderService } from "../../memberships/application/MembershipOrderService.js";
import { ReferralRepository } from "../domain/ReferralRepository.js";
import { ReferralService } from "./ReferralService.js";

/** Jenis komisi yang dibayar dari satu order membership oleh jalur referral. */
const REFERRAL_COMMISSION_TYPES = ["BASIC_SPONSOR_BONUS", "SPONSOR_BONUS", "LEVEL_BONUS", "REWARD_BONUS"] as const;

export const BACKFILL_ACTION = {
  applied: "REFERRAL_BACKFILL_APPLIED"
} as const;

export interface BackfillPayout {
  beneficiaryId: string;
  beneficiaryName: string;
  type: string;
  level: number | null;
  amount: string;
}

export interface BackfillReport {
  applied: boolean;
  userId: string;
  userName: string;
  sponsorId: string;
  sponsorName: string;
  orderId: string;
  packageName: string;
  packagePrice: string;
  payouts: BackfillPayout[];
  totalPayout: string;
}

/** Dilempar di akhir mode simulasi supaya seluruh transaksi dibatalkan, dengan membawa laporannya. */
class DryRunRollback extends Error {
  constructor(readonly report: BackfillReport) {
    super("dry-run");
  }
}

/**
 * Koreksi referral satu kali (permintaan Owner, 22 Okt 2026): akun yang membeli membership tanpa sponsor tercatat
 * karena kode referral tidak pernah sampai ke sistem. Mengaitkan sponsor SEKARANG tidak membayar apa pun surut karena
 * bonus dihitung saat aktivasi. Layanan ini mengerjakan keduanya dalam SATU transaksi, dengan aturan hitung yang sama
 * persis dengan aktivasi:
 *
 *   1. validasi (order milik akun itu, sudah lunas dan aktif, akun belum punya sponsor, tidak ada bonus referral
 *      yang sudah dibayar dari order itu, sponsor sah dan tidak melingkar);
 *   2. kaitkan sponsor (referral + level) lewat ReferralService.linkSponsor;
 *   3. bayar bonus lewat MembershipOrderService.applyReferralRewardsForActivatedOrder;
 *   4. catat audit.
 *
 * Mode simulasi (apply=false) menjalankan semua langkah lalu MEMBATALKAN transaksi, jadi laporannya persis hasil nyata
 * tanpa mengubah data. Hanya dijalankan lewat skrip CLI di server, bukan lewat API.
 */
export class ReferralBackfillService {
  private readonly referrals: ReferralService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly orders: MembershipOrderService,
    repository: ReferralRepository
  ) {
    this.referrals = new ReferralService(repository);
  }

  async run(input: {
    userId: string;
    sponsorCode: string;
    orderId: string;
    adminId?: string | undefined;
    apply: boolean;
  }): Promise<BackfillReport> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const report = await this.execute(tx, input);
          if (!input.apply) {
            throw new DryRunRollback(report);
          }
          return report;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 }
      );
    } catch (error) {
      if (error instanceof DryRunRollback) {
        return error.report;
      }
      throw error;
    }
  }

  private async execute(
    tx: Prisma.TransactionClient,
    input: { userId: string; sponsorCode: string; orderId: string; adminId?: string | undefined; apply: boolean }
  ): Promise<BackfillReport> {
    const order = await tx.membershipOrder.findUnique({
      where: { id: input.orderId },
      include: { membership: true, userMembership: true, invoice: true, user: { select: { id: true, fullName: true } } }
    });
    if (!order || order.userId !== input.userId) {
      throw new AppError("Order tidak ditemukan untuk akun ini.", StatusCodes.NOT_FOUND, "BACKFILL_ORDER_NOT_FOUND");
    }
    if (order.status !== "PAID" || !order.userMembership || !order.invoice) {
      throw new AppError(
        "Order belum lunas dan aktif; tidak ada bonus yang bisa dibayar.",
        StatusCodes.CONFLICT,
        "BACKFILL_ORDER_NOT_ACTIVATED"
      );
    }
    if (order.membership.tier === "BASIC") {
      throw new AppError("Paket Basic tidak menghasilkan bonus referral.", StatusCodes.CONFLICT, "BACKFILL_BASIC_PACKAGE");
    }

    const alreadyPaid = await tx.commission.count({
      where: {
        triggerType: "MEMBERSHIP_ORDER",
        triggerId: order.id,
        type: { in: ["BASIC_SPONSOR_BONUS", "SPONSOR_BONUS", "LEVEL_BONUS"] }
      }
    });
    if (alreadyPaid > 0) {
      throw new AppError(
        "Order ini sudah pernah membayar bonus referral; koreksi dibatalkan agar tidak dobel.",
        StatusCodes.CONFLICT,
        "BACKFILL_ALREADY_PAID"
      );
    }

    await this.referrals.linkSponsor(tx, input.userId, input.sponsorCode, { allowAfterPurchase: true });

    const referral = await tx.referral.findUniqueOrThrow({
      where: { userId: input.userId },
      select: { id: true, sponsorId: true, sponsor: { select: { fullName: true } } }
    });
    await tx.referral.update({
      where: { id: referral.id },
      data: {
        metadata: {
          source: "admin_backfill",
          sponsorReferralCode: input.sponsorCode.trim().toUpperCase(),
          orderId: order.id,
          ...(input.adminId ? { adminId: input.adminId } : {})
        }
      }
    });

    // Jejak komisi yang sudah ada sebelum koreksi (reward pencapaian sponsor boleh sudah ada dari order lain).
    const before = await tx.commission.findMany({
      where: { type: { in: [...REFERRAL_COMMISSION_TYPES] }, sourceUserId: input.userId },
      select: { id: true }
    });

    await this.orders.applyReferralRewardsForActivatedOrder(tx, order.id);

    const created = await tx.commission.findMany({
      where: {
        type: { in: [...REFERRAL_COMMISSION_TYPES] },
        sourceUserId: input.userId,
        id: { notIn: before.map((row) => row.id) }
      },
      include: { beneficiary: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: "asc" }
    });

    const payouts: BackfillPayout[] = created.map((commission) => ({
      beneficiaryId: commission.beneficiaryId,
      beneficiaryName: commission.beneficiary.fullName,
      type: commission.type,
      level: commission.level,
      amount: commission.amount.toFixed(2)
    }));
    const total = created.reduce((sum, commission) => sum.add(commission.amount), new Prisma.Decimal(0));

    if (input.apply) {
      await tx.auditLog.create({
        data: {
          ...(input.adminId ? { actorId: input.adminId } : {}),
          action: BACKFILL_ACTION.applied,
          entityType: "MEMBERSHIP_ORDER",
          entityId: order.id,
          metadata: {
            userId: input.userId,
            sponsorId: referral.sponsorId,
            sponsorReferralCode: input.sponsorCode.trim().toUpperCase(),
            payouts: payouts.map((p) => ({ beneficiaryId: p.beneficiaryId, type: p.type, level: p.level, amount: p.amount })),
            totalPayout: total.toFixed(2)
          }
        }
      });
    }

    return {
      applied: input.apply,
      userId: input.userId,
      userName: order.user.fullName,
      sponsorId: referral.sponsorId,
      sponsorName: referral.sponsor.fullName,
      orderId: order.id,
      packageName: order.membership.name,
      packagePrice: order.membership.price.toFixed(2),
      payouts,
      totalPayout: total.toFixed(2)
    };
  }
}
