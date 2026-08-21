import { PpobCategory } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  maskPpobTarget,
  normalizePpobTarget
} from "../../src/modules/ppob/domain/targetValidation.js";

describe("PPOB target validation (unit)", () => {
  it("menormalkan MSISDN +62/62/0 ke bentuk kanonik 08", () => {
    expect(normalizePpobTarget("PULSA", "085612345678")).toBe("085612345678");
    expect(normalizePpobTarget("PULSA", "+6285612345678")).toBe("085612345678");
    expect(normalizePpobTarget("PULSA", "6285612345678")).toBe("085612345678");
    expect(normalizePpobTarget("DATA", " 0856 1234 5678 ")).toBe("085612345678");
    expect(normalizePpobTarget("EWALLET", "081234567890")).toBe("081234567890");
  });

  it("menolak MSISDN yang tidak masuk grammar Indonesia", () => {
    for (const bad of ["0712345678", "08123", "021234567", "081234567890123456", "abcdefgh"]) {
      expect(() => normalizePpobTarget("PULSA", bad)).toThrowError(
        expect.objectContaining({ code: "PPOB_TARGET_INVALID" })
      );
    }
  });

  it("memvalidasi IDPEL PLN 11-12 digit dan menolak selain itu", () => {
    expect(normalizePpobTarget("PLN_PREPAID", "12345678901")).toBe("12345678901");
    expect(normalizePpobTarget("PLN_POSTPAID", "123456789012")).toBe("123456789012");
    for (const bad of ["1234567890", "1234567890123", "12345abc901"]) {
      expect(() => normalizePpobTarget("PLN_PREPAID", bad)).toThrowError(
        expect.objectContaining({ code: "PPOB_TARGET_INVALID" })
      );
    }
  });

  it("memvalidasi nomor kartu BPJS 13 digit", () => {
    expect(normalizePpobTarget("BPJS", "0001234567890")).toBe("0001234567890");
    expect(() => normalizePpobTarget("BPJS", "123456789012")).toThrowError(
      expect.objectContaining({ code: "PPOB_TARGET_INVALID" })
    );
  });

  it("menolak kategori yang tidak dikenal pada tipe runtime", () => {
    expect(() =>
      normalizePpobTarget("TIDAK_ADA" as PpobCategory, "081234567890")
    ).toThrowError(expect.objectContaining({ code: "PPOB_TARGET_INVALID" }));
  });

  it("masking tidak pernah menampilkan nomor penuh", () => {
    expect(maskPpobTarget("081234567890")).toBe("0812••••890");
    expect(maskPpobTarget("123")).toBe("***");
  });
});
