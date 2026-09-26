import { Request, Response } from "express";
import { env } from "../../../config/env.js";
import { roleSatisfies } from "../../../core/security/roleHierarchy.js";
import { AdminConsoleService } from "../application/AdminConsoleService.js";
import { WalletService } from "../../wallets/application/WalletService.js";
import { MembershipOrderService } from "../../memberships/application/MembershipOrderService.js";
import { AdminRoleService } from "../application/AdminRoleService.js";
import { MembershipRefundService } from "../../memberships/application/MembershipRefundService.js";
import { SystemHealthService } from "../application/SystemHealthService.js";
import { ErrorMonitoringService, SentryProjectKey } from "../application/ErrorMonitoringService.js";

const SENTRY_PROJECT_KEYS: SentryProjectKey[] = ["backend", "driver_app", "user_app"];

export class AdminConsoleController {
  constructor(
    private readonly adminConsoleService: AdminConsoleService,
    private readonly walletService: WalletService,
    private readonly membershipOrderService: MembershipOrderService,
    private readonly adminRoleService: AdminRoleService,
    private readonly membershipRefundService: MembershipRefundService,
    private readonly systemHealthService: SystemHealthService,
    private readonly errorMonitoringService: ErrorMonitoringService
  ) {}

  summary = async (_req: Request, res: Response) => {
    const result = await this.adminConsoleService.dashboardSummary();
    res.json({ success: true, data: result });
  };

  growth = async (_req: Request, res: Response) => {
    const result = await this.adminConsoleService.dashboardGrowth();
    res.json({ success: true, data: result });
  };

  documentsNearingRetention = async (_req: Request, res: Response) => {
    const result = await this.adminConsoleService.documentsNearingRetention();
    res.json({ success: true, data: result });
  };

  recentActivity = async (req: Request, res: Response) => {
    const limit = Number(req.query.limit);
    const result = await this.adminConsoleService.recentAdminActivity(
      Number.isFinite(limit) && limit > 0 ? limit : 20
    );
    res.json({ success: true, data: result });
  };

  profitLossReport = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.profitLossReport(this.dateRange(req));
    res.json({ success: true, data: result });
  };

  systemHealth = async (_req: Request, res: Response) => {
    const result = await this.systemHealthService.report();
    res.json({ success: true, data: result });
  };

  errorMonitoring = async (req: Request, res: Response) => {
    const statsPeriod = req.query.statsPeriod === "14d" ? "14d" : "24h";
    const project = SENTRY_PROJECT_KEYS.includes(req.query.project as SentryProjectKey)
      ? (req.query.project as SentryProjectKey)
      : "backend";
    const result = await this.errorMonitoringService.recentIssues(project, { statsPeriod });
    res.json({ success: true, data: result });
  };

  auditLogs = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.listAuditLogs({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.action === "string" ? { action: req.query.action } : {}),
      ...(typeof req.query.entityType === "string" ? { entityType: req.query.entityType } : {}),
      includeAuthority: roleSatisfies(req.auth!.role, "SUPER_ADMIN_VIP")
    });
    res.json({ success: true, data: result });
  };

  members = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.members({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.search === "string" ? { search: req.query.search } : {}),
      ...(typeof req.query.package === "string" ? { package: req.query.package as never } : {}),
      ...(typeof req.query.status === "string" ? { status: req.query.status } : {}),
      ...(req.query.activeDays ? { activeDays: Number(req.query.activeDays) } : {}),
      ...(req.query.registeredDays ? { registeredDays: Number(req.query.registeredDays) } : {}),
      ...(typeof req.query.source === "string" ? { source: req.query.source as "PLAY" | "OTHER" | "UNKNOWN" } : {})
    });
    res.json({ success: true, data: result });
  };

  member = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.memberDetail(String(req.params.id));
    res.json({ success: true, data: result });
  };

  payments = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.payments({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {})
    });
    res.json({ success: true, data: result });
  };

  invoices = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.invoices({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {})
    });
    res.json({ success: true, data: result });
  };

  commissions = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.commissions({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.type === "string" ? { type: req.query.type as never } : {}),
      ...(typeof req.query.bonusType === "string" ? { bonusType: req.query.bonusType as never } : {})
    });
    res.json({ success: true, data: result });
  };

  wallets = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.wallets({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize)
    });
    res.json({ success: true, data: result });
  };

  walletTransactions = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.walletTransactions(String(req.params.userId), {
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize)
    });
    res.json({ success: true, data: result });
  };

  withdrawals = async (req: Request, res: Response) => {
    const result = await this.walletService.listWithdrawals({
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {}),
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize)
    });
    res.json({ success: true, data: { items: result } });
  };

  withdrawal = async (req: Request, res: Response) => {
    const result = await this.walletService.getWithdrawal(String(req.params.id));
    res.json({ success: true, data: result });
  };

  approveWithdrawal = async (req: Request, res: Response) => {
    const result = await this.walletService.approveWithdrawal({
      withdrawalId: String(req.params.id),
      adminId: req.auth!.userId,
      actorRole: req.auth!.role,
      vipThreshold: env.WITHDRAWAL_VIP_THRESHOLD,
      ...(typeof req.body.note === "string" ? { note: req.body.note } : {})
    });
    res.json({ success: true, data: result });
  };

  rejectWithdrawal = async (req: Request, res: Response) => {
    const result = await this.walletService.rejectWithdrawal({
      withdrawalId: String(req.params.id),
      adminId: req.auth!.userId,
      ...(typeof req.body.note === "string" ? { note: req.body.note } : {})
    });
    res.json({ success: true, data: result });
  };

  markWithdrawalPaid = async (req: Request, res: Response) => {
    const result = await this.walletService.markWithdrawalPaid({
      withdrawalId: String(req.params.id),
      adminId: req.auth!.userId,
      ...(typeof req.body.note === "string" ? { note: req.body.note } : {})
    });
    res.json({ success: true, data: result });
  };

  memberRequests = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.memberRequests({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {})
    });
    res.json({ success: true, data: result });
  };

  approveMemberRequest = async (req: Request, res: Response) => {
    const result = await this.membershipOrderService.markPaymentSuccess({
      userId: req.auth!.userId,
      role: req.auth!.role,
      orderId: String(req.params.id),
      paymentReference: `ADMIN-${req.auth!.userId}`
    });
    await this.adminConsoleService.recordAdminAction({
      actorId: req.auth!.userId,
      action: "MEMBERSHIP_PAYMENT_CONFIRMED",
      entityType: "MembershipOrder",
      entityId: String(req.params.id)
    });
    res.json({ success: true, data: result });
  };

  /// Stage R2.6 jalur A: melepas order kanal WEB yang sudah lunas menjadi
  /// membership aktif setelah dokumen KYC-nya diperiksa admin. Endpoint ini
  /// terpisah dari approve, karena approve mengonfirmasi pembayaran sedangkan
  /// endpoint ini mengonfirmasi identitas.
  verifyMemberRequestDocuments = async (req: Request, res: Response) => {
    const result = await this.membershipOrderService.activateVerifiedOrder({
      orderId: String(req.params.id),
      adminId: req.auth!.userId
    });
    res.json({ success: true, data: result });
  };

  /// Stage R2.6 jalur A: menolak dokumen KYC atas order kanal WEB yang sudah
  /// lunas. Keputusan Owner untuk kasus ini adalah pengembalian dana penuh,
  /// sehingga permintaan refund ikut dicatat di sini.
  rejectMemberRequestDocuments = async (req: Request, res: Response) => {
    const result = await this.membershipOrderService.rejectOrderDocuments({
      orderId: String(req.params.id),
      adminId: req.auth!.userId,
      ...(typeof req.body.reason === "string" ? { reason: req.body.reason } : {})
    });
    res.json({ success: true, data: result });
  };

  /// Meminta pemohon memperbaiki dokumen tanpa menolak pengajuan.
  requestMemberRequestCorrection = async (req: Request, res: Response) => {
    const result = await this.membershipOrderService.requestOrderCorrection({
      orderId: String(req.params.id),
      adminId: req.auth!.userId,
      reason: typeof req.body.reason === "string" ? req.body.reason : ""
    });
    res.json({ success: true, data: result });
  };

  /// Menjalankan pengembalian dana yang sudah diputuskan. Terpisah dari
  /// penolakan dokumen supaya kegagalan penyedia tidak membatalkan keputusan
  /// admin, dan supaya percobaannya dapat diulang.
  executeMemberRequestRefund = async (req: Request, res: Response) => {
    const result = await this.membershipRefundService.executeRefund({
      orderId: String(req.params.id),
      adminId: req.auth!.userId
    });
    res.json({ success: true, data: result });
  };

  rejectMemberRequest = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.rejectMemberRequest({
      orderId: String(req.params.id),
      adminId: req.auth!.userId,
      ...(typeof req.body.reason === "string" ? { reason: req.body.reason } : {})
    });
    res.json({ success: true, data: result });
  };

  /// Pengelolaan role. Rutenya dijaga khusus SUPER_ADMIN_VIP; service tetap
  /// memeriksa ulang role aktor dari database, bukan dari klaim token.
  adminRoles = async (_req: Request, res: Response) => {
    const result = await this.adminRoleService.listAdmins();
    res.json({ success: true, data: result });
  };

  adminRoleCandidates = async (req: Request, res: Response) => {
    const result = await this.adminRoleService.searchCandidates(String(req.query.q ?? ""));
    res.json({ success: true, data: result });
  };

  setMemberStatus = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.setMemberAccountStatus({
      actorId: req.auth!.userId,
      userId: String(req.params.userId),
      status: req.body.status,
      reason: req.body.reason
    });
    res.json({ success: true, data: result });
  };

  assignAdminRole = async (req: Request, res: Response) => {
    const result = await this.adminRoleService.assignRole({
      actorId: req.auth!.userId,
      targetUserId: String(req.params.userId),
      role: req.body.role,
      reasonCode: req.body.reasonCode
    });
    res.json({ success: true, data: result });
  };

  bonusReport = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.bonusReport({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.type === "string" ? { type: req.query.type as never } : {}),
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {}),
      ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
      ...this.dateRange(req)
    });
    res.json({ success: true, data: result });
  };

  ppobReport = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.ppobReport({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {}),
      ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
      ...this.dateRange(req)
    });
    res.json({ success: true, data: result });
  };

  rewardReport = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.rewardReport({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {}),
      ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
      ...this.dateRange(req)
    });
    res.json({ success: true, data: result });
  };

  rewards = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.rewards({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {}),
      ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
      ...this.dateRange(req)
    });
    res.json({ success: true, data: result });
  };

  reward = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.rewardDetail(String(req.params.id));
    res.json({ success: true, data: result });
  };

  approveReward = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.approveReward({
      rewardId: String(req.params.id),
      adminId: req.auth!.userId,
      ...(typeof req.body.note === "string" ? { note: req.body.note } : {})
    });
    res.json({ success: true, data: result });
  };

  rejectReward = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.rejectReward({
      rewardId: String(req.params.id),
      adminId: req.auth!.userId,
      ...(typeof req.body.reason === "string" ? { reason: req.body.reason } : {}),
      ...(typeof req.body.note === "string" ? { note: req.body.note } : {})
    });
    res.json({ success: true, data: result });
  };

  markRewardPaid = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.markRewardPaid({
      rewardId: String(req.params.id),
      adminId: req.auth!.userId,
      ...(typeof req.body.note === "string" ? { note: req.body.note } : {})
    });
    res.json({ success: true, data: result });
  };

  financialSummaryReport = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.financialSummaryReport(this.dateRange(req));
    res.json({ success: true, data: result });
  };

  walletLiabilityReport = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.walletLiabilityReport(this.dateRange(req));
    res.json({ success: true, data: result });
  };

  commissionSummaryReport = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.commissionSummaryReport(this.dateRange(req));
    res.json({ success: true, data: result });
  };

  rewardSummaryReport = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.rewardSummaryReport(this.dateRange(req));
    res.json({ success: true, data: result });
  };

  profitSharingSummaryReport = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.profitSharingSummaryReport(this.dateRange(req));
    res.json({ success: true, data: result });
  };

  ppobSummaryReport = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.ppobSummaryReport(this.dateRange(req));
    res.json({ success: true, data: result });
  };

  deleteRequests = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.deleteRequests({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.status === "string" ? { status: req.query.status } : {})
    });
    res.json({ success: true, data: result });
  };

  contactMessages = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.contactMessages({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.status === "string" ? { status: req.query.status } : {})
    });
    res.json({ success: true, data: result });
  };

  private dateRange(req: Request) {
    return {
      ...(typeof req.query.dateFrom === "string" ? { dateFrom: new Date(req.query.dateFrom) } : {}),
      ...(typeof req.query.startDate === "string" ? { dateFrom: new Date(req.query.startDate) } : {}),
      ...(typeof req.query.dateTo === "string" ? { dateTo: new Date(req.query.dateTo) } : {}),
      ...(typeof req.query.endDate === "string" ? { dateTo: new Date(req.query.endDate) } : {})
    };
  }

  bonusReportCsv = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.bonusReport({
      page: 1,
      pageSize: 100,
      ...(typeof req.query.type === "string" ? { type: req.query.type as never } : {}),
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {}),
      ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
      ...this.dateRange(req)
    });
    this.sendCsv(res, "tapgo-bonus-report.csv", this.commissionRows(result.items));
  };

  ppobReportCsv = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.ppobReport({
      page: 1,
      pageSize: 100,
      ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
      ...this.dateRange(req)
    });
    this.sendCsv(res, "tapgo-ppob-report.csv", this.ppobRows(result.items));
  };

  /// Transaksi PPOB SUNGGUHAN (beli pulsa/token/dll) — beda dari ppobReport
  /// di atas, yang melaporkan kredit benefit PPOB gratis dari membership.
  /// Lihat catatan di AdminConsoleService.ppobTransactionsReport().
  ppobTransactionsReport = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.ppobTransactionsReport({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
      ...this.dateRange(req)
    });
    res.json({ success: true, data: result });
  };

  ppobTransactionsReportCsv = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.ppobTransactionsReport({
      page: 1,
      pageSize: 100,
      ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
      ...this.dateRange(req)
    });
    this.sendCsv(res, "tapgo-ppob-transactions-report.csv", this.ppobTransactionRows(result.items));
  };

  rewardReportCsv = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.rewardReport({
      page: 1,
      pageSize: 100,
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {}),
      ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
      ...this.dateRange(req)
    });
    this.sendCsv(res, "tapgo-reward-report.csv", this.commissionRows(result.items));
  };

  private commissionRows(items: Array<Record<string, unknown>>) {
    return items.map((item) => {
      const beneficiary = (item.beneficiary && typeof item.beneficiary === "object" ? item.beneficiary : {}) as Record<string, unknown>;
      return {
        user: String(beneficiary.fullName ?? ""),
        phone: String(beneficiary.phone ?? ""),
        type: String(item.type ?? ""),
        amount: String(item.amount ?? ""),
        status: String(item.status ?? ""),
        date: String(item.createdAt ?? "")
      };
    });
  }

  private ppobRows(items: Array<Record<string, unknown>>) {
    return items.map((item) => {
      const wallet = (item.wallet && typeof item.wallet === "object" ? item.wallet : {}) as Record<string, unknown>;
      const user = (wallet.user && typeof wallet.user === "object" ? wallet.user : {}) as Record<string, unknown>;
      return {
        user: String(user.fullName ?? ""),
        phone: String(user.phone ?? ""),
        type: String(item.type ?? ""),
        amount: String(item.amount ?? ""),
        status: "POSTED",
        date: String(item.createdAt ?? "")
      };
    });
  }

  private ppobTransactionRows(items: Array<Record<string, unknown>>) {
    return items.map((item) => {
      const user = (item.user && typeof item.user === "object" ? item.user : {}) as Record<string, unknown>;
      return {
        user: String(user.fullName ?? ""),
        phone: String(user.phone ?? ""),
        // category (PULSA/DATA/PLN_PREPAID/dst) — field ASLI di
        // PpobTransaction, bukan "type" (yang tidak ada di tabel ini,
        // hanya ada di WalletTransaction).
        type: String(item.category ?? ""),
        // totalAmount = yang benar-benar dibayar pelanggan (harga + biaya
        // admin), bukan `amount` (harga produk sebelum biaya admin) —
        // lebih tepat untuk laporan finansial.
        amount: String(item.totalAmount ?? ""),
        status: String(item.status ?? ""),
        date: String(item.createdAt ?? "")
      };
    });
  }

  private sendCsv(res: Response, filename: string, rows: Array<Record<string, string>>) {
    const headers = ["user", "phone", "type", "amount", "status", "date"];
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => this.csvCell(row[header] ?? "")).join(","))
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }

  private csvCell(value: string) {
    // Data di sel ini (nama, dsb.) berasal dari input pengguna yang mendaftar
    // sendiri. Sel yang diawali =, +, -, @, tab, atau CR akan dibaca sebagai
    // formula oleh Excel/Google Sheets saat berkas ini dibuka — bukan sebagai
    // teks. Pembelaannya: sisipkan apostrof di depan sel semacam itu, mengikuti
    // rekomendasi OWASP untuk CSV injection. Karakter aslinya tetap utuh untuk
    // pembaca CSV biasa; hanya aplikasi spreadsheet yang menafsirkannya sebagai
    // penanda "ini teks", bukan bagian dari isi.
    const needsNeutralizing = /^[=+\-@\t\r]/.test(value);
    const safeValue = needsNeutralizing ? `'${value}` : value;
    return `"${safeValue.replaceAll("\"", "\"\"")}"`;
  }
}
