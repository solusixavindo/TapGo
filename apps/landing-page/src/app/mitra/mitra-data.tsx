"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  BankAccount,
  MITRA_PREVIEW,
  Profile,
  ReferralSummary,
  WalletBalance,
  Withdrawal,
  getBankAccount,
  getProfile,
  getReferralSummary,
  getWallet,
  getWithdrawals,
  isAuthError,
  requestWithdrawal,
  saveBankAccount
} from "./mitra-api";
import {
  PREVIEW_BANK,
  PREVIEW_PROFILE,
  PREVIEW_SUMMARY,
  PREVIEW_WALLET,
  PREVIEW_WITHDRAWALS
} from "./mitra-preview";

type Core = {
  profile: Profile;
  wallet: WalletBalance;
  bank: BankAccount | null;
  summary: ReferralSummary;
  withdrawals: Withdrawal[];
};

type MitraData = {
  core: Core | null;
  loading: boolean;
  error: string;
  /** null = belum diketahui; false = server menutup pencairan web. */
  withdrawalOpen: boolean | null;
  reload: () => Promise<void>;
  saveBank: (input: {
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountHolderName: string;
  }) => Promise<void>;
  withdraw: (input: { amount: number; password: string; notes?: string }) => Promise<Withdrawal>;
};

const MitraContext = createContext<MitraData | null>(null);

export function useMitra(): MitraData {
  const value = useContext(MitraContext);
  if (!value) throw new Error("useMitra dipakai di luar MitraDataProvider");
  return value;
}

export function MitraDataProvider({
  children,
  onSessionExpired
}: {
  children: React.ReactNode;
  onSessionExpired: () => void;
}) {
  const [core, setCore] = useState<Core | null>(
    MITRA_PREVIEW
      ? {
          profile: PREVIEW_PROFILE,
          wallet: PREVIEW_WALLET,
          bank: PREVIEW_BANK,
          summary: PREVIEW_SUMMARY,
          withdrawals: PREVIEW_WITHDRAWALS
        }
      : null
  );
  const [loading, setLoading] = useState(!MITRA_PREVIEW);
  const [error, setError] = useState("");
  const [withdrawalOpen, setWithdrawalOpen] = useState<boolean | null>(MITRA_PREVIEW ? true : null);

  const load = useCallback(async () => {
    if (MITRA_PREVIEW) return;
    try {
      const [profile, wallet, bank, summary, withdrawals] = await Promise.all([
        getProfile(),
        getWallet(),
        getBankAccount(),
        getReferralSummary(),
        getWithdrawals(1, 20)
      ]);
      setCore({ profile, wallet, bank, summary, withdrawals });
      setError("");
    } catch (caught) {
      if (isAuthError(caught)) {
        onSessionExpired();
        return;
      }
      setError(caught instanceof Error ? caught.message : "Data belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  const saveBank = useCallback<MitraData["saveBank"]>(async (input) => {
    if (MITRA_PREVIEW) {
      setCore((current) =>
        current ? { ...current, bank: { ...input, updatedAt: new Date().toISOString() } } : current
      );
      return;
    }
    const bank = await saveBankAccount(input);
    setCore((current) => (current ? { ...current, bank } : current));
  }, []);

  const withdraw = useCallback<MitraData["withdraw"]>(
    async (input) => {
      if (MITRA_PREVIEW) {
        const created: Withdrawal = {
          id: `preview-${Date.now()}`,
          amount: input.amount,
          fee: 0,
          finalAmount: input.amount,
          status: "PENDING",
          bankName: PREVIEW_BANK.bankName,
          accountNumber: PREVIEW_BANK.accountNumber,
          requestedAt: new Date().toISOString(),
          approvedAt: null,
          paidAt: null,
          rejectedAt: null,
          note: ""
        };
        setCore((current) =>
          current
            ? {
                ...current,
                wallet: {
                  ...current.wallet,
                  cashBalance: current.wallet.cashBalance - input.amount,
                  balance: current.wallet.balance - input.amount
                },
                withdrawals: [created, ...current.withdrawals]
              }
            : current
        );
        return created;
      }
      try {
        const created = await requestWithdrawal(input);
        const [wallet, withdrawals] = await Promise.all([getWallet(), getWithdrawals(1, 20)]);
        setCore((current) => (current ? { ...current, wallet, withdrawals } : current));
        return created;
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === "WITHDRAWAL_WEB_DISABLED") {
          setWithdrawalOpen(false);
        }
        if (isAuthError(caught)) onSessionExpired();
        throw caught;
      }
    },
    [onSessionExpired]
  );

  const value = useMemo<MitraData>(
    () => ({ core, loading, error, withdrawalOpen, reload, saveBank, withdraw }),
    [core, loading, error, withdrawalOpen, reload, saveBank, withdraw]
  );

  return <MitraContext.Provider value={value}>{children}</MitraContext.Provider>;
}
