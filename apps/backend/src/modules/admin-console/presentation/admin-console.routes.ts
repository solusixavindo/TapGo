import { Router } from "express";
import { env } from "../../../config/env.js";
import { prisma } from "../../../config/prisma.js";
import { redis } from "../../../config/redis.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { maskForOperator } from "../../../core/security/adminMasking.js";
import { AdminConsoleService } from "../application/AdminConsoleService.js";
import { SystemHealthService } from "../application/SystemHealthService.js";
import { ErrorMonitoringService } from "../application/ErrorMonitoringService.js";
import { AdminConsoleController } from "./admin-console.controller.js";
import { WalletService } from "../../wallets/application/WalletService.js";
import { PrismaWalletRepository } from "../../wallets/infrastructure/PrismaWalletRepository.js";
import { MembershipDocumentService } from "../../memberships/application/MembershipDocumentService.js";
import { DriverDocumentService } from "../../drivers/application/DriverDocumentService.js";
import { DriverDocumentController } from "../../drivers/presentation/driver-document.controller.js";
import { AdminRoleService } from "../application/AdminRoleService.js";
import { MembershipRefundService } from "../../memberships/application/MembershipRefundService.js";
import { MembershipOrderService } from "../../memberships/application/MembershipOrderService.js";
import { MembershipDocumentController } from "../../memberships/presentation/membership-document.controller.js";
import {
  membershipDocumentListSchema,
  membershipDocumentUploadSchema
} from "../../memberships/presentation/membership.validators.js";
import {
  adminCommissionQuerySchema,
  adminFounderChairmanDetailSchema,
  adminFounderChairmanGrantSchema,
  adminFounderChairmanStatusSchema,
  adminFounderPlatinumDetailSchema,
  adminFounderPlatinumGrantSchema,
  adminFounderPlatinumStatusSchema,
  adminGenericStatusQuerySchema,
  adminInvoiceQuerySchema,
  adminAuditLogQuerySchema,
  adminListQuerySchema,
  adminFinancialReportQuerySchema,
  adminMemberDetailSchema,
  adminMemberRequestActionSchema,
  adminOrderQuerySchema,
  adminRoleAssignSchema,
  adminMemberStatusSchema,
  adminRoleCandidateSchema,
  adminPaymentQuerySchema,
  adminReportQuerySchema,
  adminRewardActionSchema,
  adminRewardDetailSchema,
  adminRewardQuerySchema,
  adminWalletTransactionSchema,
  adminWithdrawalActionSchema,
  adminWithdrawalDetailSchema,
  adminWithdrawalQuerySchema
} from "./admin-console.validators.js";

const service = new AdminConsoleService(prisma);
const walletService = new WalletService(new PrismaWalletRepository(prisma));
const membershipOrderService = new MembershipOrderService(prisma);
const adminRoleService = new AdminRoleService(prisma);
const membershipRefundService = new MembershipRefundService(prisma);
const systemHealthService = new SystemHealthService(prisma, redis);
const errorMonitoringService = new ErrorMonitoringService({
  authToken: env.SENTRY_AUTH_TOKEN,
  orgSlug: env.SENTRY_ORG_SLUG,
  apiBaseUrl: env.SENTRY_API_BASE_URL,
  projectSlugs: {
    backend: env.SENTRY_PROJECT_SLUG_BACKEND,
    driver_app: env.SENTRY_PROJECT_SLUG_DRIVER_APP,
    user_app: env.SENTRY_PROJECT_SLUG_USER_APP
  }
});
const controller = new AdminConsoleController(
  service,
  walletService,
  membershipOrderService,
  adminRoleService,
  membershipRefundService,
  systemHealthService,
  errorMonitoringService
);
const documentController = new MembershipDocumentController(
  new MembershipDocumentService(prisma)
);
const driverDocumentController = new DriverDocumentController(
  new DriverDocumentService(prisma)
);

export const adminConsoleRouter = Router();

adminConsoleRouter.use(requireAuth, requireRoles("ADMIN", "SUPER_ADMIN"), maskForOperator);

adminConsoleRouter.get("/dashboard/summary", asyncHandler(controller.summary));
adminConsoleRouter.get("/dashboard", asyncHandler(controller.summary));
adminConsoleRouter.get("/dashboard/growth", asyncHandler(controller.growth));
adminConsoleRouter.get(
  "/dashboard/documents-nearing-retention",
  asyncHandler(controller.documentsNearingRetention)
);
// Aktivitas ini mengungkap siapa memegang/mengubah otoritas admin — gerbang
// yang sama dengan /roles (VIP saja), bukan ADMIN+ seperti endpoint dashboard
// lain.
adminConsoleRouter.get(
  "/dashboard/activity",
  requireRoles("SUPER_ADMIN_VIP"),
  asyncHandler(controller.recentActivity)
);
// Laba rugi memperlihatkan seluruh posisi keuangan perusahaan: hanya pemilik.
adminConsoleRouter.get(
  "/reports/profit-loss",
  requireRoles("SUPER_ADMIN_VIP"),
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.profitLossReport)
);
// Diagnostik server (memori, disk, koneksi DB/Redis) — hanya pemilik, sama
// seperti laba rugi: memperlihatkan kondisi infrastruktur yang sensitif.
adminConsoleRouter.get(
  "/system/health",
  requireRoles("SUPER_ADMIN_VIP"),
  asyncHandler(controller.systemHealth)
);
// Issue Sentry terbaru — sama-sama informasi infrastruktur/operasional
// sensitif, gerbangnya sama seperti /system/health.
adminConsoleRouter.get(
  "/system/errors",
  requireRoles("SUPER_ADMIN_VIP"),
  asyncHandler(controller.errorMonitoring)
);
adminConsoleRouter.get(
  "/audit-logs",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminAuditLogQuerySchema),
  asyncHandler(controller.auditLogs)
);
adminConsoleRouter.get("/members", validateRequest(adminListQuerySchema), asyncHandler(controller.members));
adminConsoleRouter.get("/members/:id", validateRequest(adminMemberDetailSchema), asyncHandler(controller.member));
adminConsoleRouter.get("/member-requests", validateRequest(adminOrderQuerySchema), asyncHandler(controller.memberRequests));
adminConsoleRouter.post(
  "/member-requests/:id/approve",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminMemberRequestActionSchema),
  asyncHandler(controller.approveMemberRequest)
);
// Admin membuka dokumen untuk dicetak menjadi berkas administrasi. Ini
// satu-satunya jalan keluar isi dokumen dari database.
adminConsoleRouter.get(
  "/member-requests/:id/documents",
  validateRequest(membershipDocumentListSchema),
  asyncHandler(documentController.adminDocuments)
);
adminConsoleRouter.get(
  "/member-requests/:id/documents/:type",
  validateRequest(membershipDocumentUploadSchema),
  asyncHandler(documentController.adminDocumentFile)
);
// Dokumen mitra driver. Aturannya sama persis dengan dokumen membership:
// isinya hanya keluar lewat jalur ini, dan setiap pembukaan dicatat.
//
// Jalurnya sengaja /driver-documents, BUKAN /drivers/documents: yang kedua akan
// tertangkap lebih dulu oleh pola /drivers/:driverId/documents dan membuat kata
// "documents" diperlakukan sebagai driverId.
adminConsoleRouter.get(
  "/driver-documents",
  asyncHandler(driverDocumentController.adminQueue)
);
adminConsoleRouter.get(
  "/drivers/:driverId/documents",
  asyncHandler(driverDocumentController.adminDocuments)
);
adminConsoleRouter.get(
  "/drivers/:driverId/documents/:type",
  asyncHandler(driverDocumentController.adminDocumentFile)
);
adminConsoleRouter.post(
  "/member-requests/:id/verify-documents",
  validateRequest(adminMemberRequestActionSchema),
  asyncHandler(controller.verifyMemberRequestDocuments)
);
adminConsoleRouter.post(
  "/member-requests/:id/reject-documents",
  validateRequest(adminMemberRequestActionSchema),
  asyncHandler(controller.rejectMemberRequestDocuments)
);
adminConsoleRouter.post(
  "/member-requests/:id/execute-refund",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminMemberRequestActionSchema),
  asyncHandler(controller.executeMemberRequestRefund)
);
adminConsoleRouter.post(
  "/member-requests/:id/reject",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminMemberRequestActionSchema),
  asyncHandler(controller.rejectMemberRequest)
);
adminConsoleRouter.post(
  "/founder-chairman/grant",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFounderChairmanGrantSchema),
  asyncHandler(controller.grantFounderChairman)
);
adminConsoleRouter.get(
  "/founder-chairman",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(controller.founderChairman)
);
adminConsoleRouter.get(
  "/founder-chairman/:founderId",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFounderChairmanDetailSchema),
  asyncHandler(controller.founderChairmanDetail)
);
adminConsoleRouter.patch(
  "/founder-chairman/:founderId/status",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFounderChairmanStatusSchema),
  asyncHandler(controller.updateFounderChairmanStatus)
);
adminConsoleRouter.post(
  "/founder-platinum/grants",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFounderPlatinumGrantSchema),
  asyncHandler(controller.grantFounderPlatinum)
);
adminConsoleRouter.get(
  "/founder-platinum",
  requireRoles("SUPER_ADMIN"),
  asyncHandler(controller.founderPlatinumList)
);
adminConsoleRouter.get(
  "/founder-platinum/:founderId",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFounderPlatinumDetailSchema),
  asyncHandler(controller.founderPlatinumDetail)
);
adminConsoleRouter.patch(
  "/founder-platinum/:founderId/status",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFounderPlatinumStatusSchema),
  asyncHandler(controller.updateFounderPlatinumStatus)
);
adminConsoleRouter.get("/payments", requireRoles("SUPER_ADMIN"), validateRequest(adminPaymentQuerySchema), asyncHandler(controller.payments));
adminConsoleRouter.get("/invoices", requireRoles("SUPER_ADMIN"), validateRequest(adminInvoiceQuerySchema), asyncHandler(controller.invoices));
adminConsoleRouter.get("/commissions", requireRoles("SUPER_ADMIN"), validateRequest(adminCommissionQuerySchema), asyncHandler(controller.commissions));
adminConsoleRouter.get("/reports/bonus.csv", requireRoles("SUPER_ADMIN"), validateRequest(adminReportQuerySchema), asyncHandler(controller.bonusReportCsv));
adminConsoleRouter.get("/reports/bonus", requireRoles("SUPER_ADMIN"), validateRequest(adminReportQuerySchema), asyncHandler(controller.bonusReport));
adminConsoleRouter.get("/reports/ppob.csv", requireRoles("SUPER_ADMIN"), validateRequest(adminReportQuerySchema), asyncHandler(controller.ppobReportCsv));
adminConsoleRouter.get("/reports/ppob", requireRoles("SUPER_ADMIN"), validateRequest(adminReportQuerySchema), asyncHandler(controller.ppobReport));
// Transaksi PPOB sungguhan (beli pulsa/token/dll) — beda dari /reports/ppob
// di atas, yang melaporkan kredit benefit PPOB gratis dari membership. Lihat
// catatan di AdminConsoleService.ppobTransactionsReport().
adminConsoleRouter.get("/reports/ppob-transactions.csv", requireRoles("SUPER_ADMIN"), validateRequest(adminReportQuerySchema), asyncHandler(controller.ppobTransactionsReportCsv));
adminConsoleRouter.get("/reports/ppob-transactions", requireRoles("SUPER_ADMIN"), validateRequest(adminReportQuerySchema), asyncHandler(controller.ppobTransactionsReport));
adminConsoleRouter.get("/reports/reward.csv", requireRoles("SUPER_ADMIN"), validateRequest(adminReportQuerySchema), asyncHandler(controller.rewardReportCsv));
adminConsoleRouter.get("/reports/reward", requireRoles("SUPER_ADMIN"), validateRequest(adminReportQuerySchema), asyncHandler(controller.rewardReport));
adminConsoleRouter.get(
  "/reports/financial-summary",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.financialSummaryReport)
);
adminConsoleRouter.get(
  "/reports/wallet-liability",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.walletLiabilityReport)
);
adminConsoleRouter.get(
  "/reports/commission-summary",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.commissionSummaryReport)
);
adminConsoleRouter.get(
  "/reports/reward-summary",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.rewardSummaryReport)
);
adminConsoleRouter.get(
  "/reports/profit-sharing-summary",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.profitSharingSummaryReport)
);
adminConsoleRouter.get(
  "/reports/ppob-summary",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.ppobSummaryReport)
);
adminConsoleRouter.get("/rewards", requireRoles("SUPER_ADMIN"), validateRequest(adminRewardQuerySchema), asyncHandler(controller.rewards));
adminConsoleRouter.get("/rewards/:id", requireRoles("SUPER_ADMIN"), validateRequest(adminRewardDetailSchema), asyncHandler(controller.reward));
adminConsoleRouter.post(
  "/rewards/:id/approve",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminRewardActionSchema),
  asyncHandler(controller.approveReward)
);
adminConsoleRouter.post(
  "/rewards/:id/reject",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminRewardActionSchema),
  asyncHandler(controller.rejectReward)
);
adminConsoleRouter.post(
  "/rewards/:id/mark-paid",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminRewardActionSchema),
  asyncHandler(controller.markRewardPaid)
);
adminConsoleRouter.get("/commission-settings", requireRoles("SUPER_ADMIN"), (_req, res) => {
  res.status(501).json({
    success: false,
    code: "PRODUCTION_APPROVAL_REQUIRED",
    message: "Fitur ini membutuhkan approval production."
  });
});
adminConsoleRouter.get("/wallets", requireRoles("SUPER_ADMIN"), validateRequest(adminListQuerySchema), asyncHandler(controller.wallets));
adminConsoleRouter.get(
  "/wallets/:userId/transactions",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminWalletTransactionSchema),
  asyncHandler(controller.walletTransactions)
);
adminConsoleRouter.get("/withdrawals", requireRoles("SUPER_ADMIN"), validateRequest(adminWithdrawalQuerySchema), asyncHandler(controller.withdrawals));
adminConsoleRouter.get("/withdraw-requests", requireRoles("SUPER_ADMIN"), validateRequest(adminWithdrawalQuerySchema), asyncHandler(controller.withdrawals));
adminConsoleRouter.get("/withdrawals/:id", requireRoles("SUPER_ADMIN"), validateRequest(adminWithdrawalDetailSchema), asyncHandler(controller.withdrawal));
adminConsoleRouter.get("/withdraw-requests/:id", requireRoles("SUPER_ADMIN"), validateRequest(adminWithdrawalDetailSchema), asyncHandler(controller.withdrawal));
adminConsoleRouter.post(
  "/withdrawals/:id/approve",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminWithdrawalActionSchema),
  asyncHandler(controller.approveWithdrawal)
);
adminConsoleRouter.post(
  "/withdraw-requests/:id/approve",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminWithdrawalActionSchema),
  asyncHandler(controller.approveWithdrawal)
);
adminConsoleRouter.post(
  "/withdrawals/:id/reject",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminWithdrawalActionSchema),
  asyncHandler(controller.rejectWithdrawal)
);
adminConsoleRouter.post(
  "/withdraw-requests/:id/reject",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminWithdrawalActionSchema),
  asyncHandler(controller.rejectWithdrawal)
);
adminConsoleRouter.post(
  "/withdrawals/:id/paid",
  requireRoles("SUPER_ADMIN"),
  validateRequest(adminWithdrawalActionSchema),
  asyncHandler(controller.markWithdrawalPaid)
);
adminConsoleRouter.get("/delete-requests", validateRequest(adminGenericStatusQuerySchema), asyncHandler(controller.deleteRequests));
adminConsoleRouter.get("/contact-messages", validateRequest(adminGenericStatusQuerySchema), asyncHandler(controller.contactMessages));
// Pengelolaan role hanya untuk pemegang role puncak. requireRoles memakai
// tangga role, dan tidak ada peran di atas SUPER_ADMIN_VIP — sehingga penjaga
// ini efektif berarti "hanya VIP", termasuk menolak SUPER_ADMIN biasa.
adminConsoleRouter.get(
  "/roles",
  requireRoles("SUPER_ADMIN_VIP"),
  asyncHandler(controller.adminRoles)
);
adminConsoleRouter.get(
  "/roles/candidates",
  requireRoles("SUPER_ADMIN_VIP"),
  validateRequest(adminRoleCandidateSchema),
  asyncHandler(controller.adminRoleCandidates)
);
adminConsoleRouter.put(
  "/members/:userId/status",
  requireRoles("SUPER_ADMIN_VIP"),
  validateRequest(adminMemberStatusSchema),
  asyncHandler(controller.setMemberStatus)
);
adminConsoleRouter.put(
  "/roles/:userId",
  requireRoles("SUPER_ADMIN_VIP"),
  validateRequest(adminRoleAssignSchema),
  asyncHandler(controller.assignAdminRole)
);
adminConsoleRouter.put("/app-settings", requireRoles("SUPER_ADMIN"), (_req, res) => {
  res.status(501).json({
    success: false,
    code: "PRODUCTION_APPROVAL_REQUIRED",
    message: "Fitur ini membutuhkan approval production."
  });
});
