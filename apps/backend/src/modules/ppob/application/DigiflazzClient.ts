import crypto from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";

export type DigiflazzEnvironment = "development" | "sandbox" | "production";

export type DigiflazzConfig = {
  enabled: boolean;
  environment: DigiflazzEnvironment;
  baseUrl: string;
  username?: string;
  apiKey?: string;
  webhookSecret?: string;
};

export type DigiflazzPriceListItem = {
  product_name: string;
  category: string;
  brand: string;
  type: string;
  price: number | string;
  buyer_sku_code: string;
  buyer_product_status: boolean;
  seller_product_status: boolean;
  unlimited_stock: boolean;
  stock: number | string;
  desc?: string;
};

export type DigiflazzTransactionData = {
  ref_id: string;
  customer_no?: string;
  buyer_sku_code?: string;
  message?: string;
  status?: string;
  rc?: string;
  sn?: string;
  price?: number;
};

export type DigiflazzTransactionResponse = {
  data?: DigiflazzTransactionData;
};

export type JsonHttpTransport = {
  postJson<TResponse>(
    url: string,
    body: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<TResponse>;
};

export class FetchJsonTransport implements JsonHttpTransport {
  async postJson<TResponse>(
    url: string,
    body: Record<string, unknown>,
    options: { timeoutMs?: number } = {},
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = (await response.json()) as TResponse;
      if (!response.ok) {
        throw new AppError(
          "Digiflazz request failed",
          StatusCodes.BAD_GATEWAY,
          "DIGIFLAZZ_REQUEST_FAILED",
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError(
          "Digiflazz request timed out",
          StatusCodes.GATEWAY_TIMEOUT,
          "DIGIFLAZZ_TIMEOUT",
        );
      }
      throw new AppError(
        "Digiflazz is temporarily unavailable",
        StatusCodes.BAD_GATEWAY,
        "DIGIFLAZZ_UNAVAILABLE",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function currentDigiflazzConfig(): DigiflazzConfig {
  return {
    enabled: env.DIGIFLAZZ_ENABLED,
    environment: env.DIGIFLAZZ_ENVIRONMENT,
    baseUrl: env.DIGIFLAZZ_BASE_URL,
    ...(env.DIGIFLAZZ_USERNAME ? { username: env.DIGIFLAZZ_USERNAME } : {}),
    ...(env.DIGIFLAZZ_API_KEY ? { apiKey: env.DIGIFLAZZ_API_KEY } : {}),
    ...(env.DIGIFLAZZ_WEBHOOK_SECRET
      ? { webhookSecret: env.DIGIFLAZZ_WEBHOOK_SECRET }
      : {}),
  };
}

export function assertDigiflazzReady(config: DigiflazzConfig) {
  if (!config.enabled) {
    throw new AppError(
      "PPOB belum tersedia pada rilis ini.",
      StatusCodes.FORBIDDEN,
      "PPOB_DISABLED",
    );
  }
  if (!config.username || !config.apiKey) {
    throw new AppError(
      "Konfigurasi PPOB belum lengkap.",
      StatusCodes.SERVICE_UNAVAILABLE,
      "DIGIFLAZZ_NOT_CONFIGURED",
    );
  }
}

export function digiflazzPriceListSign(username: string, apiKey: string) {
  return md5(`${username}${apiKey}pricelist`);
}

export function digiflazzTransactionSign(username: string, apiKey: string, refId: string) {
  return md5(`${username}${apiKey}${refId}`);
}

export function verifyDigiflazzWebhookSignature(input: {
  rawBody: string;
  secret?: string;
  signatureHeader?: string;
}) {
  if (!input.secret || !input.signatureHeader) {
    return false;
  }
  const expected = `sha1=${crypto
    .createHmac("sha1", input.secret)
    .update(input.rawBody)
    .digest("hex")}`;
  const provided = input.signatureHeader.trim();
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

export function redactDigiflazzPayload(payload: unknown) {
  return redact(payload, new Set(["username", "sign", "api_key", "apiKey", "buyer_last_saldo"]));
}

export class DigiflazzClient {
  constructor(
    private readonly config: DigiflazzConfig,
    private readonly transport: JsonHttpTransport = new FetchJsonTransport(),
  ) {}

  async fetchPrepaidPriceList() {
    assertDigiflazzReady(this.config);
    const body = {
      cmd: "prepaid",
      username: this.config.username,
      sign: digiflazzPriceListSign(this.config.username!, this.config.apiKey!),
    };
    const response = await this.transport.postJson<{ data?: DigiflazzPriceListItem[] }>(
      `${this.config.baseUrl}/v1/price-list`,
      body,
    );
    return Array.isArray(response.data) ? response.data : [];
  }

  async createOrRecheckPrepaidTransaction(input: {
    buyerSkuCode: string;
    customerNo: string;
    refId: string;
    maxPrice?: number;
    callbackUrl?: string;
  }) {
    assertDigiflazzReady(this.config);
    const body: Record<string, unknown> = {
      username: this.config.username,
      buyer_sku_code: input.buyerSkuCode,
      customer_no: input.customerNo,
      ref_id: input.refId,
      sign: digiflazzTransactionSign(this.config.username!, this.config.apiKey!, input.refId),
      testing: this.config.environment !== "production",
    };
    if (input.maxPrice !== undefined) {
      body.max_price = input.maxPrice;
    }
    if (input.callbackUrl) {
      body.cb_url = input.callbackUrl;
    }
    return this.transport.postJson<DigiflazzTransactionResponse>(
      `${this.config.baseUrl}/v1/transaction`,
      body,
    );
  }
}

function md5(value: string) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function redact(value: unknown, sensitiveKeys: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, sensitiveKeys));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      sensitiveKeys.has(key) ? "[REDACTED]" : redact(nested, sensitiveKeys),
    ]),
  );
}
