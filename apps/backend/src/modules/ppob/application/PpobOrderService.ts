import { Prisma } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { logger } from "../../../core/logger/logger.js";
import { PpobProviderGateway, PpobProviderPurchaseResult } from "../domain/PpobProviderGateway.js";
import { PpobOrderRecord, PpobProductRecord, PpobRepository } from "../domain/PpobRepository.js";
import {
  PPOB_IDEMPOTENCY_CONFLICT,
  PPOB_INSUFFICIENT_BALANCE,
  PPOB_ORDER_NOT_FOUND,
  PPOB_PRODUCT_INACTIVE,
  PPOB_PRODUCT_NOT_FOUND,
  PPOB_PROVIDER_UNAVAILABLE,
  PPOB_TARGET_INVALID,
  PpobInquiryView,
  PpobOrderView,
  PpobPaymentBreakdown,
  PpobWalletSnapshot
} from "../domain/ppobModels.js";

export class PpobOrderService {
  constructor(
    private readonly ppobRepository: PpobRepository,
    private readonly providerGateway: PpobProviderGateway
  ) {}

  async inquiry(input: { userId: string; sku: string; targetNumber: string }): Promise<PpobInquiryView> {
    const product = await this.requirePurchasableProduct(input.sku, input.targetNumber);
    const wallet = await this.ppobRepository.getWalletSnapshot(input.userId);
    const payment = this.computePayment(product, wallet);

    return {
      product,
      targetNumber: input.targetNumber,
      price: product.price,
      adminFee: product.adminFee,
      amount: payment.amount,
      payment,
      wallet
    };
  }

  async listOrders(userId: string, page: number, pageSize: number): Promise<PpobOrderView[]> {
    return this.ppobRepository.listOrdersByUser(userId, page, Math.min(pageSize, 100));
  }

  async getOrder(userId: string, orderId: string): Promise<PpobOrderView> {
    const order = await this.ppobRepository.findOrderById(orderId);
    // 404 (bukan 403) supaya kepemilikan order tidak dapat dienumerasi.
    if (!order || order.userId !== userId) {
      throw new AppError("PPOB order not found", StatusCodes.NOT_FOUND, PPOB_ORDER_NOT_FOUND);
    }
    return order;
  }

  async createOrder(input: {
    userId: string;
    sku: string;
    targetNumber: string;
    idempotencyKey: string;
  }): Promise<{ order: PpobOrderView; replayed: boolean }> {
    const existing = await this.ppobRepository.findOrderByIdempotencyKey(input.userId, input.idempotencyKey);
    if (existing) {
      if (existing.sku !== input.sku || existing.targetNumber !== input.targetNumber) {
        throw new AppError(
          "Idempotency key was already used with a different payload",
          StatusCodes.CONFLICT,
          PPOB_IDEMPOTENCY_CONFLICT
        );
      }
      return { order: existing, replayed: true };
    }

    // Fail-closed: provider belum terintegrasi (R2.8), maka order gagal SEBELUM
    // saldo disentuh dan tanpa meninggalkan record menggantung.
    const availability = this.providerGateway.getAvailability();
    if (!availability.available) {
      throw new AppError(
        availability.reason ?? "PPOB provider is not available",
        StatusCodes.SERVICE_UNAVAILABLE,
        PPOB_PROVIDER_UNAVAILABLE
      );
    }

    let created: { order: PpobOrderRecord; createdNew: boolean };
    try {
      created = await this.ppobRepository.transaction(async (tx) => {
        const replay = await this.ppobRepository.findOrderByIdempotencyKey(input.userId, input.idempotencyKey, tx);
        if (replay) {
          return { order: replay, createdNew: false };
        }
        const product = await this.requirePurchasableProduct(input.sku, input.targetNumber, tx);
        const wallet = await this.ppobRepository.getWalletSnapshot(input.userId, tx);
        const payment = this.computePayment(product, wallet);
        if (!payment.sufficient) {
          throw new AppError(
            "Insufficient combined wallet balance",
            StatusCodes.BAD_REQUEST,
            PPOB_INSUFFICIENT_BALANCE
          );
        }
        const order = await this.ppobRepository.createOrderWithDebit(
          {
            userId: input.userId,
            productId: product.id,
            targetNumber: input.targetNumber,
            idempotencyKey: input.idempotencyKey,
            payment
          },
          tx
        );
        return { order, createdNew: true };
      });
    } catch (error) {
      // Dua request konkuren dengan key sama: yang kalah menabrak unique
      // constraint (userId, idempotencyKey). Perlakukan sebagai replay.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.ppobRepository.findOrderByIdempotencyKey(input.userId, input.idempotencyKey);
        if (winner && winner.sku === input.sku && winner.targetNumber === input.targetNumber) {
          return { order: winner, replayed: true };
        }
        throw new AppError(
          "Idempotency key was already used with a different payload",
          StatusCodes.CONFLICT,
          PPOB_IDEMPOTENCY_CONFLICT
        );
      }
      throw error;
    }
    if (!created.createdNew) {
      return { order: created.order, replayed: true };
    }

    const createdOrder = created.order;

    let result: PpobProviderPurchaseResult;
    try {
      result = await this.providerGateway.purchase({
        orderId: createdOrder.id,
        sku: createdOrder.sku,
        targetNumber: createdOrder.targetNumber,
        amount: createdOrder.amount.toString()
      });
    } catch (error) {
      // Provider crash setelah debit: saldo wajib kembali ke sumber asalnya.
      logger.error({ error, orderId: createdOrder.id }, "PPOB provider call failed after debit");
      result = { outcome: "FAILED", failureReason: "Provider call failed" };
    }

    if (result.outcome === "SUCCESS") {
      await this.ppobRepository.transaction((tx) =>
        this.ppobRepository.markOrderSucceeded(createdOrder.id, result.providerRef, tx)
      );
    } else if (result.outcome === "PENDING") {
      await this.ppobRepository.transaction((tx) =>
        this.ppobRepository.markOrderProcessing(createdOrder.id, result.providerRef, tx)
      );
    } else {
      await this.ppobRepository.transaction((tx) =>
        this.ppobRepository.refundOrder(
          createdOrder.id,
          result.failureReason ?? "Provider rejected the purchase",
          tx
        )
      );
    }

    const settled = await this.ppobRepository.findOrderById(createdOrder.id);
    if (!settled) {
      logger.error({ orderId: createdOrder.id }, "PPOB order missing after settlement");
      throw new AppError("PPOB order not found", StatusCodes.INTERNAL_SERVER_ERROR, PPOB_ORDER_NOT_FOUND);
    }
    return { order: settled, replayed: false };
  }

  private async requirePurchasableProduct(
    sku: string,
    targetNumber: string,
    tx?: Prisma.TransactionClient
  ): Promise<PpobProductRecord> {
    const product = await this.ppobRepository.findProductBySku(sku, tx);
    if (!product) {
      throw new AppError("PPOB product not found", StatusCodes.NOT_FOUND, PPOB_PRODUCT_NOT_FOUND);
    }
    if (!product.isActive) {
      throw new AppError("PPOB product is not active", StatusCodes.BAD_REQUEST, PPOB_PRODUCT_INACTIVE);
    }
    if (product.targetPattern) {
      let pattern: RegExp;
      try {
        pattern = new RegExp(product.targetPattern);
      } catch {
        // Katalog rusak adalah kesalahan server, bukan kesalahan pengguna.
        logger.error({ sku: product.sku }, "Invalid PPOB target pattern in catalog");
        throw new AppError("PPOB product misconfigured", StatusCodes.INTERNAL_SERVER_ERROR, PPOB_PRODUCT_INACTIVE);
      }
      if (!pattern.test(targetNumber)) {
        throw new AppError(
          `Target number is invalid for ${product.targetLabel}`,
          StatusCodes.BAD_REQUEST,
          PPOB_TARGET_INVALID
        );
      }
    }
    return product;
  }

  private computePayment(product: PpobProductRecord, wallet: PpobWalletSnapshot): PpobPaymentBreakdown {
    const amount = product.price.plus(product.adminFee);
    const benefitAmount = Prisma.Decimal.min(wallet.ppobBalance, amount);
    const balanceAmount = amount.minus(benefitAmount);
    return {
      amount,
      benefitAmount,
      balanceAmount,
      // Wallet.balance adalah total; ppobBalance subset earmarked di dalamnya.
      sufficient: wallet.balance.gte(amount) && wallet.ppobBalance.gte(benefitAmount)
    };
  }
}
