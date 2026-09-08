import { Request, Response } from "express";
import { AppError } from "../../../core/errors/AppError.js";
import { WalletTopUpPaymentService } from "../../wallets/application/WalletTopUpPaymentService.js";
import { MidtransPaymentService } from "../application/MidtransPaymentService.js";

const MEMBERSHIP_NOT_FOUND_CODES = new Set(["MIDTRANS_INVOICE_NOT_FOUND"]);

export class MidtransController {
  constructor(
    private readonly midtransPaymentService: MidtransPaymentService,
    private readonly walletTopUpPaymentService: WalletTopUpPaymentService,
  ) {}

  /**
   * Satu URL webhook Midtrans melayani dua domain (membership + wallet top up,
   * Stage R2.10) — bukan dua URL terpisah, supaya tidak perlu mendaftarkan
   * endpoint baru di dashboard Midtrans. order_id dicoba sebagai invoice
   * membership dulu; hanya bila itu benar-benar tidak ditemukan (bukan
   * kegagalan signature/nominal lain) barulah dicoba sebagai order top up.
   */
  notification = async (req: Request, res: Response) => {
    try {
      const result = await this.midtransPaymentService.handleNotification(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof AppError && MEMBERSHIP_NOT_FOUND_CODES.has(error.code)) {
        const result = await this.walletTopUpPaymentService.handleMidtransNotification(req.body);
        res.json({ success: true, data: result });
        return;
      }
      throw error;
    }
  };
}
