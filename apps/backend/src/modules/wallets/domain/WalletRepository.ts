import { Prisma, WithdrawalStatus } from "@prisma/client";

export type WalletSnapshot = {
  id: string;
  userId: string;
  balance: Prisma.Decimal;
  cashBalance: Prisma.Decimal;
  ppobBalance: Prisma.Decimal;
  currency: string;
  updatedAt: Date;
};

export type WalletTransactionItem = {
  id: string;
  type: string;
  amount: Prisma.Decimal;
  referenceType: string | null;
  referenceId: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

export type WithdrawalItem = {
  id: string;
  walletId: string;
  userId: string;
  amount: Prisma.Decimal;
  fee: Prisma.Decimal;
  finalAmount: Prisma.Decimal;
  status: WithdrawalStatus;
  bankName: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
  bankAccount: Prisma.JsonValue;
  requestedAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  paidAt: Date | null;
  notes: string | null;
  note: string | null;
};

export type BankAccountSnapshot = {
  bankName: string;
  bankCode?: string;
  accountNumber: string;
  accountHolderName: string;
  updatedAt?: string;
} | null;

export interface WalletRepository {
  transaction<T>(handler: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  getOrCreateWallet(userId: string, tx?: Prisma.TransactionClient): Promise<WalletSnapshot>;
  getWalletByUserId(userId: string): Promise<WalletSnapshot>;
  getTransactions(userId: string, page: number, pageSize: number): Promise<WalletTransactionItem[]>;
  getBankAccount(userId: string): Promise<BankAccountSnapshot>;
  updateBankAccount(input: {
    userId: string;
    bankName: string;
    bankCode?: string;
    accountNumber: string;
    accountHolderName: string;
  }): Promise<NonNullable<BankAccountSnapshot>>;
  reserveWithdrawal(input: {
    userId: string;
    amount: Prisma.Decimal;
    bankName: string;
    bankCode?: string;
    accountNumber: string;
    accountHolderName: string;
    fee?: Prisma.Decimal;
    notes?: string;
  }, tx: Prisma.TransactionClient): Promise<WithdrawalItem>;
  listWithdrawals(input: {
    userId?: string;
    status?: WithdrawalStatus;
    page: number;
    pageSize: number;
  }): Promise<WithdrawalItem[]>;
  getWithdrawal(withdrawalId: string): Promise<WithdrawalItem | null>;
  approveWithdrawal(input: {
    withdrawalId: string;
    adminId: string;
    note?: string;
  }, tx: Prisma.TransactionClient): Promise<WithdrawalItem>;
  rejectWithdrawal(input: {
    withdrawalId: string;
    adminId: string;
    note?: string;
  }, tx: Prisma.TransactionClient): Promise<WithdrawalItem>;
  markWithdrawalPaid(input: {
    withdrawalId: string;
    adminId: string;
    note?: string;
  }, tx: Prisma.TransactionClient): Promise<WithdrawalItem>;
}
