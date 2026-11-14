import { MembershipTier, Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { MembershipService } from "../application/MembershipService.js";

export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}

  plans = async (_req: Request, res: Response) => {
    const result = await this.membershipService.listPlans();
    const plans = env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED
      ? result
      : result.filter((item) => item.tier === "BASIC");
    res.json({ success: true, data: plans });
  };

  me = async (req: Request, res: Response) => {
    const result = await this.membershipService.getMyMembership(req.auth!.userId);
    res.json({ success: true, data: result });
  };

  upgrade = async (req: Request, res: Response) => {
    if (!env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED) {
      throw new AppError(
        "Upgrade membership berbayar tidak tersedia pada rilis Google Play.",
        StatusCodes.FORBIDDEN,
        "PAID_MEMBERSHIP_DISABLED_FOR_PLAY",
      );
    }

    const result = await this.membershipService.upgrade({
      userId: req.auth!.userId,
      targetTier: req.body.targetTier,
      ...this.optionalString("paymentReference", req.body.paymentReference)
    });
    res.json({ success: true, data: result });
  };

  private optionalString(key: "paymentReference", value: unknown) {
    return typeof value === "string" ? { [key]: value } : {};
  }

}
