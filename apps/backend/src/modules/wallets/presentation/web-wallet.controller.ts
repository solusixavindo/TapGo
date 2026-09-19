import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { WalletService } from "../application/WalletService.js";
import { WalletTopUpPaymentService } from "../application/WalletTopUpPaymentService.js";

/** Rekening yang baru disimpan/diubah belum boleh dipakai mencairkan dana. */
export const BANK_ACCOUNT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type PasswordVerifier = (userId: string, password: string) => Promise<boolean>;

export class WebWalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly topUpPaymentService: WalletTopUpPaymentService,
    private readonly verifyUserPassword: PasswordVerifier,
  ) {}

  wallet = async (req: Request, res: Response) => {
    const result = await this.walletService.getWallet(req.auth!.userId);
    res.json({ success: true, data: result });
  };

  transactions = async (req: Request, res: Response) => {
    const result = await this.walletService.getTransactions(
      req.auth!.userId,
      Number(req.query.page),
      Number(req.query.pageSize),
    );
    res.json({ success: true, data: result });
  };

  bankAccount = async (req: Request, res: Response) => {
    const result = await this.walletService.getBankAccount(req.auth!.userId);
    res.json({ success: true, data: result });
  };

  updateBankAccount = async (req: Request, res: Response) => {
    const result = await this.walletService.updateBankAccount({
      userId: req.auth!.userId,
      bankName: req.body.bankName,
      ...(typeof req.body.bankCode === "string" ? { bankCode: req.body.bankCode } : {}),
      accountNumber: req.body.accountNumber,
      accountHolderName: req.body.accountHolderName,
    });
    res.json({ success: true, data: result });
  };

  withdrawals = async (req: Request, res: Response) => {
    const result = await this.walletService.listWithdrawals({
      userId: req.auth!.userId,
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize),
    });
    res.json({ success: true, data: result });
  };

  /**
   * Pencairan dari dashboard mitra.
   *
   * Tujuan transfer TIDAK diterima dari klien: selalu memakai rekening yang
   * tersimpan di profil, sehingga sesi yang dibajak tidak bisa mengarahkan
   * dana ke rekening lain dalam satu permintaan. Ditambah tiga penjaga:
   * password ulang, jeda 24 jam setelah rekening diubah, dan rate limit.
   */
  requestWithdrawal = async (req: Request, res: Response) => {
    if (!env.WALLET_CASH_OUT_WEB_ENABLED) {
      throw new AppError(
        "Pencairan saldo belum tersedia.",
        StatusCodes.FORBIDDEN,
        "WITHDRAWAL_WEB_DISABLED",
      );
    }

    const userId = req.auth!.userId;
    const passwordOk = await this.verifyUserPassword(userId, String(req.body.password));
    if (!passwordOk) {
      throw new AppError("Password tidak sesuai.", StatusCodes.FORBIDDEN, "WITHDRAWAL_PASSWORD_INVALID");
    }

    const bank = await this.walletService.getBankAccount(userId);
    if (!bank || !bank.accountNumber) {
      throw new AppError(
        "Simpan rekening bank terlebih dahulu.",
        StatusCodes.BAD_REQUEST,
        "WITHDRAWAL_BANK_ACCOUNT_REQUIRED",
      );
    }

    const updatedAt = bank.updatedAt ? Date.parse(bank.updatedAt) : Number.NaN;
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < BANK_ACCOUNT_COOLDOWN_MS) {
      throw new AppError(
        "Rekening baru dapat dipakai untuk pencairan 24 jam setelah disimpan.",
        StatusCodes.FORBIDDEN,
        "WITHDRAWAL_BANK_ACCOUNT_COOLDOWN",
      );
    }

    const result = await this.walletService.requestWithdrawal({
      userId,
      amount: new Prisma.Decimal(req.body.amount),
      bankName: bank.bankName,
      ...(bank.bankCode ? { bankCode: bank.bankCode } : {}),
      accountNumber: bank.accountNumber,
      accountHolderName: bank.accountHolderName,
      ...(typeof req.body.notes === "string" ? { notes: req.body.notes } : {}),
    });
    res.status(StatusCodes.CREATED).json({ success: true, data: result });
  };

  private assertTopUpEnabled() {
    if (!env.WALLET_TOPUP_ENABLED) {
      throw new AppError(
        "Top up TapGoPay belum tersedia pada kanal ini.",
        StatusCodes.FORBIDDEN,
        "WALLET_TOPUP_DISABLED",
      );
    }
  }

  createOrder = async (req: Request, res: Response) => {
    this.assertTopUpEnabled();
    const result = await this.walletService.createTopUpOrder({
      userId: req.auth!.userId,
      amount: new Prisma.Decimal(req.body.amount),
    });
    res.status(StatusCodes.CREATED).json({ success: true, data: result });
  };

  order = async (req: Request, res: Response) => {
    const result = await this.walletService.getTopUpOrder({
      userId: req.auth!.userId,
      role: req.auth!.role,
      orderId: String(req.params.orderId),
    });
    res.json({ success: true, data: result });
  };

  pay = async (req: Request, res: Response) => {
    this.assertTopUpEnabled();
    const input = { userId: req.auth!.userId, role: req.auth!.role, orderId: String(req.params.orderId) };
    const result = env.DOKU_ENABLED
      ? await this.topUpPaymentService.createDokuPayment(input)
      : await this.topUpPaymentService.createMidtransPayment(input);
    res.json({ success: true, data: result });
  };
}
