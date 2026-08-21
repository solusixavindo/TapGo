import { PpobOrderStatus, Prisma } from "@prisma/client";

export interface PpobCategoryView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
}

export interface PpobProductView {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: Prisma.Decimal;
  adminFee: Prisma.Decimal;
  targetLabel: string;
  targetPattern: string | null;
  sortOrder: number;
}

export interface PpobCatalogCategoryView extends PpobCategoryView {
  products: PpobProductView[];
}

export interface PpobWalletSnapshot {
  balance: Prisma.Decimal;
  ppobBalance: Prisma.Decimal;
}

/**
 * Rincian pemakaian saldo gabungan: benefit (ppobBalance) dipakai lebih dulu,
 * sisanya dari saldo utama. Wallet.balance adalah total (ppobBalance subset),
 * mengikuti semantik modul wallets.
 */
export interface PpobPaymentBreakdown {
  amount: Prisma.Decimal;
  benefitAmount: Prisma.Decimal;
  balanceAmount: Prisma.Decimal;
  sufficient: boolean;
}

export interface PpobInquiryView {
  product: PpobProductView & { categoryCode: string };
  targetNumber: string;
  price: Prisma.Decimal;
  adminFee: Prisma.Decimal;
  amount: Prisma.Decimal;
  payment: PpobPaymentBreakdown;
  wallet: {
    balance: Prisma.Decimal;
    ppobBalance: Prisma.Decimal;
  };
}

export interface PpobOrderView {
  id: string;
  status: PpobOrderStatus;
  sku: string;
  productName: string;
  categoryCode: string;
  targetNumber: string;
  amount: Prisma.Decimal;
  benefitAmount: Prisma.Decimal;
  balanceAmount: Prisma.Decimal;
  failureReason: string | null;
  providerRef: string | null;
  createdAt: Date;
  paidAt: Date | null;
  completedAt: Date | null;
  refundedAt: Date | null;
}

export const PPOB_PROVIDER_UNAVAILABLE = "PPOB_PROVIDER_UNAVAILABLE";
export const PPOB_PRODUCT_NOT_FOUND = "PPOB_PRODUCT_NOT_FOUND";
export const PPOB_PRODUCT_INACTIVE = "PPOB_PRODUCT_INACTIVE";
export const PPOB_TARGET_INVALID = "PPOB_TARGET_INVALID";
export const PPOB_ORDER_NOT_FOUND = "PPOB_ORDER_NOT_FOUND";
export const PPOB_IDEMPOTENCY_CONFLICT = "PPOB_IDEMPOTENCY_CONFLICT";
export const PPOB_INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE";
