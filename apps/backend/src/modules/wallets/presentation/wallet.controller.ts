import { Prisma, WithdrawalStatus } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { walletCashOutEnabled } from "../../memberships/application/purchaseChannel.js";
import { WalletService } from "../application/WalletService.js";

export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  wallet = async (req: Request, res: Response) => {
    const result = await this.walletService.getWallet(req.auth!.userId);
    res.json({ success: true, data: result });
  };

  transactions = async (req: Request, res: Response) => {
    const result = await this.walletService.getTransactions(
      req.auth!.userId,
      Number(req.query.page),
      Number(req.query.pageSize)
    );
    res.json({ success: true, data: result });
  };

  bankAccount = async (req: Request, res: Response) => {
    const result = await this.walletService.getBankAccount(req.auth!.userId);
    res.json({ success: true, data: result });
  };

  updateBankAccount = async (req: Request, res: Response) => {
    // Menyimpan nomor rekening BUKAN pencairan saldo — murni data profil,
    // aman di semua distribusi (lihat komentar sama di dashboard_screen.dart
    // user_app yang sudah menampilkan menu ini untuk Play). Gerbang
    // WALLET_CASH_OUT_ENABLED tetap berlaku HANYA di requestWithdrawal
    // (aksi pencairan sungguhan), bukan di sini — sebelumnya endpoint ini
    // ikut memblokir simpan rekening dengan 403 CASH_OUT_DISABLED_FOR_PLAY.
    const result = await this.walletService.updateBankAccount({
      userId: req.auth!.userId,
      bankName: req.body.bankName,
      ...(typeof req.body.bankCode === "string" ? { bankCode: req.body.bankCode } : {}),
      accountNumber: req.body.accountNumber,
      accountHolderName: req.body.accountHolderName
    });
    res.json({ success: true, data: result });
  };

  requestWithdrawal = async (req: Request, res: Response) => {
    this.assertCashOutEnabledForPlay();
    const result = await this.walletService.requestWithdrawal({
      userId: req.auth!.userId,
      amount: new Prisma.Decimal(req.body.amount),
      bankName: req.body.bankName,
      ...(typeof req.body.bankCode === "string" ? { bankCode: req.body.bankCode } : {}),
      accountNumber: req.body.accountNumber,
      accountHolderName: req.body.accountHolderName,
      ...this.optionalNotes(req.body.notes)
    });

    res.status(StatusCodes.CREATED).json({ success: true, data: result });
  };

  withdrawals = async (req: Request, res: Response) => {
    const result = await this.walletService.listWithdrawals({
      userId: req.auth!.userId,
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize)
    });
    res.json({ success: true, data: result });
  };

  adminUserWallet = async (req: Request, res: Response) => {
    const result = await this.walletService.getWallet(req.params.userId as string);
    res.json({ success: true, data: result });
  };

  adminWithdrawals = async (req: Request, res: Response) => {
    const result = await this.walletService.listWithdrawals({
      ...this.optionalStatus(req.query.status),
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize)
    });
    res.json({ success: true, data: result });
  };

  adminWithdrawal = async (req: Request, res: Response) => {
    const withdrawalId = String(req.params.withdrawalId ?? req.params.id);
    const result = await this.walletService.getWithdrawal(withdrawalId);
    if (!result) {
      res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        code: "WITHDRAWAL_NOT_FOUND",
        message: "Withdrawal not found"
      });
      return;
    }
    res.json({ success: true, data: result });
  };

  approveWithdrawal = async (req: Request, res: Response) => {
    const result = await this.walletService.approveWithdrawal({
      withdrawalId: req.params.withdrawalId as string,
      adminId: req.auth!.userId,
      actorRole: req.auth!.role,
      vipThreshold: env.WITHDRAWAL_VIP_THRESHOLD,
      ...this.optionalNote(req.body.note)
    });
    res.json({ success: true, data: result });
  };

  rejectWithdrawal = async (req: Request, res: Response) => {
    const result = await this.walletService.rejectWithdrawal({
      withdrawalId: req.params.withdrawalId as string,
      adminId: req.auth!.userId,
      ...this.optionalNote(req.body.note)
    });
    res.json({ success: true, data: result });
  };

  markWithdrawalPaid = async (req: Request, res: Response) => {
    const result = await this.walletService.markWithdrawalPaid({
      withdrawalId: req.params.withdrawalId as string,
      adminId: req.auth!.userId,
      ...this.optionalNote(req.body.note)
    });
    res.json({ success: true, data: result });
  };

  transfer = async (req: Request, res: Response) => {
    this.assertTransferEnabled();
    const result = await this.walletService.transfer({
      fromUserId: req.auth!.userId,
      recipientPhone: String(req.body.recipientPhone),
      amount: new Prisma.Decimal(req.body.amount),
      ...this.optionalNote(req.body.note),
      idempotencyKey: String(req.body.idempotencyKey)
    });
    res
      .status(result.replayed ? StatusCodes.OK : StatusCodes.CREATED)
      .json({ success: true, data: result.transfer, replayed: result.replayed });
  };

  transfers = async (req: Request, res: Response) => {
    const result = await this.walletService.listTransfers({
      userId: req.auth!.userId,
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize)
    });
    res.json({ success: true, data: result });
  };

  private optionalNote(note: unknown) {
    return typeof note === "string" ? { note } : {};
  }

  private optionalNotes(notes: unknown) {
    return typeof notes === "string" ? { notes } : {};
  }

  private optionalStatus(status: unknown) {
    return typeof status === "string" ? { status: status as WithdrawalStatus } : {};
  }

  /**
   * Pencairan saldo kini memakai flag-nya sendiri.
   *
   * Sebelumnya penjaga ini membaca EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED, flag
   * yang sama dengan pembelian membership. Akibatnya menyalakan penjualan
   * membership di web akan ikut membuka pencairan saldo pada rilis Google Play.
   * Keduanya kebijakan yang berbeda, jadi flag-nya dipisah.
   */
  private assertCashOutEnabledForPlay() {
    if (!walletCashOutEnabled()) {
      throw new AppError(
        "Fitur pencairan saldo belum tersedia pada rilis Google Play.",
        StatusCodes.FORBIDDEN,
        "CASH_OUT_DISABLED_FOR_PLAY",
      );
    }
  }

  /** Fitur baru, default mati sampai Owner menyalakannya secara sadar. */
  private assertTransferEnabled() {
    if (!env.WALLET_TRANSFER_ENABLED) {
      throw new AppError(
        "Fitur transfer saldo belum tersedia.",
        StatusCodes.FORBIDDEN,
        "WALLET_TRANSFER_DISABLED",
      );
    }
  }
}
