import crypto from "node:crypto";
import http, { Server } from "node:http";
import { AddressInfo } from "node:net";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { createApp } from "../../src/app.js";
import { encryptPpobSensitiveValue } from "../../src/modules/ppob/application/PpobSensitiveData.js";
import {
  prisma,
  runIntegration,
  setupReferralWalletIntegration,
} from "../helpers/referralWalletHarness.js";

describe.skipIf(!runIntegration)("Digiflazz webhook raw-body route verification", () => {
  setupReferralWalletIntegration();

  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    env.DIGIFLAZZ_ENABLED = true;
    env.DIGIFLAZZ_USERNAME = "buyer";
    env.DIGIFLAZZ_API_KEY = "api-key";
    env.DIGIFLAZZ_WEBHOOK_SECRET = "webhook-secret";
    env.PPOB_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString("base64");
  });

  afterAll(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("accepts an exact signed raw body through Express middleware", async () => {
    await createTransaction("RAW-OK");
    const rawBody = '{"data":{"ref_id":"RAW-OK","status":"Sukses","rc":"00","sn":"SN1234567890"}}';
    const response = await postWebhook(rawBody, signature(rawBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { status: "PROCESSED", providerReference: "RAW-OK" },
    });
  });

  it("rejects semantic JSON with different whitespace when signed with the old raw body", async () => {
    await createTransaction("RAW-WHITESPACE");
    const signedBody = '{"data":{"ref_id":"RAW-WHITESPACE","status":"Sukses"}}';
    const mutatedBody = '{ "data": { "ref_id": "RAW-WHITESPACE", "status": "Sukses" } }';
    const response = await postWebhook(mutatedBody, signature(signedBody));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "DIGIFLAZZ_SIGNATURE_INVALID",
    });
  });

  it("rejects one-byte body mutation, missing signature, malformed signature, and wrong secret", async () => {
    await createTransaction("RAW-MUTATE");
    const rawBody = '{"data":{"ref_id":"RAW-MUTATE","status":"Sukses"}}';

    expect((await postWebhook(`${rawBody}\n`, signature(rawBody))).status).toBe(401);
    expect((await postWebhook(rawBody)).status).toBe(401);
    expect((await postWebhook(rawBody, "not-a-sha1-header")).status).toBe(401);

    const wrongSecretSignature = `sha1=${crypto
      .createHmac("sha1", "wrong-secret")
      .update(rawBody)
      .digest("hex")}`;
    expect((await postWebhook(rawBody, wrongSecretSignature)).status).toBe(401);
  });

  async function postWebhook(rawBody: string, signatureHeader?: string) {
    return fetch(`${baseUrl}/api/v1/webhooks/digiflazz`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signatureHeader ? { "X-Hub-Signature": signatureHeader } : {}),
      },
      body: rawBody,
    });
  }
});

async function createTransaction(providerReference: string) {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  const phoneDigits = BigInt(`0x${crypto.createHash("sha256").update(providerReference).digest("hex").slice(0, 12)}`)
    .toString()
    .slice(0, 10)
    .padEnd(10, "0");
  const user = await prisma.user.create({
    data: {
      fullName: providerReference,
      phone: `+628${phoneDigits}`,
      referralCode: providerReference.replace(/[^A-Z0-9]/gi, "").slice(0, 20),
      role: "USER",
      membershipId: basic.id,
      wallet: {
        create: {
          balance: 0,
          cashBalance: 0,
          ppobBalance: 0,
          currency: "IDR",
        },
      },
    },
  });
  const product = await prisma.ppobProduct.create({
    data: {
      provider: "DIGIFLAZZ",
      providerSkuCode: providerReference,
      productName: "Telkomsel Pulsa 5.000",
      category: "Pulsa",
      brand: "TELKOMSEL",
      type: "Umum",
      costPrice: 5100,
      sellingPrice: 6000,
      buyerProductActive: true,
      sellerProductActive: true,
      isActive: true,
      unlimitedStock: true,
      stock: 0,
    },
  });
  return prisma.ppobTransaction.create({
    data: {
      userId: user.id,
      productId: product.id,
      clientRequestId: providerReference,
      provider: "DIGIFLAZZ",
      providerReference,
      destinationEncrypted: encryptPpobSensitiveValue("081234567890"),
      destinationMasked: "0812****890",
      costPrice: 5100,
      sellingPrice: 6000,
      adminFee: 900,
      status: "PENDING",
      paymentStatus: "PAID",
      paidAt: new Date(),
    },
  });
}

function signature(rawBody: string) {
  return `sha1=${crypto
    .createHmac("sha1", "webhook-secret")
    .update(rawBody)
    .digest("hex")}`;
}
