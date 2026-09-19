import { describe, expect, it } from "vitest";
import {
  maskAccountNumber,
  maskPhone,
  maskSensitiveFields
} from "../../src/core/security/adminMasking.js";

describe("adminMasking", () => {
  it("menyamarkan nomor HP dengan 4 digit awal dan 3 akhir tampak", () => {
    expect(maskPhone("085863268373")).toBe("0858*****373");
    expect(maskPhone("+6285863268373")).toBe("+628*******373");
    expect(maskPhone("12345")).toBe("*****");
  });

  it("menyamarkan nomor rekening dengan 4 digit akhir tampak", () => {
    expect(maskAccountNumber("8830123456")).toBe("******3456");
    expect(maskAccountNumber("123")).toBe("***");
  });

  it("menyamarkan kolom sensitif di seluruh kedalaman tanpa mengubah aslinya", () => {
    const original = {
      success: true,
      data: {
        items: [
          {
            fullName: "Budi",
            phone: "085863268373",
            user: { phone: "081200000001", email: "b@example.com" },
            bankAccount: { accountNumber: "8830123456", bankName: "BCA" }
          }
        ]
      }
    };
    const masked = maskSensitiveFields(original) as typeof original;

    expect(masked.data.items[0]?.phone).toBe("0858*****373");
    expect(masked.data.items[0]?.user.phone).toBe("0812*****001");
    expect(masked.data.items[0]?.bankAccount.accountNumber).toBe("******3456");
    // Yang bukan kolom sensitif tetap utuh.
    expect(masked.data.items[0]?.fullName).toBe("Budi");
    expect(masked.data.items[0]?.user.email).toBe("b@example.com");
    expect(masked.data.items[0]?.bankAccount.bankName).toBe("BCA");
    // Objek asli tidak berubah.
    expect(original.data.items[0]?.phone).toBe("085863268373");
  });

  it("membiarkan Date dan nilai non-string apa adanya", () => {
    const when = new Date("2026-09-19T00:00:00Z");
    const masked = maskSensitiveFields({ createdAt: when, phone: null, count: 3 }) as Record<string, unknown>;
    expect(masked.createdAt).toBe(when);
    expect(masked.phone).toBeNull();
    expect(masked.count).toBe(3);
  });
});
