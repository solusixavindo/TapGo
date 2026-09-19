import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
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

  memberAvatar = async (req: Request, res: Response) => {
    const avatar = await this.referralService.getDescendantAvatar(
      req.auth!.userId,
      String(req.params.userId)
    );
    // 404 yang sama untuk "bukan anggota referral Anda" dan "belum ada foto":
    // membedakan keduanya akan membocorkan siapa yang ada di pohon orang lain.
    if (!avatar) {
      throw new AppError("Foto tidak ditemukan.", StatusCodes.NOT_FOUND, "REFERRAL_AVATAR_NOT_FOUND");
    }
    res.setHeader("cache-control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("pragma", "no-cache");
    res.setHeader("content-type", avatar.contentType);
    res.setHeader("x-content-type-options", "nosniff");
    res.send(avatar.bytes);
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
