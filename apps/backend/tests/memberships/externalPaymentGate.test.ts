import { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env.js";
import { AppError } from "../../src/core/errors/AppError.js";
import { MembershipOrderController } from "../../src/modules/memberships/presentation/membership-order.controller.js";

const originalExternalPaymentGate = env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;

afterEach(() => {
  env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = originalExternalPaymentGate;
});

describe("External membership payment safety gate", () => {
  it("defaults to disabled unless explicitly enabled", () => {
    expect(originalExternalPaymentGate).toBe(false);
  });

  it("rejects external membership pay before selecting DOKU or Midtrans", async () => {
    env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = false;
    const dokuPaymentService = { createMembershipPayment: vi.fn() };
    const midtransPaymentService = { createMembershipPayment: vi.fn() };
    const controller = new MembershipOrderController(
      {} as never,
      midtransPaymentService as never,
      dokuPaymentService as never,
    );

    const request = {
      auth: { userId: "user-1", role: "USER" },
      params: { id: "order-1" },
    } as unknown as Request;
    const response = { json: vi.fn() } as unknown as Response;

    await expect(controller.pay(request, response)).rejects.toMatchObject({
      code: "EXTERNAL_MEMBERSHIP_PAYMENTS_DISABLED",
      message:
        "Pembayaran membership eksternal belum tersedia untuk rilis Google Play.",
      statusCode: 403,
    } satisfies Partial<AppError>);
    expect(dokuPaymentService.createMembershipPayment).not.toHaveBeenCalled();
    expect(midtransPaymentService.createMembershipPayment).not.toHaveBeenCalled();
  });
});
