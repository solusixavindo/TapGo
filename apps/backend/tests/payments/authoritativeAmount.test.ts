import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/core/errors/AppError.js";
import { assertAuthoritativeAmount } from "../../src/modules/payments/application/authoritativeAmount.js";

/**
 * Verifikasi nominal callback pembayaran.
 *
 * Kontrol ini dulu hanya ada pada jalur Midtrasn dan TIDAK ADA sama sekali pada
 * jalur DOKU. Berkas uji ini menjaga dua hal sekaligus: aturannya benar, dan
 * aturannya SATU — sehingga gateway berikutnya tidak dapat diam-diam memakai
 * versi yang lebih longgar.
 */

const ORDER_AMOUNT = new Prisma.Decimal("500000.00");

function attempt(overrides: {
  providedAmount: unknown;
  providedCurrency?: unknown;
  codePrefix?: "MIDTRANS" | "DOKU";
}) {
  return () =>
    assertAuthoritativeAmount({
      gateway: "TestGateway",
      codePrefix: overrides.codePrefix ?? "MIDTRANS",
      authoritativeAmount: ORDER_AMOUNT,
      providedAmount: overrides.providedAmount,
      ...(overrides.providedCurrency !== undefined
        ? { providedCurrency: overrides.providedCurrency }
        : {}),
    });
}

function codeOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error("diharapkan menolak, tetapi lolos");
}

describe("assertAuthoritativeAmount", () => {
  it("menerima nominal string yang sama persis", () => {
    expect(attempt({ providedAmount: "500000.00" })).not.toThrow();
  });

  it("menerima nominal tanpa desimal yang nilainya sama", () => {
    expect(attempt({ providedAmount: "500000" })).not.toThrow();
  });

  // DOKU mengirim order.amount sebagai number pada sebagian kanal.
  it("menerima nominal number yang nilainya sama", () => {
    expect(attempt({ providedAmount: 500000, codePrefix: "DOKU" })).not.toThrow();
  });

  it("menolak kurang bayar", () => {
    expect(codeOf(attempt({ providedAmount: "400000.00" }))).toBe(
      "MIDTRANS_AMOUNT_MISMATCH",
    );
  });

  it("menolak lebih bayar", () => {
    expect(codeOf(attempt({ providedAmount: "600000.00" }))).toBe(
      "MIDTRANS_AMOUNT_MISMATCH",
    );
  });

  // Fail-closed. Klaim yang tidak dapat diperiksa tidak boleh memberi benefit.
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["objek", { amount: 500000 }],
    ["array", ["500000"]],
    ["boolean", true],
    ["string kosong", ""],
  ])("menolak nominal %s", (_label, value) => {
    expect(codeOf(attempt({ providedAmount: value }))).toBe(
      "MIDTRANS_AMOUNT_INVALID",
    );
  });

  /**
   * Representasi non-standar yang dapat lolos parser Decimal yang permisif.
   * Validasi format WAJIB berjalan sebelum parsing, bukan sesudahnya.
   */
  it.each([
    ["scientific notation", "5e5"],
    ["hexadecimal", "0x7A120"],
    ["underscore", "500_000"],
    ["pemisah koma", "500000,00"],
    ["spasi di tepi", " 500000 "],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["tiga desimal", "500000.000"],
    ["negatif", "-500000"],
    ["plus eksplisit", "+500000"],
  ])("menolak %s", (_label, value) => {
    expect(codeOf(attempt({ providedAmount: value }))).toBe(
      "MIDTRANS_AMOUNT_INVALID",
    );
  });

  // Number pun tidak boleh lolos lewat bentuk eksponen.
  it("menolak number dalam bentuk eksponen", () => {
    expect(codeOf(attempt({ providedAmount: 5e21 }))).toBe(
      "MIDTRANS_AMOUNT_INVALID",
    );
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("menolak number %s", (_label, value) => {
    expect(codeOf(attempt({ providedAmount: value }))).toBe(
      "MIDTRANS_AMOUNT_INVALID",
    );
  });

  it("menolak nol", () => {
    expect(codeOf(attempt({ providedAmount: "0.00" }))).toBe(
      "MIDTRANS_AMOUNT_INVALID",
    );
  });

  it("menolak mata uang selain IDR", () => {
    expect(
      codeOf(attempt({ providedAmount: "500000.00", providedCurrency: "USD" })),
    ).toBe("MIDTRANS_CURRENCY_INVALID");
  });

  it("menerima mata uang IDR yang eksplisit", () => {
    expect(
      attempt({ providedAmount: "500000.00", providedCurrency: "IDR" }),
    ).not.toThrow();
  });

  // Mata uang yang tidak disertakan callback bukan alasan menolak; yang menolak
  // adalah mata uang yang disertakan TETAPI bukan IDR.
  it("mengabaikan mata uang yang tidak disertakan", () => {
    expect(
      attempt({ providedAmount: "500000.00", providedCurrency: null }),
    ).not.toThrow();
  });

  it("memakai prefiks kode galat sesuai gateway", () => {
    expect(
      codeOf(attempt({ providedAmount: "400000.00", codePrefix: "DOKU" })),
    ).toBe("DOKU_AMOUNT_MISMATCH");
  });
});
