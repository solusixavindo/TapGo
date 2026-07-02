import { StatusCodes } from "http-status-codes";
import { AppError } from "../../core/errors/AppError.js";
import { assertDokuConfigured, getDokuConfig } from "./config.js";
import { dokuHeadersFor, verifyDokuSignature } from "./signature.js";
import {
  DokuCheckoutRequest,
  DokuCheckoutResponse,
  DokuConfig,
  DokuCreatePaymentResult,
} from "./types.js";

const checkoutTarget = "/checkout/v1/payment";

export class DokuClient {
  constructor(private readonly config: DokuConfig = getDokuConfig()) {}

  async createAccessToken() {
    assertDokuConfigured(this.config);
    throw new AppError(
      "DOKU access token flow is not enabled for Checkout integration",
      StatusCodes.NOT_IMPLEMENTED,
      "DOKU_ACCESS_TOKEN_NOT_USED",
    );
  }

  async createPayment(
    payload: DokuCheckoutRequest,
  ): Promise<DokuCreatePaymentResult> {
    const config = assertDokuConfigured(this.config);
    if (config.integrationMode !== "checkout") {
      throw new AppError(
        "DOKU snap_direct mode is not implemented for TapGo yet",
        StatusCodes.SERVICE_UNAVAILABLE,
        "DOKU_MODE_NOT_SUPPORTED",
      );
    }
    const response = await this.post<DokuCheckoutResponse>(
      checkoutTarget,
      payload,
    );
    const paymentUrl = this.extractPaymentUrl(response);

    if (!paymentUrl) {
      throw new AppError(
        response.error?.message ??
          response.message ??
          "DOKU checkout did not return a payment URL. Please retry or contact support.",
        StatusCodes.BAD_GATEWAY,
        "DOKU_CHECKOUT_RESPONSE_INVALID",
      );
    }

    const expiredAt =
      response.response?.payment?.expired_date ??
      response.payment?.expired_date ??
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    return {
      paymentUrl,
      referenceId:
        response.response?.order?.invoice_number ??
        response.order?.invoice_number ??
        payload.order.invoice_number,
      ...(expiredAt ? { expiredAt } : {}),
      gatewayResponse: response,
    };
  }

  async checkPaymentStatus(referenceId: string) {
    assertDokuConfigured(this.config);
    const requestTarget = `/orders/v1/status/${encodeURIComponent(referenceId)}`;
    return this.get<Record<string, unknown>>(requestTarget);
  }

  verifyWebhookSignature(input: {
    body: unknown;
    requestTarget: string;
    headers: {
      clientId?: string;
      requestId?: string;
      requestTimestamp?: string;
      signature?: string;
    };
  }) {
    const config = assertDokuConfigured(this.config);
    if (
      input.headers.clientId !== config.clientId ||
      !input.headers.requestId ||
      !input.headers.requestTimestamp ||
      !input.headers.signature
    ) {
      return false;
    }

    return verifyDokuSignature({
      clientId: config.clientId,
      secretKey: config.webhookSecret ?? config.secretKey,
      requestTarget: input.requestTarget,
      body: input.body,
      requestId: input.headers.requestId,
      requestTimestamp: input.headers.requestTimestamp,
      signature: input.headers.signature,
    });
  }

  private async post<T>(requestTarget: string, body: unknown): Promise<T> {
    const config = assertDokuConfigured(this.config);
    const response = await fetch(`${config.baseUrl}${requestTarget}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...dokuHeadersFor(config, requestTarget, body),
      },
      body: JSON.stringify(body),
    });
    const responseBody = (await response.json().catch(() => ({}))) as T & {
      message?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new AppError(
        responseBody.error?.message ??
          responseBody.message ??
          "DOKU checkout is temporarily unavailable. Please retry or contact support.",
        StatusCodes.BAD_GATEWAY,
        "DOKU_PAYMENT_CREATE_FAILED",
      );
    }

    return responseBody;
  }

  private async get<T>(requestTarget: string): Promise<T> {
    const config = assertDokuConfigured(this.config);
    const response = await fetch(`${config.baseUrl}${requestTarget}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...dokuHeadersFor(config, requestTarget, {}),
      },
    });
    const responseBody = (await response.json().catch(() => ({}))) as T & {
      message?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new AppError(
        responseBody.error?.message ??
          responseBody.message ??
          "DOKU payment status is temporarily unavailable. Please retry or contact support.",
        StatusCodes.BAD_GATEWAY,
        "DOKU_STATUS_CHECK_FAILED",
      );
    }

    return responseBody;
  }

  private extractPaymentUrl(response: DokuCheckoutResponse) {
    return (
      response.response?.payment?.url ??
      response.payment?.url ??
      response.paymentUrl ??
      response.payment_url ??
      response.checkout_url ??
      response.redirect_url ??
      ""
    );
  }
}
