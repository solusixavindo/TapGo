import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { AppError } from "../../src/core/errors/AppError.js";
import { DigiflazzClient, JsonHttpTransport } from "../../src/modules/ppob/application/DigiflazzClient.js";
import {
  PaymentConfirmationPort,
  PpobService,
} from "../../src/modules/ppob/application/PpobService.js";
import {
  cleanDatabase,
  prisma,
  runIntegration,
  seedMemberships,
  setupReferralWalletIntegration,
} from "../helpers/referralWalletHarness.js";

const enabledConfig = {
  enabled: true,
  environment: "development" as const,
  baseUrl: "https://api.digiflazz.com",
  username: "buyer",
  apiKey: "api-key",
  webhookSecret: "webhook-secret",
};

describe.skipIf(!runIntegration)("Digiflazz PPOB commerce foundation", () => {
  setupReferralWalletIntegration();

  beforeEach(() => {
    env.PPOB_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  });

  it("syncs Pulsa/Data catalog idempotently and deactivates unavailable products", async () => {
    const transport = priceListTransport([
      priceItem("Telkomsel Pulsa 5.000", "Pulsa", "TELKOMSEL", "S5", 5100),
      priceItem("Telkomsel Data 1GB", "Data", "TELKOMSEL", "DATA1", 12000),
      priceItem("PLN Token", "PLN", "PLN", "PLN20", 20000),
    ]);
    const service = serviceWith(transport);

    await expect(service.syncDigiflazzCatalog(new Date("2026-07-22T00:00:00Z"))).resolves.toEqual({
      synced: 2,
      skipped: 1,
    });
    await service.syncDigiflazzCatalog(new Date("2026-07-22T00:01:00Z"));

    expect(await prisma.ppobProduct.count()).toBe(2);
    expect(await prisma.ppobProduct.count({ where: { category: "PLN" } })).toBe(0);
    await prisma.ppobProduct.update({
      where: {
        provider_providerSkuCode: { provider: "DIGIFLAZZ", providerSkuCode: "S5" },
      },
      data: { sellingPrice: 7000 },
    });

    await serviceWith(priceListTransport([
      priceItem("Telkomsel Pulsa 5.000", "Pulsa", "TELKOMSEL", "S5", 5200),
      priceItem("Telkomsel Data 1GB", "Data", "TELKOMSEL", "DATA1", 12000),
    ])).syncDigiflazzCatalog(new Date("2026-07-22T00:01:30Z"));
    const approvedPrice = await prisma.ppobProduct.findUniqueOrThrow({
      where: { provider_providerSkuCode: { provider: "DIGIFLAZZ", providerSkuCode: "S5" } },
    });
    expect(approvedPrice.costPrice).toBe(5200);
    expect(approvedPrice.sellingPrice).toBe(7000);

    const deactivateService = serviceWith(priceListTransport([
      priceItem("Telkomsel Pulsa 5.000", "Pulsa", "TELKOMSEL", "S5", 5100),
    ]));
    await deactivateService.syncDigiflazzCatalog(new Date("2026-07-22T00:02:00Z"));
    const inactive = await prisma.ppobProduct.findUniqueOrThrow({
      where: { provider_providerSkuCode: { provider: "DIGIFLAZZ", providerSkuCode: "DATA1" } },
    });
    expect(inactive.isActive).toBe(false);
  });

  it("creates transaction intent with server price, masked destination, and duplicate idempotency", async () => {
    const user = await createUser("PPOBUSER1");
    const product = await createProduct();
    const service = serviceWith(transactionTransport("Sukses"));

    const first = await service.createTransactionIntent({
      userId: user.id,
      productId: product.id,
      clientRequestId: "req-duplicate-1",
      destination: "+62 812 3456 7890",
    });
    const second = await service.createTransactionIntent({
      userId: user.id,
      productId: product.id,
      clientRequestId: "req-duplicate-1",
      destination: "081299999999",
    });

    expect(first.id).toBe(second.id);
    expect(first.sellingPrice).toBe(6000);
    expect(first.destinationMasked).toBe("0812****890");
    expect(first).not.toHaveProperty("costPrice");
    await expect(
      service.createTransactionIntent({
        userId: user.id,
        productId: product.id,
        clientRequestId: "req-bad-destination",
        destination: "12345",
      }),
    ).rejects.toMatchObject({ code: "PPOB_DESTINATION_INVALID" });
  });

  it("rejects inactive SKU and keeps provider references unique per user/client request", async () => {
    const userA = await createUser("PPOBUSER2A");
    const userB = await createUser("PPOBUSER2B");
    const product = await createProduct({ isActive: false });
    const service = serviceWith(transactionTransport("Sukses"));

    await expect(
      service.createTransactionIntent({
        userId: userA.id,
        productId: product.id,
        clientRequestId: "req-inactive",
        destination: "081234567890",
      }),
    ).rejects.toMatchObject({ code: "PPOB_PRODUCT_INACTIVE" });

    const active = await createProduct({ sku: "S10", sellingPrice: 11000 });
    const txA = await service.createTransactionIntent({
      userId: userA.id,
      productId: active.id,
      clientRequestId: "same-client-request",
      destination: "081234567890",
    });
    const txB = await service.createTransactionIntent({
      userId: userB.id,
      productId: active.id,
      clientRequestId: "same-client-request",
      destination: "081234567891",
    });
    expect(txA.providerReference).not.toBe(txB.providerReference);
  });

  it("fails closed before fulfillment when payment rail is not configured", async () => {
    const user = await createUser("PPOBUSER3");
    const product = await createProduct();
    const calls: string[] = [];
    const service = serviceWith(transactionTransport("Sukses", undefined, calls));
    const intent = await service.createTransactionIntent({
      userId: user.id,
      productId: product.id,
      clientRequestId: "req-payment-closed",
      destination: "081234567890",
    });

    await expect(service.confirmPaymentAndSubmit({ userId: user.id, transactionId: intent.id })).rejects.toMatchObject({
      code: "PAYMENT_RAIL_NOT_CONFIGURED",
    });
    expect(calls).toHaveLength(0);
    expect(await prisma.ppobTransaction.findUniqueOrThrow({ where: { id: intent.id } })).toMatchObject({
      status: "CREATED",
      paymentStatus: "UNPAID",
    });
  });

  it("handles immediate success, immediate failure, pending callbacks, duplicate callbacks, and unknown references", async () => {
    const user = await createUser("PPOBUSER4");
    const product = await createProduct();

    const successService = serviceWith(transactionTransport("Sukses", "SN-1234567890"), paidPort());
    const successIntent = await successService.createTransactionIntent({
      userId: user.id,
      productId: product.id,
      clientRequestId: "req-success",
      destination: "081234567890",
    });
    const success = await successService.confirmPaymentAndSubmit({
      userId: user.id,
      transactionId: successIntent.id,
    });
    expect(success.status).toBe("SUCCESS");
    expect(success.serialNumberMasked).toBe("SN-1****7890");

    const failedService = serviceWith(transactionTransport("Gagal"), paidPort());
    const failedIntent = await failedService.createTransactionIntent({
      userId: user.id,
      productId: product.id,
      clientRequestId: "req-failed",
      destination: "081234567891",
    });
    const failed = await failedService.confirmPaymentAndSubmit({
      userId: user.id,
      transactionId: failedIntent.id,
    });
    expect(failed.status).toBe("FAILED");

    const pendingService = serviceWith(transactionTransport("Pending"), paidPort());
    const pendingIntent = await pendingService.createTransactionIntent({
      userId: user.id,
      productId: product.id,
      clientRequestId: "req-pending",
      destination: "081234567892",
    });
    const pending = await pendingService.confirmPaymentAndSubmit({
      userId: user.id,
      transactionId: pendingIntent.id,
    });
    expect(pending.status).toBe("PENDING");

    const rawSuccess = JSON.stringify({
      data: {
        ref_id: pending.providerReference,
        status: "Sukses",
        rc: "00",
        message: "Sukses",
        sn: "TOKEN-000011112222",
      },
    });
    expect(
      await pendingService.processDigiflazzWebhook({
        rawBody: rawSuccess,
        signature: signature(rawSuccess),
        eventType: "update",
        userAgent: "Digiflazz-Hookshot",
        payload: JSON.parse(rawSuccess),
      }),
    ).toMatchObject({ status: "PROCESSED" });
    expect(
      await pendingService.processDigiflazzWebhook({
        rawBody: rawSuccess,
        signature: signature(rawSuccess),
        eventType: "update",
        userAgent: "Digiflazz-Hookshot",
        payload: JSON.parse(rawSuccess),
      }),
    ).toMatchObject({ status: "DUPLICATE" });

    const updated = await prisma.ppobTransaction.findUniqueOrThrow({ where: { id: pending.id } });
    expect(updated.status).toBe("SUCCESS");

    const rawFailedAfterSuccess = JSON.stringify({
      data: { ref_id: pending.providerReference, status: "Gagal", rc: "99", message: "Gagal 081234567892" },
    });
    await pendingService.processDigiflazzWebhook({
      rawBody: rawFailedAfterSuccess,
      signature: signature(rawFailedAfterSuccess),
      eventType: "update",
      userAgent: "Digiflazz-Hookshot",
      payload: JSON.parse(rawFailedAfterSuccess),
    });
    expect((await prisma.ppobTransaction.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("SUCCESS");

    const rawUnknown = JSON.stringify({ data: { ref_id: "UNKNOWN", status: "Sukses" } });
    expect(
      await pendingService.processDigiflazzWebhook({
        rawBody: rawUnknown,
        signature: signature(rawUnknown),
        eventType: "update",
        userAgent: "Digiflazz-Hookshot",
        payload: JSON.parse(rawUnknown),
      }),
    ).toMatchObject({ status: "UNKNOWN_REFERENCE" });
  });

  it("rejects invalid or missing webhook signatures", async () => {
    const service = serviceWith(transactionTransport("Sukses"));
    const rawBody = JSON.stringify({ data: { ref_id: "TG001", status: "Sukses" } });
    await expect(
      service.processDigiflazzWebhook({
        rawBody,
        signature: "sha1=invalid",
        eventType: "update",
        userAgent: "Digiflazz-Hookshot",
        payload: JSON.parse(rawBody),
      }),
    ).rejects.toMatchObject({ code: "DIGIFLAZZ_SIGNATURE_INVALID" });
    await expect(
      service.processDigiflazzWebhook({
        rawBody,
        eventType: "update",
        userAgent: "Digiflazz-Hookshot",
        payload: JSON.parse(rawBody),
      }),
    ).rejects.toMatchObject({ code: "DIGIFLAZZ_SIGNATURE_INVALID" });
  });

  it("leaves timeout non-terminal and does not mutate wallet, membership, bonus, referral, or reward state", async () => {
    const user = await createUser("PPOBUSER5");
    const product = await createProduct();
    const timeoutService = serviceWith(timeoutTransport(), paidPort());
    const intent = await timeoutService.createTransactionIntent({
      userId: user.id,
      productId: product.id,
      clientRequestId: "req-timeout",
      destination: "081234567890",
    });
    const result = await timeoutService.confirmPaymentAndSubmit({ userId: user.id, transactionId: intent.id });
    expect(result.status).toBe("SUBMITTED");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: user.id } });
    expect(wallet.ppobBalance.toFixed(2)).toBe("0.00");
    expect(wallet.cashBalance.toFixed(2)).toBe("0.00");
    expect(await prisma.membershipOrder.count()).toBe(0);
    expect(await prisma.membershipPayment.count()).toBe(0);
    expect(await prisma.commission.count()).toBe(0);
    expect(await prisma.rewardTransaction.count()).toBe(0);
  });

  it("handles concurrent duplicate client requests idempotently", async () => {
    const user = await createUser("PPOBUSER6");
    const product = await createProduct();
    const service = serviceWith(transactionTransport("Sukses"));
    const [first, second] = await Promise.all([
      service.createTransactionIntent({
        userId: user.id,
        productId: product.id,
        clientRequestId: "req-concurrent",
        destination: "081234567890",
      }),
      service.createTransactionIntent({
        userId: user.id,
        productId: product.id,
        clientRequestId: "req-concurrent",
        destination: "081234567890",
      }),
    ]);
    expect(first.id).toBe(second.id);
    expect(await prisma.ppobTransaction.count()).toBe(1);
  });

  it("invokes provider at most once for concurrent duplicate submission", async () => {
    const user = await createUser("PPOBUSER7");
    const product = await createProduct();
    const calls: string[] = [];
    const service = serviceWith(transactionTransport("Sukses", undefined, calls), paidPort());
    const intent = await service.createTransactionIntent({
      userId: user.id,
      productId: product.id,
      clientRequestId: "req-submit-concurrent",
      destination: "081234567890",
    });

    const [first, second] = await Promise.all([
      service.confirmPaymentAndSubmit({ userId: user.id, transactionId: intent.id }),
      service.confirmPaymentAndSubmit({ userId: user.id, transactionId: intent.id }),
    ]);

    expect(first.id).toBe(second.id);
    expect(calls).toHaveLength(1);
  });
});

function serviceWith(
  transport: JsonHttpTransport,
  paymentPort?: PaymentConfirmationPort,
  client = new DigiflazzClient(enabledConfig, transport),
) {
  return new PpobService(prisma as PrismaClient, client, paymentPort, enabledConfig);
}

function priceListTransport(items: unknown[]): JsonHttpTransport {
  return { postJson: async <TResponse>() => ({ data: items }) as TResponse };
}

function transactionTransport(status: string, sn?: string, calls?: string[]): JsonHttpTransport {
  return {
    postJson: async <TResponse>(_url: string, body: Record<string, unknown>) =>
      {
        calls?.push(String(body.ref_id));
        return ({
        data: {
          ref_id: String(body.ref_id),
          status,
          rc: status === "Gagal" ? "99" : "00",
          message: status,
          sn,
        },
      }) as TResponse;
      },
  };
}

function timeoutTransport(): JsonHttpTransport {
  return {
    postJson: async () => {
      throw new AppError("timeout", 504, "DIGIFLAZZ_TIMEOUT");
    },
  };
}

function paidPort(): PaymentConfirmationPort {
  return {
    confirmPayment: async () => ({
      paidAt: new Date("2026-07-22T00:00:00Z"),
      reference: "payment-ref",
    }),
  };
}

function priceItem(
  productName: string,
  category: string,
  brand: string,
  sku: string,
  price: number,
) {
  return {
    product_name: productName,
    category,
    brand,
    type: "Umum",
    price,
    buyer_sku_code: sku,
    buyer_product_status: true,
    seller_product_status: true,
    unlimited_stock: true,
    stock: 0,
    desc: productName,
  };
}

async function createUser(label: string) {
  const basic = await prisma.membership.findUniqueOrThrow({ where: { tier: "BASIC" } });
  const phoneDigits = BigInt(`0x${crypto.createHash("sha256").update(label).digest("hex").slice(0, 12)}`)
    .toString()
    .slice(0, 10)
    .padEnd(10, "0");
  return prisma.user.create({
    data: {
      fullName: label,
      phone: `+628${phoneDigits}`,
      referralCode: label.slice(0, 20),
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
}

async function createProduct(input: {
  sku?: string;
  isActive?: boolean;
  sellingPrice?: number;
} = {}) {
  return prisma.ppobProduct.create({
    data: {
      provider: "DIGIFLAZZ",
      providerSkuCode: input.sku ?? `S5-${crypto.randomUUID()}`,
      productName: "Telkomsel Pulsa 5.000",
      category: "Pulsa",
      brand: "TELKOMSEL",
      type: "Umum",
      costPrice: 5100,
      sellingPrice: input.sellingPrice ?? 6000,
      buyerProductActive: input.isActive ?? true,
      sellerProductActive: input.isActive ?? true,
      isActive: input.isActive ?? true,
      unlimitedStock: true,
      stock: 0,
    },
  });
}

function signature(rawBody: string) {
  return `sha1=${crypto.createHmac("sha1", enabledConfig.webhookSecret).update(rawBody).digest("hex")}`;
}
