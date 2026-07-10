import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { WalletService } from "../application/WalletService.js";
import { PrismaWalletRepository } from "../infrastructure/PrismaWalletRepository.js";
import { WalletController } from "./wallet.controller.js";
import {
  adminUserWalletSchema,
  bankAccountSchema,
  withdrawalDetailSchema,
  walletTransactionQuerySchema,
  withdrawalActionSchema,
  withdrawalListSchema,
  withdrawalRequestSchema
} from "./wallet.validators.js";

const repository = new PrismaWalletRepository(prisma);
const service = new WalletService(repository);
const controller = new WalletController(service);

export const walletRouter = Router();

walletRouter.use(requireAuth);
walletRouter.get("/", asyncHandler(controller.wallet));
walletRouter.get("/transactions", validateRequest(walletTransactionQuerySchema), asyncHandler(controller.transactions));
walletRouter.get("/bank-account", asyncHandler(controller.bankAccount));
walletRouter.put("/bank-account", validateRequest(bankAccountSchema), asyncHandler(controller.updateBankAccount));
walletRouter.get("/withdrawals", validateRequest(walletTransactionQuerySchema), asyncHandler(controller.withdrawals));
walletRouter.post("/withdrawals", validateRequest(withdrawalRequestSchema), asyncHandler(controller.requestWithdrawal));
walletRouter.get("/withdraws", validateRequest(walletTransactionQuerySchema), asyncHandler(controller.withdrawals));
walletRouter.post("/withdraw", validateRequest(withdrawalRequestSchema), asyncHandler(controller.requestWithdrawal));

walletRouter.get(
  "/admin/users/:userId",
  requireRoles("ADMIN", "SUPER_ADMIN"),
  validateRequest(adminUserWalletSchema),
  asyncHandler(controller.adminUserWallet)
);
walletRouter.get(
  "/admin/withdrawals",
  requireRoles("ADMIN", "SUPER_ADMIN"),
  validateRequest(withdrawalListSchema),
  asyncHandler(controller.adminWithdrawals)
);
walletRouter.get(
  "/admin/withdrawals/:withdrawalId",
  requireRoles("ADMIN", "SUPER_ADMIN"),
  validateRequest(withdrawalDetailSchema),
  asyncHandler(controller.adminWithdrawal)
);
walletRouter.post(
  "/admin/withdrawals/:withdrawalId/approve",
  requireRoles("ADMIN", "SUPER_ADMIN"),
  validateRequest(withdrawalActionSchema),
  asyncHandler(controller.approveWithdrawal)
);
walletRouter.post(
  "/admin/withdrawals/:withdrawalId/reject",
  requireRoles("ADMIN", "SUPER_ADMIN"),
  validateRequest(withdrawalActionSchema),
  asyncHandler(controller.rejectWithdrawal)
);
walletRouter.post(
  "/admin/withdrawals/:withdrawalId/paid",
  requireRoles("SUPER_ADMIN"),
  validateRequest(withdrawalActionSchema),
  asyncHandler(controller.markWithdrawalPaid)
);
