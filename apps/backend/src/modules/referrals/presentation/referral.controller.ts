import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ReferralService } from "../application/ReferralService.js";

export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  claimReferral = async (req: Request, res: Response) => {
    const result = await this.referralService.claimReferral({
      userId: req.auth!.userId,
      sponsorCode: req.body.sponsorCode,
      triggerType: req.body.triggerType,
      triggerId: req.body.triggerId ?? `referral:${req.auth!.userId}`,
      baseAmount: new Prisma.Decimal(req.body.baseAmount)
    });

    res.status(StatusCodes.CREATED).json({
      success: true,
      data: result
    });
  };

  summary = async (req: Request, res: Response) => {
    const result = await this.referralService.getSummary(req.auth!.userId);
    res.json({ success: true, data: result });
  };

  tree = async (req: Request, res: Response) => {
    const result = await this.referralService.getTree(req.auth!.userId, Number(req.query.maxLevel));
    res.json({ success: true, data: result });
  };

  uplink = async (req: Request, res: Response) => {
    const result = await this.referralService.getUplinkChain(req.auth!.userId, Number(req.query.maxLevel));
    res.json({ success: true, data: result });
  };

  downlines = async (req: Request, res: Response) => {
    const result = await this.referralService.getDownlines(
      req.auth!.userId,
      Number(req.query.maxLevel),
      Number(req.query.page),
      Number(req.query.pageSize)
    );
    res.json({ success: true, data: result });
  };

  depth = async (req: Request, res: Response) => {
    const result = await this.referralService.getDepthStats(req.auth!.userId, Number(req.query.maxLevel));
    res.json({ success: true, data: result });
  };

  commissions = async (req: Request, res: Response) => {
    const result = await this.referralService.getCommissions(
      req.auth!.userId,
      Number(req.query.page),
      Number(req.query.pageSize)
    );
    res.json({ success: true, data: result });
  };
}
