import pino from "pino";
import { env } from "../../config/env.js";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.passwordHash",
      "req.body.refreshToken",
      "req.body.token",
      "req.body.snapToken",
      "req.body.signature_key",
      "req.body.DOKU_SECRET_KEY",
      "req.body.dokuSecretKey",
      "req.body.secretKey",
      "req.headers.signature",
      "req.headers.x-hub-signature",
      "req.headers.x-signature",
      "req.headers.client-id",
      "req.body.username",
      "req.body.sign",
      "req.body.apiKey",
      "req.body.api_key",
      "password",
      "passwordHash",
      "refreshToken",
      "token",
      "snapToken",
      "signature_key",
      "signature",
      "secretKey",
      "DOKU_SECRET_KEY",
      "DOKU_API_KEY",
      "DIGIFLAZZ_API_KEY",
      "DIGIFLAZZ_WEBHOOK_SECRET"
    ],
    censor: "[REDACTED]"
  },
  formatters: {
    level(label) {
      return { level: label };
    }
  }
});
