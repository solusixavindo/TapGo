import { Prisma } from "@prisma/client";
import {
  PpobCatalogCategoryView,
  PpobOrderView,
  PpobPaymentBreakdown,
  PpobProductView,
  PpobWalletSnapshot
} from "./ppobModels.js";

export interface PpobProductRecord extends PpobProductView {
  categoryCode: string;
  isActive: boolean;
}

export interface PpobOrderRecord extends PpobOrderView {
  userId: string;
  idempotencyKey: string;
  walletTransactionId: string | null;
}

export interface PpobDebitInput {
  userId: string;
  productId: string;
  targetNumber: string;
  idempotencyKey: string;
  payment: PpobPaymentBreakdown;
}

export interface PpobRepository {
  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;

  listCatalog(): Promise<PpobCatalogCategoryView[]>;
  findProductBySku(sku: string, tx?: Prisma.TransactionClient): Promise<PpobProductRecord | null>;
  getWalletSnapshot(userId: string, tx?: Prisma.TransactionClient): Promise<PpobWalletSnapshot>;

  findOrderByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    tx?: Prisma.TransactionClient
  ): Promise<PpobOrderRecord | null>;
  findOrderById(orderId: string): Promise<PpobOrderRecord | null>;
  listOrdersByUser(userId: string, page: number, pageSize: number): Promise<PpobOrderView[]>;

  /** Debit saldo gabungan + ledger + order dalam satu transaksi pemanggil. */
  createOrderWithDebit(input: PpobDebitInput, tx: Prisma.TransactionClient): Promise<PpobOrderRecord>;
  markOrderSucceeded(orderId: string, providerRef: string | undefined, tx: Prisma.TransactionClient): Promise<void>;
  markOrderProcessing(orderId: string, providerRef: string | undefined, tx: Prisma.TransactionClient): Promise<void>;
  /** Refund penuh ke sumber saldo asal; no-op bila order sudah REFUNDED. */
  refundOrder(orderId: string, failureReason: string, tx: Prisma.TransactionClient): Promise<void>;
}
