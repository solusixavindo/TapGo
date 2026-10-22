import { Prisma, PrismaClient } from "@prisma/client";
import { MembershipOrderService } from "./MembershipOrderService.js";

export const GRANT_ACTION = { applied: "MEMBERSHIP_GRANTED_COMPLIMENTARY" } as const;

export interface GrantReport {
  applied: boolean;
  userId: string;
  userName: string;
  previousTier: string;
  tier: string;
  packageName: string;
  ppobCredited: string;
  /** Jumlah anggota aktif pada tingkat yang diberikan, sebelum dan sesudah (pembagi pembagian laba tingkat itu). */
  tierMembersBefore: number;
  tierMembersAfter: number;
}

/** Dilempar di akhir mode simulasi supaya seluruh transaksi dibatalkan, dengan membawa laporannya. */
class DryRunRollback extends Error {
  constructor(readonly report: GrantReport) {
    super("dry-run");
  }
}

/**
 * Pemberian membership tanpa pembelian lewat satu transaksi: pemberian + audit. Mode simulasi (apply=false) menjalankan
 * semuanya lalu MEMBATALKAN transaksi, jadi laporannya persis hasil nyata tanpa mengubah data. Hanya dijalankan lewat
 * skrip CLI di server, bukan lewat API.
 */
export class MembershipGrantService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly orders: MembershipOrderService
  ) {}

  async run(input: {
    userId: string;
    tier: "SILVER" | "GOLD" | "PLATINUM";
    reason: string;
    adminId?: string | undefined;
    apply: boolean;
  }): Promise<GrantReport> {
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

  private async countActiveMembers(tx: Prisma.TransactionClient, tier: "SILVER" | "GOLD" | "PLATINUM") {
    const rows = await tx.userMembership.findMany({
      where: { status: "ACTIVE", membership: { tier } },
      distinct: ["userId"],
      select: { userId: true }
    });
    return rows.length;
  }

  private async execute(
    tx: Prisma.TransactionClient,
    input: { userId: string; tier: "SILVER" | "GOLD" | "PLATINUM"; reason: string; adminId?: string | undefined; apply: boolean }
  ): Promise<GrantReport> {
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { id: true, fullName: true } });
    const before = await this.countActiveMembers(tx, input.tier);

    const result = await this.orders.grantComplimentaryMembership(tx, {
      userId: input.userId,
      tier: input.tier,
      reason: input.reason,
      adminId: input.adminId
    });

    const after = await this.countActiveMembers(tx, input.tier);

    if (input.apply) {
      await tx.auditLog.create({
        data: {
          ...(input.adminId ? { actorId: input.adminId } : {}),
          action: GRANT_ACTION.applied,
          entityType: "USER",
          entityId: input.userId,
          metadata: {
            tier: result.tier,
            previousTier: result.previousTier,
            reason: input.reason,
            userMembershipId: result.userMembershipId,
            ppobCredited: result.ppobCredited.toFixed(2)
          }
        }
      });
    }

    return {
      applied: input.apply,
      userId: user.id,
      userName: user.fullName,
      previousTier: result.previousTier,
      tier: result.tier,
      packageName: result.packageName,
      ppobCredited: result.ppobCredited.toFixed(2),
      tierMembersBefore: before,
      tierMembersAfter: after
    };
  }
}
