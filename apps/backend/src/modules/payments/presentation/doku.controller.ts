import { Request, Response } from "express";
import { DokuPaymentService } from "../application/DokuPaymentService.js";

export class DokuController {
  constructor(private readonly dokuPaymentService: DokuPaymentService) {}

  create = async (req: Request, res: Response) => {
    const result = await this.dokuPaymentService.createMembershipPayment({
      userId: req.auth!.userId,
      role: req.auth!.role,
      orderId: String(req.body.orderId),
    });
    res.json({ success: true, data: result });
  };

  notification = async (req: Request, res: Response) => {
    const result = await this.dokuPaymentService.handleNotification({
      payload: req.body,
      signatureBody:
        (req as Request & { rawBody?: string }).rawBody ?? req.body,
      requestTarget: req.originalUrl.split("?")[0] ?? "/api/webhooks/doku",
      headers: this.signatureHeaders(req),
    });
    res.json({ success: true, data: result });
  };

  status = async (req: Request, res: Response) => {
    const result = await this.dokuPaymentService.checkPaymentStatus(
      String(req.params.referenceId),
    );
    res.json({ success: true, data: result });
  };

  private header(req: Request, name: string) {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private signatureHeaders(req: Request) {
    const headers: {
      clientId?: string;
      requestId?: string;
      requestTimestamp?: string;
      signature?: string;
    } = {};
    const clientId = this.header(req, "client-id");
    const requestId = this.header(req, "request-id");
    const requestTimestamp = this.header(req, "request-timestamp");
    const signature = this.header(req, "signature");
    if (clientId) headers.clientId = clientId;
    if (requestId) headers.requestId = requestId;
    if (requestTimestamp) headers.requestTimestamp = requestTimestamp;
    if (signature) headers.signature = signature;
    return headers;
  }
}
