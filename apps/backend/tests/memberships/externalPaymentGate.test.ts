import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env, strictEnvBoolean } from "../../src/config/env.js";
import { AppError } from "../../src/core/errors/AppError.js";
import { errorHandler } from "../../src/core/errors/errorHandler.js";
import { MembershipOrderController } from "../../src/modules/memberships/presentation/membership-order.controller.js";
import { MembershipController } from "../../src/modules/memberships/presentation/membership.controller.js";
import { DokuController } from "../../src/modules/payments/presentation/doku.controller.js";
import { WalletController } from "../../src/modules/wallets/presentation/wallet.controller.js";

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

  it.each(["1", "0", "yes", "no", "on", "off", "maybe", "enabled", "disabled"])(
    "rejects unsupported boolean value %s",
    (value) => {
      expect(strictEnvBoolean(false).safeParse(value).success).toBe(false);
    },
  );

  it("defaults external membership payments to disabled unless explicitly enabled", () => {
    expect(strictEnvBoolean(false).parse(undefined)).toBe(false);
  });

  it("returns only Basic package data when external paid memberships are disabled", async () => {
    env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = false;
    const membershipOrderService = {
      listPackages: vi.fn().mockResolvedValue([
        { tier: "BASIC", name: "Basic" },
        { tier: "SILVER", name: "Silver" },
      ]),
    };
    const controller = new MembershipOrderController(
      membershipOrderService as never,
    );
    const response = { json: vi.fn() } as unknown as Response;

    await controller.packages({} as Request, response);

    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: [{ tier: "BASIC", name: "Basic" }],
    });
  });

  it("rejects membership order creation before service execution in Play-safe mode", async () => {
    env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = false;
    const membershipOrderService = { createOrder: vi.fn() };
    const controller = new MembershipOrderController(
      membershipOrderService as never,
    );
    const request = {
      auth: { userId: "user-1", role: "USER" },
      body: { packageId: "package-1" },
    } as unknown as Request;
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await expect(controller.createOrder(request, response)).rejects.toMatchObject({
      code: "PAID_MEMBERSHIP_DISABLED_FOR_PLAY",
      statusCode: 403,
    });
    expect(membershipOrderService.createOrder).not.toHaveBeenCalled();
  });

  it("rejects legacy membership upgrade before service execution in Play-safe mode", async () => {
    env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = false;
    const membershipService = { upgrade: vi.fn() };
    const controller = new MembershipController(membershipService as never);
    const request = {
      auth: { userId: "user-1", role: "USER" },
      body: { targetTier: "SILVER" },
    } as unknown as Request;
    const response = { json: vi.fn() } as unknown as Response;

    await expect(controller.upgrade(request, response)).rejects.toMatchObject({
      code: "PAID_MEMBERSHIP_DISABLED_FOR_PLAY",
      statusCode: 403,
    });
    expect(membershipService.upgrade).not.toHaveBeenCalled();
  });

  it("rejects DOKU create before invoking DOKU service in Play-safe mode", async () => {
    env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = false;
    const dokuPaymentService = { createMembershipPayment: vi.fn() };
    const controller = new DokuController(dokuPaymentService as never);
    const request = {
      auth: { userId: "user-1", role: "USER" },
      body: { orderId: "order-1" },
    } as unknown as Request;
    const response = { json: vi.fn() } as unknown as Response;

    await expect(controller.create(request, response)).rejects.toMatchObject({
      code: "EXTERNAL_MEMBERSHIP_PAYMENTS_DISABLED",
      statusCode: 403,
    });
    expect(dokuPaymentService.createMembershipPayment).not.toHaveBeenCalled();
  });

  it("rejects bank account mutation and withdrawal before wallet service execution in Play-safe mode", async () => {
    env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = false;
    const walletService = {
      updateBankAccount: vi.fn(),
      requestWithdrawal: vi.fn(),
    };
    const controller = new WalletController(walletService as never);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await expect(
      controller.updateBankAccount(
        {
          auth: { userId: "user-1", role: "USER" },
          body: {
            bankName: "Bank Mandiri",
            accountNumber: "00123456",
            accountHolderName: "Member TapGo",
          },
        } as unknown as Request,
        response,
      ),
    ).rejects.toMatchObject({
      code: "CASH_OUT_DISABLED_FOR_PLAY",
      statusCode: 403,
    });
    await expect(
      controller.requestWithdrawal(
        {
          auth: { userId: "user-1", role: "USER" },
          body: {
            amount: 50000,
            bankName: "Bank Mandiri",
            accountNumber: "00123456",
            accountHolderName: "Member TapGo",
          },
        } as unknown as Request,
        response,
      ),
    ).rejects.toMatchObject({
      code: "CASH_OUT_DISABLED_FOR_PLAY",
      statusCode: 403,
    });
    expect(walletService.updateBankAccount).not.toHaveBeenCalled();
    expect(walletService.requestWithdrawal).not.toHaveBeenCalled();
  });

  it("preserves direct membership order creation when the gate is explicitly enabled", async () => {
    env.EXTERNAL_MEMBERSHIP_PAYMENTS_ENABLED = true;
    const createdOrder = { id: "order-1" };
    const membershipOrderService = {
      createOrder: vi.fn().mockResolvedValue(createdOrder),
    };
    const controller = new MembershipOrderController(
      membershipOrderService as never,
    );
    const request = {
      auth: { userId: "user-1", role: "USER" },
      body: { packageId: "package-1", registrationData: { name: "Member" } },
    } as unknown as Request;
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await controller.createOrder(request, response);

    expect(membershipOrderService.createOrder).toHaveBeenCalledWith({
      userId: "user-1",
      packageId: "package-1",
      registrationData: { name: "Member" },
    });
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: createdOrder,
    });
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
