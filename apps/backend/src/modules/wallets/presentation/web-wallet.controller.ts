import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { WalletService } from "../application/WalletService.js";
import { WalletTopUpPaymentService } from "../application/WalletTopUpPaymentService.js";

export class WebWalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly topUpPaymentService: WalletTopUpPaymentService,
  ) {}

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
