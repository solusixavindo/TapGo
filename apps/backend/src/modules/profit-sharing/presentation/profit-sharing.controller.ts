import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { ProfitSharingService } from "../application/ProfitSharingService.js";

export class ProfitSharingController {
  constructor(private readonly service: ProfitSharingService) {}

  createPeriod = async (req: Request, res: Response) => {
    const result = await this.service.createPeriod({
      periodMonth: req.body.periodMonth,
      periodYear: req.body.periodYear,
      netProfitAmount: new Prisma.Decimal(req.body.netProfitAmount ?? req.body.totalPoolAmount)
    });

    res.status(201).json({ success: true, data: result });
  };

  periods = async (_req: Request, res: Response) => {
    const result = await this.service.listPeriods();
    res.json({ success: true, data: result });
  };

  period = async (req: Request, res: Response) => {
    const result = await this.service.getPeriod(String(req.params.id));
    res.json({ success: true, data: result });
  };

  approve = async (req: Request, res: Response) => {
    const result = await this.service.approvePeriod(String(req.params.id));
    res.json({ success: true, data: result });
  };

  distribute = async (req: Request, res: Response) => {
    const result = await this.service.distribute(String(req.params.id));
    res.json({ success: true, data: result });
  };
}
