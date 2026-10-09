import { describe, expect, it } from "vitest";
import { phoneLookupVariants } from "../../src/core/security/phone.js";
import { loginSchema, otpRequestSchema, registerSchema } from "../../src/modules/auth/presentation/auth.validators.js";

describe("auth validators", () => {
  it.each([
    ["081355503217", "081355503217"],
    ["6281355503217", "081355503217"],
    ["+6281355503217", "081355503217"]
  ])("normalizes Indonesian phone format %s to %s during register", (input, expected) => {
    const parsed = registerSchema.parse({
      fullName: "TapGo User",
      phone: input,
      password: "User123"
    });

    expect(parsed.body.phone).toBe(expected);
  });

  it.each([
    "081234567890", // deretan berurutan
    "081111111111", // digit sama
    "0812345", // terlalu pendek
    "080012345678", // bukan awalan seluler
    "+14155550123" // bukan nomor Indonesia
  ])("rejects implausible phone %s during register but still accepts it at login", (phone) => {
    expect(() => registerSchema.parse({ fullName: "TapGo User", phone, password: "User123" })).toThrow();
    // Login tidak diperketat: akun lama dan akun uji boleh punya nomor di luar pola pendaftaran.
    if (/^\d+$/.test(phone) && phone.length >= 8) {
      expect(() => loginSchema.parse({ phone, password: "User123" })).not.toThrow();
    }
  });

  it("normalizes phone during login and OTP request", () => {
    const login = loginSchema.parse({
      phone: "+6281234567890",
      password: "User123"
    });
    const otp = otpRequestSchema.parse({
      phone: "6281234567890",
      purpose: "LOGIN"
    });

    expect(login.body.phone).toBe("081234567890");
    expect(otp.body.phone).toBe("081234567890");
  });

  it("keeps lookup variants for backward compatibility with old +62 stored users", () => {
    expect(phoneLookupVariants("+6281234567890")).toEqual([
      "+6281234567890",
      "081234567890",
      "6281234567890"
    ]);
  });
});
