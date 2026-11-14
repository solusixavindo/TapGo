import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { roleSatisfies } from "../../../core/security/roleHierarchy.js";
import { AdminConsoleService } from "../application/AdminConsoleService.js";
import { AdminInsightsService } from "../application/AdminInsightsService.js";
import { WalletService } from "../../wallets/application/WalletService.js";
import { MembershipOrderService } from "../../memberships/application/MembershipOrderService.js";
import { AdminRoleService } from "../application/AdminRoleService.js";
import { MembershipRefundService } from "../../memberships/application/MembershipRefundService.js";
import { SystemHealthService } from "../application/SystemHealthService.js";
import { ErrorMonitoringService, SentryProjectKey } from "../application/ErrorMonitoringService.js";
import { auditDescription, auditKind } from "../application/auditLabels.js";
import { buildXlsx, XlsxColumn } from "../../../core/export/xlsx.js";

/** Ekspor CSV mengambil halaman berukuran besar ini sampai habis, dengan batas total baris demi memori server. */
const CSV_PAGE_SIZE = 1000;

/** Judul dan jenis kolom untuk berkas Excel, menurut kunci baris laporan. Kunci tak dikenal tampil apa adanya sebagai teks. */
const XLSX_COLUMNS: Record<string, XlsxColumn> = {
  user: { header: "Nama", width: 26 },
  phone: { header: "Telepon", width: 17 },
  type: { header: "Jenis", width: 20 },
  amount: { header: "Jumlah (Rp)", type: "number", width: 16 },
  status: { header: "Status", width: 14 },
  date: { header: "Tanggal (WIB)", type: "datetime", width: 18 },
  reference: { header: "Referensi", width: 26 },
  category: { header: "Kategori", width: 14 },
  product: { header: "Produk", width: 30 },
  provider_cost: { header: "Modal Provider (Rp)", type: "number", width: 18 },
  margin: { header: "Selisih (Rp)", type: "number", width: 14 },
  failure_code: { header: "Kode Gagal", width: 16 },
  nama: { header: "Nama", width: 26 },
  telepon: { header: "Telepon", width: 17 },
  email: { header: "Email", width: 28 },
  kodeReferral: { header: "Kode Referral", width: 16 },
  paket: { header: "Paket", width: 12 },
  statusAkun: { header: "Status Akun", width: 16 },
  terdaftar: { header: "Terdaftar (WIB)", type: "datetime", width: 18 },
  loginTerakhir: { header: "Login Terakhir (WIB)", type: "datetime", width: 20 },
  saldoTotal: { header: "Saldo Total (Rp)", type: "number", width: 16 },
  saldoDapatDitarik: { header: "Dapat Ditarik (Rp)", type: "number", width: 18 },
  bonusTerkunci: { header: "Bonus Terkunci (Rp)", type: "number", width: 18 },
  deposit: { header: "Deposit (Rp)", type: "number", width: 14 },
  saldoPpob: { header: "Saldo PPOB (Rp)", type: "number", width: 16 },
  statusDriver: { header: "Status Driver", width: 14 },
  verifikasi: { header: "Verifikasi", width: 16 },
  kendaraan: { header: "Kendaraan", width: 12 },
  plat: { header: "Plat", width: 14 },
  perjalananSelesai: { header: "Perjalanan Selesai", type: "number", width: 18 },
  ratingRataRata: { header: "Rating", type: "number", width: 10 },
  jumlahPenilaian: { header: "Jumlah Penilaian", type: "number", width: 16 },
  tanggal: { header: "Tanggal (WIB)", type: "datetime", width: 18 },
  driver: { header: "Driver", width: 26 },
  jenis: { header: "Jenis", width: 20 },
  jumlah: { header: "Jumlah (Rp)", type: "number", width: 16 },
  referensi: { header: "Referensi", width: 30 },
  waktu: { header: "Waktu (WIB)", type: "datetime", width: 18 },
  pelaku: { header: "Pelaku", width: 24 },
  peran: { header: "Peran", width: 16 },
  golongan: { header: "Golongan", width: 11 },
  uraian: { header: "Uraian", width: 44 },
  kodeAksi: { header: "Kode Aksi", width: 30 },
  sasaran: { header: "Sasaran", width: 34 },
  metode: { header: "Metode", width: 9 },
  rute: { header: "Rute", width: 44 },
  statusHttp: { header: "Status HTTP", type: "number", width: 12 },
  ip: { header: "Alamat IP", width: 18 },
  perangkat: { header: "Perangkat/Peramban", width: 40 },
  isian: { header: "Isian yang dikirim", width: 60 }
};

const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value ?? ""));
const CSV_MAX_ROWS = 50_000;
const PPOB_TRANSACTION_CSV_HEADERS = [
  "date",
  "reference",
  "user",
  "phone",
  "category",
  "product",
  "amount",
  "provider_cost",
  "margin",
  "status",
  "failure_code"
] as const;

const SENTRY_PROJECT_KEYS: SentryProjectKey[] = ["backend", "driver_app", "user_app"];

export class AdminConsoleController {
  constructor(
    private readonly adminConsoleService: AdminConsoleService,
    private readonly walletService: WalletService,
    private readonly membershipOrderService: MembershipOrderService,
    private readonly adminRoleService: AdminRoleService,
    private readonly membershipRefundService: MembershipRefundService,
    private readonly systemHealthService: SystemHealthService,
    private readonly errorMonitoringService: ErrorMonitoringService,
    private readonly insightsService: AdminInsightsService
  ) {}

  /** Wawasan Beranda VIP. Tanpa rentang: 30 hari terakhir. */
  insights = async (req: Request, res: Response) => {
    const { dateFrom, dateTo } = this.dateRange(req);
    const to = dateTo ?? new Date();
    const from = dateFrom ?? new Date(to.getTime() - 30 * 86_400_000);
    if (from.getTime() > to.getTime()) {
      throw new AppError("Rentang tanggal tidak valid", StatusCodes.BAD_REQUEST, "INVALID_DATE_RANGE");
    }
    const result = await this.insightsService.vipInsights({ from, to });
    res.json({ success: true, data: result });
  };

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
      ...(typeof req.query.actorId === "string" ? { actorId: req.query.actorId } : {}),
      ...(req.query.hideReadOnly === "true" ? { hideReadOnly: true } : {}),
      ...this.dateRange(req),
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

  onlinePayments = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.onlinePayments({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(req.query.kind === "TOPUP" || req.query.kind === "MEMBERSHIP" ? { kind: req.query.kind } : {}),
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {}),
      ...this.dateRange(req)
    });
    res.json({ success: true, data: result });
  };

  digiflazzTransactions = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.digiflazzTransactions({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {}),
      ...(typeof req.query.category === "string" ? { category: req.query.category as never } : {}),
      ...(typeof req.query.search === "string" ? { search: req.query.search } : {}),
      ...(req.query.stuck === "1" || req.query.stuck === "true" ? { stuckOnly: true } : {}),
      ...(req.query.marginIssue === "1" || req.query.marginIssue === "true" ? { marginIssueOnly: true } : {}),
      ...this.dateRange(req)
    });
    res.json({ success: true, data: result });
  };

  digiflazzBalance = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.digiflazzBalanceOverview({
      force: req.query.refresh === "1" || req.query.refresh === "true"
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
      ...this.dateRange(req),
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

  /// Mencatat pengembalian dana lewat transfer bank untuk pembayaran transfer
  /// manual (executeRefund menolak jalur ini karena tidak ada penyedia).
  confirmMemberRequestManualRefund = async (req: Request, res: Response) => {
    const result = await this.membershipRefundService.confirmManualRefund({
      orderId: String(req.params.id),
      adminId: req.auth!.userId,
      bankReference: String(req.body.bankReference)
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

  /**
   * Rentang tanggal dari query. validateRequest sudah mengubah dateFrom/dateTo menjadi objek Date
   * (z.coerce.date) dan menggantikan req.query, jadi nilainya bisa Date atau teks. Sebelumnya hanya
   * teks yang dibaca sehingga rentang diabaikan diam-diam dan laporan selalu menampilkan seluruh waktu.
   */
  private dateRange(req: Request) {
    const read = (value: unknown): Date | undefined => {
      const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined;
      return date && !Number.isNaN(date.getTime()) ? date : undefined;
    };
    const from = read(req.query.startDate) ?? read(req.query.dateFrom);
    const to = read(req.query.endDate) ?? read(req.query.dateTo);
    return {
      ...(from ? { dateFrom: from } : {}),
      ...(to ? { dateTo: to } : {})
    };
  }

  bonusReportCsv = async (req: Request, res: Response) => {
    const items = await this.collectAllPages((page) =>
      this.adminConsoleService.bonusReport({
        page,
        pageSize: CSV_PAGE_SIZE,
        ...(typeof req.query.type === "string" ? { type: req.query.type as never } : {}),
        ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {}),
        ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
        ...this.dateRange(req)
      })
    );
    this.sendCsv(res, "tapgo-bonus-report.csv", this.commissionRows(items));
  };

  ppobReportCsv = async (req: Request, res: Response) => {
    const items = await this.collectAllPages((page) =>
      this.adminConsoleService.ppobReport({
        page,
        pageSize: CSV_PAGE_SIZE,
        ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
        ...this.dateRange(req)
      })
    );
    this.sendCsv(res, "tapgo-ppob-report.csv", this.ppobRows(items));
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
    const items = await this.collectAllPages((page) =>
      this.adminConsoleService.ppobTransactionsReport({
        page,
        pageSize: CSV_PAGE_SIZE,
        ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
        ...this.dateRange(req)
      })
    );
    this.sendCsv(res, "tapgo-ppob-transactions-report.csv", this.ppobTransactionRows(items), PPOB_TRANSACTION_CSV_HEADERS);
  };

  rewardReportCsv = async (req: Request, res: Response) => {
    const items = await this.collectAllPages((page) =>
      this.adminConsoleService.rewardReport({
        page,
        pageSize: CSV_PAGE_SIZE,
        ...(typeof req.query.status === "string" ? { status: req.query.status as never } : {}),
        ...(typeof req.query.userId === "string" ? { userId: req.query.userId } : {}),
        ...this.dateRange(req)
      })
    );
    this.sendCsv(res, "tapgo-reward-report.csv", this.commissionRows(items));
  };

  usersReportCsv = async (req: Request, res: Response) => {
    const items = await this.collectAllPages((page) =>
      this.adminConsoleService.usersReport({ page, pageSize: CSV_PAGE_SIZE, ...this.dateRange(req) })
    );
    await this.auditExport(req, "users", items.length);
    const date = (value: unknown) => (value instanceof Date ? value.toISOString() : "");
    this.sendCsv(
      res,
      "tapgo-data-pengguna.csv",
      items.map((item) => ({
        nama: item.fullName,
        telepon: item.phone,
        email: item.email ?? "",
        kodeReferral: item.referralCode,
        paket: item.membership?.tier ?? "BASIC",
        statusAkun: item.status,
        terdaftar: date(item.createdAt),
        loginTerakhir: date(item.lastLoginAt),
        saldoTotal: String(item.wallet?.balance ?? 0),
        saldoDapatDitarik: String(item.wallet?.cashBalance ?? 0),
        bonusTerkunci: String(item.wallet?.lockedBonusBalance ?? 0),
        deposit: String(item.wallet?.depositBalance ?? 0),
        saldoPpob: String(item.wallet?.ppobBalance ?? 0)
      })),
      ["nama", "telepon", "email", "kodeReferral", "paket", "statusAkun", "terdaftar", "loginTerakhir", "saldoTotal", "saldoDapatDitarik", "bonusTerkunci", "deposit", "saldoPpob"],
      true
    );
  };

  driversReportCsv = async (req: Request, res: Response) => {
    const items = await this.collectAllPages((page) =>
      this.adminConsoleService.driversReport({ page, pageSize: CSV_PAGE_SIZE, ...this.dateRange(req) })
    );
    await this.auditExport(req, "drivers", items.length);
    this.sendCsv(
      res,
      "tapgo-data-driver.csv",
      items.map((item) => ({
        nama: item.user.fullName,
        telepon: item.user.phone,
        email: item.user.email ?? "",
        statusAkun: item.user.status,
        statusDriver: item.status,
        verifikasi: item.kycStatus,
        kendaraan: item.vehicleType,
        plat: item.vehiclePlate ?? "",
        perjalananSelesai: String(item.completedRides),
        ratingRataRata: String(item.ratingAverage),
        jumlahPenilaian: String(item.ratingCount),
        terdaftar: item.createdAt.toISOString()
      })),
      ["nama", "telepon", "email", "statusAkun", "statusDriver", "verifikasi", "kendaraan", "plat", "perjalananSelesai", "ratingRataRata", "jumlahPenilaian", "terdaftar"],
      true
    );
  };

  driverTransactionsReportCsv = async (req: Request, res: Response) => {
    const items = await this.collectAllPages((page) =>
      this.adminConsoleService.driverTransactionsReport({ page, pageSize: CSV_PAGE_SIZE, ...this.dateRange(req) })
    );
    await this.auditExport(req, "driver-transactions", items.length);
    this.sendCsv(
      res,
      "tapgo-transaksi-driver.csv",
      items.map((item) => ({
        tanggal: item.createdAt.toISOString(),
        driver: item.wallet.user.fullName,
        telepon: item.wallet.user.phone,
        jenis: item.type,
        jumlah: String(item.amount),
        referensi: [item.referenceType, item.referenceId].filter(Boolean).join(":")
      })),
      ["tanggal", "driver", "telepon", "jenis", "jumlah", "referensi"],
      true
    );
  };

  /** Ekspor memuat data pribadi: setiap unduhan dicatat (siapa, jenis, berapa baris). */
  private async auditExport(req: Request, report: string, rows: number) {
    await this.adminConsoleService.recordAdminAction({
      actorId: req.auth!.userId,
      action: "REPORT_EXPORT",
      entityType: "REPORT",
      entityId: report,
      metadata: { rows, dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : null, dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : null }
    });
  }

  /** Unduh Log Aktivitas (Excel/CSV) dengan saringan yang sama seperti layar. Khusus VIP; unduhan sendiri tercatat. */
  auditLogsExport = async (req: Request, res: Response) => {
    const filters = {
      ...(typeof req.query.action === "string" ? { action: req.query.action } : {}),
      ...(typeof req.query.actorId === "string" ? { actorId: req.query.actorId } : {}),
      ...(req.query.hideReadOnly === "true" ? { hideReadOnly: true } : {}),
      ...this.dateRange(req)
    };
    const items = await this.collectAllPages((page) =>
      this.adminConsoleService.listAuditLogs({ page, pageSize: CSV_PAGE_SIZE, ...filters, includeAuthority: true }).then((r) => ({
        items: r.items,
        pagination: { totalPages: Math.ceil(r.total / CSV_PAGE_SIZE) }
      }))
    );
    await this.auditExport(req, "audit-logs", items.length);
    const wib = (value: Date) => value.toISOString();
    this.sendCsv(
      res,
      "tapgo-log-aktivitas.csv",
      items.map((item) => {
        const meta = (item.metadata && typeof item.metadata === "object" ? item.metadata : {}) as Record<string, unknown>;
        return {
          waktu: wib(item.createdAt),
          pelaku: item.actorName,
          peran: item.actorRole ?? "",
          golongan: auditKind(item.action, item.metadata),
          uraian: auditDescription(item.action, item.metadata),
          kodeAksi: item.action,
          sasaran: [item.entityType, item.entityId].filter(Boolean).join(" · "),
          metode: typeof meta.method === "string" ? meta.method : "",
          rute: typeof meta.path === "string" ? meta.path : "",
          statusHttp: typeof meta.statusCode === "number" ? String(meta.statusCode) : "",
          ip: "ipAddress" in item && item.ipAddress ? String(item.ipAddress) : "",
          perangkat: typeof meta.userAgent === "string" ? meta.userAgent : "",
          isian: JSON.stringify(
            Object.fromEntries(Object.entries(meta).filter(([key]) => !["label", "method", "path", "statusCode", "userAgent", "ok", "readOnly"].includes(key)))
          )
        };
      }),
      ["waktu", "pelaku", "peran", "golongan", "uraian", "kodeAksi", "sasaran", "metode", "rute", "statusHttp", "ip", "perangkat", "isian"],
      true
    );
  };

  /**
   * Mengambil SEMUA baris untuk ekspor CSV, bukan hanya halaman pertama. Dulu ekspor memanggil layanan dengan
   * pageSize 100 sehingga laporan tahunan diam-diam hanya memuat 100 baris terbaru. Batas CSV_MAX_ROWS menjaga
   * memori server; bila tercapai, berkas diberi baris penanda di akhir agar tidak dikira lengkap.
   */
  private async collectAllPages<T>(
    fetchPage: (page: number) => Promise<{ items: T[]; pagination: { totalPages: number } }>
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; items.length < CSV_MAX_ROWS; page += 1) {
      const result = await fetchPage(page);
      items.push(...result.items);
      if (page >= result.pagination.totalPages) {
        return items;
      }
    }
    return items;
  }

  private commissionRows(items: Array<Record<string, unknown>>) {
    return items.map((item) => {
      const beneficiary = (item.beneficiary && typeof item.beneficiary === "object" ? item.beneficiary : {}) as Record<string, unknown>;
      return {
        user: String(beneficiary.fullName ?? ""),
        phone: String(beneficiary.phone ?? ""),
        type: String(item.type ?? ""),
        amount: String(item.amount ?? ""),
        status: String(item.status ?? ""),
        date: iso(item.createdAt)
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
        date: iso(item.createdAt)
      };
    });
  }

  private ppobTransactionRows(items: Array<Record<string, unknown>>) {
    return items.map((item) => {
      const user = (item.user && typeof item.user === "object" ? item.user : {}) as Record<string, unknown>;
      const total = Number(item.totalAmount ?? 0);
      const cost = item.providerCost === null || item.providerCost === undefined ? null : Number(item.providerCost);
      const success = item.status === "SUCCESS";
      return {
        date: iso(item.createdAt),
        reference: String(item.publicReference ?? ""),
        user: String(user.fullName ?? ""),
        phone: String(user.phone ?? ""),
        // category (PULSA/DATA/PLN_PREPAID/dst) — field ASLI di PpobTransaction.
        category: String(item.category ?? ""),
        product: String(item.productNameSnapshot ?? ""),
        // Yang benar-benar dibayar pelanggan (harga + biaya layanan), bukan `amount` (harga produk saja).
        amount: String(item.totalAmount ?? ""),
        provider_cost: cost === null ? "" : String(cost),
        margin: success && cost !== null ? String(total - cost) : "",
        status: String(item.status ?? ""),
        failure_code: String(item.failureCode ?? "")
      };
    });
  }

  /**
   * Mengirim laporan sebagai Excel (.xlsx) bila alamatnya berakhiran .xlsx, selain itu CSV. Excel berbahasa Indonesia
   * membaca CSV berkoma sebagai satu sel panjang, jadi dasbor admin memakai .xlsx; CSV dipertahankan untuk alat lain.
   */
  private sendCsv(
    res: Response,
    filename: string,
    rows: Array<Record<string, string>>,
    headers: readonly string[] = ["user", "phone", "type", "amount", "status", "date"],
    excelBom = false
  ) {
    const truncated = rows.length >= CSV_MAX_ROWS;
    if (res.req.path.endsWith(".xlsx")) {
      const columns = headers.map((key) => XLSX_COLUMNS[key] ?? { header: key });
      const data = rows.map((row) => headers.map((key) => row[key] ?? ""));
      if (truncated) {
        data.push([`BERKAS TERPOTONG: hanya ${CSV_MAX_ROWS} baris pertama. Persempit periodenya.`, ...headers.slice(1).map(() => "")]);
      }
      const title = filename.replace(/^tapgo-/, "").replace(/\.csv$/, "");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/\.csv$/, ".xlsx")}"`);
      res.send(buildXlsx({ sheetName: title, columns, rows: data }));
      return;
    }
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => this.csvCell(row[header] ?? "")).join(",")),
      ...(truncated ? [this.csvCell(`BERKAS TERPOTONG: hanya ${CSV_MAX_ROWS} baris pertama. Persempit periodenya.`)] : [])
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // BOM UTF-8 agar Excel membaca huruf Indonesia (nama, alamat) dengan benar; hanya untuk ekspor baru.
    res.send(excelBom ? `\uFEFF${csv}` : csv);
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
