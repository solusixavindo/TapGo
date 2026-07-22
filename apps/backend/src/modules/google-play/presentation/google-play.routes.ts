import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { GooglePlayPurchaseService } from "../application/GooglePlayPurchaseService.js";
import { GooglePlayTokenProtection } from "../application/GooglePlayTokenProtection.js";
import { GooglePlayVerifier, NotConfiguredGooglePlayVerifier } from "../application/GooglePlayVerifier.js";
import { GooglePlayPurchaseController } from "./google-play.controller.js";
import { verifyGooglePlayPurchaseSchema } from "./google-play.validators.js";

let verifierFactory: () => GooglePlayVerifier = () => new NotConfiguredGooglePlayVerifier();

export function setGooglePlayVerifierFactoryForTests(factory: () => GooglePlayVerifier) {
  verifierFactory = factory;
}

export function resetGooglePlayVerifierFactoryForTests() {
  verifierFactory = () => new NotConfiguredGooglePlayVerifier();
}

const controller = new GooglePlayPurchaseController(
  () => new GooglePlayPurchaseService(
    prisma,
    verifierFactory(),
    GooglePlayTokenProtection.fromEnv(),
  ),
);

export const googlePlayRouter = Router();

googlePlayRouter.use(requireAuth);
googlePlayRouter.post(
  "/purchases/verify",
  validateRequest(verifyGooglePlayPurchaseSchema),
  asyncHandler(controller.verifyPurchase),
);
