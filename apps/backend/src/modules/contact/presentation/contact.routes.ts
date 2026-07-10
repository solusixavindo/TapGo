import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { contactMessageSchema } from "./contact.validators.js";

export const contactRouter = Router();

contactRouter.use(requireAuth);

contactRouter.post(
  "/",
  validateRequest(contactMessageSchema),
  asyncHandler(async (req, res) => {
    const message = await prisma.contactMessage.create({
      data: {
        userId: req.auth!.userId,
        name: req.body.name,
        contact: req.body.contact,
        category: req.body.category,
        message: req.body.message
      }
    });

    res.status(201).json({ success: true, data: message });
  })
);

