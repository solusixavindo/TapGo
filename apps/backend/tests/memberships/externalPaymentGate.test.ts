import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env, strictEnvBoolean } from "../../src/config/env.js";
import { AppError } from "../../src/core/errors/AppError.js";
import { errorHandler } from "../../src/core/errors/errorHandler.js";
import { MembershipOrderController } from "../../src/modules/memberships/presentation/membership-order.controller.js";

const originalExternalPaymentGate = env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED;
const originalDokuEnabled = env.DOKU_ENABLED;

afterEach(() => {
  env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = originalExternalPaymentGate;
  env.DOKU_ENABLED = originalDokuEnabled;
  vi.restoreAllMocks();
});

describe("External membership payment safety gate", () => {
  it.each([
    ["unset", undefined, false],
    ["empty string", "", false],
    ["literal false", "false", false],
    ["literal true", "true", true],
    ["mixed-case false", "FaLsE", false],
    ["mixed-case true", "TrUe", true],
  ])("parses %s safely", (_label, value, expected) => {
    expect(strictEnvBoolean(false).parse(value)).toBe(expected);
  });

  it.each(["maybe", "enabled", "disabled", "truthy", "falsy"])(
    "rejects unsupported boolean value %s",
    (value) => {
      expect(strictEnvBoolean(false).safeParse(value).success).toBe(false);
    },
  );

  it("defaults external membership payments to disabled unless explicitly enabled", () => {
    expect(originalExternalPaymentGate).toBe(false);
  });

  it("rejects external membership pay before constructing or selecting providers", async () => {
    env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = false;
    const dokuPaymentServiceFactory = vi.fn(() => ({
      createMembershipPayment: vi.fn(),
    }));
    const midtransPaymentServiceFactory = vi.fn(() => ({
      createMembershipPayment: vi.fn(),
    }));
    const controller = new MembershipOrderController(
      {} as never,
      midtransPaymentServiceFactory as never,
      dokuPaymentServiceFactory as never,
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
    expect(dokuPaymentServiceFactory).not.toHaveBeenCalled();
    expect(midtransPaymentServiceFactory).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it("returns a structured safe API error through the error handler", () => {
    const error = new AppError(
      "Pembayaran membership eksternal belum tersedia untuk rilis Google Play.",
      StatusCodes.FORBIDDEN,
      "EXTERNAL_MEMBERSHIP_PAYMENTS_DISABLED",
    );
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    errorHandler(
      error,
      { path: "/api/v1/membership/orders/order-1/pay" } as Request,
      { status, json } as unknown as Response,
      vi.fn(),
    );

    expect(status).toHaveBeenCalledWith(StatusCodes.FORBIDDEN);
    expect(json).toHaveBeenCalledWith({
      success: false,
      code: "EXTERNAL_MEMBERSHIP_PAYMENTS_DISABLED",
      message:
        "Pembayaran membership eksternal belum tersedia untuk rilis Google Play.",
    });
  });

  it("preserves the DOKU direct flow when the gate is explicitly enabled", async () => {
    env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = true;
    env.DOKU_ENABLED = true;
    const dokuPaymentService = {
      createMembershipPayment: vi.fn().mockResolvedValue({
        paymentUrl: "https://sandbox.doku.example/checkout",
        redirectUrl: "https://sandbox.doku.example/checkout",
        referenceId: "INV-1",
        gateway: "DOKU",
      }),
    };
    const dokuPaymentServiceFactory = vi.fn(() => dokuPaymentService);
    const midtransPaymentServiceFactory = vi.fn(() => ({
      createMembershipPayment: vi.fn(),
    }));
    const controller = new MembershipOrderController(
      {} as never,
      midtransPaymentServiceFactory as never,
      dokuPaymentServiceFactory as never,
    );

    const request = {
      auth: { userId: "user-1", role: "USER" },
      params: { id: "order-1" },
    } as unknown as Request;
    const response = { json: vi.fn() } as unknown as Response;

    await controller.pay(request, response);

    expect(dokuPaymentServiceFactory).toHaveBeenCalledTimes(1);
    expect(dokuPaymentService.createMembershipPayment).toHaveBeenCalledWith({
      userId: "user-1",
      role: "USER",
      orderId: "order-1",
    });
    expect(midtransPaymentServiceFactory).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ gateway: "DOKU" }),
    });
  });

  it("preserves the Midtrans direct flow when DOKU is disabled and the gate is enabled", async () => {
    env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = true;
    env.DOKU_ENABLED = false;
    const midtransPaymentService = {
      createMembershipPayment: vi.fn().mockResolvedValue({
        snapToken: "token-redacted",
        redirectUrl: "https://app.midtrans.example/snap",
        orderId: "order-1",
        invoiceNumber: "INV-1",
      }),
    };
    const midtransPaymentServiceFactory = vi.fn(() => midtransPaymentService);
    const dokuPaymentServiceFactory = vi.fn(() => ({
      createMembershipPayment: vi.fn(),
    }));
    const controller = new MembershipOrderController(
      {} as never,
      midtransPaymentServiceFactory as never,
      dokuPaymentServiceFactory as never,
    );

    const request = {
      auth: { userId: "user-1", role: "USER" },
      params: { id: "order-1" },
    } as unknown as Request;
    const response = { json: vi.fn() } as unknown as Response;

    await controller.pay(request, response);

    expect(midtransPaymentServiceFactory).toHaveBeenCalledTimes(1);
    expect(midtransPaymentService.createMembershipPayment).toHaveBeenCalledWith({
      userId: "user-1",
      role: "USER",
      orderId: "order-1",
    });
    expect(dokuPaymentServiceFactory).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ orderId: "order-1" }),
    });
  });
});
