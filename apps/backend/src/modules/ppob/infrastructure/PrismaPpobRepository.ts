import { Prisma, PrismaClient, PpobOrder, PpobProduct } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { PpobDebitInput, PpobOrderRecord, PpobProductRecord, PpobRepository } from "../domain/PpobRepository.js";
import { PPOB_INSUFFICIENT_BALANCE, PpobCatalogCategoryView, PpobWalletSnapshot } from "../domain/ppobModels.js";

type ProductWithCategory = PpobProduct & { category: { code: string } };
type OrderWithProduct = PpobOrder & { product: ProductWithCategory };

export class PrismaPpobRepository implements PpobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(handler, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000
    });
  }

  async listCatalog(): Promise<PpobCatalogCategoryView[]> {
    const categories = await this.prisma.ppobCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        products: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" }
        }
      }
    });
    return categories.map((category) => ({
      id: category.id,
      code: category.code,
      name: category.name,
      description: category.description,
      icon: category.icon,
      sortOrder: category.sortOrder,
      products: category.products.map((product) => this.toProductView(product))
    }));
  }

  async findProductBySku(sku: string, tx?: Prisma.TransactionClient): Promise<PpobProductRecord | null> {
    const client = tx ?? this.prisma;
    const product = await client.ppobProduct.findUnique({
      where: { sku },
      include: { category: { select: { code: true } } }
    });
    return product ? this.toProductRecord(product) : null;
  }

  async getWalletSnapshot(userId: string, tx?: Prisma.TransactionClient): Promise<PpobWalletSnapshot> {
    const client = tx ?? this.prisma;
    const wallet = await client.wallet.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        balance: new Prisma.Decimal(0),
        cashBalance: new Prisma.Decimal(0),
        ppobBalance: new Prisma.Decimal(0),
        currency: "IDR"
      }
    });
    return { balance: wallet.balance, ppobBalance: wallet.ppobBalance };
  }

  async findOrderByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    tx?: Prisma.TransactionClient
  ): Promise<PpobOrderRecord | null> {
    const client = tx ?? this.prisma;
    const order = await client.ppobOrder.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: { product: { include: { category: { select: { code: true } } } } }
    });
    return order ? this.toOrderRecord(order) : null;
  }

  async findOrderById(orderId: string): Promise<PpobOrderRecord | null> {
    const order = await this.prisma.ppobOrder.findUnique({
      where: { id: orderId },
      include: { product: { include: { category: { select: { code: true } } } } }
    });
    return order ? this.toOrderRecord(order) : null;
  }

  async listOrdersByUser(userId: string, page: number, pageSize: number) {
    const orders = await this.prisma.ppobOrder.findMany({
      where: { userId },
      include: { product: { include: { category: { select: { code: true } } } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    });
    return orders.map((order) => this.toOrderRecord(order));
  }

  async createOrderWithDebit(input: PpobDebitInput, tx: Prisma.TransactionClient): Promise<PpobOrderRecord> {
    const wallet = await tx.wallet.upsert({
      where: { userId: input.userId },
      update: {},
      create: {
        userId: input.userId,
        balance: new Prisma.Decimal(0),
        cashBalance: new Prisma.Decimal(0),
        ppobBalance: new Prisma.Decimal(0),
        currency: "IDR"
      }
    });

    // Debit atomik ter-guard: Wallet.balance adalah total (ppobBalance subset
    // earmarked), maka balance turun sebesar amount penuh dan ppobBalance hanya
    // turun sebesar bagian benefit — pola yang sama dengan reserveWithdrawal.
    const debited = await tx.wallet.updateMany({
      where: {
        id: wallet.id,
        balance: { gte: input.payment.amount },
        ppobBalance: { gte: input.payment.benefitAmount }
      },
      data: {
        balance: { decrement: input.payment.amount },
        ppobBalance: { decrement: input.payment.benefitAmount }
      }
    });
    if (debited.count !== 1) {
      throw new AppError("Insufficient combined wallet balance", StatusCodes.BAD_REQUEST, PPOB_INSUFFICIENT_BALANCE);
    }

    const order = await tx.ppobOrder.create({
      data: {
        userId: input.userId,
        productId: input.productId,
        targetNumber: input.targetNumber,
        amount: input.payment.amount,
        benefitAmount: input.payment.benefitAmount,
        balanceAmount: input.payment.balanceAmount,
        status: "PENDING",
        idempotencyKey: input.idempotencyKey,
        paidAt: new Date()
      }
    });

    const ledger = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "PPOB_PURCHASE",
        amount: input.payment.amount.neg(),
        referenceType: "PPOB_ORDER",
        referenceId: order.id,
        metadata: {
          benefitAmount: input.payment.benefitAmount.toString(),
          balanceAmount: input.payment.balanceAmount.toString()
        }
      }
    });

    const linked = await tx.ppobOrder.update({
      where: { id: order.id },
      data: { walletTransactionId: ledger.id },
      include: { product: { include: { category: { select: { code: true } } } } }
    });
    return this.toOrderRecord(linked);
  }

  async markOrderSucceeded(orderId: string, providerRef: string | undefined, tx: Prisma.TransactionClient) {
    await tx.ppobOrder.update({
      where: { id: orderId },
      data: {
        status: "SUCCESS",
        completedAt: new Date(),
        ...(providerRef !== undefined ? { providerRef } : {})
      }
    });
  }

  async markOrderProcessing(orderId: string, providerRef: string | undefined, tx: Prisma.TransactionClient) {
    await tx.ppobOrder.update({
      where: { id: orderId },
      data: {
        status: "PROCESSING",
        ...(providerRef !== undefined ? { providerRef } : {})
      }
    });
  }

  async refundOrder(orderId: string, failureReason: string, tx: Prisma.TransactionClient) {
    // Guard status lebih dulu: refund bersifat idempotent dan tidak boleh
    // mengkredit dua kali bila dipanggil ulang (retry / recovery R2.8).
    const flipped = await tx.ppobOrder.updateMany({
      where: { id: orderId, status: { not: "REFUNDED" } },
      data: { status: "REFUNDED", failureReason, refundedAt: new Date() }
    });
    if (flipped.count !== 1) {
      return;
    }
    const order = await tx.ppobOrder.findUniqueOrThrow({ where: { id: orderId } });
    const wallet = await tx.wallet.upsert({
      where: { userId: order.userId },
      update: {},
      create: {
        userId: order.userId,
        balance: new Prisma.Decimal(0),
        cashBalance: new Prisma.Decimal(0),
        ppobBalance: new Prisma.Decimal(0),
        currency: "IDR"
      }
    });
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: order.amount },
        ppobBalance: { increment: order.benefitAmount }
      }
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: "PPOB_REFUND",
        amount: order.amount,
        referenceType: "PPOB_ORDER_REFUND",
        referenceId: order.id,
        metadata: {
          benefitAmount: order.benefitAmount.toString(),
          balanceAmount: order.balanceAmount.toString(),
          reason: failureReason
        }
      }
    });
  }

  private toProductView(product: PpobProduct) {
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      price: product.price,
      adminFee: product.adminFee,
      targetLabel: product.targetLabel,
      targetPattern: product.targetPattern,
      sortOrder: product.sortOrder
    };
  }

  private toProductRecord(product: ProductWithCategory): PpobProductRecord {
    return {
      ...this.toProductView(product),
      categoryCode: product.category.code,
      isActive: product.isActive
    };
  }

  private toOrderRecord(order: OrderWithProduct): PpobOrderRecord {
    return {
      id: order.id,
      userId: order.userId,
      status: order.status,
      sku: order.product.sku,
      productName: order.product.name,
      categoryCode: order.product.category.code,
      targetNumber: order.targetNumber,
      amount: order.amount,
      benefitAmount: order.benefitAmount,
      balanceAmount: order.balanceAmount,
      failureReason: order.failureReason,
      providerRef: order.providerRef,
      idempotencyKey: order.idempotencyKey,
      walletTransactionId: order.walletTransactionId,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      completedAt: order.completedAt,
      refundedAt: order.refundedAt
    };
  }
}
