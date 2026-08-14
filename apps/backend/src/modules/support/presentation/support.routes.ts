import { Router } from "express";
import { SupportTicketStatus, UserRole } from "@prisma/client";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import { supportRateLimiter } from "../../../core/security/rateLimit.js";
import { SupportTicketService } from "../application/SupportTicketService.js";
import {
  adminSupportListSchema,
  adminSupportUpdateSchema,
  createSupportTicketSchema,
  supportTicketIdSchema,
} from "./support.validators.js";

export const supportRouter = Router();
export const adminSupportRouter = Router();

const supportTicketService = new SupportTicketService();

supportRouter.use(requireAuth);

supportRouter.get(
  "/tickets",
  asyncHandler(async (req, res) => {
    const data = await supportTicketService.listUserTickets(req.auth!.userId);
    res.json({ success: true, data });
  }),
);

supportRouter.post(
  "/tickets",
  supportRateLimiter,
  validateRequest(createSupportTicketSchema),
  asyncHandler(async (req, res) => {
    const data = await supportTicketService.createTicket({
      userId: req.auth!.userId,
      category: req.body.category,
      subject: req.body.subject,
      message: req.body.message,
    });
    res.status(201).json({ success: true, data });
  }),
);

supportRouter.get(
  "/tickets/:id",
  validateRequest(supportTicketIdSchema),
  asyncHandler(async (req, res) => {
    const data = await supportTicketService.getUserTicket(
      req.auth!.userId,
      String(req.params.id),
    );
    res.json({ success: true, data });
  }),
);

adminSupportRouter.use(requireAuth, requireRoles(UserRole.ADMIN, UserRole.SUPER_ADMIN));

adminSupportRouter.get(
  "/tickets",
  validateRequest(adminSupportListSchema),
  asyncHandler(async (req, res) => {
    const data = await supportTicketService.listAdminTickets(
      req.query.status as SupportTicketStatus | undefined,
    );
    res.json({ success: true, data });
  }),
);

adminSupportRouter.get(
  "/tickets/:id",
  validateRequest(supportTicketIdSchema),
  asyncHandler(async (req, res) => {
    const data = await supportTicketService.getAdminTicket(String(req.params.id));
    res.json({ success: true, data });
  }),
);

adminSupportRouter.patch(
  "/tickets/:id",
  validateRequest(adminSupportUpdateSchema),
  asyncHandler(async (req, res) => {
    const data = await supportTicketService.updateAdminTicket({
      ticketId: String(req.params.id),
      adminId: req.auth!.userId,
      adminRole: req.auth!.role,
      status: req.body.status,
      message: req.body.message,
    });
    res.json({ success: true, data });
  }),
);
