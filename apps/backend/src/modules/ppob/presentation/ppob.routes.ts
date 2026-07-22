import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import {
  DigiflazzClient,
  currentDigiflazzConfig,
} from "../application/DigiflazzClient.js";
import { PpobService } from "../application/PpobService.js";
import { PpobController } from "./ppob.controller.js";
import {
  digiflazzWebhookSchema,
  ppobCreateTransactionSchema,
  ppobProductListSchema,
  ppobTransactionDetailSchema,
  ppobTransactionListSchema,
} from "./ppob.validators.js";

const controller = new PpobController(() => {
  const config = currentDigiflazzConfig();
  return new PpobService(
    prisma,
    new DigiflazzClient(config),
    undefined,
    config,
  );
});

export const ppobRouter = Router();
export const digiflazzWebhookRouter = Router();

ppobRouter.use(requireAuth);
ppobRouter.get(
  "/products",
  validateRequest(ppobProductListSchema),
  asyncHandler(controller.products),
);
ppobRouter.get(
  "/transactions",
  validateRequest(ppobTransactionListSchema),
  asyncHandler(controller.transactions),
);
ppobRouter.post(
  "/transactions",
  validateRequest(ppobCreateTransactionSchema),
  asyncHandler(controller.createTransaction),
);
ppobRouter.get(
  "/transactions/:id",
  validateRequest(ppobTransactionDetailSchema),
  asyncHandler(controller.transaction),
);

digiflazzWebhookRouter.post(
  "/digiflazz",
  validateRequest(digiflazzWebhookSchema),
  asyncHandler(controller.digiflazzWebhook),
);
