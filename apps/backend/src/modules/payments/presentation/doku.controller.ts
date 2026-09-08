import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { WalletTopUpPaymentService } from "../../wallets/application/WalletTopUpPaymentService.js";
import { DokuPaymentService } from "../application/DokuPaymentService.js";

const MEMBERSHIP_NOT_FOUND_CODES = new Set(["DOKU_INVOICE_NOT_FOUND"]);

export class DokuController {
  constructor(
    private readonly dokuPaymentService: DokuPaymentService,
    private readonly walletTopUpPaymentService: WalletTopUpPaymentService,
  ) {}

  create = async (req: Request, res: Response) => {
    if (!env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED) {
      throw new AppError(
        "Pembayaran membership eksternal belum tersedia untuk rilis Google Play.",
        StatusCodes.FORBIDDEN,
        "EXTERNAL_MEMBERSHIP_PAYMENTS_DISABLED",
      );
    }

    const result = await this.dokuPaymentService.createMembershipPayment({
      userId: req.auth!.userId,
      role: req.auth!.role,
      orderId: String(req.body.orderId),
    });
    res.json({ success: true, data: result });
  };

  /**
   * Satu URL webhook DOKU melayani dua domain (membership + wallet top up,
   * Stage R2.10) — lihat catatan yang sama di MidtransController.
   */
  notification = async (req: Request, res: Response) => {
    const notificationInput = {
      payload: req.body,
      signatureBody:
        (req as Request & { rawBody?: string }).rawBody ?? req.body,
      requestTarget: req.originalUrl.split("?")[0] ?? "/api/webhooks/doku",
      headers: this.signatureHeaders(req),
    };
    try {
      const result = await this.dokuPaymentService.handleNotification(notificationInput);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof AppError && MEMBERSHIP_NOT_FOUND_CODES.has(error.code)) {
        const result = await this.walletTopUpPaymentService.handleDokuNotification(notificationInput);
        res.json({ success: true, data: result });
        return;
      }
      throw error;
    }
  };

  status = async (req: Request, res: Response) => {
    const result = await this.dokuPaymentService.checkPaymentStatus(
      String(req.params.referenceId),
    );
    res.json({ success: true, data: result });
  };

  private header(req: Request, name: string) {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private signatureHeaders(req: Request) {
    const headers: {
      clientId?: string;
      requestId?: string;
      requestTimestamp?: string;
      signature?: string;
    } = {};
    const clientId = this.header(req, "client-id");
    const requestId = this.header(req, "request-id");
    const requestTimestamp = this.header(req, "request-timestamp");
    const signature = this.header(req, "signature");
    if (clientId) headers.clientId = clientId;
    if (requestId) headers.requestId = requestId;
    if (requestTimestamp) headers.requestTimestamp = requestTimestamp;
    if (signature) headers.signature = signature;
    return headers;
  }
}
