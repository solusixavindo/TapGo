import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { prisma } from "../../../config/prisma.js";
import { AppError } from "../../../core/errors/AppError.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { requireAuth } from "../../../core/security/authContext.js";

export const invoiceRouter = Router();

invoiceRouter.use(requireAuth);

invoiceRouter.get("/:id", asyncHandler(async (req, res) => {
  const idOrNumber = String(req.params.id);
  const where = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idOrNumber)
    ? { OR: [{ id: idOrNumber }, { number: idOrNumber }] }
    : { number: idOrNumber };
  const invoice = await prisma.invoice.findFirst({
    where,
    include: {
      user: { select: { id: true, fullName: true, phone: true, email: true } },
      order: { include: { membership: true } },
      payments: { orderBy: { createdAt: "desc" }, take: 3 }
    }
  });

  if (!invoice) {
    throw new AppError("Invoice not found", StatusCodes.NOT_FOUND, "INVOICE_NOT_FOUND");
  }

  const canRead = invoice.userId === req.auth!.userId || req.auth!.role === "ADMIN" || req.auth!.role === "SUPER_ADMIN";
  if (!canRead) {
    throw new AppError("You are not allowed to view this invoice", StatusCodes.FORBIDDEN, "INVOICE_FORBIDDEN");
  }

  res.json({ success: true, data: invoice });
}));
