import { Request, Response } from "express";
import { AdminConsoleService } from "../application/AdminConsoleService.js";
import { WalletService } from "../../wallets/application/WalletService.js";
import { MembershipOrderService } from "../../memberships/application/MembershipOrderService.js";

export class AdminConsoleController {
  constructor(
    private readonly adminConsoleService: AdminConsoleService,
    private readonly walletService: WalletService,
    private readonly membershipOrderService: MembershipOrderService
  ) {}

  summary = async (_req: Request, res: Response) => {
    const result = await this.adminConsoleService.dashboardSummary();
    res.json({ success: true, data: result });
  };

  members = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.members({
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
      ...(typeof req.query.search === "string" ? { search: req.query.search } : {}),
      ...(typeof req.query.package === "string" ? { package: req.query.package as never } : {}),
      ...(typeof req.query.status === "string" ? { status: req.query.status } : {})
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

  grantFounderPlatinum = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.grantFounderPlatinum({
      actorId: req.auth!.userId,
      fullName: String(req.body.fullName),
      phone: String(req.body.phone),
      password: String(req.body.password),
      ...(typeof req.body.founderId === "string" ? { founderId: req.body.founderId } : {}),
      ...(typeof req.body.email === "string" ? { email: req.body.email } : {}),
      ...(typeof req.body.sponsorReferralCode === "string" ? { sponsorReferralCode: req.body.sponsorReferralCode } : {}),
      ...(typeof req.body.reason === "string" ? { reason: req.body.reason } : {})
    });
    res.status(201).json({ success: true, data: result });
  };

  grantFounderChairman = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.grantFounderChairman({
      actorId: req.auth!.userId,
      fullName: String(req.body.fullName),
      phone: String(req.body.phone),
      password: String(req.body.password),
      reason: String(req.body.reason),
      ...(typeof req.body.email === "string" ? { email: req.body.email } : {}),
      ...(typeof req.body.secureBankAccountReference === "string"
        ? { secureBankAccountReference: req.body.secureBankAccountReference }
        : {}),
      ...(req.body.bankAccount && typeof req.body.bankAccount === "object"
        ? {
          bankAccount: {
            bankName: String(req.body.bankAccount.bankName),
            accountHolderName: String(req.body.bankAccount.accountHolderName),
            accountNumber: String(req.body.bankAccount.accountNumber)
          }
        }
        : {})
    });
    res.status(201).json({ success: true, data: result });
  };

  founderChairman = async (_req: Request, res: Response) => {
    const result = await this.adminConsoleService.founderChairman();
    res.json({ success: true, data: result });
  };

  founderChairmanDetail = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.founderChairmanDetail(String(req.params.founderId));
    res.json({ success: true, data: result });
  };

  updateFounderChairmanStatus = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.updateFounderChairmanStatus({
      actorId: req.auth!.userId,
      founderId: String(req.params.founderId),
      status: req.body.status,
      ...(typeof req.body.reason === "string" ? { reason: req.body.reason } : {})
    });
    res.json({ success: true, data: result });
  };

  founderPlatinumList = async (_req: Request, res: Response) => {
    const result = await this.adminConsoleService.founderPlatinumList();
    res.json({ success: true, data: result });
  };

  founderPlatinumDetail = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.founderPlatinumDetail(String(req.params.founderId));
    res.json({ success: true, data: result });
  };

  updateFounderPlatinumStatus = async (req: Request, res: Response) => {
    const result = await this.adminConsoleService.updateFounderPlatinumStatus({
      actorId: req.auth!.userId,
      founderId: String(req.params.founderId),
      status: req.body.status,
      ...(typeof req.body.reason === "string" ? { reason: req.body.reason } : {})
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
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }
}
