import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { strictLiteralTrueBoolean } from "../../src/config/env.js";
import { AppError } from "../../src/core/errors/AppError.js";
import {
  DigiflazzClient,
  JsonHttpTransport,
  digiflazzPriceListSign,
  digiflazzTransactionSign,
  redactDigiflazzPayload,
  verifyDigiflazzWebhookSignature,
} from "../../src/modules/ppob/application/DigiflazzClient.js";
import {
  decryptPpobSensitiveValue,
  encryptPpobSensitiveValue,
} from "../../src/modules/ppob/application/PpobSensitiveData.js";
import {
  normalizeIndonesianMobile,
  maskDestination,
  resolvePpobProviderTransition,
} from "../../src/modules/ppob/application/PpobService.js";

describe("Digiflazz PPOB foundation unit safety", () => {
  it.each([
    ["unset", undefined, false],
    ["empty", "", false],
    ["false", "false", false],
    ["FALSE", "FALSE", false],
    ["true", "true", true],
    ["TRUE", "TRUE", true],
  ])("parses DIGIFLAZZ_ENABLED %s", (_label, value, expected) => {
    expect(strictLiteralTrueBoolean(false).parse(value)).toBe(expected);
  });

  it.each(["True", "FALSES", "1", "yes", "enabled", "on"])(
    "rejects unsupported DIGIFLAZZ_ENABLED value %s",
    (value) => {
      expect(strictLiteralTrueBoolean(false).safeParse(value).success).toBe(false);
    },
  );

  it("fails closed when Digiflazz configuration is disabled or incomplete", async () => {
    const transport: JsonHttpTransport = {
      postJson: async <TResponse>() => ({ data: [] }) as TResponse,
    };
    await expect(
      new DigiflazzClient(
        { enabled: false, environment: "development", baseUrl: "https://api.digiflazz.com" },
        transport,
      ).fetchPrepaidPriceList(),
    ).rejects.toMatchObject({ code: "PPOB_DISABLED" });

    await expect(
      new DigiflazzClient(
        { enabled: true, environment: "development", baseUrl: "https://api.digiflazz.com" },
        transport,
      ).fetchPrepaidPriceList(),
    ).rejects.toMatchObject({ code: "DIGIFLAZZ_NOT_CONFIGURED" });
  });

  it("builds official Digiflazz signatures", () => {
    expect(digiflazzPriceListSign("username", "apiKey")).toBe(
      crypto.createHash("md5").update("usernameapiKeypricelist").digest("hex"),
    );
    expect(digiflazzTransactionSign("username", "apiKey", "ref-1")).toBe(
      crypto.createHash("md5").update("usernameapiKeyref-1").digest("hex"),
    );
  });

  it("verifies X-Hub-Signature using HMAC SHA1 over raw body", () => {
    const rawBody = JSON.stringify({ data: { ref_id: "TG001", status: "Sukses" } });
    const secret = "webhook-secret";
    const signature = `sha1=${crypto.createHmac("sha1", secret).update(rawBody).digest("hex")}`;

    expect(verifyDigiflazzWebhookSignature({ rawBody, secret, signatureHeader: signature })).toBe(true);
    expect(verifyDigiflazzWebhookSignature({ rawBody, secret, signatureHeader: "sha1=bad" })).toBe(false);
    expect(verifyDigiflazzWebhookSignature({ rawBody, secret })).toBe(false);
  });

  it("sends price-list and transaction requests through injectable transport only", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const transport: JsonHttpTransport = {
      postJson: async <TResponse>(url: string, body: Record<string, unknown>) => {
        calls.push({ url, body });
        return { data: [] } as TResponse;
      },
    };
    const client = new DigiflazzClient(
      {
        enabled: true,
        environment: "development",
        baseUrl: "https://api.digiflazz.com",
        username: "buyer",
        apiKey: "secret",
      },
      transport,
    );

    await client.fetchPrepaidPriceList();
    await client.createOrRecheckPrepaidTransaction({
      buyerSkuCode: "S5",
      customerNo: "081234567890",
      refId: "TG001",
      maxPrice: 5100,
    });

    expect(calls[0]).toMatchObject({
      url: "https://api.digiflazz.com/v1/price-list",
      body: { cmd: "prepaid", username: "buyer" },
    });
    expect(calls[1]).toMatchObject({
      url: "https://api.digiflazz.com/v1/transaction",
      body: {
        username: "buyer",
        buyer_sku_code: "S5",
        customer_no: "081234567890",
        ref_id: "TG001",
        testing: true,
        max_price: 5100,
      },
    });
    expect(calls[0]?.body.sign).toBeDefined();
    expect(calls[1]?.body.sign).toBeDefined();
  });

  it("redacts sensitive provider payload fields", () => {
    expect(
      redactDigiflazzPayload({
        username: "buyer",
        sign: "secret-sign",
        data: { buyer_last_saldo: 1000000, ref_id: "TG001" },
      }),
    ).toEqual({
      username: "[REDACTED]",
      sign: "[REDACTED]",
      data: { buyer_last_saldo: "[REDACTED]", ref_id: "TG001" },
    });
  });

  it("validates and masks Indonesian mobile destinations", () => {
    expect(normalizeIndonesianMobile("+62 812-3456-7890")).toBe("081234567890");
    expect(maskDestination("081234567890")).toBe("0812****890");
    expect(() => normalizeIndonesianMobile("12345")).toThrow(AppError);
  });

  it("encrypts PPOB sensitive data with AES-256-GCM and random nonce", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const ciphertextA = encryptPpobSensitiveValue("081234567890", key);
    const ciphertextB = encryptPpobSensitiveValue("081234567890", key);

    expect(ciphertextA).not.toBe(ciphertextB);
    expect(ciphertextA).not.toContain("081234567890");
    expect(decryptPpobSensitiveValue(ciphertextA, key)).toBe("081234567890");
  });

  it("rejects tampered, wrong-key, missing-key, and invalid-key PPOB ciphertext", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const wrongKey = Buffer.alloc(32, 8).toString("base64");
    const ciphertext = encryptPpobSensitiveValue("SN-000011112222", key);
    const tampered = `${ciphertext.slice(0, -2)}aa`;

    expect(() => decryptPpobSensitiveValue(tampered, key)).toThrow(AppError);
    expect(() => decryptPpobSensitiveValue(ciphertext, wrongKey)).toThrow(AppError);
    expect(() => encryptPpobSensitiveValue("value", undefined)).toThrow(AppError);
    expect(() => encryptPpobSensitiveValue("value", "short")).toThrow(AppError);
  });

  it("keeps PPOB provider state transitions monotonic", () => {
    expect(resolvePpobProviderTransition("PENDING", "SUCCESS")).toBe("SUCCESS");
    expect(resolvePpobProviderTransition("PENDING", "FAILED")).toBe("FAILED");
    expect(resolvePpobProviderTransition("SUCCESS", "FAILED")).toBe("SUCCESS");
    expect(resolvePpobProviderTransition("SUCCESS", "PENDING")).toBe("SUCCESS");
    expect(resolvePpobProviderTransition("FAILED", "SUCCESS")).toBe("FAILED");
  });
});
