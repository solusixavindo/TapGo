import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { PpobCatalogService } from "../application/PpobCatalogService.js";
import { PpobOrderService } from "../application/PpobOrderService.js";

export class PpobController {
  constructor(
    private readonly catalogService: PpobCatalogService,
    private readonly orderService: PpobOrderService
  ) {}

  catalog = async (_req: Request, res: Response) => {
    const result = await this.catalogService.getCatalog();
    res.json({ success: true, data: result });
  };

  inquiry = async (req: Request, res: Response) => {
    const result = await this.orderService.inquiry({
      userId: req.auth!.userId,
      sku: req.body.sku,
      targetNumber: req.body.targetNumber
    });
    res.json({ success: true, data: result });
  };

  createOrder = async (req: Request, res: Response) => {
    const result = await this.orderService.createOrder({
      userId: req.auth!.userId,
      sku: req.body.sku,
      targetNumber: req.body.targetNumber,
      idempotencyKey: req.body.idempotencyKey
    });
    res
      .status(result.replayed ? StatusCodes.OK : StatusCodes.CREATED)
      .json({ success: true, data: { ...result.order, replayed: result.replayed } });
  };

  orders = async (req: Request, res: Response) => {
    const result = await this.orderService.listOrders(
      req.auth!.userId,
      Number(req.query.page),
      Number(req.query.pageSize)
    );
    res.json({ success: true, data: result });
  };

  order = async (req: Request, res: Response) => {
    const result = await this.orderService.getOrder(req.auth!.userId, req.params.orderId as string);
    res.json({ success: true, data: result });
  };
}
