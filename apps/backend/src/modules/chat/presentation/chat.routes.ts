import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { chatRateLimiter } from "../../../core/security/rateLimit.js";
import { ChatService } from "../application/ChatService.js";
import { ChatController } from "./chat.controller.js";
import { chatListMessagesSchema, chatMarkReadSchema, chatSendMessageSchema } from "./chat.validators.js";

const service = new ChatService(prisma);
const controller = new ChatController(service);

/**
 * REST untuk chat per-ride (Stage R2.10) — pelengkap Socket.IO, bukan
 * penggantinya. Socket memberi pengiriman real-time; rute ini memberi jalan
 * fallback (klien tanpa socket aktif tetap bisa kirim/baca) dan histori saat
 * membuka layar chat. Kedua jalur memakai ChatService yang sama sehingga
 * aturan partisipan & jendela status ride tidak pernah berbeda antar jalur.
 */
export const chatRouter = Router();

chatRouter.use(requireAuth);
chatRouter.get("/:rideRef/messages", validateRequest(chatListMessagesSchema), asyncHandler(controller.list));
chatRouter.post(
  "/:rideRef/messages",
  chatRateLimiter,
  validateRequest(chatSendMessageSchema),
  asyncHandler(controller.send)
);
chatRouter.post("/:rideRef/read", validateRequest(chatMarkReadSchema), asyncHandler(controller.markRead));

/** Kotak masuk chat milik pemanggil: GET /api/v1/chat/conversations. */
export const chatInboxRouter = Router();
chatInboxRouter.use(requireAuth);
chatInboxRouter.get("/", asyncHandler(controller.conversations));
