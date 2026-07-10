import { describe, expect, it } from "vitest";
import { phoneLookupVariants } from "../../src/core/security/phone.js";
import { loginSchema, otpRequestSchema, registerSchema } from "../../src/modules/auth/presentation/auth.validators.js";

describe("auth validators", () => {
  it.each([
    ["081234567890", "081234567890"],
    ["6281234567890", "081234567890"],
    ["+6281234567890", "081234567890"]
  ])("normalizes Indonesian phone format %s to %s during register", (input, expected) => {
    const parsed = registerSchema.parse({
      fullName: "TapGo User",
      phone: input,
      password: "User123"
    });

    expect(parsed.body.phone).toBe(expected);
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
