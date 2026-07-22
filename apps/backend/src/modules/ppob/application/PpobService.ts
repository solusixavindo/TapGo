import crypto from "node:crypto";
import {
  PpobPaymentStatus,
  PpobProvider,
  PpobProviderEventStatus,
  PpobTransactionStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import {
  DigiflazzClient,
  DigiflazzConfig,
  DigiflazzPriceListItem,
  DigiflazzTransactionData,
  assertDigiflazzReady,
  currentDigiflazzConfig,
  redactDigiflazzPayload,
  verifyDigiflazzWebhookSignature,
} from "./DigiflazzClient.js";
import {
  decryptPpobSensitiveValue,
  encryptPpobSensitiveValue,
} from "./PpobSensitiveData.js";

type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type PaymentConfirmationPort = {
  confirmPayment(input: {
    transactionId: string;
    userId: string;
    amount: number;
  }): Promise<{ paidAt: Date; reference: string }>;
};

export class FailClosedPaymentConfirmationPort implements PaymentConfirmationPort {
  async confirmPayment(): Promise<{ paidAt: Date; reference: string }> {
    throw new AppError(
      "Payment rail for PPOB is not configured.",
      StatusCodes.SERVICE_UNAVAILABLE,
      "PAYMENT_RAIL_NOT_CONFIGURED",
    );
  }
}

export class PpobService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly digiflazzClient: DigiflazzClient,
    private readonly paymentConfirmationPort: PaymentConfirmationPort =
      new FailClosedPaymentConfirmationPort(),
    private readonly config: DigiflazzConfig = currentDigiflazzConfig(),
  ) {}

  async listProducts() {
    this.assertEnabled();
    const products = await this.prisma.ppobProduct.findMany({
      where: {
        provider: "DIGIFLAZZ",
        isActive: true,
        buyerProductActive: true,
        sellerProductActive: true,
      },
      orderBy: [{ category: "asc" }, { brand: "asc" }, { sellingPrice: "asc" }],
    });
    return products.map((product) => this.productDto(product));
  }

  async syncDigiflazzCatalog(now = new Date()) {
    this.assertEnabled();
    const items = await this.digiflazzClient.fetchPrepaidPriceList();
    const filtered = items.filter((item) => isAllowedCategory(item.category));
    const seenCodes = new Set<string>();

    for (const item of filtered) {
      const sku = String(item.buyer_sku_code);
      seenCodes.add(sku);
      const costPrice = rupiahInteger(item.price);
      await this.prisma.ppobProduct.upsert({
        where: {
          provider_providerSkuCode: {
            provider: "DIGIFLAZZ",
            providerSkuCode: sku,
          },
        },
        update: {
          productName: String(item.product_name),
          category: String(item.category),
          brand: String(item.brand),
          type: String(item.type),
          costPrice,
          buyerProductActive: Boolean(item.buyer_product_status),
          sellerProductActive: Boolean(item.seller_product_status),
          isActive: Boolean(item.buyer_product_status && item.seller_product_status),
          unlimitedStock: Boolean(item.unlimited_stock),
          stock: optionalInteger(item.stock),
          description: item.desc ?? null,
          lastSyncedAt: now,
        },
        create: {
          provider: "DIGIFLAZZ",
          providerSkuCode: sku,
          productName: String(item.product_name),
          category: String(item.category),
          brand: String(item.brand),
          type: String(item.type),
          costPrice,
          sellingPrice: costPrice,
          buyerProductActive: Boolean(item.buyer_product_status),
          sellerProductActive: Boolean(item.seller_product_status),
          isActive: Boolean(item.buyer_product_status && item.seller_product_status),
          unlimitedStock: Boolean(item.unlimited_stock),
          stock: optionalInteger(item.stock),
          description: item.desc ?? null,
          lastSyncedAt: now,
        },
      });
    }

    await this.prisma.ppobProduct.updateMany({
      where: {
        provider: "DIGIFLAZZ",
        category: { in: ["Pulsa", "Data"] },
        providerSkuCode: { notIn: Array.from(seenCodes) },
      },
      data: {
        isActive: false,
        buyerProductActive: false,
        sellerProductActive: false,
        lastSyncedAt: now,
      },
    });

    return { synced: filtered.length, skipped: items.length - filtered.length };
  }

  async createTransactionIntent(input: {
    userId: string;
    productId: string;
    clientRequestId: string;
    destination: string;
  }) {
    this.assertEnabled();
    const existing = await this.prisma.ppobTransaction.findUnique({
      where: {
        userId_clientRequestId: {
          userId: input.userId,
          clientRequestId: input.clientRequestId,
        },
      },
      include: { product: true },
    });
    if (existing) {
      return this.transactionDto(existing);
    }

    const product = await this.prisma.ppobProduct.findUnique({
      where: { id: input.productId },
    });
    if (!product || !product.isActive || !product.buyerProductActive || !product.sellerProductActive) {
      throw new AppError(
        "Produk PPOB tidak tersedia.",
        StatusCodes.BAD_REQUEST,
        "PPOB_PRODUCT_INACTIVE",
      );
    }
    if (!isAllowedCategory(product.category)) {
      throw new AppError(
        "Kategori PPOB belum didukung.",
        StatusCodes.BAD_REQUEST,
        "PPOB_CATEGORY_NOT_SUPPORTED",
      );
    }

    const normalizedDestination = normalizeIndonesianMobile(input.destination);
    const providerReference = providerRef(input.userId, input.clientRequestId);
    try {
      const transaction = await this.prisma.ppobTransaction.create({
        data: {
          userId: input.userId,
          productId: product.id,
          clientRequestId: input.clientRequestId,
          provider: "DIGIFLAZZ",
          providerReference,
          destinationEncrypted: encryptPpobSensitiveValue(normalizedDestination),
          destinationMasked: maskDestination(normalizedDestination),
          costPrice: product.costPrice,
          sellingPrice: product.sellingPrice,
          adminFee: Math.max(product.sellingPrice - product.costPrice, 0),
          status: "CREATED",
          paymentStatus: "UNPAID",
        },
        include: { product: true },
      });
      return this.transactionDto(transaction);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const duplicate = await this.prisma.ppobTransaction.findUniqueOrThrow({
          where: {
            userId_clientRequestId: {
              userId: input.userId,
              clientRequestId: input.clientRequestId,
            },
          },
          include: { product: true },
        });
        return this.transactionDto(duplicate);
      }
      throw error;
    }
  }

  async confirmPaymentAndSubmit(input: { userId: string; transactionId: string }) {
    this.assertEnabled();
    const transaction = await this.prisma.ppobTransaction.findFirst({
      where: { id: input.transactionId, userId: input.userId },
      include: { product: true },
    });
    if (!transaction) {
      throw new AppError("Transaksi PPOB tidak ditemukan.", StatusCodes.NOT_FOUND, "PPOB_TRANSACTION_NOT_FOUND");
    }
    if (transaction.status === "SUCCESS") {
      return this.transactionDto(transaction);
    }
    if (transaction.paymentStatus !== "PAID") {
      const confirmation = await this.paymentConfirmationPort.confirmPayment({
        transactionId: transaction.id,
        userId: transaction.userId,
        amount: transaction.sellingPrice + transaction.adminFee,
      });
      await this.prisma.ppobTransaction.update({
        where: { id: transaction.id },
        data: {
          paymentStatus: "PAID",
          status: "PAID",
          paidAt: confirmation.paidAt,
          providerMessage: "Payment confirmed",
        },
      });
    }
    return this.submitPaidTransaction(transaction.id, input.userId);
  }

  async getTransaction(input: { userId: string; transactionId: string }) {
    this.assertEnabled();
    const transaction = await this.prisma.ppobTransaction.findFirst({
      where: { id: input.transactionId, userId: input.userId },
      include: { product: true },
    });
    if (!transaction) {
      throw new AppError("Transaksi PPOB tidak ditemukan.", StatusCodes.NOT_FOUND, "PPOB_TRANSACTION_NOT_FOUND");
    }
    return this.transactionDto(transaction);
  }

  async listTransactions(input: { userId: string; page: number; pageSize: number }) {
    this.assertEnabled();
    const items = await this.prisma.ppobTransaction.findMany({
      where: { userId: input.userId },
      include: { product: true },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });
    return items.map((item) => this.transactionDto(item));
  }

  async processDigiflazzWebhook(input: {
    rawBody: string;
    signature?: string;
    eventType?: string;
    userAgent?: string;
    payload: unknown;
  }) {
    this.assertEnabled();
    if (!verifyDigiflazzWebhookSignature({
      rawBody: input.rawBody,
      ...(this.config.webhookSecret ? { secret: this.config.webhookSecret } : {}),
      ...(input.signature ? { signatureHeader: input.signature } : {}),
    })) {
      throw new AppError(
        "Digiflazz webhook signature is invalid.",
        StatusCodes.UNAUTHORIZED,
        "DIGIFLAZZ_SIGNATURE_INVALID",
      );
    }

    const eventType = input.eventType ?? "unknown";
    const eventIdentity = eventIdentityFor(input.rawBody, eventType);
    const data = webhookData(input.payload);
    const providerReference = data?.ref_id ? String(data.ref_id) : null;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const event = await tx.ppobProviderEvent.create({
          data: {
            provider: "DIGIFLAZZ",
            eventIdentity,
            providerReference,
            eventType,
            payloadRedacted: redactDigiflazzPayload(input.payload) as Prisma.InputJsonValue,
            processingStatus: "RECEIVED",
          },
        });

        if (!providerReference || !data) {
          return tx.ppobProviderEvent.update({
            where: { id: event.id },
            data: {
              processingStatus: "UNKNOWN_REFERENCE",
              processedAt: new Date(),
            },
          });
        }

        const transaction = await tx.ppobTransaction.findUnique({
          where: {
            provider_providerReference: {
              provider: "DIGIFLAZZ",
              providerReference,
            },
          },
        });
        if (!transaction) {
          return tx.ppobProviderEvent.update({
            where: { id: event.id },
            data: {
              processingStatus: "UNKNOWN_REFERENCE",
              processedAt: new Date(),
            },
          });
        }

        await this.applyProviderUpdate(tx, transaction.id, data);
        return tx.ppobProviderEvent.update({
          where: { id: event.id },
          data: {
            processingStatus: "PROCESSED",
            processedAt: new Date(),
          },
        });
      });
      return {
        status: result.processingStatus,
        providerReference: result.providerReference,
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { status: "DUPLICATE" as const, providerReference };
      }
      throw error;
    }
  }

  private async submitPaidTransaction(transactionId: string, userId: string) {
    const transaction = await this.prisma.ppobTransaction.findFirstOrThrow({
      where: { id: transactionId, userId },
      include: { product: true },
    });
    if (transaction.paymentStatus !== "PAID") {
      throw new AppError(
        "Transaksi PPOB belum dibayar.",
        StatusCodes.CONFLICT,
        "PPOB_PAYMENT_NOT_CONFIRMED",
      );
    }
    if (transaction.status === "SUCCESS") {
      return this.transactionDto(transaction);
    }
    if (terminalStatus(transaction.status)) {
      return this.transactionDto(transaction);
    }

    const submissionClaim = await this.prisma.ppobTransaction.updateMany({
      where: {
        id: transaction.id,
        paymentStatus: "PAID",
        status: { in: ["PAID", "PENDING", "SUBMITTED"] },
        submittedAt: null,
      },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });
    if (submissionClaim.count === 0) {
      const latest = await this.prisma.ppobTransaction.findUniqueOrThrow({
        where: { id: transaction.id },
        include: { product: true },
      });
      return this.transactionDto(latest);
    }

    try {
      const response = await this.digiflazzClient.createOrRecheckPrepaidTransaction({
        buyerSkuCode: transaction.product.providerSkuCode,
        customerNo: decryptPpobSensitiveValue(transaction.destinationEncrypted),
        refId: transaction.providerReference,
        maxPrice: transaction.costPrice,
      });
      await this.applyProviderUpdate(this.prisma, transaction.id, response.data);
    } catch (error) {
      if (error instanceof AppError && error.code === "DIGIFLAZZ_TIMEOUT") {
        await this.prisma.ppobTransaction.update({
          where: { id: transaction.id },
          data: {
            status: "SUBMITTED",
            providerMessage: "Provider timeout; status remains retryable",
          },
        });
      } else {
        throw error;
      }
    }

    const updated = await this.prisma.ppobTransaction.findUniqueOrThrow({
      where: { id: transaction.id },
      include: { product: true },
    });
    return this.transactionDto(updated);
  }

  private async applyProviderUpdate(
    tx: PrismaTx,
    transactionId: string,
    data?: DigiflazzTransactionData,
  ) {
    if (!data) {
      return;
    }
    const current = await tx.ppobTransaction.findUniqueOrThrow({
      where: { id: transactionId },
    });
    if (current.status === "SUCCESS") {
      return;
    }

    const mapped = resolvePpobProviderTransition(current.status, mapProviderStatus(data.status));
    const now = new Date();
    await tx.ppobTransaction.update({
      where: { id: transactionId },
      data: {
        status: mapped,
        providerResponseCode: data.rc ? String(data.rc) : current.providerResponseCode,
        providerMessage: data.message
          ? safeMessage(String(data.message))
          : current.providerMessage,
        ...(data.sn
          ? {
              serialNumberEncrypted: encryptPpobSensitiveValue(String(data.sn)),
              serialNumberMasked: maskSerial(String(data.sn)),
            }
          : {}),
        ...(mapped === "SUCCESS" || mapped === "FAILED"
          ? { completedAt: now }
          : {}),
      },
    });
  }

  private assertEnabled() {
    assertDigiflazzReady(this.config);
  }

  private productDto(product: {
    id: string;
    providerSkuCode: string;
    productName: string;
    category: string;
    brand: string;
    type: string;
    sellingPrice: number;
    buyerProductActive: boolean;
    sellerProductActive: boolean;
    isActive: boolean;
    unlimitedStock: boolean;
    stock: number | null;
    description: string | null;
  }) {
    return {
      id: product.id,
      provider: "DIGIFLAZZ",
      skuCode: product.providerSkuCode,
      productName: product.productName,
      category: product.category,
      brand: product.brand,
      type: product.type,
      sellingPrice: product.sellingPrice,
      buyerProductActive: product.buyerProductActive,
      sellerProductActive: product.sellerProductActive,
      isActive: product.isActive,
      unlimitedStock: product.unlimitedStock,
      stock: product.stock,
      description: product.description,
    };
  }

  private transactionDto(transaction: {
    id: string;
    productId: string;
    clientRequestId: string;
    providerReference: string;
    destinationMasked: string;
    sellingPrice: number;
    adminFee: number;
    status: PpobTransactionStatus;
    paymentStatus: PpobPaymentStatus;
    providerResponseCode: string | null;
    providerMessage: string | null;
    serialNumberMasked: string | null;
    paidAt: Date | null;
    submittedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    product: { productName: string; category: string; brand: string; type: string };
  }) {
    return {
      id: transaction.id,
      productId: transaction.productId,
      clientRequestId: transaction.clientRequestId,
      provider: "DIGIFLAZZ",
      providerReference: transaction.providerReference,
      destinationMasked: transaction.destinationMasked,
      sellingPrice: transaction.sellingPrice,
      adminFee: transaction.adminFee,
      totalAmount: transaction.sellingPrice + transaction.adminFee,
      status: transaction.status,
      paymentStatus: transaction.paymentStatus,
      providerResponseCode: transaction.providerResponseCode,
      providerMessage: transaction.providerMessage,
      serialNumberMasked: transaction.serialNumberMasked,
      paidAt: transaction.paidAt,
      submittedAt: transaction.submittedAt,
      completedAt: transaction.completedAt,
      createdAt: transaction.createdAt,
      product: transaction.product,
    };
  }
}

export function normalizeIndonesianMobile(value: string) {
  const digits = value.replace(/[^\d+]/g, "").replace(/^\+/, "");
  const normalized = digits.startsWith("62") ? `0${digits.slice(2)}` : digits;
  if (!/^08\d{7,13}$/.test(normalized)) {
    throw new AppError(
      "Nomor tujuan tidak valid.",
      StatusCodes.BAD_REQUEST,
      "PPOB_DESTINATION_INVALID",
    );
  }
  return normalized;
}

export function maskDestination(value: string) {
  if (value.length <= 7) {
    return "****";
  }
  return `${value.slice(0, 4)}****${value.slice(-3)}`;
}

export function maskSerial(value: string) {
  if (value.length <= 8) {
    return "****";
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function isAllowedCategory(category: string) {
  const normalized = category.trim().toLowerCase();
  return normalized === "pulsa" || normalized === "data";
}

function rupiahInteger(value: number | string) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new AppError(
      "Harga PPOB dari provider tidak valid.",
      StatusCodes.BAD_GATEWAY,
      "PPOB_PROVIDER_PRICE_INVALID",
    );
  }
  return numberValue;
}

function optionalInteger(value: number | string | undefined) {
  if (value === undefined || value === "") {
    return null;
  }
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numberValue) ? numberValue : null;
}

function providerRef(userId: string, clientRequestId: string) {
  const hash = crypto
    .createHash("sha256")
    .update(`${userId}:${clientRequestId}`)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  return `TG${hash}`;
}

function terminalStatus(status: PpobTransactionStatus) {
  return ["SUCCESS", "FAILED", "EXPIRED", "REFUNDED"].includes(status);
}

export function resolvePpobProviderTransition(
  current: PpobTransactionStatus,
  incoming: PpobTransactionStatus,
) {
  if (current === "SUCCESS") {
    return "SUCCESS";
  }
  if (current === "FAILED" && incoming !== "FAILED") {
    return "FAILED";
  }
  if (incoming === "SUCCESS" || incoming === "FAILED" || incoming === "PENDING") {
    return incoming;
  }
  return current;
}

function mapProviderStatus(status?: string): PpobTransactionStatus {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "sukses" || normalized === "success") {
    return "SUCCESS";
  }
  if (normalized === "gagal" || normalized === "failed") {
    return "FAILED";
  }
  return "PENDING";
}

function safeMessage(value: string) {
  return value.replace(/\b\d{8,}\b/g, "[REDACTED]").slice(0, 500);
}

function webhookData(payload: unknown): DigiflazzTransactionData | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const data = record.data;
  return data && typeof data === "object"
    ? (data as DigiflazzTransactionData)
    : null;
}

function eventIdentityFor(rawBody: string, eventType: string) {
  return crypto.createHash("sha256").update(`${eventType}:${rawBody}`).digest("hex");
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
