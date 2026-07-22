import { Request, Response } from "express";
import { PpobService } from "../application/PpobService.js";

export class PpobController {
  constructor(private readonly serviceFactory: () => PpobService) {}

  products = async (_req: Request, res: Response) => {
    const result = await this.serviceFactory().listProducts();
    res.json({ success: true, data: result });
  };

  createTransaction = async (req: Request, res: Response) => {
    const result = await this.serviceFactory().createTransactionIntent({
      userId: req.auth!.userId,
      productId: String(req.body.productId),
      clientRequestId: String(req.body.clientRequestId),
      destination: String(req.body.destination),
    });
    res.status(201).json({ success: true, data: result });
  };

  transaction = async (req: Request, res: Response) => {
    const result = await this.serviceFactory().getTransaction({
      userId: req.auth!.userId,
      transactionId: String(req.params.id),
    });
    res.json({ success: true, data: result });
  };

  transactions = async (req: Request, res: Response) => {
    const result = await this.serviceFactory().listTransactions({
      userId: req.auth!.userId,
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 20),
    });
    res.json({ success: true, data: result });
  };

  digiflazzWebhook = async (req: Request, res: Response) => {
    const signature = this.header(req, "x-hub-signature");
    const userAgent = this.header(req, "user-agent");
    const result = await this.serviceFactory().processDigiflazzWebhook({
      rawBody: (req as Request & { rawBody?: string }).rawBody ?? "",
      ...(signature ? { signature } : {}),
      eventType:
        this.header(req, "x-digiflazz-event") ??
        this.header(req, "x-dgflazz-event") ??
        "unknown",
      ...(userAgent ? { userAgent } : {}),
      payload: req.body,
    });
    res.json({ success: true, data: result });
  };

  private header(req: Request, name: string) {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
}
