import { describe, expect, it } from "vitest";
import { detectMobileOperator } from "../../src/modules/ppob/domain/operatorDetection.js";

describe("Deteksi operator dari prefiks nomor", () => {
  it.each([
    ["081112345678", "telkomsel"],
    ["082312345678", "telkomsel"],
    ["085212345678", "telkomsel"],
    ["081412345678", "indosat"],
    ["085612345678", "indosat"],
    ["081712345678", "xl"],
    ["087812345678", "xl"],
    ["083812345678", "axis"],
    ["089512345678", "tri"],
    ["089912345678", "tri"],
    ["088112345678", "smartfren"],
    ["088912345678", "smartfren"]
  ])("%s -> %s", (msisdn, operator) => {
    expect(detectMobileOperator(msisdn)).toBe(operator);
  });

  it("prefiks tidak dikenal atau terlalu pendek menghasilkan null", () => {
    expect(detectMobileOperator("080012345678")).toBeNull();
    expect(detectMobileOperator("0899")).toBe("tri");
    expect(detectMobileOperator("08")).toBeNull();
    expect(detectMobileOperator("")).toBeNull();
  });
});
