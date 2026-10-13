import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import {
  REFUNDABLE_PAYMENT_METHODS,
  isBankTransferPaymentType,
  resolveMidtransEnabledPayments,
  snapEnabledPaymentsPart
} from "../../src/modules/payments/application/MidtransPaymentService.js";

/**
 * Midtrans mengaktifkan akun TapGo hanya dengan "Bank Transfer Aggregator" (9 Okt 2026). Daftar metode Snap
 * harus dapat diatur dari pengaturan tanpa rilis ulang, dan bawaannya tidak boleh berubah.
 */
describe("MIDTRANS_ENABLED_PAYMENTS", () => {
  const saved = env.MIDTRANS_ENABLED_PAYMENTS;
  afterEach(() => {
    env.MIDTRANS_ENABLED_PAYMENTS = saved;
  });

  it("kosong = daftar tertutup bawaan (kartu, GoPay, QRIS), tidak berubah", () => {
    expect(resolveMidtransEnabledPayments(undefined)).toEqual(REFUNDABLE_PAYMENT_METHODS);
    expect(resolveMidtransEnabledPayments("   ")).toEqual(["credit_card", "gopay", "other_qris"]);
  });

  it('"all" (huruf apa pun) = daftar TIDAK dikirim sama sekali', () => {
    expect(resolveMidtransEnabledPayments("all")).toBeUndefined();
    expect(resolveMidtransEnabledPayments(" ALL ")).toBeUndefined();
    env.MIDTRANS_ENABLED_PAYMENTS = "all";
    expect(snapEnabledPaymentsPart()).toEqual({});
    expect("enabled_payments" in snapEnabledPaymentsPart()).toBe(false);
  });

  it("daftar eksplisit dirapikan; nama aneh ditolak (bukan dikirim ke Midtrans)", () => {
    expect(resolveMidtransEnabledPayments(" Other_VA , permata_va ,")).toEqual(["other_va", "permata_va"]);
    env.MIDTRANS_ENABLED_PAYMENTS = "other_va,permata_va";
    expect(snapEnabledPaymentsPart()).toEqual({ enabled_payments: ["other_va", "permata_va"] });
    for (const bad of ["credit card", "gopay;drop", "x", "a,,b!", ","]) {
      expect(() => resolveMidtransEnabledPayments(bad), bad).toThrow(/MIDTRANS_ENABLED_PAYMENTS/);
    }
  });

  it("jenis pembayaran transfer bank dikenali; kartu, GoPay, QRIS, dan nilai kosong tidak", () => {
    for (const type of ["bank_transfer", "echannel", "permata", "other_va", "BCA_VA", " bni_va "]) {
      expect(isBankTransferPaymentType(type), type).toBe(true);
    }
    for (const type of ["credit_card", "gopay", "qris", "shopeepay", "cstore", "", null, undefined, 5]) {
      expect(isBankTransferPaymentType(type), String(type)).toBe(false);
    }
  });
});
