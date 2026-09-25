import {
  CommissionType,
  CommissionStatus,
  MembershipOrderStatus,
  MembershipTier,
  PaymentStatus,
  Prisma,
  PrismaClient,
  RewardTransactionStatus,
  WalletTransactionType
} from "@prisma/client";
import crypto from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { midtransFeeFor } from "../../../core/finance/midtransFees.js";
import { plConfig, prorateMonthlyCost } from "../../../core/finance/plConfig.js";
import { AppError } from "../../../core/errors/AppError.js";
import { hashPassword } from "../../../core/security/passwordHasher.js";
import { normalizePhoneNumber, phoneLookupVariants } from "../../../core/security/phone.js";

type PageInput = {
  page: number;
  pageSize: number;
};

type MemberListInput = PageInput & {
  search?: string;
  package?: MembershipTier;
  status?: string;
  activeDays?: number;
  registeredDays?: number;
  source?: "PLAY" | "OTHER" | "UNKNOWN";
};

/** Indonesia (WIB) = UTC+7 tanpa DST; hari kalender dibatasi di zona ini. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Awal hari WIB (sebagai instan UTC), `daysBack` hari sebelum hari ini. */
function wibDayStart(daysBack = 0, now = new Date()) {
  const shifted = new Date(now.getTime() + WIB_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - WIB_OFFSET_MS - daysBack * 86_400_000);
}

/** Pendaftaran dari build Play yang dipasang lewat Google Play (dilaporkan klien). */
const PLAY_INSTALL = { distribution: "play", installer: "com.android.vending" } as const;

function signupSourceOf(event: { distribution: string | null; installer: string | null } | null) {
  if (!event || !event.distribution) return "UNKNOWN" as const;
  return event.distribution === "play" && event.installer === PLAY_INSTALL.installer
    ? ("PLAY" as const)
    : ("OTHER" as const);
}

type PaymentListInput = PageInput & {
  status?: PaymentStatus;
};

type CommissionListInput = PageInput & {
  type?: CommissionType;
  bonusType?: "sponsor" | "level" | "reward" | "profit_sharing";
};

type DateRangeInput = PageInput & {
  dateFrom?: Date;
  dateTo?: Date;
  userId?: string;
};

type DateRangeOnlyInput = {
  dateFrom?: Date;
  dateTo?: Date;
};

type BonusReportInput = DateRangeInput & {
  type?: CommissionType;
  status?: CommissionStatus;
};

type RewardListInput = DateRangeInput & {
  status?: RewardTransactionStatus;
};

const sponsorTypes: CommissionType[] = ["SPONSOR_BONUS", "BASIC_SPONSOR_BONUS"];
const levelTypes: CommissionType[] = ["LEVEL_BONUS", "LEVEL_COMMISSION"];
const rewardTypes: CommissionType[] = ["REWARD_BONUS"];
const profitSharingTypes: CommissionType[] = ["PROFIT_SHARING", "PROFIT_SHARING_BONUS"];

export class AdminConsoleService {
  constructor(private readonly prisma: PrismaClient) {}

  async dashboardSummary() {
    const [
      totalMembers,
      packageCounts,
      revenue,
      commission,
      sponsorBonus,
      levelBonus,
      rewardBonus,
      profitSharing,
      withdrawPending,
      withdrawApproved,
      walletBalance,
      rewardPending
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: "USER" } }),
      this.prisma.user.groupBy({
        by: ["membershipId"],
        where: { role: "USER" },
        _count: { _all: true }
      }),
      this.prisma.invoice.aggregate({
        where: { status: "PAID" },
        _sum: { amount: true }
      }),
      this.prisma.commission.aggregate({
        where: { status: "POSTED" },
        _sum: { amount: true }
      }),
      this.sumCommissionByTypes(sponsorTypes),
      this.sumCommissionByTypes(levelTypes),
      this.sumCommissionByTypes(rewardTypes),
      this.sumCommissionByTypes(profitSharingTypes),
      this.prisma.withdrawal.aggregate({
        where: { status: "PENDING" },
        _sum: { amount: true }
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: { in: ["APPROVED", "PAID"] } },
        _sum: { amount: true }
      }),
      this.prisma.wallet.aggregate({
        _sum: { balance: true }
      }),
      this.prisma.rewardTransaction.aggregate({
        where: { status: "PENDING" },
        _sum: { amount: true }
      })
    ]);

    const memberships = await this.prisma.membership.findMany({
      select: { id: true, tier: true }
    });
    const tierByMembershipId = new Map(memberships.map((item) => [item.id, item.tier]));
    const countByTier = new Map<MembershipTier, number>([
      ["BASIC", 0],
      ["SILVER", 0],
      ["GOLD", 0],
      ["PLATINUM", 0]
    ]);

    for (const row of packageCounts) {
      const tier = row.membershipId ? tierByMembershipId.get(row.membershipId) : undefined;
      countByTier.set(tier ?? "BASIC", (countByTier.get(tier ?? "BASIC") ?? 0) + row._count._all);
    }

    return {
      totalMembers,
      totalBasic: countByTier.get("BASIC") ?? 0,
      totalSilver: countByTier.get("SILVER") ?? 0,
      totalGold: countByTier.get("GOLD") ?? 0,
      totalPlatinum: countByTier.get("PLATINUM") ?? 0,
      totalRevenue: this.decimal(revenue._sum.amount),
      totalCommission: this.decimal(commission._sum.amount),
      totalSponsorBonus: this.decimal(sponsorBonus._sum.amount),
      totalLevelBonus: this.decimal(levelBonus._sum.amount),
      totalRewardBonus: this.decimal(rewardBonus._sum.amount),
      totalProfitSharing: this.decimal(profitSharing._sum.amount),
      totalWithdrawPending: this.decimal(withdrawPending._sum.amount),
      totalWithdrawApproved: this.decimal(withdrawApproved._sum.amount),
      // Saldo TapGoPay total (yang dilihat member di aplikasi), bukan hanya yang bisa ditarik.
      totalWalletBalance: this.decimal(walletBalance._sum.balance),
      totalPpobGiven: await this.sumWalletTransactions(["PPOB_BENEFIT"]),
      totalRewardPending: this.decimal(rewardPending._sum.amount)
    };
  }

  /**
   * Tren pendaftaran member baru per hari, `days` hari terakhir (termasuk
   * hari ini). Tidak ada pola groupBy-per-tanggal lain di codebase ini untuk
   * dipakai ulang — Prisma.groupBy tidak bisa memotong DateTime ke tanggal,
   * jadi dipakai raw query dengan date_trunc.
   *
   * Hari tanpa pendaftaran TIDAK muncul dari SQL (tidak ada barisnya sama
   * sekali) — diisi 0 di sisi aplikasi supaya grafik tidak bolong.
   */
  async registrationTrend(days = 30) {
    const bounded = Math.min(90, Math.max(1, Math.trunc(days)));
    // Hari kalender WIB, bukan UTC: "hari ini" berganti pukul 00:00 WIB.
    const since = wibDayStart(bounded - 1);
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "created_at" + interval '7 hours') AS day, COUNT(*) AS count
      FROM "users"
      WHERE "role" = 'USER'
        AND "created_at" >= ${since}
      GROUP BY day
      ORDER BY day ASC
    `;
    const countByDay = new Map(
      rows.map((row) => [row.day.toISOString().slice(0, 10), Number(row.count)])
    );

    const series: Array<{ date: string; count: number }> = [];
    for (let offset = bounded - 1; offset >= 0; offset -= 1) {
      // Kunci tanggal WIB: geser instan awal-hari-WIB +7 jam lalu baca tanggal UTC-nya.
      const key = new Date(wibDayStart(offset).getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
      series.push({ date: key, count: countByDay.get(key) ?? 0 });
    }
    return series;
  }

  /**
   * "Aktif" = login dalam `days` hari terakhir. Definisi awal, gampang
   * diubah — tidak ada definisi baku lain di codebase ini untuk "user aktif"
   * (dikonfirmasi lewat riset sebelum menulis method ini).
   */
  async activeUsersCount(days: number) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    return this.prisma.user.count({
      where: { role: "USER", lastLoginAt: { gte: since } }
    });
  }

  async dashboardGrowth() {
    const [registrationTrend, activeUsers7d, activeUsers30d, pendingApprovals] = await Promise.all([
      this.registrationTrend(30),
      this.activeUsersCount(7),
      this.activeUsersCount(30),
      this.pendingApprovalCounts()
    ]);
    return { registrationTrend, activeUsers7d, activeUsers30d, pendingApprovals };
  }

  /**
   * Hitungan pekerjaan yang menunggu keputusan admin, digabung dari tiga
   * antrean terpisah — supaya Beranda bisa menunjukkan "ada kerjaan" tanpa
   * admin membuka satu-satu halaman.
   *
   * "Member request pending" di sini SENGAJA bukan status PENDING mentah
   * (itu masih menunggu pembayaran, bukan menunggu admin) — cocok dengan
   * isAwaitingVerification di member-requests/page.tsx: status PAID tapi
   * belum punya UserMembership aktif.
   */
  private async pendingApprovalCounts() {
    const [memberRequests, rewards, withdrawals] = await Promise.all([
      this.prisma.membershipOrder.count({
        where: { status: "PAID", userMembership: null }
      }),
      this.prisma.rewardTransaction.count({ where: { status: "PENDING" } }),
      this.prisma.withdrawal.count({ where: { status: "PENDING" } })
    ]);
    return {
      memberRequests,
      rewards,
      withdrawals,
      total: memberRequests + rewards + withdrawals
    };
  }

  /**
   * Dokumen KYC member yang mendekati batas retensi (default: sisa <= 6 jam)
   * — supaya admin tidak lupa mencetak sebelum berkas terhapus otomatis.
   * Hanya order yang masih menunggu verifikasi (PAID, belum aktif) yang
   * relevan; dokumen order yang sudah selesai diproses tidak perlu dicetak
   * lagi.
   */
  async documentsNearingRetention(warningHours = 6) {
    const now = new Date();
    const threshold = new Date(now.getTime() + warningHours * 60 * 60 * 1000);
    const documents = await this.prisma.membershipDocument.findMany({
      where: {
        purgedAt: null,
        expiresAt: { not: null, gte: now, lte: threshold },
        order: { status: "PAID", userMembership: null }
      },
      select: {
        id: true,
        type: true,
        expiresAt: true,
        order: {
          select: {
            id: true,
            user: { select: { fullName: true, referralCode: true } }
          }
        }
      },
      orderBy: { expiresAt: "asc" },
      take: 50
    });
    return documents.map((doc) => ({
      orderId: doc.order.id,
      memberName: doc.order.user?.fullName ?? "—",
      referralCode: doc.order.user?.referralCode ?? "—",
      documentType: doc.type,
      expiresAt: doc.expiresAt
    }));
  }

  /**
   * Log aktivitas admin terbaru — dibatasi pada perubahan role dan
   * grant/revoke scope saja (bukan seluruh AuditLog, yang juga memuat jejak
   * transaksi non-admin). actorId ditampilkan sebagai nama, bukan UUID
   * mentah, supaya langsung terbaca siapa melakukan apa.
   */
  async recentAdminActivity(limit = 20) {
    const relevantActions = [
      "ADMIN_ROLE_ASSIGNED",
      "ADMIN_ROLE_ASSIGN_DENIED",
      "SUPER_ADMIN_VIP_GRANTED",
      "SUPER_ADMIN_VIP_REVOKED",
      "admin.scope.bootstrap_completed",
      "admin.scope.break_glass_completed",
      "admin.scope.granted",
      "admin.scope.self_granted",
      "admin.scope.revoked",
      "admin.scope.grant_denied",
      "admin.scope.revoke_denied",
      "admin.scope.last_manager_protected"
    ];
    const rows = await this.prisma.auditLog.findMany({
      where: { action: { in: relevantActions } },
      orderBy: { createdAt: "desc" },
      take: Math.min(50, Math.max(1, limit)),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        actor: { select: { fullName: true } }
      }
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actorName: row.actor?.fullName ?? "Sistem (bootstrap CLI)",
      createdAt: row.createdAt
    }));
  }

  /**
   * Log audit untuk konsol. SUPER_ADMIN melihat aksi operasional dan uang;
   * aksi yang mengungkap siapa memegang otoritas admin (peran, scope) serta
   * alamat IP hanya untuk SUPER_ADMIN_VIP.
   */
  async listAuditLogs(input: {
    page: number;
    pageSize: number;
    action?: string;
    entityType?: string;
    includeAuthority: boolean;
  }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(input.action ? { action: input.action } : {}),
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.includeAuthority
        ? {}
        : {
            NOT: [
              { action: { startsWith: "ADMIN_ROLE" } },
              { action: { startsWith: "SUPER_ADMIN_VIP" } },
              { action: { startsWith: "admin.scope" } }
            ]
          })
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
          createdAt: true,
          ...(input.includeAuthority ? { ipAddress: true } : {}),
          actor: { select: { fullName: true, role: true } }
        }
      })
    ]);
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: row.metadata,
        createdAt: row.createdAt,
        actorName: row.actor?.fullName ?? "Sistem",
        actorRole: row.actor?.role ?? null,
        ...("ipAddress" in row ? { ipAddress: row.ipAddress } : {})
      }))
    };
  }

  /** Mencatat aksi admin yang belum dicatat oleh layanan asalnya. */
  async recordAdminAction(input: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
      }
    });
  }

  async memberRequests(input: PageInput & { status?: MembershipOrderStatus }) {
    const where: Prisma.MembershipOrderWhereInput = {
      ...(input.status ? { status: input.status } : {})
    };
    const [total, items] = await Promise.all([
      this.prisma.membershipOrder.count({ where }),
      this.prisma.membershipOrder.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, phone: true, referralCode: true, status: true } },
          membership: true,
          invoice: true,
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
          userMembership: true
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  /**
   * Menonaktifkan / mengaktifkan kembali akun member. Keputusan pemilik: hanya
   * SUPER_ADMIN_VIP (dijaga di route). Akun admin tidak boleh diubah lewat
   * sini — role dikelola di halaman Peran — dan tidak boleh menonaktifkan diri
   * sendiri. Saat dinonaktifkan, semua sesi dicabut dan token lama gugur
   * seketika (authVersion naik), dalam transaksi yang sama dengan audit.
   */
  async setMemberAccountStatus(input: {
    actorId: string;
    userId: string;
    status: "ACTIVE" | "SUSPENDED";
    reason: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, fullName: true, role: true, status: true }
      });
      if (!target) {
        throw new AppError("Member tidak ditemukan.", StatusCodes.NOT_FOUND, "MEMBER_NOT_FOUND");
      }
      if (target.id === input.actorId) {
        throw new AppError("Akun sendiri tidak dapat dinonaktifkan.", StatusCodes.CONFLICT, "MEMBER_STATUS_SELF");
      }
      if (target.role === "ADMIN" || target.role === "SUPER_ADMIN" || target.role === "SUPER_ADMIN_VIP") {
        throw new AppError(
          "Akun admin dikelola lewat halaman Pengaturan Role.",
          StatusCodes.CONFLICT,
          "MEMBER_STATUS_ADMIN_TARGET"
        );
      }
      if (target.status !== "ACTIVE" && target.status !== "SUSPENDED") {
        throw new AppError(
          "Status akun ini tidak dapat diubah dari sini.",
          StatusCodes.CONFLICT,
          "MEMBER_STATUS_NOT_CHANGEABLE"
        );
      }

      const previousStatus = target.status;
      if (previousStatus === input.status) {
        return { id: target.id, fullName: target.fullName, status: target.status, changed: false };
      }

      const now = new Date();
      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          status: input.status,
          ...(input.status === "SUSPENDED"
            ? { authVersion: { increment: 1 }, sessionsRevokedAt: now }
            : {})
        },
        select: { id: true, fullName: true, status: true }
      });
      if (input.status === "SUSPENDED") {
        await tx.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: now }
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: input.status === "SUSPENDED" ? "MEMBER_ACCOUNT_SUSPENDED" : "MEMBER_ACCOUNT_REACTIVATED",
          entityType: "USER",
          entityId: target.id,
          metadata: { previousStatus, newStatus: input.status, reason: input.reason }
        }
      });
      return { ...updated, changed: true };
    });
  }

  async rejectMemberRequest(input: { orderId: string; adminId: string; reason?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.membershipOrder.findUnique({
        where: { id: input.orderId },
        include: { invoice: true }
      });
      if (!order) {
        throw new AppError("Membership request not found", StatusCodes.NOT_FOUND, "MEMBERSHIP_REQUEST_NOT_FOUND");
      }
      if (order.status !== "PENDING") {
        throw new AppError("Only pending membership requests can be rejected", StatusCodes.CONFLICT, "MEMBERSHIP_REQUEST_INVALID_STATE");
      }

      const metadata = {
        rejectedBy: input.adminId,
        rejectedAt: new Date().toISOString(),
        reason: input.reason ?? null
      };

      const updated = await tx.membershipOrder.update({
        where: { id: input.orderId },
        data: {
          status: "CANCELLED",
          registrationData: {
            ...(this.asObject(order.registrationData)),
            adminRejection: metadata
          }
        },
        include: {
          user: { select: { id: true, fullName: true, phone: true, referralCode: true } },
          membership: true,
          invoice: true,
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
          userMembership: true
        }
      });

      if (order.invoice) {
        await tx.invoice.update({
          where: { id: order.invoice.id },
          data: {
            status: "CANCELLED",
            metadata
          }
        });
        await tx.membershipPayment.updateMany({
          where: { orderId: order.id, status: "PENDING" },
          data: {
            status: "CANCELLED",
            metadata
          }
        });
      }

      return updated;
    });
  }

  async bonusReport(input: BonusReportInput) {
    const where: Prisma.CommissionWhereInput = {
      ...(input.type ? { type: input.type } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.userId ? { beneficiaryId: input.userId } : {}),
      ...this.createdAtRange(input)
    };
    const baseWhere = {
      ...(input.type ? { type: input.type } : {}),
      ...(input.userId ? { beneficiaryId: input.userId } : {}),
      ...this.createdAtRange(input)
    };
    const [total, aggregate, pending, posted, items] = await Promise.all([
      this.prisma.commission.count({ where }),
      this.prisma.commission.aggregate({ where, _sum: { amount: true } }),
      this.prisma.commission.aggregate({ where: { ...baseWhere, status: "PENDING" }, _sum: { amount: true } }),
      this.prisma.commission.aggregate({ where: { ...baseWhere, status: "POSTED" }, _sum: { amount: true } }),
      this.prisma.commission.findMany({
        where,
        include: {
          beneficiary: { select: { id: true, fullName: true, phone: true, referralCode: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);
    return {
      totalBonus: this.decimal(aggregate._sum.amount),
      transactionCount: total,
      totalPending: this.decimal(pending._sum.amount),
      totalApprovedPaid: this.decimal(posted._sum.amount),
      ...this.page(items, total, input)
    };
  }

  async ppobReport(input: DateRangeInput) {
    const where: Prisma.WalletTransactionWhereInput = {
      type: "PPOB_BENEFIT",
      ...(input.userId ? { wallet: { userId: input.userId } } : {}),
      ...this.createdAtRange(input)
    };
    const [total, aggregate, items] = await Promise.all([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.aggregate({ where, _sum: { amount: true } }),
      this.prisma.walletTransaction.findMany({
        where,
        include: {
          wallet: {
            include: {
              user: { select: { id: true, fullName: true, phone: true, membership: true } }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);
    return {
      totalPpob: this.decimal(aggregate._sum.amount),
      transactionCount: total,
      totalPending: "0.00",
      totalApprovedPaid: this.decimal(aggregate._sum.amount),
      ...this.page(items, total, input)
    };
  }

  /**
   * Transaksi PPOB SUNGGUHAN (beli pulsa/token/dll, tabel PpobTransaction) —
   * berbeda dari ppobReport() di atas, yang melaporkan KREDIT BENEFIT PPOB
   * gratis dari paket membership (tabel WalletTransaction tipe
   * PPOB_BENEFIT). Keduanya laporan yang sah dan berbeda maknanya; sebelum
   * method ini ada, satu-satunya "Laporan PPOB" di dashboard admin hanya
   * memuat data benefit membership, membuat pemilik bisnis mengira itu
   * laporan transaksi PPOB (Owner, 2026-09-23).
   */
  async ppobTransactionsReport(input: DateRangeInput) {
    const where: Prisma.PpobTransactionWhereInput = {
      ...(input.userId ? { userId: input.userId } : {}),
      ...this.createdAtRange(input)
    };
    const [total, aggregate, pendingAggregate, successAggregate, items] = await Promise.all([
      this.prisma.ppobTransaction.count({ where }),
      this.prisma.ppobTransaction.aggregate({ where, _sum: { totalAmount: true } }),
      this.prisma.ppobTransaction.aggregate({
        where: { ...where, status: { in: ["PENDING", "PROCESSING"] } },
        _sum: { totalAmount: true }
      }),
      this.prisma.ppobTransaction.aggregate({
        where: { ...where, status: "SUCCESS" },
        _sum: { totalAmount: true }
      }),
      this.prisma.ppobTransaction.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, phone: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);
    return {
      totalPpob: this.decimal(aggregate._sum.totalAmount),
      transactionCount: total,
      totalPending: this.decimal(pendingAggregate._sum.totalAmount),
      totalApprovedPaid: this.decimal(successAggregate._sum.totalAmount),
      ...this.page(items, total, input)
    };
  }

  async rewardReport(input: DateRangeInput) {
    return this.bonusReport({ ...input, type: "REWARD_BONUS" });
  }

  async rewards(input: RewardListInput) {
    const where: Prisma.RewardTransactionWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...this.createdAtRange(input)
    };

    const [total, items] = await Promise.all([
      this.prisma.rewardTransaction.count({ where }),
      this.prisma.rewardTransaction.findMany({
        where,
        include: this.rewardInclude(),
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  async rewardDetail(rewardId: string) {
    const reward = await this.prisma.rewardTransaction.findUnique({
      where: { id: rewardId },
      include: this.rewardInclude()
    });

    if (!reward) {
      throw new AppError("Reward not found", StatusCodes.NOT_FOUND, "REWARD_NOT_FOUND");
    }

    return reward;
  }

  async approveReward(input: { rewardId: string; adminId: string; note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.rewardTransaction.findUnique({ where: { id: input.rewardId } });
      if (!reward) {
        throw new AppError("Reward not found", StatusCodes.NOT_FOUND, "REWARD_NOT_FOUND");
      }
      if (reward.status !== "PENDING") {
        throw new AppError("Only pending rewards can be approved", StatusCodes.CONFLICT, "REWARD_INVALID_STATE");
      }

      const updated = await tx.rewardTransaction.update({
        where: { id: input.rewardId },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          metadata: this.mergeMetadata(reward.metadata, {
            approvedBy: input.adminId,
            approvedNote: input.note ?? null
          })
        },
        include: this.rewardInclude()
      });

      return updated;
    });
  }

  async rejectReward(input: { rewardId: string; adminId: string; reason?: string; note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.rewardTransaction.findUnique({ where: { id: input.rewardId } });
      if (!reward) {
        throw new AppError("Reward not found", StatusCodes.NOT_FOUND, "REWARD_NOT_FOUND");
      }
      if (reward.status !== "PENDING") {
        throw new AppError("Only pending rewards can be rejected", StatusCodes.CONFLICT, "REWARD_INVALID_STATE");
      }

      const updated = await tx.rewardTransaction.update({
        where: { id: input.rewardId },
        data: {
          status: "REJECTED",
          rejectedAt: new Date(),
          metadata: this.mergeMetadata(reward.metadata, {
            rejectedBy: input.adminId,
            rejectReason: input.reason ?? input.note ?? null
          })
        },
        include: this.rewardInclude()
      });

      return updated;
    });
  }

  async markRewardPaid(input: { rewardId: string; adminId: string; note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.rewardTransaction.findUnique({
        where: { id: input.rewardId },
        include: { walletTransaction: true }
      });
      if (!reward) {
        throw new AppError("Reward not found", StatusCodes.NOT_FOUND, "REWARD_NOT_FOUND");
      }
      if (reward.status === "PAID") {
        return tx.rewardTransaction.findUniqueOrThrow({
          where: { id: input.rewardId },
          include: this.rewardInclude()
        });
      }
      if (reward.status !== "APPROVED") {
        throw new AppError("Only approved rewards can be marked paid", StatusCodes.CONFLICT, "REWARD_INVALID_STATE");
      }

      const claim = await tx.rewardTransaction.updateMany({
        where: {
          id: input.rewardId,
          status: "APPROVED",
          walletTransactionId: null
        },
        data: {
          status: "PAID",
          paidAt: new Date(),
          metadata: this.mergeMetadata(reward.metadata, {
            paidBy: input.adminId,
            paidNote: input.note ?? null
          })
        }
      });

      if (claim.count !== 1) {
        return tx.rewardTransaction.findUniqueOrThrow({
          where: { id: input.rewardId },
          include: this.rewardInclude()
        });
      }

      const wallet = await tx.wallet.upsert({
        where: { userId: reward.userId },
        update: {
          balance: { increment: reward.amount },
          cashBalance: { increment: reward.amount }
        },
        create: {
          userId: reward.userId,
          balance: reward.amount,
          cashBalance: reward.amount,
          ppobBalance: new Prisma.Decimal(0),
          currency: "IDR"
        }
      });

      const walletTransaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "REWARD_BONUS",
          amount: reward.amount,
          referenceType: reward.referenceType,
          referenceId: reward.referenceId,
          metadata: {
            rewardTransactionId: reward.id,
            threshold: reward.threshold,
            directSilverCount: reward.directSilverCount
          }
        }
      });

      return tx.rewardTransaction.update({
        where: { id: input.rewardId },
        data: {
          walletId: wallet.id,
          walletTransactionId: walletTransaction.id
        },
        include: this.rewardInclude()
      });
    });
  }

  async financialSummaryReport(input: DateRangeOnlyInput) {
    const [
      walletLiability,
      sponsorBonus,
      levelBonus,
      rewardSummary,
      profitSharingSummary,
      withdrawPending,
      withdrawPaidApproved,
      membershipRevenuePaid,
      packageCounts
    ] = await Promise.all([
      this.walletLiabilityReport(input),
      this.sumCommissionByTypesInRange(sponsorTypes, input),
      this.sumCommissionByTypesInRange(levelTypes, input),
      this.rewardSummaryReport(input),
      this.profitSharingSummaryReport(input),
      this.prisma.withdrawal.aggregate({
        where: { status: "PENDING", ...this.requestedAtRange(input) },
        _sum: { amount: true }
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: { in: ["APPROVED", "PAID"] }, ...this.requestedAtRange(input) },
        _sum: { amount: true }
      }),
      this.prisma.invoice.aggregate({
        where: { status: "PAID", ...this.createdAtRange(input) },
        _sum: { amount: true }
      }),
      this.membershipBreakdown()
    ]);

    return {
      totalWalletLiability: walletLiability.totalWalletBalance,
      totalCashWalletLiability: walletLiability.totalCashBalance,
      totalPpobLiability: walletLiability.totalPpobBalance,
      totalSponsorBonus: this.decimal(sponsorBonus._sum.amount),
      totalLevelBonus: this.decimal(levelBonus._sum.amount),
      totalRewardPending: rewardSummary.totalPending,
      totalRewardApproved: rewardSummary.totalApproved,
      totalRewardPaid: rewardSummary.totalPaid,
      totalProfitSharing: profitSharingSummary.totalPaid,
      totalWithdrawalPending: this.decimal(withdrawPending._sum.amount),
      totalWithdrawalPaidApproved: this.decimal(withdrawPaidApproved._sum.amount),
      totalMembershipRevenuePaid: this.decimal(membershipRevenuePaid._sum.amount),
      totalActiveBasic: packageCounts.BASIC,
      totalActiveSilver: packageCounts.SILVER,
      totalActiveGold: packageCounts.GOLD,
      totalActivePlatinum: packageCounts.PLATINUM
    };
  }

  /**
   * Laporan laba rugi manajemen, dihitung dari data operasional sistem.
   *
   * BUKAN laporan keuangan resmi/teraudit. Yang dihitung hanyalah yang benar-
   * benar tercatat di sistem; biaya di luar sistem (biaya gateway pembayaran,
   * harga modal PPOB dari provider, gaji, server, pajak) belum ada di sini
   * dan disebut eksplisit di `notes` agar angka laba tidak dibaca berlebihan.
   */
  async profitLossReport(input: DateRangeOnlyInput) {
    const current = await this.computeProfitLoss(input);

    let previous: Awaited<ReturnType<AdminConsoleService["computeProfitLoss"]>> | null = null;
    if (input.dateFrom && input.dateTo) {
      const length = input.dateTo.getTime() - input.dateFrom.getTime();
      if (length > 0) {
        previous = await this.computeProfitLoss({
          dateFrom: new Date(input.dateFrom.getTime() - length - 1),
          dateTo: new Date(input.dateFrom.getTime() - 1)
        });
      }
    }

    const [walletLiability, withdrawPending] = await Promise.all([
      this.walletLiabilityReport(input),
      this.prisma.withdrawal.aggregate({
        where: { status: { in: ["PENDING", "APPROVED"] } },
        _sum: { amount: true }
      })
    ]);

    return {
      period: this.reportPeriod(input),
      ...current,
      previous: previous
        ? {
            totalRevenue: previous.revenue.total,
            totalExpenses: previous.expenses.total,
            operatingProfit: previous.operatingProfit
          }
        : null,
      memo: {
        ppobGrossSales: current.memo.ppobGrossSales,
        walletLiabilityWallet: walletLiability.totalWalletBalance,
        walletLiabilityCash: walletLiability.totalCashBalance,
        walletLiabilityPpob: walletLiability.totalPpobBalance,
        withdrawalsOutstanding: this.decimal(withdrawPending._sum.amount)
      },
      notes: [
        "Dihitung dari data sistem TapGo; bukan laporan keuangan teraudit.",
        ...(current.hpp.missingTiers.length > 0
          ? [`HPP paket ${current.hpp.missingTiers.join(", ")} belum diisi, jadi belum dihitung sebagai beban.`]
          : []),
        "HPP paket dicatat saat paket terjual, termasuk saldo PPOB yang diberikan sebagai manfaat.",
        "Biaya gateway dihitung dari tarif publik Midtrans per metode (belum termasuk potongan lain di kontrak Anda). Pembayaran dengan jenis tidak dikenal tidak dihitung.",
        ...(current.operating.gateway.unknownCount > 0
          ? [`${current.operating.gateway.unknownCount} pembayaran Midtrans tanpa jenis pembayaran tercatat, jadi biayanya belum dihitung.`]
          : []),
        "Harga modal PPOB diambil dari harga yang ditagihkan Digiflazz saat transaksi sukses.",
        ...(current.operating.ppob.withoutCostCount > 0
          ? [`${current.operating.ppob.withoutCostCount} transaksi PPOB sukses tanpa harga modal tercatat, jadi modalnya belum dihitung.`]
          : []),
        "HPP paket sudah memuat saldo PPOB yang diberikan; pembelian PPOB dengan saldo itu ikut tercatat lagi di penjualan dan modal PPOB, jadi sebagian bisa terhitung dua kali.",
        `Server dihitung Rp${new Intl.NumberFormat("id-ID").format(current.operating.server.monthly)} per bulan, dibagi per hari sepanjang periode. Pajak ${current.operating.taxRatePercent}% dari total pendapatan.`,
        "Belum termasuk: gaji dan biaya operasional lain di luar sistem.",
        "Komisi ojek hanya tercatat untuk perjalanan yang dibayar TapGoPay; ojek tunai belum memotong komisi.",
        "Saldo dompet dan penarikan tertunda adalah kewajiban, bukan pendapatan atau beban."
      ]
    };
  }

  private async computeProfitLoss(input: DateRangeOnlyInput) {
    const range = this.createdAtRange(input);
    const [
      invoicesPaid,
      invoicesRefunded,
      rideCommission,
      ppob,
      sponsor,
      level,
      reward,
      profitSharing,
      paidInvoices,
      membershipPayments,
      topUpPayments,
      ppobWithoutCost,
      firstUser
    ] = await Promise.all([
      this.prisma.invoice.aggregate({ where: { status: "PAID", ...range }, _sum: { amount: true } }),
      this.prisma.invoice.aggregate({ where: { status: "REFUNDED", ...range }, _sum: { amount: true } }),
      this.prisma.commission.aggregate({
        where: { type: "RIDE_COMPANY_REVENUE", status: { in: ["PENDING", "POSTED"] }, ...range },
        _sum: { amount: true }
      }),
      this.prisma.ppobTransaction.aggregate({
        where: { status: "SUCCESS", ...range },
        _sum: { adminFee: true, totalAmount: true, providerCost: true },
        _count: { _all: true }
      }),
      this.sumCommissionByTypesInRange(sponsorTypes, input),
      this.sumCommissionByTypesInRange(levelTypes, input),
      this.rewardSummaryReport(input),
      this.profitSharingSummaryReport(input),
      this.prisma.invoice.findMany({
        where: { status: "PAID", ...range },
        select: {
          order: {
            select: {
              membership: { select: { tier: true, name: true, hppTotal: true, hppBreakdown: true } }
            }
          }
        }
      }),
      // Biaya gateway: pembayaran Midtrans yang berhasil (paidAt dalam periode).
      this.prisma.membershipPayment.findMany({
        where: { status: "PAID", provider: "MIDTRANS", ...this.paidAtRange(input) },
        select: { amount: true, metadata: true }
      }),
      this.prisma.walletTopUpOrder.findMany({
        where: { status: "PAID", provider: "MIDTRANS", ...this.paidAtRange(input) },
        select: { amount: true, metadata: true }
      }),
      this.prisma.ppobTransaction.count({
        where: { status: "SUCCESS", providerCost: null, ...range }
      }),
      this.prisma.user.aggregate({ _min: { createdAt: true } })
    ]);

    // Biaya gateway per metode. Jenis pembayaran yang tidak dikenal tidak
    // dihitung (dan dilaporkan jumlahnya) daripada menebak tarifnya.
    const gatewayByType = new Map<string, { count: number; gross: Prisma.Decimal; fee: Prisma.Decimal }>();
    let gatewayUnknown = 0;
    let gatewayTotal = new Prisma.Decimal(0);
    for (const payment of [...membershipPayments, ...topUpPayments]) {
      const meta = payment.metadata as { paymentType?: string | null } | null;
      const type = meta?.paymentType ?? null;
      const { known, fee } = midtransFeeFor(type, payment.amount);
      if (!known) {
        gatewayUnknown += 1;
        continue;
      }
      const key = String(type).toLowerCase();
      const row = gatewayByType.get(key) ?? { count: 0, gross: new Prisma.Decimal(0), fee: new Prisma.Decimal(0) };
      row.count += 1;
      row.gross = row.gross.plus(payment.amount);
      row.fee = row.fee.plus(fee);
      gatewayByType.set(key, row);
      gatewayTotal = gatewayTotal.plus(fee);
    }

    // HPP paket: jumlah paket terjual dalam periode x harga pokok per paket.
    const tierMap = new Map<string, { tier: string; name: string; units: number; unitCost: Prisma.Decimal; items: unknown }>();
    for (const row of paidInvoices) {
      const membership = row.order?.membership;
      if (!membership) continue;
      const entry = tierMap.get(membership.tier) ?? {
        tier: membership.tier,
        name: membership.name,
        units: 0,
        unitCost: new Prisma.Decimal(membership.hppTotal),
        items: membership.hppBreakdown
      };
      entry.units += 1;
      tierMap.set(membership.tier, entry);
    }
    const hppTiers = Array.from(tierMap.values()).map((entry) => ({
      tier: entry.tier,
      name: entry.name,
      units: entry.units,
      unitCost: entry.unitCost.toFixed(2),
      total: entry.unitCost.mul(entry.units).toFixed(2),
      items: entry.items ?? null
    }));
    const hppTotal = hppTiers.reduce((sum, tier) => sum.plus(tier.total), new Prisma.Decimal(0));
    const hppMissing = hppTiers.filter((tier) => new Prisma.Decimal(tier.unitCost).isZero()).map((tier) => tier.name);

    const membershipSales = new Prisma.Decimal(invoicesPaid._sum.amount ?? 0);
    const membershipRefunds = new Prisma.Decimal(invoicesRefunded._sum.amount ?? 0);
    const membershipNet = membershipSales.minus(membershipRefunds);
    const rideRevenue = new Prisma.Decimal(rideCommission._sum.amount ?? 0);
    // Penjualan PPOB = yang dibayar pelanggan (harga + biaya admin); harga
    // modal dari provider dicatat sebagai beban terpisah (ppobCost).
    const ppobSales = new Prisma.Decimal(ppob._sum.totalAmount ?? 0);
    const ppobCost = new Prisma.Decimal(ppob._sum.providerCost ?? 0);
    const totalRevenue = membershipNet.plus(rideRevenue).plus(ppobSales);

    const sponsorBonus = new Prisma.Decimal(sponsor._sum.amount ?? 0);
    const levelBonus = new Prisma.Decimal(level._sum.amount ?? 0);
    const rewardPaid = new Prisma.Decimal(reward.totalPaid ?? 0);
    const profitSharingPaid = new Prisma.Decimal(profitSharing.totalPaid ?? 0);
    // Biaya operasional: server (tetap per bulan, dibagi per hari) dan pajak
    // (persentase dari total pendapatan) — asumsi bisa diubah lewat environment.
    const config = plConfig();
    const periodFrom = input.dateFrom ?? firstUser._min.createdAt ?? new Date();
    const periodTo = input.dateTo ?? new Date();
    const server = prorateMonthlyCost(config.serverCostMonthly, periodFrom, periodTo);
    const serverCost = new Prisma.Decimal(server.amount);
    const tax = totalRevenue.gt(0)
      ? totalRevenue.mul(config.taxRatePercent).div(100).toDecimalPlaces(2)
      : new Prisma.Decimal(0);
    const totalExpenses = sponsorBonus
      .plus(levelBonus)
      .plus(rewardPaid)
      .plus(profitSharingPaid)
      .plus(hppTotal)
      .plus(gatewayTotal)
      .plus(ppobCost)
      .plus(serverCost)
      .plus(tax);

    const operatingProfit = totalRevenue.minus(totalExpenses);
    const margin = totalRevenue.gt(0)
      ? operatingProfit.div(totalRevenue).mul(100).toDecimalPlaces(1).toString()
      : null;

    return {
      revenue: {
        membershipSales: membershipSales.toFixed(2),
        membershipRefunds: membershipRefunds.toFixed(2),
        membershipNet: membershipNet.toFixed(2),
        rideCommission: rideRevenue.toFixed(2),
        ppobSales: ppobSales.toFixed(2),
        total: totalRevenue.toFixed(2)
      },
      expenses: {
        sponsorBonus: sponsorBonus.toFixed(2),
        levelBonus: levelBonus.toFixed(2),
        rewardPaid: rewardPaid.toFixed(2),
        profitSharing: profitSharingPaid.toFixed(2),
        hppPackages: hppTotal.toFixed(2),
        gatewayFee: gatewayTotal.toFixed(2),
        ppobCost: ppobCost.toFixed(2),
        serverCost: serverCost.toFixed(2),
        tax: tax.toFixed(2),
        total: totalExpenses.toFixed(2)
      },
      operating: {
        gateway: {
          byMethod: Array.from(gatewayByType.entries()).map(([type, row]) => ({
            type,
            count: row.count,
            gross: row.gross.toFixed(2),
            fee: row.fee.toFixed(2)
          })),
          unknownCount: gatewayUnknown
        },
        ppob: { successCount: ppob._count._all, withoutCostCount: ppobWithoutCost },
        server: { monthly: config.serverCostMonthly, days: server.days },
        taxRatePercent: config.taxRatePercent
      },
      hpp: { tiers: hppTiers, missingTiers: hppMissing },
      operatingProfit: operatingProfit.toFixed(2),
      operatingMarginPercent: margin,
      memo: { ppobGrossSales: new Prisma.Decimal(ppob._sum.totalAmount ?? 0).toFixed(2) }
    };
  }

  async walletLiabilityReport(_input: DateRangeOnlyInput = {}) {
    const [aggregate, cashUsers, ppobUsers] = await Promise.all([
      this.prisma.wallet.aggregate({
        _sum: { balance: true, cashBalance: true, ppobBalance: true }
      }),
      this.prisma.wallet.count({
        where: { cashBalance: { gt: 0 } }
      }),
      this.prisma.wallet.count({
        where: { ppobBalance: { gt: 0 } }
      })
    ]);

    return {
      // `balance` = saldo TapGoPay total (dilihat member & dipakai bayar ojek);
      // `cashBalance` = bagian yang boleh ditarik; PPOB terpisah.
      totalWalletBalance: this.decimal(aggregate._sum.balance),
      totalCashBalance: this.decimal(aggregate._sum.cashBalance),
      totalPpobBalance: this.decimal(aggregate._sum.ppobBalance),
      totalWithdrawableBalance: this.decimal(aggregate._sum.cashBalance),
      totalNonWithdrawablePpob: this.decimal(aggregate._sum.ppobBalance),
      usersWithCashBalance: cashUsers,
      usersWithPpobBalance: ppobUsers
    };
  }

  async commissionSummaryReport(input: DateRangeOnlyInput) {
    const [sponsor, level, reward, profitSharing] = await Promise.all([
      this.sumCommissionByTypesInRange(sponsorTypes, input),
      this.sumCommissionByTypesInRange(levelTypes, input),
      this.sumCommissionByTypesInRange(rewardTypes, input),
      this.sumCommissionByTypesInRange(profitSharingTypes, input)
    ]);

    return {
      sponsorBonusTotal: this.decimal(sponsor._sum.amount),
      levelBonusTotal: this.decimal(level._sum.amount),
      rewardBonusTotal: this.decimal(reward._sum.amount),
      profitSharingTotal: this.decimal(profitSharing._sum.amount),
      period: this.reportPeriod(input)
    };
  }

  async rewardSummaryReport(input: DateRangeOnlyInput) {
    const rows = await this.prisma.rewardTransaction.groupBy({
      by: ["status"],
      where: this.createdAtRange(input),
      _sum: { amount: true },
      _count: { _all: true }
    });

    const summary = {
      countPending: 0,
      countApproved: 0,
      countPaid: 0,
      countRejected: 0,
      totalPending: "0.00",
      totalApproved: "0.00",
      totalPaid: "0.00",
      totalRejected: "0.00"
    };

    for (const row of rows) {
      const amount = this.decimal(row._sum.amount);
      if (row.status === "PENDING") {
        summary.countPending = row._count._all;
        summary.totalPending = amount;
      }
      if (row.status === "APPROVED") {
        summary.countApproved = row._count._all;
        summary.totalApproved = amount;
      }
      if (row.status === "PAID") {
        summary.countPaid = row._count._all;
        summary.totalPaid = amount;
      }
      if (row.status === "REJECTED") {
        summary.countRejected = row._count._all;
        summary.totalRejected = amount;
      }
    }

    return {
      ...summary,
      period: this.reportPeriod(input)
    };
  }

  async profitSharingSummaryReport(input: DateRangeOnlyInput) {
    const [periods, paid] = await Promise.all([
      this.prisma.profitSharingPeriod.aggregate({
        where: this.createdAtRange(input),
        _sum: {
          netProfitAmount: true,
          totalPoolAmount: true,
          silverAllocation: true,
          goldAllocation: true,
          platinumAllocation: true,
          retainedAmount: true
        }
      }),
      this.prisma.profitSharingDistribution.aggregate({
        where: {
          status: "POSTED",
          ...this.createdAtRange(input)
        },
        _sum: { amount: true }
      })
    ]);

    return {
      totalNetProfitInput: this.decimal(periods._sum.netProfitAmount),
      totalPoolAmount: this.decimal(periods._sum.totalPoolAmount),
      totalSilverAllocation: this.decimal(periods._sum.silverAllocation),
      totalGoldAllocation: this.decimal(periods._sum.goldAllocation),
      totalPlatinumAllocation: this.decimal(periods._sum.platinumAllocation),
      totalRetainedUndistributed: this.decimal(periods._sum.retainedAmount),
      totalPaid: this.decimal(paid._sum.amount),
      period: this.reportPeriod(input)
    };
  }

  async ppobSummaryReport(input: DateRangeOnlyInput) {
    const [walletLiability, basic, packageBenefits, packageRows] = await Promise.all([
      this.walletLiabilityReport(input),
      this.prisma.walletTransaction.aggregate({
        where: {
          type: "REGISTRATION_BONUS",
          referenceType: "BASIC_REGISTRATION",
          ...this.createdAtRange(input)
        },
        _sum: { amount: true }
      }),
      this.prisma.walletTransaction.aggregate({
        where: {
          type: "PPOB_BENEFIT",
          ...this.createdAtRange(input)
        },
        _sum: { amount: true }
      }),
      this.prisma.walletTransaction.findMany({
        where: {
          type: "PPOB_BENEFIT",
          ...this.createdAtRange(input)
        },
        select: { amount: true, metadata: true }
      })
    ]);

    const byPackage = new Map<string, Prisma.Decimal>([
      ["SILVER", new Prisma.Decimal(0)],
      ["GOLD", new Prisma.Decimal(0)],
      ["PLATINUM", new Prisma.Decimal(0)],
      ["UNKNOWN", new Prisma.Decimal(0)]
    ]);

    for (const row of packageRows) {
      const metadata = this.asObject(row.metadata);
      const packageName = String(metadata.packageName ?? "UNKNOWN").toUpperCase();
      const key = packageName.includes("SILVER")
        ? "SILVER"
        : packageName.includes("GOLD")
          ? "GOLD"
          : packageName.includes("PLATINUM")
            ? "PLATINUM"
            : "UNKNOWN";
      byPackage.set(key, (byPackage.get(key) ?? new Prisma.Decimal(0)).plus(row.amount));
    }

    return {
      basicRegistrationPpobTotal: this.decimal(basic._sum.amount),
      silverPpobTotal: this.decimal(byPackage.get("SILVER")),
      goldPpobTotal: this.decimal(byPackage.get("GOLD")),
      platinumPpobTotal: this.decimal(byPackage.get("PLATINUM")),
      unknownPackagePpobTotal: this.decimal(byPackage.get("UNKNOWN")),
      packagePpobBenefitTotal: this.decimal(packageBenefits._sum.amount),
      totalPpobLiability: walletLiability.totalPpobBalance,
      totalNonWithdrawablePpob: walletLiability.totalNonWithdrawablePpob,
      period: this.reportPeriod(input)
    };
  }

  async deleteRequests(input: PageInput & { status?: string }) {
    const where: Prisma.AccountDeletionRequestWhereInput = {
      ...(input.status ? { status: input.status as never } : {})
    };
    const [total, items] = await Promise.all([
      this.prisma.accountDeletionRequest.count({ where }),
      this.prisma.accountDeletionRequest.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, phone: true, email: true } } },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);
    return this.page(items, total, input);
  }

  async contactMessages(input: PageInput & { status?: string }) {
    const where: Prisma.ContactMessageWhereInput = {
      ...(input.status ? { status: input.status as never } : {})
    };
    const [total, items] = await Promise.all([
      this.prisma.contactMessage.count({ where }),
      this.prisma.contactMessage.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, phone: true } } },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);
    return this.page(items, total, input);
  }

  async members(input: MemberListInput) {
    const where = this.memberWhere(input);
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: {
          membership: true,
          wallet: true,
          referralRecord: {
            include: {
              sponsor: { select: { id: true, fullName: true, phone: true, referralCode: true } }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    const items = await Promise.all(users.map((user) => this.memberSummary(user)));
    return this.page(items, total, input);
  }

  async memberDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        wallet: true,
        referralRecord: {
          include: {
            sponsor: { select: { id: true, fullName: true, phone: true, referralCode: true } }
          }
        },
        userMemberships: {
          where: { status: "ACTIVE" },
          include: {
            membership: { include: { benefits: true } },
            order: { include: { invoice: true } }
          },
          orderBy: { activeAt: "desc" },
          take: 1
        },
        invoices: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            order: { include: { membership: true } },
            payments: { orderBy: { createdAt: "desc" }, take: 3 }
          }
        },
        commissions: {
          orderBy: { createdAt: "desc" },
          take: 20
        }
      }
    });

    if (!user) {
      throw new AppError("Member not found", StatusCodes.NOT_FOUND, "ADMIN_MEMBER_NOT_FOUND");
    }

    return {
      ...(await this.memberSummary(user)),
      profile: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        referralCode: user.referralCode,
        status: user.status,
        joinedAt: user.createdAt
      },
      activeMembership: user.userMemberships[0] ?? null,
      invoices: user.invoices,
      commissions: user.commissions
    };
  }

  async payments(input: PaymentListInput) {
    const where = input.status ? { status: input.status } : {};
    const [total, items] = await Promise.all([
      this.prisma.membershipPayment.count({ where }),
      this.prisma.membershipPayment.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
          invoice: true,
          order: { include: { membership: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  async invoices(input: PaymentListInput) {
    const where = input.status ? { status: input.status } : {};
    const [total, items] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
          order: { include: { membership: true } },
          payments: { orderBy: { createdAt: "desc" }, take: 1 }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  async commissions(input: CommissionListInput) {
    const where: Prisma.CommissionWhereInput = {
      ...(input.type ? { type: input.type } : {}),
      ...(input.bonusType ? { type: { in: this.typesForBonus(input.bonusType) } } : {})
    };
    const [total, items] = await Promise.all([
      this.prisma.commission.count({ where }),
      this.prisma.commission.findMany({
        where,
        include: {
          beneficiary: { select: { id: true, fullName: true, phone: true, referralCode: true } },
          referral: {
            include: {
              user: { select: { id: true, fullName: true, phone: true } }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  async wallets(input: PageInput) {
    const [total, items] = await Promise.all([
      this.prisma.wallet.count(),
      this.prisma.wallet.findMany({
        include: {
          user: { select: { id: true, fullName: true, phone: true, referralCode: true, membership: true } },
          _count: { select: { ledger: true, withdrawals: true } }
        },
        orderBy: { cashBalance: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return this.page(items, total, input);
  }

  async walletTransactions(userId: string, input: PageInput) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      include: { user: { select: { id: true, fullName: true, phone: true } } }
    });

    if (!wallet) {
      return this.page([], 0, input);
    }

    const [total, items] = await Promise.all([
      this.prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      })
    ]);

    return {
      wallet,
      ...this.page(items, total, input)
    };
  }

  private async memberSummary(user: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string;
    referralCode: string;
    createdAt: Date;
    membership: { tier: MembershipTier; name: string } | null;
    wallet: { balance: Prisma.Decimal; cashBalance: Prisma.Decimal; ppobBalance: Prisma.Decimal } | null;
    referralRecord: {
      sponsor: { id: string; fullName: string; phone: string; referralCode: string };
    } | null;
  }) {
    const [directSponsorCount, totalDownline, commissionTotal, activeMembership, signupEvent] = await Promise.all([
      this.prisma.referral.count({ where: { sponsorId: user.id, status: "ACTIVE" } }),
      this.prisma.referralLevel.count({ where: { ancestorId: user.id } }),
      this.prisma.commission.aggregate({
        where: { beneficiaryId: user.id, status: "POSTED" },
        _sum: { amount: true }
      }),
      this.prisma.userMembership.findFirst({
        where: { userId: user.id, status: "ACTIVE" },
        include: {
          membership: true,
          order: { include: { invoice: true } }
        },
        orderBy: { activeAt: "desc" }
      }),
      this.prisma.registrationEvent.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        select: { distribution: true, installer: true }
      })
    ]);

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      referralCode: user.referralCode,
      // PLAY = build Play + installer Google Play; OTHER = build lain/APK langsung; UNKNOWN = tanpa data (akun lama).
      signupSource: signupSourceOf(signupEvent),
      joinedAt: user.createdAt,
      membership: user.membership,
      activeMembership,
      sponsor: user.referralRecord?.sponsor ?? null,
      directSponsorCount,
      totalDownline,
      // Sama dengan aplikasi/web: saldo TapGoPay = wallet.balance; sebagian di antaranya
      // (cashBalance) yang dapat ditarik.
      walletBalance: this.decimal(user.wallet?.balance),
      withdrawableBalance: this.decimal(user.wallet?.cashBalance),
      // Saldo PPOB NYATA di dompet member (termasuk bonus Basic Rp5.000), bukan
      // jatah PPOB paket — yang terakhir 0 untuk Basic dan menyesatkan.
      ppobBalance: this.decimal(user.wallet?.ppobBalance),
      commissionTotal: this.decimal(commissionTotal._sum.amount)
    };
  }

  private memberWhere(input: MemberListInput): Prisma.UserWhereInput {
    return {
      role: "USER",
      ...(input.package ? { membership: { tier: input.package } } : {}),
      ...(input.status ? { status: input.status as never } : {}),
      ...(input.activeDays
        ? (() => {
            const since = new Date();
            since.setUTCDate(since.getUTCDate() - input.activeDays);
            return { lastLoginAt: { gte: since } };
          })()
        : {}),
      ...(input.registeredDays ? { createdAt: { gte: wibDayStart(input.registeredDays - 1) } } : {}),
      ...(input.source === "PLAY"
        ? { registrationEvents: { some: PLAY_INSTALL } }
        : input.source === "UNKNOWN"
          ? { registrationEvents: { none: { distribution: { not: null } } } }
          : input.source === "OTHER"
            ? {
                AND: [
                  { registrationEvents: { some: { distribution: { not: null } } } },
                  { NOT: { registrationEvents: { some: PLAY_INSTALL } } }
                ]
              }
            : {}),
      ...(input.search
        ? {
            OR: [
              { fullName: { contains: input.search, mode: "insensitive" } },
              { phone: { contains: input.search, mode: "insensitive" } },
              { referralCode: { contains: input.search, mode: "insensitive" } }
            ]
          }
        : {})
    };
  }

  private sumCommissionByTypes(types: CommissionType[]) {
    return this.prisma.commission.aggregate({
      where: { status: "POSTED", type: { in: types } },
      _sum: { amount: true }
    });
  }

  private sumCommissionByTypesInRange(types: CommissionType[], input: DateRangeOnlyInput) {
    return this.prisma.commission.aggregate({
      where: {
        status: "POSTED",
        type: { in: types },
        ...this.createdAtRange(input)
      },
      _sum: { amount: true }
    });
  }

  private async sumWalletTransactions(types: WalletTransactionType[]) {
    const result = await this.prisma.walletTransaction.aggregate({
      where: { type: { in: types } },
      _sum: { amount: true }
    });
    return this.decimal(result._sum.amount);
  }

  private paidAtRange(input: { dateFrom?: Date; dateTo?: Date }) {
    if (!input.dateFrom && !input.dateTo) {
      return {};
    }
    return {
      paidAt: {
        ...(input.dateFrom ? { gte: input.dateFrom } : {}),
        ...(input.dateTo ? { lte: input.dateTo } : {})
      }
    };
  }

  private createdAtRange(input: { dateFrom?: Date; dateTo?: Date }) {
    if (!input.dateFrom && !input.dateTo) {
      return {};
    }
    return {
      createdAt: {
        ...(input.dateFrom ? { gte: input.dateFrom } : {}),
        ...(input.dateTo ? { lte: input.dateTo } : {})
      }
    };
  }

  private requestedAtRange(input: { dateFrom?: Date; dateTo?: Date }) {
    if (!input.dateFrom && !input.dateTo) {
      return {};
    }
    return {
      requestedAt: {
        ...(input.dateFrom ? { gte: input.dateFrom } : {}),
        ...(input.dateTo ? { lte: input.dateTo } : {})
      }
    };
  }

  private async membershipBreakdown() {
    const [memberships, packageCounts] = await Promise.all([
      this.prisma.membership.findMany({ select: { id: true, tier: true } }),
      this.prisma.user.groupBy({
        by: ["membershipId"],
        where: { role: "USER", status: "ACTIVE" },
        _count: { _all: true }
      })
    ]);

    const tierByMembershipId = new Map(memberships.map((item) => [item.id, item.tier]));
    const countByTier: Record<MembershipTier, number> = {
      BASIC: 0,
      SILVER: 0,
      GOLD: 0,
      PLATINUM: 0
    };

    for (const row of packageCounts) {
      const tier = row.membershipId ? tierByMembershipId.get(row.membershipId) : "BASIC";
      countByTier[tier ?? "BASIC"] += row._count._all;
    }

    return countByTier;
  }

  private asObject(value: Prisma.JsonValue | null | undefined) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private mergeMetadata(value: Prisma.JsonValue | null | undefined, patch: Prisma.InputJsonObject): Prisma.InputJsonObject {
    return {
      ...(this.asObject(value) as Prisma.InputJsonObject),
      ...patch
    };
  }

  private rewardInclude() {
    return {
      user: { select: { id: true, fullName: true, phone: true, referralCode: true, membership: true } },
      wallet: true,
      walletTransaction: true
    } satisfies Prisma.RewardTransactionInclude;
  }

  private reportPeriod(input: DateRangeOnlyInput) {
    return {
      dateFrom: input.dateFrom?.toISOString() ?? null,
      dateTo: input.dateTo?.toISOString() ?? null
    };
  }

  private typesForBonus(type: "sponsor" | "level" | "reward" | "profit_sharing") {
    return {
      sponsor: sponsorTypes,
      level: levelTypes,
      reward: rewardTypes,
      profit_sharing: profitSharingTypes
    }[type];
  }

  private decimal(value: Prisma.Decimal | null | undefined) {
    return value?.toFixed(2) ?? "0.00";
  }

  private skip(input: PageInput) {
    return (input.page - 1) * input.pageSize;
  }

  private page<T>(items: T[], total: number, input: PageInput) {
    return {
      items,
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: Math.ceil(total / input.pageSize)
      }
    };
  }
}
