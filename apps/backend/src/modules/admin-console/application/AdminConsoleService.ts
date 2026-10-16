import {
  CommissionType,
  CommissionStatus,
  MembershipOrderStatus,
  MembershipTier,
  PaymentStatus,
  PpobCategory,
  PpobTransactionStatus,
  Prisma,
  PrismaClient,
  RewardTransactionStatus,
  WalletTransactionType
} from "@prisma/client";
import crypto from "node:crypto";
import { StatusCodes } from "http-status-codes";
import {
  TOPUP_METHODS,
  companyBorneGatewayFee,
  isTopUpMethod,
  midtransFeeFor,
  type TopUpMethod
} from "../../../core/finance/midtransFees.js";
import { plConfig, prorateMonthlyCost } from "../../../core/finance/plConfig.js";
import { POSTPAID_CATEGORIES } from "../../ppob/domain/ppobProvider.js";
import { assessPpobMargin, scanPpobMargins } from "../../ppob/application/ppobMarginAudit.js";
import { DigiflazzBalanceService, digiflazzBalanceService } from "../../ppob/application/DigiflazzBalanceService.js";
import { env } from "../../../config/env.js";
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

/** Transaksi PPOB yang masih PENDING/PROCESSING lebih lama dari ini dianggap tertahan (rekonsiliasi belum menyelesaikannya). */
const DIGIFLAZZ_STUCK_AFTER_MS = 10 * 60 * 1000;

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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly digiflazzBalance: DigiflazzBalanceService = digiflazzBalanceService
  ) {}

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
      // Serial/token (mis. token PLN) dapat dipakai siapa pun yang memegangnya; hanya pemilik transaksi yang berhak.
      ...this.page(
        items.map(({ serialNumber: _serialNumber, ...row }) => row),
        total,
        input
      )
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
      // Tanggal DIBAYAR, sama dengan laba rugi: invoice yang dibuat di satu periode dan dibayar di periode lain
      // dihitung di periode pembayarannya.
      this.prisma.invoice.aggregate({
        where: { status: "PAID", ...this.invoicePaidDateRange(input) },
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
   * Laporan laba rugi manajemen, dihitung dari data operasional sistem dan disusun mengikuti struktur
   * Laporan Laba Rugi menurut SAK Indonesia (SAK EMKM / SAK ETAP, PSAK 1):
   *
   *   Pendapatan usaha (tanpa PPN)
   *   - Beban pokok pendapatan (HPP paket, harga pokok PPOB)
   *   = Laba kotor
   *   - Beban usaha (insentif mitra, biaya gateway, server)
   *   = Laba usaha  (= laba sebelum pajak; tidak ada pendapatan/beban lain yang tercatat)
   *   - Beban pajak penghasilan
   *   = Laba bersih
   *
   * Pengakuan: pendapatan membership pada tanggal pembayaran; saldo PPOB yang diberikan sebagai manfaat
   * ditangguhkan (pendapatan diterima di muka) dan baru diakui saat dipakai; tagihan pascabayar disajikan neto
   * (hanya biaya layanan, TapGo bertindak sebagai agen); PPN keluaran dikeluarkan dari pendapatan.
   *
   * BUKAN laporan keuangan teraudit. Hal yang bergantung pada perlakuan pajak dan kontrak disebut di `notes`
   * dan perlu ditinjau akuntan.
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
            totalExpenses: previous.totalExpenses,
            netProfit: previous.netProfit
          }
        : null,
      memo: {
        ...current.memo,
        walletLiabilityWallet: walletLiability.totalWalletBalance,
        walletLiabilityCash: walletLiability.totalCashBalance,
        walletLiabilityPpob: walletLiability.totalPpobBalance,
        withdrawalsOutstanding: this.decimal(withdrawPending._sum.amount)
      },
      notes: [
        "Laporan manajemen dari data sistem TapGo, disusun mengikuti struktur laporan laba rugi SAK Indonesia; bukan laporan keuangan teraudit dan perlu ditinjau akuntan sebelum dipakai untuk pelaporan resmi.",
        current.assumptions.ppnInclusive
          ? `Pendapatan disajikan tanpa PPN ${current.assumptions.ppnRatePercent}% (PKP, harga jual sudah termasuk PPN): membership dan biaya layanan tagihan dikurangi PPN atas seluruh nilainya, sedangkan PPOB prabayar hanya dikurangi PPN atas margin (penjualan dikurangi harga pokok). PPN keluaran adalah kewajiban kepada negara, bukan pendapatan maupun beban, dan ditampilkan di bagian catatan. Komisi ojek belum dipisahkan dari PPN.`
          : "PPN tidak diperhitungkan (PL_PPN_MODE=NONE): pendapatan sama dengan harga yang dibayar pelanggan.",
        current.incomeTax.mode === "FINAL_OMZET"
          ? `Pajak penghasilan memakai PPh final ${current.incomeTax.ratePercent}% dari pendapatan bruto (tanpa PPN). Dasar pengenaan sebenarnya adalah penerimaan bruto menurut ketentuan pajak; angka ini perkiraan.`
          : current.incomeTax.mode === "CORPORATE"
            ? `Pajak penghasilan memakai PPh badan ${current.incomeTax.ratePercent}% dari laba sebelum pajak (nol bila rugi), tanpa koreksi fiskal.`
            : "Pajak penghasilan belum dihitung (PL_INCOME_TAX_MODE=NONE); laba bersih sama dengan laba sebelum pajak.",
        ...(current.hpp.missingTiers.length > 0
          ? [`HPP paket ${current.hpp.missingTiers.join(", ")} belum diisi, jadi belum dihitung sebagai beban pokok.`]
          : []),
        "Saldo PPOB yang diberikan sebagai manfaat paket dicatat sebagai pendapatan diterima di muka: dikeluarkan dari pendapatan membership dan dari HPP paket, lalu diakui sebagai pendapatan dan harga pokok PPOB saat saldo dipakai membeli. Saldo yang belum terpakai tampil sebagai kewajiban.",
        "Pendapatan PPOB prabayar (pulsa, token, paket data) disajikan bruto; tagihan pascabayar (PLN, BPJS, PDAM, dan sejenisnya) disajikan neto, yaitu hanya biaya layanan TapGo.",
        "Biaya gateway dihitung dari tarif publik Midtrans per metode, termasuk PPN atas biaya tersebut (belum termasuk potongan lain di kontrak Anda). Pembayaran dengan jenis tidak dikenal tidak dihitung.",
        ...(current.operating.gateway.unknownCount > 0
          ? [`${current.operating.gateway.unknownCount} pembayaran Midtrans tanpa jenis pembayaran tercatat, jadi biayanya belum dihitung.`]
          : []),
        "Harga pokok PPOB diambil dari harga yang ditagihkan Digiflazz saat transaksi sukses.",
        ...(current.operating.ppob.withoutCostCount > 0
          ? [`${current.operating.ppob.withoutCostCount} transaksi PPOB sukses tanpa harga modal tercatat: pada prabayar pendapatannya dihitung tetapi harga pokoknya belum; pada pascabayar belum dihitung sama sekali.`]
          : []),
        "Insentif mitra (bonus sponsor, bonus tingkat, reward milestone, bagi hasil) disajikan sebagai beban usaha. Bonus diakui saat dikreditkan, reward saat milestone tercapai.",
        `Server dihitung Rp${new Intl.NumberFormat("id-ID").format(current.operating.server.monthly)} per bulan, dibagi per hari sepanjang periode.`,
        "Belum termasuk: gaji dan biaya operasional lain di luar sistem, penyusutan, serta pendapatan/beban lain-lain.",
        "Komisi ojek hanya tercatat untuk perjalanan yang dibayar TapGoPay; komisi pesanan tunai yang dipotong dari saldo driver belum dihitung sebagai pendapatan.",
        "Saldo dompet, saldo PPOB, dan penarikan tertunda adalah kewajiban, bukan pendapatan atau beban."
      ]
    };
  }

  /**
   * Rentang untuk invoice: tanggal dibayar; invoice yang (data lama) belum punya paidAt memakai tanggal dibuat.
   */
  private invoicePaidDateRange(input: { dateFrom?: Date; dateTo?: Date }) {
    if (!input.dateFrom && !input.dateTo) {
      return {};
    }
    const bounds = {
      ...(input.dateFrom ? { gte: input.dateFrom } : {}),
      ...(input.dateTo ? { lte: input.dateTo } : {})
    };
    return { OR: [{ paidAt: bounds }, { paidAt: null, createdAt: bounds }] };
  }

  private async computeProfitLoss(input: DateRangeOnlyInput) {
    const range = this.createdAtRange(input);
    const invoiceDateRange = this.invoicePaidDateRange(input);
    const [
      invoicesPaid,
      invoicesRefunded,
      rideCommission,
      cashCommission,
      ppobAllByCategory,
      ppobCostedByCategory,
      sponsor,
      level,
      reward,
      profitSharing,
      driverIncentives,
      paidInvoices,
      membershipPayments,
      topUpPayments,
      ppobWithoutCost,
      firstUser
    ] = await Promise.all([
      // Penjualan membership dicatat pada tanggal DIBAYAR (bukan tanggal invoice dibuat), sama dengan biaya
      // gateway. Pengembalian dana mengubah invoice dari PAID menjadi REFUNDED, jadi invoice PAID saja =
      // penjualan bersih; penjualan kotor = PAID + REFUNDED.
      this.prisma.invoice.aggregate({ where: { status: "PAID", ...invoiceDateRange }, _sum: { amount: true } }),
      this.prisma.invoice.aggregate({ where: { status: "REFUNDED", ...invoiceDateRange }, _sum: { amount: true } }),
      this.prisma.commission.aggregate({
        where: { type: "RIDE_COMPANY_REVENUE", status: { in: ["PENDING", "POSTED"] }, ...range },
        _sum: { amount: true }
      }),
      // Komisi pesanan TUNAI yang sudah final (ditahan dari Saldo TapGo driver saat diterima, menjadi biaya final saat
      // perjalanan selesai). Tidak masuk tabel komisi: hanya tercatat di buku saldo. Yang masih ditahan (HELD) atau
      // sudah dikembalikan (RELEASED, perjalanan dibatalkan) bukan pendapatan.
      this.prisma.walletTransaction.aggregate({
        where: { type: "PAYMENT", referenceType: "RIDE_COMMISSION_FEE", metadata: { path: ["status"], equals: "FINALIZED" }, ...range },
        _sum: { amount: true }
      }),
      this.prisma.ppobTransaction.groupBy({
        by: ["category"],
        where: { status: "SUCCESS", ...range },
        _sum: { totalAmount: true },
        _count: { _all: true }
      }),
      this.prisma.ppobTransaction.groupBy({
        by: ["category"],
        where: { status: "SUCCESS", providerCost: { not: null }, ...range },
        _sum: { totalAmount: true, providerCost: true }
      }),
      this.sumCommissionByTypesInRange(sponsorTypes, input),
      this.sumCommissionByTypesInRange(levelTypes, input),
      this.rewardSummaryReport(input),
      this.profitSharingSummaryReport(input),
      // Bonus insentif harian yang benar-benar dibayarkan ke driver (beban usaha), per tanggal pencairan. Klaim yang
      // ditahan, ditolak, atau ditarik kembali (REVERSED) bukan beban.
      this.prisma.driverIncentiveClaim.aggregate({
        where: {
          status: "PAID",
          ...(input.dateFrom || input.dateTo
            ? { settledAt: { ...(input.dateFrom ? { gte: input.dateFrom } : {}), ...(input.dateTo ? { lte: input.dateTo } : {}) } }
            : {})
        },
        _sum: { amount: true }
      }),
      this.prisma.invoice.findMany({
        where: { status: "PAID", ...invoiceDateRange },
        select: {
          order: {
            select: {
              membership: { select: { tier: true, name: true, hppTotal: true, hppBreakdown: true, ppobBalance: true } }
            }
          }
        }
      }),
      // Biaya gateway: pembayaran Midtrans yang berhasil (paidAt dalam periode).
      this.prisma.membershipPayment.findMany({
        // REFUNDED ikut: Midtrans tetap memungut biaya transaksi walau dananya dikembalikan ke pembeli.
        where: { status: { in: ["PAID", "REFUNDED"] }, provider: "MIDTRANS", ...this.paidAtRange(input) },
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

    const zero = new Prisma.Decimal(0);
    const dec = (value: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(value ?? 0);

    // ---- Asumsi pajak (PL_* di environment) ------------------------------------------------------------
    const config = plConfig();
    const ppnInclusive = config.ppnMode === "INCLUSIVE";
    const ppnFactor = ppnInclusive ? new Prisma.Decimal(100).plus(config.ppnRatePercent).div(100) : new Prisma.Decimal(1);
    /** Nilai tanpa PPN (dasar pengenaan pajak) dari harga jual yang sudah termasuk PPN. */
    const exPpn = (value: Prisma.Decimal) => value.div(ppnFactor).toDecimalPlaces(2);

    // ---- Biaya gateway per metode. Jenis yang tidak dikenal tidak dihitung (dan dilaporkan jumlahnya). ----
    const gatewayByType = new Map<string, { count: number; gross: Prisma.Decimal; fee: Prisma.Decimal }>();
    let gatewayUnknown = 0;
    let gatewayTotal = zero;
    const addGateway = (type: string | null, gross: Prisma.Decimal.Value, fee: Prisma.Decimal) => {
      const key = String(type).toLowerCase();
      const row = gatewayByType.get(key) ?? { count: 0, gross: zero, fee: zero };
      row.count += 1;
      row.gross = row.gross.plus(gross);
      row.fee = row.fee.plus(fee);
      gatewayByType.set(key, row);
      gatewayTotal = gatewayTotal.plus(fee);
    };
    // Membership: seluruh biaya Midtrans adalah beban perusahaan (harga membership tidak ditambah biaya).
    for (const payment of membershipPayments) {
      const meta = payment.metadata as { paymentType?: string | null } | null;
      const type = meta?.paymentType ?? null;
      const { known, fee } = midtransFeeFor(type, payment.amount);
      if (!known) {
        gatewayUnknown += 1;
        continue;
      }
      addGateway(type, payment.amount, fee);
    }
    // Top up online: beban perusahaan = biaya Midtrans sebenarnya (dari metode yang dibayar, atas total tagihan)
    // dikurangi biaya layanan yang dibayar pelanggan. Saldo PPOB: pelanggan menanggung penuh, jadi selisihnya nol.
    // Saldo TapGo: pelanggan membayar sampai batas (Rp2.500 bawaan), sisanya beban perusahaan.
    for (const payment of topUpPayments) {
      const meta = payment.metadata as {
        paymentType?: string | null;
        method?: string | null;
        feeBorneByCustomer?: boolean;
        feeAmount?: number;
        grossAmount?: number;
      } | null;
      // Pesanan lama (sebelum biaya per metode): ditandai ditanggung penuh oleh pelanggan, tanpa rincian biaya.
      if (meta?.feeBorneByCustomer === true && meta.feeAmount === undefined) continue;
      const gross = typeof meta?.grossAmount === "number" ? meta.grossAmount : Number(payment.amount);
      const customerFee = typeof meta?.feeAmount === "number" ? meta.feeAmount : 0;
      const type = meta?.paymentType ?? (isTopUpMethod(meta?.method) ? TOPUP_METHODS[meta!.method as TopUpMethod].paymentType : null);
      const { known, fee } = companyBorneGatewayFee(type, gross, customerFee);
      if (!known) {
        gatewayUnknown += 1;
        continue;
      }
      if (fee.isZero()) continue;
      addGateway(type, gross, fee);
    }

    // ---- HPP paket: jumlah paket terjual x harga pokok per paket, TANPA saldo PPOB yang diberikan ----------
    // Saldo PPOB adalah pendapatan diterima di muka (kewajiban) yang baru menjadi beban saat dipakai
    // (harga pokok PPOB), sehingga tidak dihitung dua kali di HPP paket.
    const tierMap = new Map<
      string,
      { tier: string; name: string; units: number; fullCost: Prisma.Decimal; ppobBenefit: Prisma.Decimal; items: unknown }
    >();
    for (const row of paidInvoices) {
      const membership = row.order?.membership;
      if (!membership) continue;
      const entry = tierMap.get(membership.tier) ?? {
        tier: membership.tier,
        name: membership.name,
        units: 0,
        fullCost: dec(membership.hppTotal),
        ppobBenefit: dec(membership.ppobBalance),
        items: membership.hppBreakdown
      };
      entry.units += 1;
      tierMap.set(membership.tier, entry);
    }
    let deferredPpobIncl = zero;
    const hppTiers = Array.from(tierMap.values()).map((entry) => {
      const excluded = Prisma.Decimal.min(entry.ppobBenefit, entry.fullCost);
      const unitCost = entry.fullCost.minus(excluded);
      deferredPpobIncl = deferredPpobIncl.plus(entry.ppobBenefit.mul(entry.units));
      return {
        tier: entry.tier,
        name: entry.name,
        units: entry.units,
        unitCost: unitCost.toFixed(2),
        fullUnitCost: entry.fullCost.toFixed(2),
        ppobBenefit: excluded.toFixed(2),
        total: unitCost.mul(entry.units).toFixed(2),
        items: entry.items ?? null
      };
    });
    const hppTotal = hppTiers.reduce((sum, tier) => sum.plus(tier.total), zero);
    const hppMissing = hppTiers.filter((tier) => new Prisma.Decimal(tier.fullUnitCost).isZero()).map((tier) => tier.name);

    // ---- Pendapatan --------------------------------------------------------------------------------------
    // Invoice yang dikembalikan sudah BUKAN PAID, jadi penjualan kotor = PAID + REFUNDED.
    const refundsIncl = dec(invoicesRefunded._sum.amount);
    const salesIncl = dec(invoicesPaid._sum.amount).plus(refundsIncl);
    const membershipSales = exPpn(salesIncl);
    const membershipRefunds = exPpn(refundsIncl);
    const membershipNet = membershipSales.minus(membershipRefunds);
    const membershipDeferred = exPpn(deferredPpobIncl);
    const membershipRecognized = membershipNet.minus(membershipDeferred);
    // Komisi digital (tabel komisi) + komisi tunai final (buku saldo; nominalnya tercatat negatif sebagai debit driver).
    const rideCommissionCash = dec(cashCommission._sum.amount).abs();
    const rideRevenue = dec(rideCommission._sum.amount).plus(rideCommissionCash);

    // PPOB: prabayar bruto (penjualan - harga pokok); pascabayar neto (hanya biaya layanan TapGo).
    let prepaidSalesIncl = zero;
    let prepaidCostedSales = zero;
    let prepaidCost = zero;
    let postpaidFeeIncl = zero;
    let ppobSuccessCount = 0;
    let ppobGrossAll = zero;
    for (const row of ppobAllByCategory) {
      ppobSuccessCount += row._count._all;
      ppobGrossAll = ppobGrossAll.plus(dec(row._sum.totalAmount));
      if (!POSTPAID_CATEGORIES.has(row.category)) prepaidSalesIncl = prepaidSalesIncl.plus(dec(row._sum.totalAmount));
    }
    for (const row of ppobCostedByCategory) {
      if (POSTPAID_CATEGORIES.has(row.category)) {
        postpaidFeeIncl = postpaidFeeIncl.plus(dec(row._sum.totalAmount).minus(dec(row._sum.providerCost)));
      } else {
        prepaidCostedSales = prepaidCostedSales.plus(dec(row._sum.totalAmount));
        prepaidCost = prepaidCost.plus(dec(row._sum.providerCost));
      }
    }
    // PPN atas penjualan prabayar (pulsa, token, paket data) hanya dikenakan pada margin penjualan, bukan seluruh
    // harga. PPN margin = margin x tarif/(100+tarif); penjualan tanpa harga modal tercatat belum bisa dihitung marginnya.
    const ppnShare = ppnInclusive ? new Prisma.Decimal(config.ppnRatePercent).div(new Prisma.Decimal(100).plus(config.ppnRatePercent)) : zero;
    const prepaidPpn = prepaidCostedSales.minus(prepaidCost).mul(ppnShare).toDecimalPlaces(2);
    const ppobPrepaidSales = prepaidSalesIncl.minus(prepaidPpn);
    const ppobPostpaidFee = exPpn(postpaidFeeIncl);
    const ppobSales = ppobPrepaidSales.plus(ppobPostpaidFee);
    const ppnOutput = ppnInclusive
      ? dec(invoicesPaid._sum.amount)
          .minus(exPpn(dec(invoicesPaid._sum.amount)))
          .plus(prepaidPpn)
          .plus(postpaidFeeIncl.minus(ppobPostpaidFee))
      : zero;
    const totalRevenue = membershipRecognized.plus(rideRevenue).plus(ppobSales);

    // ---- Beban pokok pendapatan ---------------------------------------------------------------------------
    const cogsTotal = hppTotal.plus(prepaidCost);
    const grossProfit = totalRevenue.minus(cogsTotal);

    // ---- Beban usaha -----------------------------------------------------------------------------------------
    const sponsorBonus = dec(sponsor._sum.amount);
    const levelBonus = dec(level._sum.amount);
    const rewardPaid = dec(reward.totalPaid);
    // Reward milestone adalah kewajiban yang lahir saat milestone tercapai (mis. upgrade member membuat sponsor
    // mencapai 10 Silver langsung), bukan saat admin membayarnya. Yang REJECTED tidak dihitung.
    const rewardAccrued = rewardPaid.plus(dec(reward.totalApproved)).plus(dec(reward.totalPending));
    const profitSharingPaid = dec(profitSharing.totalPaid);
    const driverIncentiveCost = dec(driverIncentives._sum.amount);
    const periodFrom = input.dateFrom ?? firstUser._min.createdAt ?? new Date();
    const periodTo = input.dateTo ?? new Date();
    const server = prorateMonthlyCost(config.serverCostMonthly, periodFrom, periodTo);
    const serverCost = new Prisma.Decimal(server.amount);
    const opexTotal = sponsorBonus
      .plus(levelBonus)
      .plus(rewardAccrued)
      .plus(profitSharingPaid)
      .plus(driverIncentiveCost)
      .plus(gatewayTotal)
      .plus(serverCost);

    // ---- Laba usaha, pajak penghasilan, laba bersih -----------------------------------------------------------
    const operatingProfit = grossProfit.minus(opexTotal);
    const profitBeforeTax = operatingProfit;
    const incomeTaxRate =
      config.incomeTaxMode === "FINAL_OMZET"
        ? config.finalTaxRatePercent
        : config.incomeTaxMode === "CORPORATE"
          ? config.corporateTaxRatePercent
          : 0;
    const incomeTax =
      config.incomeTaxMode === "FINAL_OMZET"
        ? (totalRevenue.gt(0) ? totalRevenue.mul(incomeTaxRate).div(100).toDecimalPlaces(2) : zero)
        : config.incomeTaxMode === "CORPORATE"
          ? (profitBeforeTax.gt(0) ? profitBeforeTax.mul(incomeTaxRate).div(100).toDecimalPlaces(2) : zero)
          : zero;
    const netProfit = profitBeforeTax.minus(incomeTax);
    const totalExpenses = cogsTotal.plus(opexTotal).plus(incomeTax);
    const percentOfRevenue = (value: Prisma.Decimal) =>
      totalRevenue.gt(0) ? value.div(totalRevenue).mul(100).toDecimalPlaces(1).toString() : null;

    return {
      revenue: {
        membershipSales: membershipSales.toFixed(2),
        membershipRefunds: membershipRefunds.toFixed(2),
        membershipNet: membershipNet.toFixed(2),
        membershipDeferred: membershipDeferred.toFixed(2),
        membershipRecognized: membershipRecognized.toFixed(2),
        rideCommission: rideRevenue.toFixed(2),
        rideCommissionCash: rideCommissionCash.toFixed(2),
        ppobPrepaid: ppobPrepaidSales.toFixed(2),
        ppobPostpaidFee: ppobPostpaidFee.toFixed(2),
        ppobSales: ppobSales.toFixed(2),
        total: totalRevenue.toFixed(2)
      },
      cogs: {
        hppPackages: hppTotal.toFixed(2),
        ppobCost: prepaidCost.toFixed(2),
        total: cogsTotal.toFixed(2)
      },
      grossProfit: grossProfit.toFixed(2),
      opex: {
        sponsorBonus: sponsorBonus.toFixed(2),
        levelBonus: levelBonus.toFixed(2),
        rewardAccrued: rewardAccrued.toFixed(2),
        rewardPaid: rewardPaid.toFixed(2),
        profitSharing: profitSharingPaid.toFixed(2),
        driverIncentives: driverIncentiveCost.toFixed(2),
        gatewayFee: gatewayTotal.toFixed(2),
        serverCost: serverCost.toFixed(2),
        total: opexTotal.toFixed(2)
      },
      operatingProfit: operatingProfit.toFixed(2),
      profitBeforeTax: profitBeforeTax.toFixed(2),
      incomeTax: {
        mode: config.incomeTaxMode,
        ratePercent: incomeTaxRate,
        amount: incomeTax.toFixed(2)
      },
      netProfit: netProfit.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      grossMarginPercent: percentOfRevenue(grossProfit),
      operatingMarginPercent: percentOfRevenue(operatingProfit),
      netMarginPercent: percentOfRevenue(netProfit),
      assumptions: {
        ppnInclusive,
        ppnRatePercent: config.ppnRatePercent
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
        ppob: { successCount: ppobSuccessCount, withoutCostCount: ppobWithoutCost },
        server: { monthly: config.serverCostMonthly, days: server.days }
      },
      hpp: { tiers: hppTiers, missingTiers: hppMissing },
      memo: {
        ppobGrossSales: ppobGrossAll.toFixed(2),
        ppnOutput: ppnOutput.toFixed(2)
      }
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
    const range = this.createdAtRange(input);
    const paidRange = input.dateFrom || input.dateTo
      ? {
          paidAt: {
            ...(input.dateFrom ? { gte: input.dateFrom } : {}),
            ...(input.dateTo ? { lte: input.dateTo } : {})
          }
        }
      : {};
    const [walletLiability, basic, packageBenefits, packageRows, salesAll, salesCosted, openTx, failedTx, topUpGroups] = await Promise.all([
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
      }),
      // Penjualan PPOB sungguhan (dibayar dari saldo PPOB pelanggan) dan modalnya di Digiflazz.
      this.prisma.ppobTransaction.aggregate({
        where: { status: "SUCCESS", ...range },
        _sum: { totalAmount: true },
        _count: { _all: true }
      }),
      this.prisma.ppobTransaction.aggregate({
        where: { status: "SUCCESS", providerCost: { not: null }, ...range },
        _sum: { totalAmount: true, providerCost: true },
        _count: { _all: true }
      }),
      this.prisma.ppobTransaction.aggregate({
        where: { status: { in: ["PENDING", "PROCESSING"] }, ...range },
        _sum: { totalAmount: true },
        _count: { _all: true }
      }),
      this.prisma.ppobTransaction.aggregate({
        where: { status: "FAILED", ...range },
        _sum: { totalAmount: true },
        _count: { _all: true }
      }),
      // Satu-satunya jalur saldo PPOB yang berasal dari uang tunai pelanggan: top up bertujuan PPOB yang lunas.
      this.prisma.walletTopUpOrder.groupBy({
        by: ["provider"],
        where: { status: "PAID", metadata: { path: ["target"], equals: "PPOB" }, ...paidRange },
        _sum: { amount: true },
        _count: { _all: true }
      })
    ]);

    const salesTotal = new Prisma.Decimal(salesAll._sum.totalAmount ?? 0);
    const costedSales = new Prisma.Decimal(salesCosted._sum.totalAmount ?? 0);
    const costedCost = new Prisma.Decimal(salesCosted._sum.providerCost ?? 0);
    const topUpOnline = topUpGroups.filter((row) => row.provider !== "MANUAL_BANK");
    const topUpManual = topUpGroups.filter((row) => row.provider === "MANUAL_BANK");
    const sumGroups = (rows: typeof topUpGroups) =>
      rows.reduce((sum, row) => sum.plus(row._sum.amount ?? 0), new Prisma.Decimal(0));
    const countGroups = (rows: typeof topUpGroups) => rows.reduce((sum, row) => sum + row._count._all, 0);

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
      /**
       * Penjualan PPOB memakai saldo PPOB yang SUDAH dimiliki pelanggan, jadi tidak ada uang baru masuk saat
       * transaksi. Selisih penjualan dan modal Digiflazz adalah pendapatan perusahaan.
       */
      sales: {
        successCount: salesAll._count._all,
        salesTotal: this.decimal(salesTotal),
        costedCount: salesCosted._count._all,
        providerCost: this.decimal(costedCost),
        // Selisih hanya dari transaksi yang modalnya tercatat; sisanya belum bisa dihitung.
        margin: this.decimal(costedSales.minus(costedCost)),
        withoutCostCount: salesAll._count._all - salesCosted._count._all,
        openCount: openTx._count._all,
        openAmount: this.decimal(openTx._sum.totalAmount),
        failedCount: failedTx._count._all,
        failedAmount: this.decimal(failedTx._sum.totalAmount)
      },
      /** Dari mana saldo PPOB terisi pada periode ini: hanya top up yang berupa uang tunai masuk. */
      funding: {
        topUpOnlineCount: countGroups(topUpOnline),
        topUpOnline: this.decimal(sumGroups(topUpOnline)),
        topUpManualCount: countGroups(topUpManual),
        topUpManual: this.decimal(sumGroups(topUpManual))
      },
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

  /**
   * Pemantauan pembayaran online: top up saldo dan pembayaran membership lewat penyedia pembayaran
   * (Midtrans/DOKU), digabung menjadi satu daftar, terbaru lebih dulu. Hanya baca. Transfer manual tidak
   * ikut (punya halamannya sendiri). Nomor HP disamarkan: pemantauan tidak memerlukan nomor penuh.
   */
  async onlinePayments(input: PageInput & { kind?: "TOPUP" | "MEMBERSHIP"; status?: PaymentStatus; dateFrom?: Date; dateTo?: Date }) {
    const providers = ["MIDTRANS", "DOKU"];
    const created = this.createdAtRange(input);
    const base = { provider: { in: providers }, ...created };
    const withStatus = input.status ? { ...base, status: input.status } : base;
    const wantTopUp = input.kind !== "MEMBERSHIP";
    const wantMembership = input.kind !== "TOPUP";
    const take = input.page * input.pageSize;
    const now = new Date();

    const [topUpTotal, membershipTotal, topUpRows, membershipRows, topUpStatuses, membershipStatuses, topUpOverdue, membershipOverdue] =
      await Promise.all([
        wantTopUp ? this.prisma.walletTopUpOrder.count({ where: withStatus }) : 0,
        wantMembership ? this.prisma.membershipPayment.count({ where: withStatus }) : 0,
        wantTopUp
          ? this.prisma.walletTopUpOrder.findMany({
              where: withStatus,
              include: { user: { select: { fullName: true, phone: true } } },
              orderBy: { createdAt: "desc" },
              take
            })
          : [],
        wantMembership
          ? this.prisma.membershipPayment.findMany({
              where: withStatus,
              include: {
                user: { select: { fullName: true, phone: true } },
                invoice: { select: { number: true } },
                order: { select: { expiresAt: true, membership: { select: { name: true } } } }
              },
              orderBy: { createdAt: "desc" },
              take
            })
          : [],
        wantTopUp ? this.prisma.walletTopUpOrder.groupBy({ by: ["status"], where: base, _count: { _all: true } }) : [],
        wantMembership ? this.prisma.membershipPayment.groupBy({ by: ["status"], where: base, _count: { _all: true } }) : [],
        wantTopUp ? this.prisma.walletTopUpOrder.count({ where: { ...base, status: "PENDING", expiresAt: { lt: now } } }) : 0,
        wantMembership
          ? this.prisma.membershipPayment.count({ where: { ...base, status: "PENDING", order: { expiresAt: { lt: now } } } })
          : 0
      ]);

    const asObject = (value: Prisma.JsonValue | null) =>
      value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const maskPhone = (phone: string) => (phone.length > 6 ? `${phone.slice(0, 4)}****${phone.slice(-3)}` : "****");
    const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

    type Item = {
      kind: "TOPUP" | "MEMBERSHIP";
      id: string;
      reference: string;
      status: PaymentStatus;
      provider: string | null;
      method: string | null;
      description: string;
      amount: number;
      baseAmount: number | null;
      feeAmount: number;
      userName: string;
      phoneMasked: string;
      createdAt: Date;
      paidAt: Date | null;
      expiresAt: Date | null;
      overdue: boolean;
    };
    const items: Item[] = [
      ...topUpRows.map((row): Item => {
        const meta = asObject(row.metadata);
        const gross = num(meta.grossAmount);
        const base = Number(row.amount);
        return {
          kind: "TOPUP",
          id: row.id,
          reference: row.reference,
          status: row.status,
          provider: row.provider,
          method: typeof meta.paymentType === "string" ? meta.paymentType : null,
          description: `Top up ${meta.target === "PPOB" ? "Saldo PPOB" : "Saldo TapGo"}`,
          amount: gross ?? base,
          baseAmount: base,
          feeAmount: num(meta.feeAmount) ?? 0,
          userName: row.user.fullName,
          phoneMasked: maskPhone(row.user.phone),
          createdAt: row.createdAt,
          paidAt: row.paidAt,
          expiresAt: row.expiresAt,
          overdue: row.status === "PENDING" && row.expiresAt !== null && row.expiresAt < now
        };
      }),
      ...membershipRows.map((row): Item => {
        const meta = asObject(row.metadata);
        const expiresAt = row.order?.expiresAt ?? null;
        return {
          kind: "MEMBERSHIP",
          id: row.id,
          reference: row.invoice?.number ?? row.providerReference ?? row.id,
          status: row.status,
          provider: row.provider,
          method: typeof meta.paymentType === "string" ? meta.paymentType : null,
          description: `Membership ${row.order?.membership?.name ?? ""}`.trim(),
          amount: Number(row.amount),
          baseAmount: null,
          feeAmount: 0,
          userName: row.user.fullName,
          phoneMasked: maskPhone(row.user.phone),
          createdAt: row.createdAt,
          paidAt: row.paidAt,
          expiresAt,
          overdue: row.status === "PENDING" && expiresAt !== null && expiresAt < now
        };
      })
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(this.skip(input), this.skip(input) + input.pageSize);

    const byStatus: Record<string, number> = {};
    for (const row of [...topUpStatuses, ...membershipStatuses]) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + row._count._all;
    }
    return {
      ...this.page(items, topUpTotal + membershipTotal, input),
      summary: {
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        byStatus,
        overduePending: topUpOverdue + membershipOverdue
      }
    };
  }

  /**
   * Transaksi PPOB yang dikirim ke Digiflazz, lengkap untuk penelusuran oleh Super Admin: status, kode jawaban
   * provider, modal, selisih (margin), lama proses, dan apakah saldo pelanggan sudah dikembalikan.
   *
   * `publicReference` adalah `ref_id` di dasbor Digiflazz, jadi pencarian memakainya untuk mencocokkan kedua sisi.
   * Nomor tujuan, nomor HP pelanggan, dan serial/token disamarkan: token PLN dapat dipakai siapa saja yang
   * memegangnya, dan yang berhak melihatnya hanya pemilik transaksi di aplikasi.
   */
  async digiflazzTransactions(
    input: PageInput & {
      status?: PpobTransactionStatus;
      category?: PpobCategory;
      search?: string;
      stuckOnly?: boolean;
      /** Hanya transaksi sukses yang rugi bersih atau di bawah target untung bersih. */
      marginIssueOnly?: boolean;
      dateFrom?: Date;
      dateTo?: Date;
    }
  ) {
    const stuckBefore = new Date(Date.now() - DIGIFLAZZ_STUCK_AFTER_MS);
    const created = this.createdAtRange(input);
    const search = input.search?.trim();
    const filters: Prisma.PpobTransactionWhereInput = {
      ...created,
      ...(input.category ? { category: input.category } : {}),
      ...(search
        ? {
            OR: [
              { publicReference: { contains: search, mode: "insensitive" } },
              { providerReference: { contains: search, mode: "insensitive" } },
              { skuSnapshot: { contains: search, mode: "insensitive" } },
              { productNameSnapshot: { contains: search, mode: "insensitive" } },
              { targetNumber: { contains: search } }
            ]
          }
        : {})
    };
    const marginScan = await scanPpobMargins(this.prisma, filters, { collectIssueIds: input.marginIssueOnly === true });
    const where: Prisma.PpobTransactionWhereInput = {
      ...filters,
      ...(input.marginIssueOnly ? { id: { in: marginScan.issueIds } } : {}),
      ...(input.stuckOnly
        ? { status: { in: ["PENDING", "PROCESSING"] }, createdAt: { ...(created.createdAt ?? {}), lt: stuckBefore } }
        : input.status
          ? { status: input.status }
          : {})
    };

    const [total, rows, statusGroups, stuckCount, successTotals, costedTotals] = await Promise.all([
      this.prisma.ppobTransaction.count({ where }),
      this.prisma.ppobTransaction.findMany({
        where,
        include: { user: { select: { fullName: true, phone: true } } },
        orderBy: { createdAt: "desc" },
        skip: this.skip(input),
        take: input.pageSize
      }),
      this.prisma.ppobTransaction.groupBy({ by: ["status"], where: filters, _count: { _all: true } }),
      this.prisma.ppobTransaction.count({
        where: { ...filters, status: { in: ["PENDING", "PROCESSING"] }, createdAt: { ...(created.createdAt ?? {}), lt: stuckBefore } }
      }),
      this.prisma.ppobTransaction.aggregate({
        where: { ...filters, status: "SUCCESS" },
        _sum: { totalAmount: true },
        _count: { _all: true }
      }),
      // Selisih hanya sah dihitung dari transaksi yang modalnya tercatat; penjualan tanpa modal bukan selisih penuh.
      this.prisma.ppobTransaction.aggregate({
        where: { ...filters, status: "SUCCESS", providerCost: { not: null } },
        _sum: { totalAmount: true, providerCost: true },
        _count: { _all: true }
      })
    ]);

    const maskTail = (value: string, keep: number) =>
      value.length > keep + 2 ? `${"*".repeat(Math.min(8, value.length - keep))}${value.slice(-keep)}` : "****";
    const maskTarget = (value: string) =>
      value.length > 7 ? `${value.slice(0, 4)}${"*".repeat(Math.min(6, value.length - 7))}${value.slice(-3)}` : "****";
    const toNumber = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

    const items = rows.map((row) => {
      const providerCost = toNumber(row.providerCost);
      const totalAmount = Number(row.totalAmount);
      const open = row.status === "PENDING" || row.status === "PROCESSING";
      return {
        id: row.id,
        reference: row.publicReference,
        status: row.status,
        category: row.category,
        productName: row.productNameSnapshot,
        brand: row.brandSnapshot,
        sku: row.skuSnapshot,
        providerSku: row.providerSku,
        provider: row.provider,
        providerReference: row.providerReference,
        targetMasked: maskTarget(row.targetNumber),
        serialMasked: row.serialNumber ? maskTail(row.serialNumber, 4) : null,
        amount: Number(row.amount),
        adminFee: Number(row.adminFee),
        totalAmount,
        providerCost,
        margin: row.status === "SUCCESS" && providerCost !== null ? totalAmount - providerCost : null,
        // Untung bersih (setelah PPN atas selisih dan PPh) dan statusnya terhadap target; null bila belum ada modal.
        netMargin: row.status === "SUCCESS" && providerCost !== null ? Math.round(assessPpobMargin({ totalAmount: row.totalAmount, providerCost: row.providerCost!, category: row.category }).netMargin) : null,
        marginStatus:
          row.status === "SUCCESS" && providerCost !== null
            ? assessPpobMargin({ totalAmount: row.totalAmount, providerCost: row.providerCost!, category: row.category }).status
            : null,
        failureCode: row.failureCode,
        failureReason: row.failureReason,
        refunded: row.refundTransactionId !== null,
        stuck: open && row.createdAt < stuckBefore,
        userName: row.user.fullName,
        phoneMasked: row.user.phone.length > 6 ? `${row.user.phone.slice(0, 4)}****${row.user.phone.slice(-3)}` : "****",
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        durationSeconds: row.completedAt ? Math.max(0, Math.round((row.completedAt.getTime() - row.createdAt.getTime()) / 1000)) : null
      };
    });

    const byStatus: Record<string, number> = {};
    for (const group of statusGroups) {
      byStatus[group.status] = group._count._all;
    }
    const salesTotal = toNumber(successTotals._sum.totalAmount) ?? 0;
    const costTotal = toNumber(costedTotals._sum.providerCost) ?? 0;
    const costedSales = toNumber(costedTotals._sum.totalAmount) ?? 0;
    return {
      ...this.page(items, total, input),
      summary: {
        total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        byStatus,
        stuck: stuckCount,
        stuckAfterMinutes: DIGIFLAZZ_STUCK_AFTER_MS / 60_000,
        success: {
          count: successTotals._count._all,
          sales: salesTotal,
          providerCost: costTotal,
          /** Penjualan dari transaksi yang modalnya tercatat: dasar selisih = costedSales - providerCost. */
          costedSales,
          // Modal hanya tercatat pada sebagian transaksi sukses; selisih dihitung dari yang bermodal saja.
          withCostCount: costedTotals._count._all,
          /** Untung bersih seluruh transaksi sukses bermodal dalam filter, dan berapa yang rugi atau di bawah target. */
          netMargin: marginScan.netTotal,
          lossCount: marginScan.loss,
          belowTargetCount: marginScan.belowTarget,
          targets: marginScan.targets
        }
      }
    };
  }

  /**
   * Saldo deposit Digiflazz beserta konteks: pemakaian hari ini dan 7 hari, perkiraan sisa hari, transaksi yang
   * masih tertahan, dan perbandingan dengan saldo PPOB pelanggan yang beredar (kewajiban menyediakan layanan).
   */
  async digiflazzBalanceOverview(options: { force?: boolean } = {}) {
    const reading = await this.digiflazzBalance.read(options);
    const nowMs = Date.now();
    const wibOffset = 7 * 60 * 60 * 1000;
    const wibMidnight = new Date(Math.floor((nowMs + wibOffset) / 86_400_000) * 86_400_000 - wibOffset);
    const weekAgo = new Date(nowMs - 7 * 86_400_000);

    const [today, week, inFlight, liability] = await Promise.all([
      this.prisma.ppobTransaction.aggregate({
        where: { status: "SUCCESS", createdAt: { gte: wibMidnight } },
        _sum: { providerCost: true },
        _count: { _all: true }
      }),
      this.prisma.ppobTransaction.aggregate({
        where: { status: "SUCCESS", createdAt: { gte: weekAgo } },
        _sum: { providerCost: true },
        _count: { _all: true }
      }),
      this.prisma.ppobTransaction.aggregate({
        where: { status: { in: ["PENDING", "PROCESSING"] } },
        _sum: { totalAmount: true },
        _count: { _all: true }
      }),
      this.prisma.wallet.aggregate({ _sum: { ppobBalance: true } })
    ]);

    const toNumber = (value: Prisma.Decimal | null | undefined) => Number(value ?? 0);
    const weekCost = toNumber(week._sum.providerCost);
    const avgPerDay = weekCost / 7;
    const customerLiability = toNumber(liability._sum.ppobBalance);
    const balance = reading.balance;
    const warn = env.DIGIFLAZZ_BALANCE_WARN;
    const critical = env.DIGIFLAZZ_BALANCE_CRITICAL;
    const daysLeft = balance !== null && avgPerDay > 0 ? Math.floor((balance / avgPerDay) * 10) / 10 : null;
    const level: "UNKNOWN" | "OK" | "LOW" | "CRITICAL" =
      balance === null ? "UNKNOWN" : balance < critical ? "CRITICAL" : balance < warn || (daysLeft !== null && daysLeft < 2) ? "LOW" : "OK";

    return {
      provider: reading,
      level,
      thresholds: { warn, critical },
      customerPpobLiability: customerLiability,
      coverageRatio: balance !== null && customerLiability > 0 ? Math.round((balance / customerLiability) * 100) / 100 : null,
      spend: {
        today: { count: today._count._all, cost: toNumber(today._sum.providerCost) },
        last7Days: { count: week._count._all, cost: weekCost, averagePerDay: Math.round(avgPerDay) }
      },
      estimatedDaysLeft: daysLeft,
      inFlight: { count: inFlight._count._all, amount: toNumber(inFlight._sum.totalAmount) }
    };
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
