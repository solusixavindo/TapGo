import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { corsOrigins } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./core/errors/errorHandler.js";
import { logger } from "./core/logger/logger.js";
import { adminRateLimiter, apiRateLimiter, paymentRateLimiter } from "./core/security/rateLimit.js";
import { authRouter } from "./modules/auth/presentation/auth.routes.js";
import { accountRouter } from "./modules/account/presentation/account.routes.js";
import { adminConsoleRouter } from "./modules/admin-console/presentation/admin-console.routes.js";
import { contactRouter } from "./modules/contact/presentation/contact.routes.js";
import { invoiceRouter } from "./modules/invoices/presentation/invoice.routes.js";
import { googlePlayRouter } from "./modules/google-play/presentation/google-play.routes.js";
import { legalRouter } from "./modules/legal/presentation/legal.routes.js";
import { membershipOrderRouter } from "./modules/memberships/presentation/membership-order.routes.js";
import { membershipRouter } from "./modules/memberships/presentation/membership.routes.js";
import { midtransRouter } from "./modules/payments/presentation/midtrans.routes.js";
import { dokuPaymentRouter, dokuWebhookRouter } from "./modules/payments/presentation/doku.routes.js";
import { profitSharingRouter } from "./modules/profit-sharing/presentation/profit-sharing.routes.js";
import { referralRouter } from "./modules/referrals/presentation/referral.routes.js";
import { walletRouter } from "./modules/wallets/presentation/wallet.routes.js";

function healthPayload() {
  return {
    success: true,
    service: "tapgo-backend",
    status: "ok",
    timestamp: new Date().toISOString()
  };
}

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(compression());
  app.use(express.json({
    limit: "1mb",
    verify: (req, _res, buffer) => {
      (req as express.Request & { rawBody?: string }).rawBody = buffer.toString("utf8");
    }
  }));
  app.use(express.urlencoded({ extended: true }));
  app.use(pinoHttp({ logger }));
  app.use(apiRateLimiter);

  app.get("/health", (_req, res) => {
    res.json(healthPayload());
  });

  app.get("/api/v1/health", (_req, res) => {
    res.json(healthPayload());
  });

  app.use("/legal", legalRouter);
  app.use("/", legalRouter);

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/account", accountRouter);
  app.use("/api/v1/contact", contactRouter);
  app.use("/api/v1/google-play", paymentRateLimiter, googlePlayRouter);
  app.use("/api/v1/invoices", invoiceRouter);
  app.use("/api/v1/membership", membershipOrderRouter);
  app.use("/api/v1/memberships", membershipRouter);
  app.use("/api/v1/payments", paymentRateLimiter, midtransRouter);
  app.use("/api/v1/payments", paymentRateLimiter, dokuPaymentRouter);
  app.use("/api/v1/webhooks", paymentRateLimiter, dokuWebhookRouter);
  // Backward-compatible alias for earlier DOKU sandbox checks. Use /api/v1/* in production docs.
  app.use("/api/payments", paymentRateLimiter, dokuPaymentRouter);
  // Backward-compatible alias only. Canonical production webhook: /api/v1/webhooks/doku.
  app.use("/api/webhooks", paymentRateLimiter, dokuWebhookRouter);
  app.use("/api/v1/admin/profit-sharing", adminRateLimiter, profitSharingRouter);
  app.use("/api/v1/admin", adminRateLimiter, adminConsoleRouter);
  app.use("/api/v1/referrals", referralRouter);
  app.use("/api/v1/wallet", walletRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
