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
import { adminScopeRouter } from "./modules/admin-console/presentation/admin-scope.routes.js";
import { contactRouter } from "./modules/contact/presentation/contact.routes.js";
import { invoiceRouter } from "./modules/invoices/presentation/invoice.routes.js";
import { legalRouter } from "./modules/legal/presentation/legal.routes.js";
import { memberIdentityRouter } from "./modules/member-identity/presentation/member-identity.routes.js";
import { membershipOrderRouter } from "./modules/memberships/presentation/membership-order.routes.js";
import { webMembershipRouter } from "./modules/memberships/presentation/web-membership.routes.js";
import { membershipRouter } from "./modules/memberships/presentation/membership.routes.js";
import { midtransRouter } from "./modules/payments/presentation/midtrans.routes.js";
import { dokuPaymentRouter, dokuWebhookRouter } from "./modules/payments/presentation/doku.routes.js";
import { ppobRouter } from "./modules/ppob/presentation/ppob.routes.js";
import { digiflazzWebhookRouter } from "./modules/ppob/presentation/digiflazz-webhook.routes.js";
import { profitSharingRouter } from "./modules/profit-sharing/presentation/profit-sharing.routes.js";
import { referralRouter } from "./modules/referrals/presentation/referral.routes.js";
import { driverReviewRouter } from "./modules/rides/presentation/driverReview.routes.js";
import { adminRideRouter, driverRideRouter, rideRouter } from "./modules/rides/presentation/ride.routes.js";
import { driverDocumentRouter } from "./modules/drivers/presentation/driver-document.routes.js";
import { adminSupportRouter, supportRouter } from "./modules/support/presentation/support.routes.js";
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

  // P1-3: produksi berada di belakang TEPAT SATU reverse proxy (Nginx) yang
  // menetapkan X-Forwarded-For. trust proxy = 1 membuat Express memakai satu hop
  // paling kanan, sehingga req.ip = IP klien asli yang di-set Nginx dan header
  // X-Forwarded-For yang dipalsukan klien tidak dapat memalsukan IP untuk
  // rate limiting. JANGAN memakai `true` (mempercayai seluruh rantai) tanpa
  // alasan, karena itu membuat spoofing mungkin.
  app.set("trust proxy", 1);

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
  app.use("/api/v1/invoices", invoiceRouter);
  app.use("/api/v1/member-identity", memberIdentityRouter);
  // Kanal web didaftarkan lebih dulu agar prefix /web tidak tertangkap router
  // membership aplikasi mobile.
  app.use("/api/v1/web/membership", webMembershipRouter);
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
  app.use("/api/v1/admin/rides", adminRateLimiter, adminRideRouter);
  app.use("/api/v1/admin/driver-review", driverReviewRouter);
  app.use("/api/v1/admin/scope-grants", adminScopeRouter);
  app.use("/api/v1/admin/support", adminRateLimiter, adminSupportRouter);
  app.use("/api/v1/admin", adminRateLimiter, adminConsoleRouter);
  app.use("/api/v1/referrals", referralRouter);
  // Release 2 — domain PPOB (Stage R2.7). Pembelian berada di bawah
  // paymentRateLimiter di dalam router, sama seperti jalur pembayaran lain.
  app.use("/api/v1/ppob", ppobRouter);
  // Webhook provider PPOB (Stage R2.8). TANPA auth — keaslian dibuktikan
  // HMAC X-Hub-Signature di dalam router; rate limit mengikuti jalur webhook
  // pembayaran lain.
  app.use("/api/v1/webhooks/ppob", paymentRateLimiter, digiflazzWebhookRouter);
  // Release 2 — domain Ride. Tidak diekspos ke aplikasi Play Release 1.
  app.use("/api/v1/rides", rideRouter);
  // URUTAN PENTING. driverRideRouter memasang pemeriksa kapabilitas untuk
  // SELURUH sub-jalur /api/v1/driver, dan pemeriksa itu menolak driver yang
  // belum terverifikasi — padahal justru merekalah yang perlu mengunggah
  // dokumen. Karena Express menjalankan router sesuai urutan pendaftaran,
  // rute dokumen harus didaftarkan lebih dulu.
  app.use("/api/v1/driver/documents", driverDocumentRouter);
  app.use("/api/v1/driver", driverRideRouter);
  app.use("/api/v1/support", supportRouter);
  app.use("/api/v1/wallet", walletRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
