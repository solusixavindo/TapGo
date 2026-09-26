import { Request, Response, Router } from "express";
import { StatusCodes } from "http-status-codes";
import { z } from "zod";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireChannel, requireRoles } from "../../../core/security/authContext.js";
import { ManualTopUpService } from "../application/ManualTopUpService.js";

const service = new ManualTopUpService(prisma);

const createSchema = z.object({ body: z.object({ amount: z.coerce.number().int() }) });
const idSchema = z.object({ params: z.object({ orderId: z.string().uuid() }) });
const listSchema = z.object({ query: z.object({ status: z.enum(["PENDING", "PAID", "CANCELLED"]).optional() }) });
const rejectSchema = z.object({
  params: z.object({ orderId: z.string().uuid() }),
  body: z.object({ reason: z.string().trim().max(200).optional() }).default({}),
});

/** Rute pengguna (kanal WEB): dipasang di bawah /api/v1/web/wallet. */
export const webManualTopUpRouter = Router();
webManualTopUpRouter.use(requireAuth, requireChannel("WEB"));
webManualTopUpRouter.post(
  "/topup/manual",
  validateRequest(createSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.createOrder({ userId: req.auth!.userId, amount: Number(req.body.amount) });
    res.status(StatusCodes.CREATED).json({ success: true, data });
  }),
);
webManualTopUpRouter.get(
  "/topup/manual/:orderId",
  validateRequest(idSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.getOrderForUser({ userId: req.auth!.userId, orderId: String(req.params.orderId) });
    res.json({ success: true, data });
  }),
);

/** Rute Super Admin: dipasang di bawah /api/v1/admin (setelah autentikasi konsol admin). */
export const adminManualTopUpRouter = Router();
adminManualTopUpRouter.get(
  "/manual-topups",
  requireRoles("SUPER_ADMIN"),
  validateRequest(listSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const status = (req.query.status as "PENDING" | "PAID" | "CANCELLED" | undefined) ?? "PENDING";
    res.json({ success: true, data: await service.listPendingForAdmin(status) });
  }),
);
adminManualTopUpRouter.post(
  "/manual-topups/:orderId/confirm",
  requireRoles("SUPER_ADMIN"),
  validateRequest(idSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await service.confirm({ orderId: String(req.params.orderId), actorId: req.auth!.userId }) });
  }),
);
adminManualTopUpRouter.post(
  "/manual-topups/:orderId/reject",
  requireRoles("SUPER_ADMIN"),
  validateRequest(rejectSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({
      success: true,
      data: await service.reject({ orderId: String(req.params.orderId), actorId: req.auth!.userId, reason: req.body.reason }),
    });
  }),
);
