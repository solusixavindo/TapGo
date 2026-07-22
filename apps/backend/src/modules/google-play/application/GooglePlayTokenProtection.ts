import crypto from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";

const TOKEN_ENCRYPTION_VERSION = "v1";
const IV_LENGTH = 12;

export class GooglePlayTokenProtection {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new AppError(
        "Google Play token protection is not configured.",
        StatusCodes.SERVICE_UNAVAILABLE,
        "GOOGLE_PLAY_TOKEN_PROTECTION_NOT_CONFIGURED",
      );
    }
  }

  static fromEnv() {
    const encodedKey = env.GOOGLE_PLAY_PURCHASE_TOKEN_ENCRYPTION_KEY;
    if (!encodedKey) {
      throw new AppError(
        "Google Play token protection is not configured.",
        StatusCodes.SERVICE_UNAVAILABLE,
        "GOOGLE_PLAY_TOKEN_PROTECTION_NOT_CONFIGURED",
      );
    }

    let key: Buffer;
    try {
      key = Buffer.from(encodedKey, "base64");
    } catch {
      throw new AppError(
        "Google Play token protection is not configured.",
        StatusCodes.SERVICE_UNAVAILABLE,
        "GOOGLE_PLAY_TOKEN_PROTECTION_NOT_CONFIGURED",
      );
    }

    return new GooglePlayTokenProtection(key);
  }

  hashPurchaseToken(purchaseToken: string) {
    return crypto
      .createHmac("sha256", this.key)
      .update(purchaseToken, "utf8")
      .digest("hex");
  }

  encryptPurchaseToken(purchaseToken: string) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(purchaseToken, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      TOKEN_ENCRYPTION_VERSION,
      iv.toString("base64"),
      tag.toString("base64"),
      encrypted.toString("base64"),
    ].join(":");
  }
}
