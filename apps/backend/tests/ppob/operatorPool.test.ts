import { describe, expect, it } from "vitest";
import { expandOperatorPool } from "../../src/modules/ppob/domain/operatorPool.js";

describe("expandOperatorPool", () => {
  it("peta pulsa yang menyusut dipulihkan ke semua operator menurut konvensi kode, kode yang ada dipertahankan", () => {
    expect(expandOperatorPool("PULSA", { indosat: "i20" })).toEqual({
      indosat: "i20",
      telkomsel: "s20",
      xl: "x20",
      axis: "ax20",
      tri: "t20",
      smartfren: "sm20"
    });
    // Nominal ribuan berdigit banyak.
    expect(expandOperatorPool("PULSA", { telkomsel: "s100" })).toMatchObject({ telkomsel: "s100", indosat: "i100", tri: "t100", axis: "ax100" });
  });

  it("kode yang sudah ada menang atas kode turunan (mis. kode non-standar yang dipilih manual)", () => {
    const pool = expandOperatorPool("PULSA", { telkomsel: "s20", xl: "x20" });
    expect(pool.telkomsel).toBe("s20");
    expect(pool.xl).toBe("x20");
    expect(pool.tri).toBe("t20");
  });

  it("bukan pulsa: tidak diperluas (paket data, token, dll.)", () => {
    expect(expandOperatorPool("DATA", { telkomsel: "s20" })).toEqual({ telkomsel: "s20" });
    expect(expandOperatorPool("EWALLET", { telkomsel: "s20" })).toEqual({ telkomsel: "s20" });
  });

  it("kode yang tidak mengikuti konvensi atau nominalnya berbeda: dikembalikan apa adanya", () => {
    expect(expandOperatorPool("PULSA", { telkomsel: "flash1" })).toEqual({ telkomsel: "flash1" });
    // Awalan tidak cocok dengan operatornya.
    expect(expandOperatorPool("PULSA", { telkomsel: "x20" })).toEqual({ telkomsel: "x20" });
    // Nominal berbeda antar entri: ragu, jangan menebak.
    expect(expandOperatorPool("PULSA", { telkomsel: "s20", xl: "x50" })).toEqual({ telkomsel: "s20", xl: "x50" });
    // Kunci operator yang tidak dikenal.
    expect(expandOperatorPool("PULSA", { byu: "byu10" })).toEqual({ byu: "byu10" });
  });

  it("peta kosong atau nilai bukan string tidak menimbulkan galat", () => {
    expect(expandOperatorPool("PULSA", {})).toEqual({});
    expect(expandOperatorPool("PULSA", { telkomsel: 5 })).toEqual({});
  });
});
