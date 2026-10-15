import { describe, expect, it } from "vitest";
import {
  availableTopUpMethods,
  companyBorneGatewayFee,
  customerTopUpFee,
  fullTopUpFee,
  gatewayFeeFor,
  snapCodesFor
} from "../../src/core/finance/midtransFees.js";

/**
 * Biaya top up per metode (keputusan Owner 16 Okt 2026): Saldo PPOB menanggung biaya penuh; Saldo TapGo (komisi driver)
 * dibatasi Rp2.500 dan sisanya ditanggung perusahaan. Angka diperiksa dengan hitungan terpisah (Python) dari tarif tertulis:
 * VA Rp4.000 + PPN 11%; GoPay 2%; QRIS 0,7%; DANA 1,5% + PPN. Tarif persen dihitung atas total tagihan (gross-up).
 */
describe("fullTopUpFee: biaya yang menutup seluruh biaya Midtrans", () => {
  it("transfer bank: tetap Rp4.440 berapa pun nominalnya", () => {
    for (const amount of [25_000, 50_000, 200_000]) expect(fullTopUpFee("bank_transfer", amount)).toBe(4440);
  });

  it("tarif persen di-gross-up: GoPay 2%, QRIS 0,7%, DANA 1,5% + PPN", () => {
    expect(fullTopUpFee("gopay", 25_000)).toBe(511);
    expect(fullTopUpFee("gopay", 50_000)).toBe(1021);
    expect(fullTopUpFee("gopay", 200_000)).toBe(4082);
    expect(fullTopUpFee("qris", 50_000)).toBe(353);
    expect(fullTopUpFee("qris", 200_000)).toBe(1410);
    expect(fullTopUpFee("dana", 50_000)).toBe(847);
    expect(fullTopUpFee("dana", 200_000)).toBe(3387);
  });

  it("hasilnya selalu cukup: biaya Midtrans atas (nominal + biaya) tidak melebihi biaya yang ditagih", () => {
    for (const method of ["bank_transfer", "gopay", "qris", "dana"] as const) {
      for (const amount of [10_000, 25_000, 77_777, 123_456, 1_000_000, 5_000_000]) {
        const fee = fullTopUpFee(method, amount);
        expect(gatewayFeeFor(method, amount + fee).toNumber(), `${method} ${amount}`).toBeLessThanOrEqual(fee);
        // Dan minimal: biaya satu rupiah lebih kecil sudah tidak cukup.
        expect(gatewayFeeFor(method, amount + fee - 1).toNumber(), `${method} ${amount} minimal`).toBeGreaterThan(fee - 1);
      }
    }
  });
});

describe("customerTopUpFee: yang ditagihkan ke pelanggan", () => {
  const cap = 2500;

  it("Saldo PPOB: biaya penuh (margin PPOB terlalu tipis untuk menanggung biaya gateway)", () => {
    expect(customerTopUpFee({ target: "PPOB", method: "bank_transfer", amount: 25_000, walletCap: cap })).toBe(4440);
    expect(customerTopUpFee({ target: "PPOB", method: "gopay", amount: 25_000, walletCap: cap })).toBe(511);
  });

  it("Saldo TapGo (driver): transfer bank dibatasi Rp2.500, sisanya Rp1.940 ditanggung perusahaan", () => {
    for (const amount of [25_000, 50_000, 100_000, 200_000]) {
      expect(customerTopUpFee({ target: "WALLET", method: "bank_transfer", amount, walletCap: cap })).toBe(2500);
    }
    const gross = 50_000 + 2500;
    expect(companyBorneGatewayFee("bank_transfer", gross, 2500).fee.toNumber()).toBe(1940);
  });

  it("Saldo TapGo: metode berbiaya persen tidak pernah ditagih lebih dari biaya sebenarnya, dan dibatasi Rp2.500", () => {
    expect(customerTopUpFee({ target: "WALLET", method: "qris", amount: 50_000, walletCap: cap })).toBe(353);
    expect(customerTopUpFee({ target: "WALLET", method: "gopay", amount: 100_000, walletCap: cap })).toBe(2041);
    // Di atas titik impas batas, perusahaan menanggung sisanya.
    expect(customerTopUpFee({ target: "WALLET", method: "gopay", amount: 200_000, walletCap: cap })).toBe(2500);
    expect(companyBorneGatewayFee("gopay", 200_000 + 2500, 2500).fee.toNumber()).toBe(1550); // 2% x 202.500 = 4.050 - 2.500
    expect(customerTopUpFee({ target: "WALLET", method: "dana", amount: 200_000, walletCap: cap })).toBe(2500);
    expect(companyBorneGatewayFee("dana", 200_000 + 2500, 2500).fee.toNumber()).toBeCloseTo(871.63, 1);
  });

  it("batas dapat diubah lewat konfigurasi (0 = perusahaan menanggung semuanya)", () => {
    expect(customerTopUpFee({ target: "WALLET", method: "bank_transfer", amount: 50_000, walletCap: 0 })).toBe(0);
    expect(customerTopUpFee({ target: "WALLET", method: "bank_transfer", amount: 50_000, walletCap: 10_000 })).toBe(4440);
  });
});

describe("companyBorneGatewayFee", () => {
  it("nol bila biaya pelanggan menutup biaya Midtrans; tidak pernah negatif", () => {
    expect(companyBorneGatewayFee("bank_transfer", 29_440, 4440).fee.toNumber()).toBe(0);
    expect(companyBorneGatewayFee("qris", 50_353, 5000).fee.toNumber()).toBe(0);
  });

  it("jenis pembayaran yang tidak dikenal: tidak dihitung (dilaporkan sebagai tidak dikenal)", () => {
    expect(companyBorneGatewayFee("jenis_baru", 50_000, 0).known).toBe(false);
    expect(companyBorneGatewayFee(null, 50_000, 0).known).toBe(false);
  });
});

describe("metode yang tersedia menurut daftar enabled_payments", () => {
  it("hanya metode yang kodenya aktif yang ditawarkan", () => {
    expect(availableTopUpMethods(["bni_va", "bri_va", "cimb_va", "permata_va", "echannel"])).toEqual(["bank_transfer"]);
    expect(availableTopUpMethods(["bni_va", "gopay", "other_qris", "dana"])).toEqual(["bank_transfer", "gopay", "qris", "dana"]);
    expect(availableTopUpMethods(["credit_card"])).toEqual([]);
  });

  it('"all" (undefined) menawarkan semua metode', () => {
    expect(availableTopUpMethods(undefined)).toEqual(["bank_transfer", "gopay", "qris", "dana"]);
  });

  it("kode Snap yang dikirim hanya irisan dengan daftar yang berlaku", () => {
    expect(snapCodesFor("bank_transfer", ["bni_va", "echannel", "gopay"])).toEqual(["bni_va", "echannel"]);
    expect(snapCodesFor("gopay", ["bni_va"])).toEqual([]);
    expect(snapCodesFor("qris", undefined)).toEqual(["other_qris"]);
  });
});
