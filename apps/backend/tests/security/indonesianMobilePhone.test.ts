import { describe, expect, it } from "vitest";
import { isPlausibleIndonesianMobile, normalizePhoneNumber } from "../../src/core/security/phone.js";

const accepted = (raw: string) => isPlausibleIndonesianMobile(normalizePhoneNumber(raw));

describe("nomor seluler Indonesia untuk pendaftaran", () => {
  it("menerima nomor sungguhan dalam berbagai penulisan", () => {
    for (const phone of [
      "081355503217", "+6281355503217", "6281355503217", "0813-5550-3217", "0813 5550 3217",
      "0811234098", "08211045672", "085712098374", "0895123450987", "087812345098", "0881098712345", "0831 9876 2310"
    ]) {
      expect(accepted(phone), phone).toBe(true);
    }
  });

  it("menolak awalan bukan seluler, panjang di luar 10-13 digit, dan karakter bukan angka", () => {
    for (const phone of [
      "0800123456789", "0801234567", "0211234567", "07123456789", "0812345", "081355503", "08135550321712",
      "081355503217123", "+14155550123", "081355503ABC", "", "08"
    ]) {
      expect(accepted(phone), phone).toBe(false);
    }
  });

  it("menolak pola rekaan: deretan digit sama atau berurutan", () => {
    for (const phone of [
      "081111111111", "082222222222", "0813333333333", "0812345678901", "081234567890", "089876543210",
      "0812 3456 7809" /* 1234567 masih urutan 7 */, "087777777788", "08550000000012"
    ]) {
      expect(accepted(phone), phone).toBe(false);
    }
  });

  it("tidak menolak nomor sungguhan yang kebetulan memuat sedikit pengulangan atau urutan", () => {
    for (const phone of ["081300055512", "081255512345", "0857 1234 9876", "081333344455", "082198765012"]) {
      expect(accepted(phone), phone).toBe(true);
    }
  });
});
