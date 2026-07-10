import { MembershipTier, Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { MembershipService } from "../application/MembershipService.js";

export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}

  plans = async (_req: Request, res: Response) => {
    const result = await this.membershipService.listPlans();
    res.json({ success: true, data: result });
  };

  me = async (req: Request, res: Response) => {
    const result = await this.membershipService.getMyMembership(req.auth!.userId);
    res.json({ success: true, data: result });
  };

  upgrade = async (req: Request, res: Response) => {
    const result = await this.membershipService.upgrade({
      userId: req.auth!.userId,
      targetTier: req.body.targetTier,
      ...this.optionalString("paymentReference", req.body.paymentReference)
    });
    res.json({ success: true, data: result });
  };

  updateRules = async (req: Request, res: Response) => {
    const result = await this.membershipService.updateRules({
      adminId: req.auth!.userId,
      tier: req.params.tier as MembershipTier,
      ...this.optionalString("name", req.body.name),
      ...this.optionalDecimal("price", req.body.price),
      ...this.optionalDecimal("directBonus", req.body.directBonus),
      ...this.optionalNumber("activeLevels", req.body.activeLevels),
      ...this.optionalBoolean("isActive", req.body.isActive),
      ...(Array.isArray(req.body.benefits)
        ? {
            benefits: req.body.benefits.map((benefit: {
              level: number;
              commissionRate: number;
              fixedBonus: number;
              isActive?: boolean;
            }) => ({
              level: benefit.level,
              commissionRate: new Prisma.Decimal(benefit.commissionRate),
              fixedBonus: new Prisma.Decimal(benefit.fixedBonus),
              ...(typeof benefit.isActive === "boolean" ? { isActive: benefit.isActive } : {})
            }))
          }
        : {})
    });
    res.json({ success: true, data: result });
  };

  private optionalString(key: "name" | "paymentReference", value: unknown) {
    return typeof value === "string" ? { [key]: value } : {};
  }

  private optionalDecimal(key: "price" | "directBonus", value: unknown) {
    return typeof value === "number" ? { [key]: new Prisma.Decimal(value) } : {};
  }

  private optionalNumber(key: "activeLevels", value: unknown) {
    return typeof value === "number" ? { [key]: value } : {};
  }

  private optionalBoolean(key: "isActive", value: unknown) {
    return typeof value === "boolean" ? { [key]: value } : {};
  }
}
