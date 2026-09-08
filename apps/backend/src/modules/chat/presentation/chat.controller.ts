import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ChatService } from "../application/ChatService.js";
import { emitChatMessage } from "../../../realtime/socket.js";

export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  send = async (req: Request, res: Response) => {
    const result = await this.chatService.sendMessage({
      rideRef: String(req.params.rideRef),
      userId: req.auth!.userId,
      message: String(req.body.message)
    });
    // Klien yang mengirim lewat REST (fallback tanpa socket) tetap perlu
    // pesannya sampai real-time ke lawan bicara yang sedang terhubung socket.
    emitChatMessage(result.rideOrderId, result);
    res.status(StatusCodes.CREATED).json({ success: true, data: result });
  };

  list = async (req: Request, res: Response) => {
    const result = await this.chatService.listMessages({
      rideRef: String(req.params.rideRef),
      userId: req.auth!.userId,
      page: Number(req.query.page),
      pageSize: Number(req.query.pageSize)
    });
    res.json({ success: true, data: result });
  };

  markRead = async (req: Request, res: Response) => {
    const result = await this.chatService.markRead({
      rideRef: String(req.params.rideRef),
      userId: req.auth!.userId
    });
    res.json({ success: true, data: result });
  };
}
