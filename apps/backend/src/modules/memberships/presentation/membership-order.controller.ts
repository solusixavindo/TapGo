import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { MembershipOrderService } from "../application/MembershipOrderService.js";
import { MidtransPaymentService } from "../../payments/application/MidtransPaymentService.js";
import { DokuPaymentService } from "../../payments/application/DokuPaymentService.js";

export class MembershipOrderController {
  constructor(
    private readonly membershipOrderService: MembershipOrderService,
    private readonly midtransPaymentService?: MidtransPaymentService,
    private readonly dokuPaymentService?: DokuPaymentService,
  ) {}

  packages = async (_req: Request, res: Response) => {
    const result = await this.membershipOrderService.listPackages();
    res.json({ success: true, data: result });
  };

  createOrder = async (req: Request, res: Response) => {
    const result = await this.membershipOrderService.createOrder({
      userId: req.auth!.userId,
      packageId: req.body.packageId,
      ...(req.body.registrationData
        ? { registrationData: req.body.registrationData }
        : {}),
    });

    res.status(201).json({ success: true, data: result });
  };

  order = async (req: Request, res: Response) => {
    const result = await this.membershipOrderService.getOrder({
      userId: req.auth!.userId,
      role: req.auth!.role,
      orderId: String(req.params.id),
    });

    res.json({ success: true, data: result });
  };

  paymentSuccess = async (req: Request, res: Response) => {
    if (env.NODE_ENV === "production") {
      throw new AppError(
        "Development payment simulator is disabled in production",
        StatusCodes.FORBIDDEN,
        "PAYMENT_SIMULATOR_DISABLED",
      );
    }

    const result = await this.membershipOrderService.markPaymentSuccess({
      userId: req.auth!.userId,
      role: req.auth!.role,
      orderId: String(req.params.id),
      ...(typeof req.body?.paymentReference === "string"
        ? { paymentReference: req.body.paymentReference }
        : {}),
    });

    res.json({ success: true, data: result });
  };

  pay = async (req: Request, res: Response) => {
    if (!env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED) {
      throw new AppError(
        "Pembayaran membership eksternal belum tersedia untuk rilis Google Play.",
        StatusCodes.FORBIDDEN,
        "EXTERNAL_MEMBERSHIP_PAYMENTS_DISABLED",
      );
    }

    if (env.DOKU_ENABLED) {
      if (!this.dokuPaymentService) {
        throw new Error("DOKU payment service is not configured");
      }

      const result = await this.dokuPaymentService.createMembershipPayment({
        userId: req.auth!.userId,
        role: req.auth!.role,
        orderId: String(req.params.id),
      });

      res.json({ success: true, data: result });
      return;
    }

    if (!this.midtransPaymentService) {
      throw new Error("Midtrans payment service is not configured");
    }

    let result;
    try {
      result = await this.midtransPaymentService.createMembershipPayment({
        userId: req.auth!.userId,
        role: req.auth!.role,
        orderId: String(req.params.id),
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "MIDTRANS_NOT_CONFIGURED" &&
        !env.MIDTRANS_IS_PRODUCTION
      ) {
        const paidOrder = await this.membershipOrderService.markPaymentSuccess({
          userId: req.auth!.userId,
          role: req.auth!.role,
          orderId: String(req.params.id),
          paymentReference: `uat-sandbox-${String(req.params.id)}`,
        });
        result = {
          snapToken: "",
          redirectUrl: "",
          orderId: paidOrder.id,
          invoiceNumber: paidOrder.invoice?.number ?? "",
          paid: true,
          mode: "UAT_SANDBOX_AUTO_PAID",
        };
      } else {
        throw error;
      }
    }

    res.json({ success: true, data: result });
  };

  me = async (req: Request, res: Response) => {
    const result = await this.membershipOrderService.getMyMembership(
      req.auth!.userId,
    );
    res.json({ success: true, data: result });
  };

  myOrders = async (req: Request, res: Response) => {
    const result = await this.membershipOrderService.listMyOrders(
      req.auth!.userId,
    );
    res.json({ success: true, data: result });
  };
}
