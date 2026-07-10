import { Request, Response } from "express";
import { MidtransPaymentService } from "../application/MidtransPaymentService.js";

export class MidtransController {
  constructor(private readonly midtransPaymentService: MidtransPaymentService) {}

  notification = async (req: Request, res: Response) => {
    const result = await this.midtransPaymentService.handleNotification(req.body);
    res.json({ success: true, data: result });
  };
}
