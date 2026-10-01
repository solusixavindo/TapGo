import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { maskForOperator } from "../../../core/security/adminMasking.js";
import { verifyPassword } from "../../../core/security/passwordHasher.js";
import { walletTransferRateLimiter, withdrawalRateLimiter } from "../../../core/security/rateLimit.js";
import { WalletService } from "../application/WalletService.js";
import { PrismaWalletRepository } from "../infrastructure/PrismaWalletRepository.js";
import { WalletController } from "./wallet.controller.js";
import {
  adminUserWalletSchema,
  bankAccountSchema,
  transferListSchema,
  transferRequestSchema,
  withdrawalDetailSchema,
  walletTransactionQuerySchema,
  withdrawalActionSchema,
  withdrawalListSchema,
  withdrawalRequestSchema
} from "./wallet.validators.js";

const repository = new PrismaWalletRepository(prisma);
const service = new WalletService(repository);
// Pemeriksa password sama persis dengan kanal web (web-wallet.routes.ts) —
// akun tanpa passwordHash (mis. Google-only) SENGAJA ditolak, bukan lolos.
const controller = new WalletController(service, async (userId, password) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true }
  });
  if (!user?.passwordHash) return false;
  try {
    return await verifyPassword(user.passwordHash, password);
  } catch {
    return false;
  }
});

export const walletRouter = Router();

walletRouter.use(requireAuth);
walletRouter.get("/", asyncHandler(controller.wallet));
walletRouter.get("/transactions", validateRequest(walletTransactionQuerySchema), asyncHandler(controller.transactions));
walletRouter.get("/bank-account", asyncHandler(controller.bankAccount));
walletRouter.put("/bank-account", validateRequest(bankAccountSchema), asyncHandler(controller.updateBankAccount));
walletRouter.get("/withdrawals", validateRequest(walletTransactionQuerySchema), asyncHandler(controller.withdrawals));
walletRouter.post("/withdrawals", withdrawalRateLimiter, validateRequest(withdrawalRequestSchema), asyncHandler(controller.requestWithdrawal));
walletRouter.get("/withdraws", validateRequest(walletTransactionQuerySchema), asyncHandler(controller.withdrawals));
walletRouter.post("/withdraw", withdrawalRateLimiter, validateRequest(withdrawalRequestSchema), asyncHandler(controller.requestWithdrawal));

walletRouter.get("/transfers", validateRequest(transferListSchema), asyncHandler(controller.transfers));
walletRouter.post(
  "/transfer",
  walletTransferRateLimiter,
  validateRequest(transferRequestSchema),
  asyncHandler(controller.transfer)
);

walletRouter.get(
  "/admin/users/:userId",
  requireRoles("ADMIN", "SUPER_ADMIN"),
  maskForOperator,
  validateRequest(adminUserWalletSchema),
  asyncHandler(controller.adminUserWallet)
);
walletRouter.get(
  "/admin/withdrawals",
  requireRoles("ADMIN", "SUPER_ADMIN"),
  maskForOperator,
  validateRequest(withdrawalListSchema),
  asyncHandler(controller.adminWithdrawals)
);
walletRouter.get(
  "/admin/withdrawals/:withdrawalId",
  requireRoles("ADMIN", "SUPER_ADMIN"),
  maskForOperator,
  validateRequest(withdrawalDetailSchema),
  asyncHandler(controller.adminWithdrawal)
);
walletRouter.post(
  "/admin/withdrawals/:withdrawalId/approve",
  requireRoles("SUPER_ADMIN"),
  maskForOperator,
  validateRequest(withdrawalActionSchema),
  asyncHandler(controller.approveWithdrawal)
);
walletRouter.post(
  "/admin/withdrawals/:withdrawalId/reject",
  requireRoles("SUPER_ADMIN"),
  maskForOperator,
  validateRequest(withdrawalActionSchema),
  asyncHandler(controller.rejectWithdrawal)
);
walletRouter.post(
  "/admin/withdrawals/:withdrawalId/paid",
  requireRoles("SUPER_ADMIN"),
  maskForOperator,
  validateRequest(withdrawalActionSchema),
  asyncHandler(controller.markWithdrawalPaid)
);
