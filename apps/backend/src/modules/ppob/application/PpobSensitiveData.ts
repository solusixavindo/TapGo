import crypto from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";

const keyLengthBytes = 32;

export function encryptPpobSensitiveValue(value: string, key = env.PPOB_DATA_ENCRYPTION_KEY) {
  const encryptionKey = parsePpobEncryptionKey(key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptPpobSensitiveValue(value: string, key = env.PPOB_DATA_ENCRYPTION_KEY) {
  const encryptionKey = parsePpobEncryptionKey(key);
  const [iv, authTag, encrypted] = value.split(".");
  if (!iv || !authTag || !encrypted) {
    throw new AppError(
      "Encrypted PPOB data is invalid.",
      StatusCodes.INTERNAL_SERVER_ERROR,
      "PPOB_ENCRYPTED_DATA_INVALID",
    );
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError(
      "Encrypted PPOB data failed authentication.",
      StatusCodes.INTERNAL_SERVER_ERROR,
      "PPOB_ENCRYPTED_DATA_AUTH_FAILED",
    );
  }
}

export function parsePpobEncryptionKey(value = env.PPOB_DATA_ENCRYPTION_KEY) {
  if (!value) {
    throw new AppError(
      "PPOB encryption key is not configured.",
      StatusCodes.SERVICE_UNAVAILABLE,
      "PPOB_ENCRYPTION_KEY_MISSING",
    );
  }
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length !== keyLengthBytes) {
    throw new AppError(
      "PPOB encryption key must be 32 bytes.",
      StatusCodes.SERVICE_UNAVAILABLE,
      "PPOB_ENCRYPTION_KEY_INVALID",
    );
  }
  return decoded;
}
