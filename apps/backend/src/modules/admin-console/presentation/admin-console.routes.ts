import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { AdminConsoleService } from "../application/AdminConsoleService.js";
import { AdminConsoleController } from "./admin-console.controller.js";
import { WalletService } from "../../wallets/application/WalletService.js";
import { PrismaWalletRepository } from "../../wallets/infrastructure/PrismaWalletRepository.js";
import { MembershipDocumentService } from "../../memberships/application/MembershipDocumentService.js";
import { AdminRoleService } from "../application/AdminRoleService.js";
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
  adminListQuerySchema,
  adminFinancialReportQuerySchema,
  adminMemberDetailSchema,
  adminMemberRequestActionSchema,
  adminOrderQuerySchema,
  adminRoleAssignSchema,
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
const controller = new AdminConsoleController(
  service,
  walletService,
  membershipOrderService,
  adminRoleService
);
const documentController = new MembershipDocumentController(
  new MembershipDocumentService(prisma)
);

export const adminConsoleRouter = Router();

adminConsoleRouter.use(requireAuth, requireRoles("ADMIN", "SUPER_ADMIN"));

adminConsoleRouter.get("/dashboard/summary", asyncHandler(controller.summary));
adminConsoleRouter.get("/dashboard", asyncHandler(controller.summary));
adminConsoleRouter.get("/members", validateRequest(adminListQuerySchema), asyncHandler(controller.members));
adminConsoleRouter.get("/members/:id", validateRequest(adminMemberDetailSchema), asyncHandler(controller.member));
adminConsoleRouter.get("/member-requests", validateRequest(adminOrderQuerySchema), asyncHandler(controller.memberRequests));
adminConsoleRouter.post(
  "/member-requests/:id/approve",
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
  "/member-requests/:id/reject",
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
adminConsoleRouter.get("/payments", validateRequest(adminPaymentQuerySchema), asyncHandler(controller.payments));
adminConsoleRouter.get("/invoices", validateRequest(adminInvoiceQuerySchema), asyncHandler(controller.invoices));
adminConsoleRouter.get("/commissions", validateRequest(adminCommissionQuerySchema), asyncHandler(controller.commissions));
adminConsoleRouter.get("/reports/bonus.csv", validateRequest(adminReportQuerySchema), asyncHandler(controller.bonusReportCsv));
adminConsoleRouter.get("/reports/bonus", validateRequest(adminReportQuerySchema), asyncHandler(controller.bonusReport));
adminConsoleRouter.get("/reports/ppob.csv", validateRequest(adminReportQuerySchema), asyncHandler(controller.ppobReportCsv));
adminConsoleRouter.get("/reports/ppob", validateRequest(adminReportQuerySchema), asyncHandler(controller.ppobReport));
adminConsoleRouter.get("/reports/reward.csv", validateRequest(adminReportQuerySchema), asyncHandler(controller.rewardReportCsv));
adminConsoleRouter.get("/reports/reward", validateRequest(adminReportQuerySchema), asyncHandler(controller.rewardReport));
adminConsoleRouter.get(
  "/reports/financial-summary",
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.financialSummaryReport)
);
adminConsoleRouter.get(
  "/reports/wallet-liability",
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.walletLiabilityReport)
);
adminConsoleRouter.get(
  "/reports/commission-summary",
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.commissionSummaryReport)
);
adminConsoleRouter.get(
  "/reports/reward-summary",
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.rewardSummaryReport)
);
adminConsoleRouter.get(
  "/reports/profit-sharing-summary",
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.profitSharingSummaryReport)
);
adminConsoleRouter.get(
  "/reports/ppob-summary",
  validateRequest(adminFinancialReportQuerySchema),
  asyncHandler(controller.ppobSummaryReport)
);
adminConsoleRouter.get("/rewards", validateRequest(adminRewardQuerySchema), asyncHandler(controller.rewards));
adminConsoleRouter.get("/rewards/:id", validateRequest(adminRewardDetailSchema), asyncHandler(controller.reward));
adminConsoleRouter.post(
  "/rewards/:id/approve",
  validateRequest(adminRewardActionSchema),
  asyncHandler(controller.approveReward)
);
adminConsoleRouter.post(
  "/rewards/:id/reject",
  validateRequest(adminRewardActionSchema),
  asyncHandler(controller.rejectReward)
);
adminConsoleRouter.post(
  "/rewards/:id/mark-paid",
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
adminConsoleRouter.get("/wallets", validateRequest(adminListQuerySchema), asyncHandler(controller.wallets));
adminConsoleRouter.get(
  "/wallets/:userId/transactions",
  validateRequest(adminWalletTransactionSchema),
  asyncHandler(controller.walletTransactions)
);
adminConsoleRouter.get("/withdrawals", validateRequest(adminWithdrawalQuerySchema), asyncHandler(controller.withdrawals));
adminConsoleRouter.get("/withdraw-requests", validateRequest(adminWithdrawalQuerySchema), asyncHandler(controller.withdrawals));
adminConsoleRouter.get("/withdrawals/:id", validateRequest(adminWithdrawalDetailSchema), asyncHandler(controller.withdrawal));
adminConsoleRouter.get("/withdraw-requests/:id", validateRequest(adminWithdrawalDetailSchema), asyncHandler(controller.withdrawal));
adminConsoleRouter.post(
  "/withdrawals/:id/approve",
  validateRequest(adminWithdrawalActionSchema),
  asyncHandler(controller.approveWithdrawal)
);
adminConsoleRouter.post(
  "/withdraw-requests/:id/approve",
  validateRequest(adminWithdrawalActionSchema),
  asyncHandler(controller.approveWithdrawal)
);
adminConsoleRouter.post(
  "/withdrawals/:id/reject",
  validateRequest(adminWithdrawalActionSchema),
  asyncHandler(controller.rejectWithdrawal)
);
adminConsoleRouter.post(
  "/withdraw-requests/:id/reject",
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
