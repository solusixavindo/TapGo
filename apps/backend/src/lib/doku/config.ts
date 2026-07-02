import { env } from "../../config/env.js";
import { AppError } from "../../core/errors/AppError.js";
import { StatusCodes } from "http-status-codes";
import { DokuConfig } from "./types.js";

const sandboxBaseUrl = "https://api-sandbox.doku.com";
const productionBaseUrl = "https://api.doku.com";

export function getDokuConfig(): DokuConfig {
  const environment = env.DOKU_ENVIRONMENT;
  return {
    clientId: env.DOKU_CLIENT_ID ?? "",
    secretKey: env.DOKU_SECRET_KEY ?? "",
    ...(env.DOKU_API_KEY ? { apiKey: env.DOKU_API_KEY } : {}),
    ...(env.DOKU_PUBLIC_KEY ? { publicKey: env.DOKU_PUBLIC_KEY } : {}),
    ...(env.DOKU_MERCHANT_PUBLIC_KEY
      ? { merchantPublicKey: env.DOKU_MERCHANT_PUBLIC_KEY }
      : {}),
    environment,
    integrationMode: env.DOKU_INTEGRATION_MODE,
    baseUrl:
      env.DOKU_BASE_URL ??
      (environment === "production" ? productionBaseUrl : sandboxBaseUrl),
    ...(env.DOKU_WEBHOOK_SECRET
      ? { webhookSecret: env.DOKU_WEBHOOK_SECRET }
      : {}),
    ...(env.DOKU_WEBHOOK_URL ? { webhookUrl: env.DOKU_WEBHOOK_URL } : {}),
    enabled: env.DOKU_ENABLED,
  };
}

export function assertDokuConfigured(config = getDokuConfig()) {
  const missing: string[] = [];
  if (!config.enabled) missing.push("DOKU_ENABLED=true");
  if (!config.clientId) missing.push("DOKU_CLIENT_ID");
  if (!config.secretKey) missing.push("DOKU_SECRET_KEY");

  if (missing.length > 0) {
    throw new AppError(
      `DOKU checkout is not ready. Missing backend configuration: ${missing.join(", ")}`,
      StatusCodes.SERVICE_UNAVAILABLE,
      "DOKU_NOT_CONFIGURED",
    );
  }

  if (config.integrationMode !== "checkout") {
    throw new AppError(
      "DOKU snap_direct mode is reserved for future use and is not enabled",
      StatusCodes.SERVICE_UNAVAILABLE,
      "DOKU_MODE_NOT_SUPPORTED",
    );
  }

  return config;
}
