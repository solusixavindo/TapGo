import "./ppobUnitEnv.js";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/core/errors/AppError.js";
import { PpobOrderService } from "../../src/modules/ppob/application/PpobOrderService.js";
import {
  PpobProviderGateway,
  PpobProviderPurchaseRequest,
  PpobProviderPurchaseResult
} from "../../src/modules/ppob/domain/PpobProviderGateway.js";
import {
  PpobDebitInput,
  PpobOrderRecord,
  PpobProductRecord,
  PpobRepository
} from "../../src/modules/ppob/domain/PpobRepository.js";
import { PpobCatalogCategoryView, PpobWalletSnapshot } from "../../src/modules/ppob/domain/ppobModels.js";

/**
 * Stage R2.7 — logika order PPOB pada boundary port.
 *
 * Test double dipakai secara sengaja dan terbatas pada DUA port yang memang
 * dirancang untuk ditukar: PpobRepository (adaptor database) dan
 * PpobProviderGateway (adaptor biller R2.8). Tanpa ini, jalur settlement
 * SUCCESS/FAILED/refund mustahil dicapai pada stage ini karena gateway
 * produksi fail-closed. Permukaan HTTP dengan repository Prisma nyata dijaga
 * oleh ppob.integration.test.ts.
 */

class FakePpobRepository implements PpobRepository {
  wallet: PpobWalletSnapshot = {
    balance: new Prisma.Decimal(0),
    ppobBalance: new Prisma.Decimal(0)
  };
  product: PpobProductRecord | null = null;
  orders: PpobOrderRecord[] = [];
  ledgerEntries: Array<{ type: string; amount: Prisma.Decimal }> = [];
  debitCalls: PpobDebitInput[] = [];
  refundCalls: string[] = [];

  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return handler({} as Prisma.TransactionClient);
  }

  listCatalog(): Promise<PpobCatalogCategoryView[]> {
    return Promise.resolve([]);
  }

  findProductBySku(): Promise<PpobProductRecord | null> {
    return Promise.resolve(this.product);
  }

  getWalletSnapshot(): Promise<PpobWalletSnapshot> {
    return Promise.resolve(this.wallet);
  }

  findOrderByIdempotencyKey(userId: string, idempotencyKey: string): Promise<PpobOrderRecord | null> {
    return Promise.resolve(
      this.orders.find(
        (order) => order.userId === userId && order.idempotencyKey === idempotencyKey
      ) ?? null
    );
  }

  findOrderById(orderId: string): Promise<PpobOrderRecord | null> {
    return Promise.resolve(this.orders.find((order) => order.id === orderId) ?? null);
  }

  listOrdersByUser(userId: string): Promise<PpobOrderRecord[]> {
    return Promise.resolve(this.orders.filter((order) => order.userId === userId));
  }

  createOrderWithDebit(input: PpobDebitInput): Promise<PpobOrderRecord> {
    this.debitCalls.push(input);
    const order: PpobOrderRecord = {
      id: `order-${this.orders.length + 1}`,
      userId: input.userId,
      status: "PENDING",
      sku: this.product!.sku,
      productName: this.product!.name,
      categoryCode: this.product!.categoryCode,
      targetNumber: input.targetNumber,
      amount: input.payment.amount,
      benefitAmount: input.payment.benefitAmount,
      balanceAmount: input.payment.balanceAmount,
      failureReason: null,
      providerRef: null,
      idempotencyKey: input.idempotencyKey,
      walletTransactionId: "ledger-1",
      createdAt: new Date(),
      paidAt: new Date(),
      completedAt: null,
      refundedAt: null
    };
    this.orders.push(order);
    this.ledgerEntries.push({ type: "PPOB_PURCHASE", amount: input.payment.amount.neg() });
    return Promise.resolve(order);
  }

  markOrderSucceeded(orderId: string): Promise<void> {
    this.orders = this.orders.map((order) =>
      order.id === orderId ? { ...order, status: "SUCCESS" as const, completedAt: new Date() } : order
    );
    return Promise.resolve();
  }

  markOrderProcessing(orderId: string): Promise<void> {
    this.orders = this.orders.map((order) =>
      order.id === orderId ? { ...order, status: "PROCESSING" as const } : order
    );
    return Promise.resolve();
  }

  refundOrder(orderId: string, failureReason: string): Promise<void> {
    this.refundCalls.push(orderId);
    this.orders = this.orders.map((order) =>
      order.id === orderId
        ? { ...order, status: "REFUNDED" as const, failureReason, refundedAt: new Date() }
        : order
    );
    this.ledgerEntries.push({ type: "PPOB_REFUND", amount: new Prisma.Decimal(11500) });
    return Promise.resolve();
  }
}

class FakeProviderGateway implements PpobProviderGateway {
  available = true;
  result: PpobProviderPurchaseResult = { outcome: "SUCCESS", providerRef: "REF-1" };
  error: Error | null = null;
  purchaseCalls: PpobProviderPurchaseRequest[] = [];

  getAvailability() {
    return { available: this.available, ...(this.available ? {} : { reason: "down" }) };
  }

  purchase(request: PpobProviderPurchaseRequest): Promise<PpobProviderPurchaseResult> {
    this.purchaseCalls.push(request);
    if (this.error) {
      return Promise.reject(this.error);
    }
    return Promise.resolve(this.result);
  }
}

function makeProduct(overrides: Partial<PpobProductRecord> = {}): PpobProductRecord {
  return {
    id: "product-1",
    sku: "PULSA_10K",
    name: "Pulsa Rp10.000",
    description: null,
    price: new Prisma.Decimal(11500),
    adminFee: new Prisma.Decimal(0),
    targetLabel: "Nomor HP",
    targetPattern: "^[0-9]{10,15}$",
    sortOrder: 1,
    categoryCode: "PULSA",
    isActive: true,
    ...overrides
  };
}

function makeService() {
  const repository = new FakePpobRepository();
  const gateway = new FakeProviderGateway();
  const service = new PpobOrderService(repository, gateway);
  repository.product = makeProduct();
  return { repository, gateway, service };
}

describe("PpobOrderService (port boundary)", () => {
  it("inquiry memakai ppobBalance lebih dulu, sisanya saldo utama", async () => {
    const { repository, service } = makeService();
    repository.wallet = {
      balance: new Prisma.Decimal(100000),
      ppobBalance: new Prisma.Decimal(5000)
    };

    const result = await service.inquiry({
      userId: "user-1",
      sku: "PULSA_10K",
      targetNumber: "081234567890"
    });

    expect(result.amount.toString()).toBe("11500");
    expect(result.payment.benefitAmount.toString()).toBe("5000");
    expect(result.payment.balanceAmount.toString()).toBe("6500");
    expect(result.payment.sufficient).toBe(true);
  });

  it("inquiry menambahkan adminFee ke total", async () => {
    const { repository, service } = makeService();
    repository.product = makeProduct({ adminFee: new Prisma.Decimal(2500) });
    repository.wallet = {
      balance: new Prisma.Decimal(100000),
      ppobBalance: new Prisma.Decimal(0)
    };

    const result = await service.inquiry({
      userId: "user-1",
      sku: "PULSA_10K",
      targetNumber: "081234567890"
    });

    expect(result.amount.toString()).toBe("14000");
    expect(result.payment.balanceAmount.toString()).toBe("14000");
  });

  it("create order fail-closed sebelum debit saat provider tidak tersedia", async () => {
    const { repository, gateway, service } = makeService();
    gateway.available = false;
    repository.wallet = {
      balance: new Prisma.Decimal(100000),
      ppobBalance: new Prisma.Decimal(0)
    };

    await expect(
      service.createOrder({
        userId: "user-1",
        sku: "PULSA_10K",
        targetNumber: "081234567890",
        idempotencyKey: "key-0001"
      })
    ).rejects.toMatchObject({ code: "PPOB_PROVIDER_UNAVAILABLE", statusCode: 503 });

    expect(repository.debitCalls).toHaveLength(0);
    expect(repository.orders).toHaveLength(0);
    expect(gateway.purchaseCalls).toHaveLength(0);
  });

  it("create order menolak saldo tidak cukup sebelum memanggil provider", async () => {
    const { repository, gateway, service } = makeService();
    repository.wallet = {
      balance: new Prisma.Decimal(1000),
      ppobBalance: new Prisma.Decimal(0)
    };

    await expect(
      service.createOrder({
        userId: "user-1",
        sku: "PULSA_10K",
        targetNumber: "081234567890",
        idempotencyKey: "key-0002"
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE", statusCode: 400 });

    expect(repository.debitCalls).toHaveLength(0);
    expect(gateway.purchaseCalls).toHaveLength(0);
  });

  it("provider SUCCESS menutup order sebagai SUCCESS dengan satu ledger debit", async () => {
    const { repository, service } = makeService();
    repository.wallet = {
      balance: new Prisma.Decimal(100000),
      ppobBalance: new Prisma.Decimal(20000)
    };

    const { order, replayed } = await service.createOrder({
      userId: "user-1",
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "key-0003"
    });

    expect(replayed).toBe(false);
    expect(order.status).toBe("SUCCESS");
    expect(repository.ledgerEntries).toHaveLength(1);
    expect(repository.ledgerEntries[0]!.type).toBe("PPOB_PURCHASE");
    expect(repository.ledgerEntries[0]!.amount.toString()).toBe("-11500");
    // Benefit Rp11.500 penuh dari ppobBalance karena mencukupi.
    expect(repository.debitCalls[0]!.payment.benefitAmount.toString()).toBe("11500");
    expect(repository.debitCalls[0]!.payment.balanceAmount.toString()).toBe("0");
  });

  it("provider PENDING memarkah order PROCESSING tanpa refund", async () => {
    const { repository, gateway, service } = makeService();
    gateway.result = { outcome: "PENDING", providerRef: "REF-PENDING" };
    repository.wallet = {
      balance: new Prisma.Decimal(100000),
      ppobBalance: new Prisma.Decimal(0)
    };

    const { order } = await service.createOrder({
      userId: "user-1",
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "key-0004"
    });

    expect(order.status).toBe("PROCESSING");
    expect(repository.refundCalls).toHaveLength(0);
  });

  it("provider FAILED memicu refund penuh dan order REFUNDED", async () => {
    const { repository, gateway, service } = makeService();
    gateway.result = { outcome: "FAILED", failureReason: "Biller rejected" };
    repository.wallet = {
      balance: new Prisma.Decimal(100000),
      ppobBalance: new Prisma.Decimal(0)
    };

    const { order } = await service.createOrder({
      userId: "user-1",
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "key-0005"
    });

    expect(order.status).toBe("REFUNDED");
    expect(order.failureReason).toBe("Biller rejected");
    expect(repository.refundCalls).toHaveLength(1);
    expect(repository.ledgerEntries.map((entry) => entry.type)).toEqual([
      "PPOB_PURCHASE",
      "PPOB_REFUND"
    ]);
  });

  it("provider crash setelah debit tetap mengembalikan saldo (refund)", async () => {
    const { repository, gateway, service } = makeService();
    gateway.error = new Error("socket hang up");
    repository.wallet = {
      balance: new Prisma.Decimal(100000),
      ppobBalance: new Prisma.Decimal(0)
    };

    const { order } = await service.createOrder({
      userId: "user-1",
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "key-0006"
    });

    expect(order.status).toBe("REFUNDED");
    expect(order.failureReason).toBe("Provider call failed");
    expect(repository.refundCalls).toHaveLength(1);
  });

  it("replay idempotency key yang sama mengembalikan order lama tanpa debit ulang", async () => {
    const { repository, gateway, service } = makeService();
    repository.wallet = {
      balance: new Prisma.Decimal(100000),
      ppobBalance: new Prisma.Decimal(0)
    };
    const input = {
      userId: "user-1",
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "key-0007"
    };

    const first = await service.createOrder(input);
    const second = await service.createOrder(input);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(repository.debitCalls).toHaveLength(1);
    expect(gateway.purchaseCalls).toHaveLength(1);
  });

  it("idempotency key sama dengan payload berbeda ditolak 409", async () => {
    const { repository, service } = makeService();
    repository.wallet = {
      balance: new Prisma.Decimal(100000),
      ppobBalance: new Prisma.Decimal(0)
    };

    await service.createOrder({
      userId: "user-1",
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "key-0008"
    });

    await expect(
      service.createOrder({
        userId: "user-1",
        sku: "PULSA_10K",
        targetNumber: "089999999999",
        idempotencyKey: "key-0008"
      })
    ).rejects.toMatchObject({ code: "PPOB_IDEMPOTENCY_CONFLICT", statusCode: 409 });
  });

  it("key yang sama milik user berbeda tidak saling bertabrakan", async () => {
    const { repository, service } = makeService();
    repository.wallet = {
      balance: new Prisma.Decimal(100000),
      ppobBalance: new Prisma.Decimal(0)
    };

    const first = await service.createOrder({
      userId: "user-1",
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "key-shared"
    });
    const second = await service.createOrder({
      userId: "user-2",
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "key-shared"
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(false);
    expect(second.order.id).not.toBe(first.order.id);
  });

  it("getOrder menyembunyikan order milik user lain sebagai 404", async () => {
    const { repository, service } = makeService();
    repository.wallet = {
      balance: new Prisma.Decimal(100000),
      ppobBalance: new Prisma.Decimal(0)
    };
    const { order } = await service.createOrder({
      userId: "user-1",
      sku: "PULSA_10K",
      targetNumber: "081234567890",
      idempotencyKey: "key-0009"
    });

    await expect(service.getOrder("user-2", order.id)).rejects.toMatchObject({
      code: "PPOB_ORDER_NOT_FOUND",
      statusCode: 404
    });
    await expect(service.getOrder("user-1", order.id)).resolves.toMatchObject({
      id: order.id
    });
  });

  it("target tidak sesuai pola produk ditolak sebelum provider dipanggil", async () => {
    const { gateway, service } = makeService();

    await expect(
      service.createOrder({
        userId: "user-1",
        sku: "PULSA_10K",
        targetNumber: "123",
        idempotencyKey: "key-0010"
      })
    ).rejects.toMatchObject({ code: "PPOB_TARGET_INVALID", statusCode: 400 });
    expect(gateway.purchaseCalls).toHaveLength(0);
  });

  it("AppError dari service membawa code operasional yang stabil", async () => {
    const { repository, service } = makeService();
    repository.product = null;

    try {
      await service.inquiry({ userId: "user-1", sku: "TIDAK_ADA", targetNumber: "081234567890" });
      expect.unreachable("harus melempar AppError");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("PPOB_PRODUCT_NOT_FOUND");
    }
  });
});
