import {
  MembershipOrderStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
  UserRole,
} from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { logger } from "../../../core/logger/logger.js";
import { DokuClient } from "../../../lib/doku/client.js";
import { DokuNotificationPayload } from "../../../lib/doku/types.js";
import { MembershipOrderService } from "../../memberships/application/MembershipOrderService.js";
import { isAdminRole } from "../../../core/security/roleHierarchy.js";

const successStatuses = new Set(["SUCCESS", "PAID", "SETTLEMENT", "CAPTURE"]);
const pendingStatuses = new Set(["PENDING", "INITIATED"]);
const expiredStatuses = new Set(["EXPIRED", "TIMEOUT"]);
const cancelledStatuses = new Set(["CANCELLED", "CANCELED", "CANCEL"]);
const failedStatuses = new Set(["FAILED", "FAILURE", "DENIED", "DENY", "REJECTED"]);
const defaultPaymentExpiryMs = 24 * 60 * 60 * 1000;

export class DokuPaymentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly membershipOrderService = new MembershipOrderService(
      prisma,
    ),
    private readonly dokuClient = new DokuClient(),
  ) {}

  async createMembershipPayment(input: {
    userId: string;
    role: UserRole;
    orderId: string;
  }) {
    const order = await this.prisma.membershipOrder.findUnique({
      where: { id: input.orderId },
      include: {
        invoice: true,
        membership: true,
        payments: { orderBy: { createdAt: "desc" } },
        user: {
          select: { id: true, fullName: true, email: true, phone: true },
        },
      },
    });

    if (!order) {
      throw new AppError(
        "Membership order not found",
        StatusCodes.NOT_FOUND,
        "MEMBERSHIP_ORDER_NOT_FOUND",
      );
    }

    if (!this.canReadOrder(input.role, input.userId, order.userId)) {
      throw new AppError(
        "You are not allowed to pay this membership order",
        StatusCodes.FORBIDDEN,
        "MEMBERSHIP_ORDER_FORBIDDEN",
      );
    }

    if (order.status !== "PENDING" || order.invoice?.status !== "PENDING") {
      throw new AppError(
        "Only pending membership orders can be paid",
        StatusCodes.CONFLICT,
        "MEMBERSHIP_ORDER_NOT_PAYABLE",
      );
    }

    if (!order.invoice) {
      throw new AppError(
        "Membership order invoice not found",
        StatusCodes.CONFLICT,
        "MEMBERSHIP_INVOICE_NOT_FOUND",
      );
    }

    const reusablePayment = order.payments.find((payment) => {
      const metadata = this.asObject(payment.metadata);
      return (
        payment.status === "PENDING" &&
        payment.provider === "DOKU" &&
        typeof metadata.paymentUrl === "string" &&
        metadata.paymentUrl.length > 0
      );
    });

    if (reusablePayment) {
      const metadata = this.asObject(reusablePayment.metadata);
      return {
        paymentUrl: String(metadata.paymentUrl),
        redirectUrl: String(metadata.paymentUrl),
        referenceId: reusablePayment.providerReference ?? order.invoice.number,
        expiredAt: this.optionalString(metadata.expiredAt),
        orderId: order.id,
        invoiceNumber: order.invoice.number,
        gateway: "DOKU",
      };
    }

    const amount = Number(new Prisma.Decimal(order.totalAmount).toFixed(0));
    const callbackUrl = env.APP_URL ? `${env.APP_URL}/membership` : undefined;
    const defaultExpiredAt = new Date(
      Date.now() + defaultPaymentExpiryMs,
    ).toISOString();
    const payment = await this.dokuClient.createPayment({
      order: {
        amount,
        invoice_number: order.invoice.number,
        currency: "IDR",
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        ...(callbackUrl ? { callback_url_cancel: callbackUrl } : {}),
        auto_redirect: false,
        line_items: [
          {
            id: order.membership.id,
            name: `TapGo ${order.membership.name}`,
            quantity: 1,
            price: amount,
          },
        ],
      },
      payment: {
        payment_due_date: 1440,
      },
      customer: {
        id: order.user.id,
        name: order.user.fullName,
        ...(order.user.email ? { email: order.user.email } : {}),
        ...(order.user.phone ? { phone: order.user.phone } : {}),
      },
    });

    await this.prisma.membershipPayment.updateMany({
      where: {
        orderId: order.id,
        status: "PENDING",
      },
      data: {
        method: "DOKU_CHECKOUT",
        provider: "DOKU",
        providerReference: payment.referenceId,
        metadata: {
          gateway: "DOKU",
          paymentUrl: payment.paymentUrl,
          redirectUrl: payment.paymentUrl,
          referenceId: payment.referenceId,
          expiredAt: payment.expiredAt ?? defaultExpiredAt,
          dokuEnvironment: env.DOKU_ENVIRONMENT,
          gatewayResponse: this.safeGatewayResponse(payment.gatewayResponse),
          createdAt: new Date().toISOString(),
        },
      },
    });

    return {
      paymentUrl: payment.paymentUrl,
      redirectUrl: payment.paymentUrl,
      referenceId: payment.referenceId,
      expiredAt: payment.expiredAt ?? defaultExpiredAt,
      orderId: order.id,
      invoiceNumber: order.invoice.number,
      gateway: "DOKU",
      gatewayResponse: payment.gatewayResponse,
    };
  }

  async handleNotification(input: {
    payload: DokuNotificationPayload;
    signatureBody?: unknown;
    headers: {
      clientId?: string;
      requestId?: string;
      requestTimestamp?: string;
      signature?: string;
    };
    requestTarget: string;
  }) {
    if (
      !this.dokuClient.verifyWebhookSignature({
        body: input.signatureBody ?? input.payload,
        requestTarget: input.requestTarget,
        headers: input.headers,
      })
    ) {
      throw new AppError(
        "DOKU webhook signature is invalid",
        StatusCodes.UNAUTHORIZED,
        "DOKU_SIGNATURE_INVALID",
      );
    }

    const invoiceNumber =
      input.payload.order?.invoice_number ??
      input.payload.invoice_number ??
      input.payload.reference_id;
    if (!invoiceNumber) {
      throw new AppError(
        "DOKU webhook invoice number is missing",
        StatusCodes.BAD_REQUEST,
        "DOKU_INVOICE_NUMBER_MISSING",
      );
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { number: invoiceNumber },
      include: {
        order: true,
        payments: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!invoice) {
      throw new AppError(
        "DOKU invoice not found",
        StatusCodes.NOT_FOUND,
        "DOKU_INVOICE_NOT_FOUND",
      );
    }

    const status = this.resolveStatus(input.payload);
    const paymentReference =
      input.payload.transaction?.original_request_id ??
      input.payload.transaction_id ??
      input.headers.requestId ??
      invoiceNumber;

    if (status.kind === "SUCCESS") {
      await this.updatePendingPayment({
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        paymentReference,
        payload: input.payload,
      });
      try {
        const result = await this.membershipOrderService.markPaymentSuccess({
          userId: invoice.userId,
          role: "SUPER_ADMIN",
          orderId: invoice.orderId,
          paymentReference,
        });
        return { status: "PAID", idempotent: false, order: result };
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === "MEMBERSHIP_INVOICE_ALREADY_FINALIZED"
        ) {
          return {
            status: invoice.status,
            idempotent: true,
            orderId: invoice.orderId,
          };
        }
        throw error;
      }
    }

    if (status.kind === "PENDING") {
      await this.updatePendingPayment({
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        paymentReference,
        payload: input.payload,
      });
      return {
        status: "PENDING",
        idempotent: invoice.status === "PENDING",
        orderId: invoice.orderId,
      };
    }

    if (status.kind === "UNKNOWN") {
      await this.updatePendingPayment({
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        paymentReference,
        payload: input.payload,
      });
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          metadata: {
            ...this.asObject(invoice.metadata),
            gateway: "DOKU",
            unknownDokuStatus:
              input.payload.transaction?.status ?? input.payload.status ?? null,
            unknownWebhookReceivedAt: new Date().toISOString(),
            gatewayResponse: this.safeGatewayResponse(input.payload),
          },
        },
      });
      return {
        status: "UNKNOWN",
        idempotent: true,
        orderId: invoice.orderId,
      };
    }

    if (invoice.status === "PAID") {
      return {
        status: "PAID",
        idempotent: true,
        orderId: invoice.orderId,
      };
    }

    await this.markTerminalPaymentStatus({
      invoiceId: invoice.id,
      orderId: invoice.orderId,
      paymentReference,
      invoiceStatus: status.paymentStatus,
      orderStatus: status.orderStatus,
      payload: input.payload,
      ...(invoice.payments[0]?.id ? { paymentId: invoice.payments[0].id } : {}),
    });
    return {
      status: status.paymentStatus,
      idempotent: invoice.status === status.paymentStatus,
      orderId: invoice.orderId,
    };
  }

  checkPaymentStatus(referenceId: string) {
    return this.dokuClient.checkPaymentStatus(referenceId);
  }

  private resolveStatus(payload: DokuNotificationPayload):
    | { kind: "SUCCESS" }
    | { kind: "PENDING" }
    | { kind: "UNKNOWN" }
    | {
        kind: "TERMINAL";
        paymentStatus: PaymentStatus;
        orderStatus: MembershipOrderStatus;
      } {
    const rawStatus =
      payload.transaction?.status ?? payload.status ?? "PENDING";
    const status = rawStatus.toUpperCase();

    if (successStatuses.has(status)) return { kind: "SUCCESS" };
    if (pendingStatuses.has(status)) return { kind: "PENDING" };
    if (expiredStatuses.has(status)) {
      return {
        kind: "TERMINAL",
        paymentStatus: "EXPIRED",
        orderStatus: "EXPIRED",
      };
    }
    if (cancelledStatuses.has(status)) {
      return {
        kind: "TERMINAL",
        paymentStatus: "CANCELLED",
        orderStatus: "CANCELLED",
      };
    }
    if (failedStatuses.has(status)) {
      return {
        kind: "TERMINAL",
        paymentStatus: "FAILED",
        orderStatus: "FAILED",
      };
    }

    logger.warn({ dokuStatus: rawStatus }, "Unsupported DOKU webhook status");
    return { kind: "UNKNOWN" };
  }

  private async updatePendingPayment(input: {
    invoiceId: string;
    orderId: string;
    paymentReference: string;
    payload: DokuNotificationPayload;
  }) {
    await this.prisma.membershipPayment.updateMany({
      where: {
        invoiceId: input.invoiceId,
        orderId: input.orderId,
        status: "PENDING",
      },
      data: {
        method: "DOKU_CHECKOUT",
        provider: "DOKU",
        providerReference: input.paymentReference,
        metadata: {
          gateway: "DOKU",
          notificationStatus:
            input.payload.transaction?.status ?? input.payload.status ?? null,
          paymentType: input.payload.payment?.type ?? null,
          receivedAt: new Date().toISOString(),
          gatewayResponse: this.safeGatewayResponse(input.payload),
        },
      },
    });
  }

  private async markTerminalPaymentStatus(input: {
    invoiceId: string;
    orderId: string;
    paymentId?: string;
    paymentReference: string;
    invoiceStatus: PaymentStatus;
    orderStatus: MembershipOrderStatus;
    payload: DokuNotificationPayload;
  }) {
    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.updateMany({
        where: {
          id: input.invoiceId,
          status: "PENDING",
        },
        data: {
          status: input.invoiceStatus,
          metadata: {
            gateway: "DOKU",
            dokuStatus:
              input.payload.transaction?.status ?? input.payload.status ?? null,
            dokuTransactionId: input.payload.transaction_id ?? null,
            receivedAt: new Date().toISOString(),
          },
        },
      });

      await tx.membershipOrder.updateMany({
        where: {
          id: input.orderId,
          status: "PENDING",
        },
        data: {
          status: input.orderStatus,
        },
      });

      if (input.paymentId) {
        await tx.membershipPayment.updateMany({
          where: {
            id: input.paymentId,
            status: "PENDING",
          },
          data: {
            status: input.invoiceStatus,
            provider: "DOKU",
            providerReference: input.paymentReference,
            metadata: {
              gateway: "DOKU",
              notificationStatus:
                input.payload.transaction?.status ?? input.payload.status ?? null,
              paymentType: input.payload.payment?.type ?? null,
              receivedAt: new Date().toISOString(),
              gatewayResponse: this.safeGatewayResponse(input.payload),
            },
          },
        });
      }
    });
  }

  private safeGatewayResponse(value: unknown) {
    return JSON.parse(
      JSON.stringify(value, (key, original) => {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes("secret") ||
          lowerKey.includes("signature") ||
          lowerKey.includes("token") ||
          lowerKey.includes("authorization") ||
          lowerKey.includes("api_key") ||
          lowerKey.includes("apikey") ||
          lowerKey.includes("private") ||
          lowerKey.includes("client_secret") ||
          lowerKey.includes("secret_key")
        ) {
          return "[REDACTED]";
        }
        return original;
      }),
    ) as Prisma.InputJsonValue;
  }

  private canReadOrder(role: UserRole, requesterId: string, ownerId: string) {
    return (
      requesterId === ownerId || isAdminRole(role)
    );
  }

  private asObject(
    value: Prisma.JsonValue | null | undefined,
  ): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private optionalString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
}
