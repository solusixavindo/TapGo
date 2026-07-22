import { Request, Response } from "express";
import { GooglePlayPurchaseService } from "../application/GooglePlayPurchaseService.js";

export class GooglePlayPurchaseController {
  constructor(private readonly purchaseServiceFactory: () => GooglePlayPurchaseService) {}

  verifyPurchase = async (req: Request, res: Response) => {
    const result = await this.purchaseServiceFactory().verifyPurchase({
      userId: req.auth!.userId,
      productId: req.body.productId,
      purchaseToken: req.body.purchaseToken,
      clientRequestId: req.body.clientRequestId,
    });

    res.json({
      success: true,
      data: result,
    });
  };
}
