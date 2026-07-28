import { createHash, timingSafeEqual } from "node:crypto";
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
import { MembershipOrderService } from "../../memberships/application/MembershipOrderService.js";

type PrismaTransaction = Prisma.TransactionClient;

type MidtransNotificationPayload = {
  order_id: string;
  transaction_id?: string;
  transaction_status: string;
  fraud_status?: string;
  status_code?: string;
  gross_amount?: string;
  currency?: string;
  signature_key?: string;
  payment_type?: string;
  transaction_time?: string;
};

// Kontrak Midtrans: gross_amount adalah string desimal biasa (mis. "500000.00").
// Hanya digit dengan opsional 1-2 desimal yang diterima — menolak scientific
// notation, hexadecimal, underscore, comma, whitespace, NaN/Infinity, dan tanda.
const STRICT_DECIMAL_AMOUNT = /^\d+(\.\d{1,2})?$/;

type MidtransSnapResponse = {
  token?: string;
  redirect_url?: string;
  error_messages?: string[];
};

const successStatuses = new Set(["settlement", "capture"]);
const pendingStatuses = new Set(["pending"]);
const failedStatuses = new Set(["deny", "failure", "cancel", "expire"]);

export class MidtransPaymentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly membershipOrderService = new MembershipOrderService(
      prisma,
    ),
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
        metadata.snapToken &&
        metadata.redirectUrl
      );
    });

    if (reusablePayment) {
      const metadata = this.asObject(reusablePayment.metadata);
      return {
        snapToken: String(metadata.snapToken),
        redirectUrl: String(metadata.redirectUrl),
        orderId: order.id,
        invoiceNumber: order.invoice.number,
      };
    }

    const snapPayload = {
      transaction_details: {
        order_id: order.invoice.number,
        gross_amount: Number(new Prisma.Decimal(order.totalAmount).toFixed(0)),
      },
      customer_details: {
        first_name: order.user.fullName,
        email: order.user.email ?? undefined,
        phone: order.user.phone,
      },
      item_details: [
        {
          id: order.membership.id,
          price: Number(new Prisma.Decimal(order.totalAmount).toFixed(0)),
          quantity: 1,
          name: `TapGo ${order.membership.name}`,
        },
      ],
    };

    const snapResponse = await this.createSnapTransaction(snapPayload);
    const snapToken = snapResponse.token;
    const redirectUrl = snapResponse.redirect_url;

    if (!snapToken || !redirectUrl) {
      throw new AppError(
        "Midtrans did not return a usable Snap transaction",
        StatusCodes.BAD_GATEWAY,
        "MIDTRANS_SNAP_RESPONSE_INVALID",
      );
    }

    await this.prisma.membershipPayment.updateMany({
      where: {
        orderId: order.id,
        status: "PENDING",
      },
      data: {
        method: "MIDTRANS_SNAP",
        provider: "MIDTRANS",
        providerReference: order.invoice.number,
        metadata: {
          snapToken,
          redirectUrl,
          midtransOrderId: order.invoice.number,
          sandbox: !env.MIDTRANS_IS_PRODUCTION,
        },
      },
    });

    return {
      snapToken,
      redirectUrl,
      orderId: order.id,
      invoiceNumber: order.invoice.number,
    };
  }

  async handleNotification(payload: MidtransNotificationPayload) {
    this.verifySignature(payload);

    const invoice = await this.prisma.invoice.findUnique({
      where: { number: payload.order_id },
      include: {
        order: true,
        payments: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!invoice) {
      throw new AppError(
        "Midtrans invoice not found",
        StatusCodes.NOT_FOUND,
        "MIDTRANS_INVOICE_NOT_FOUND",
      );
    }

    const paymentReference = payload.transaction_id ?? payload.order_id;
    const status = this.resolveNotificationStatus(payload);

    if (status.kind === "SUCCESS") {
      // P1-2: fail-closed jika nominal callback tidak sama persis dengan nominal
      // order authoritative dari backend. Mencegah aktivasi/bonus/wallet akibat
      // callback ber-signature valid namun nominal berbeda (under/over-payment).
      this.assertAuthoritativeAmount(invoice.amount, payload);
      try {
        const result = await this.membershipOrderService.markPaymentSuccess({
          userId: invoice.userId,
          role: "SUPER_ADMIN",
          orderId: invoice.orderId,
          paymentReference,
        });

        return {
          status: "PAID",
          idempotent: false,
          order: result,
        };
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

        // P1-2: callback duplikat yang berjalan konkuren dapat kalah pada
        // Serializable isolation (write conflict/deadlock). Jika invoice sudah
        // lunas oleh callback pemenang, perlakukan sebagai idempotent agar tidak
        // menghasilkan 5xx yang memicu retry berulang. Side effect tetap sekali.
        if (this.isSerializationConflict(error)) {
          const settled = await this.prisma.invoice.findUnique({
            where: { id: invoice.id },
            select: { status: true },
          });
          if (settled && settled.status !== "PENDING") {
            return {
              status: settled.status,
              idempotent: true,
              orderId: invoice.orderId,
            };
          }
        }

        throw error;
      }
    }

    if (status.kind === "PENDING") {
      await this.updatePendingPayment(
        invoice.id,
        invoice.orderId,
        paymentReference,
        payload,
      );
      return {
        status: "PENDING",
        idempotent: invoice.status === "PENDING",
        orderId: invoice.orderId,
      };
    }

    await this.markTerminalPaymentStatus({
      invoiceId: invoice.id,
      orderId: invoice.orderId,
      paymentReference,
      invoiceStatus: status.paymentStatus,
      orderStatus: status.orderStatus,
      payload,
      ...(invoice.payments[0]?.id ? { paymentId: invoice.payments[0].id } : {}),
    });

    return {
      status: status.paymentStatus,
      idempotent: invoice.status === status.paymentStatus,
      orderId: invoice.orderId,
    };
  }

  private async createSnapTransaction(
    payload: Record<string, unknown>,
  ): Promise<MidtransSnapResponse> {
    const serverKey = env.MIDTRANS_SERVER_KEY;

    if (!serverKey) {
      throw new AppError(
        "Midtrans server key is not configured",
        StatusCodes.SERVICE_UNAVAILABLE,
        "MIDTRANS_NOT_CONFIGURED",
      );
    }

    const snapUrl =
      env.MIDTRANS_SNAP_URL ??
      (env.MIDTRANS_IS_PRODUCTION
        ? "https://app.midtrans.com/snap/v1/transactions"
        : "https://app.sandbox.midtrans.com/snap/v1/transactions");

    const response = await fetch(snapUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json()) as MidtransSnapResponse;

    if (!response.ok) {
      throw new AppError(
        body.error_messages?.join(", ") || "Midtrans Snap transaction failed",
        StatusCodes.BAD_GATEWAY,
        "MIDTRANS_SNAP_FAILED",
      );
    }

    return body;
  }

  // P1-2: deteksi serialization failure / deadlock PostgreSQL yang dibungkus
  // Prisma, baik pada operasi biasa (P2034/P2037) maupun raw query (P2010 dengan
  // SQLSTATE 40001/40P01).
  private isSerializationConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }
    if (error.code === "P2034" || error.code === "P2037") {
      return true;
    }
    if (error.code === "P2010") {
      const pgCode = (error.meta as { code?: string } | undefined)?.code;
      return pgCode === "40001" || pgCode === "40P01";
    }
    return false;
  }

  // P1-2: nominal order hanya boleh berasal dari backend (invoice.amount),
  // bukan dari nilai callback. gross_amount yang hilang/malformed atau tidak
  // sama persis ditolak (fail-closed) sebelum aktivasi apa pun.
  private assertAuthoritativeAmount(
    authoritativeAmount: Prisma.Decimal,
    payload: MidtransNotificationPayload,
  ) {
    // Currency, bila disediakan callback, wajib literal IDR.
    if (payload.currency !== undefined && payload.currency !== "IDR") {
      throw new AppError(
        "Midtrans currency must be IDR",
        StatusCodes.BAD_REQUEST,
        "MIDTRANS_CURRENCY_INVALID",
      );
    }

    // Validasi format string yang ketat sebelum parsing numerik, menolak
    // representasi non-standar (5e5, 0x.., 500_000, "500000,00", whitespace,
    // NaN/Infinity, tanda minus) yang bisa lolos parser Decimal yang permisif.
    const raw = payload.gross_amount;
    if (typeof raw !== "string" || !STRICT_DECIMAL_AMOUNT.test(raw)) {
      throw new AppError(
        "Midtrans gross_amount format is invalid",
        StatusCodes.BAD_REQUEST,
        "MIDTRANS_AMOUNT_INVALID",
      );
    }

    const provided = new Prisma.Decimal(raw);

    // Nominal harus positif (bukan nol/negatif).
    if (!provided.isFinite() || provided.lte(0)) {
      throw new AppError(
        "Midtrans gross_amount must be a positive value",
        StatusCodes.BAD_REQUEST,
        "MIDTRANS_AMOUNT_INVALID",
      );
    }

    // Harus sama persis dengan nominal order authoritative dari backend.
    if (!provided.equals(new Prisma.Decimal(authoritativeAmount))) {
      throw new AppError(
        "Midtrans gross_amount does not match the authoritative order amount",
        StatusCodes.BAD_REQUEST,
        "MIDTRANS_AMOUNT_MISMATCH",
      );
    }
  }

  private verifySignature(payload: MidtransNotificationPayload) {
    if (!env.MIDTRANS_SERVER_KEY) {
      if (env.NODE_ENV === "production") {
        throw new AppError(
          "Midtrans server key is required in production",
          StatusCodes.SERVICE_UNAVAILABLE,
          "MIDTRANS_SERVER_KEY_REQUIRED",
        );
      }
      return;
    }

    if (!payload.signature_key) {
      if (env.NODE_ENV === "production") {
        throw new AppError(
          "Midtrans signature is required in production",
          StatusCodes.UNAUTHORIZED,
          "MIDTRANS_SIGNATURE_REQUIRED",
        );
      }
      return;
    }

    const requiredParts =
      payload.order_id && payload.status_code && payload.gross_amount;

    if (!requiredParts) {
      throw new AppError(
        "Midtrans signature payload is incomplete",
        StatusCodes.BAD_REQUEST,
        "MIDTRANS_SIGNATURE_INCOMPLETE",
      );
    }

    const expected = createHash("sha512")
      .update(
        `${payload.order_id}${payload.status_code}${payload.gross_amount}${env.MIDTRANS_SERVER_KEY}`,
      )
      .digest("hex");

    // P2: bandingkan signature dengan constant-time compare untuk menghindari
    // timing side-channel. timingSafeEqual mensyaratkan panjang buffer sama,
    // jadi panjang divalidasi lebih dulu (perbedaan panjang = pasti invalid).
    const expectedBuffer = Buffer.from(expected, "utf8");
    const providedBuffer = Buffer.from(payload.signature_key, "utf8");

    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new AppError(
        "Midtrans signature is invalid",
        StatusCodes.UNAUTHORIZED,
        "MIDTRANS_SIGNATURE_INVALID",
      );
    }
  }

  private resolveNotificationStatus(
    payload: MidtransNotificationPayload,
  ):
    | { kind: "SUCCESS" }
    | { kind: "PENDING" }
    | {
        kind: "TERMINAL";
        paymentStatus: PaymentStatus;
        orderStatus: MembershipOrderStatus;
      } {
    const transactionStatus = payload.transaction_status.toLowerCase();

    if (successStatuses.has(transactionStatus)) {
      return { kind: "SUCCESS" };
    }

    if (transactionStatus === "capture") {
      return payload.fraud_status === "challenge"
        ? { kind: "PENDING" }
        : { kind: "SUCCESS" };
    }

    if (pendingStatuses.has(transactionStatus)) {
      return { kind: "PENDING" };
    }

    if (transactionStatus === "expire") {
      return {
        kind: "TERMINAL",
        paymentStatus: "EXPIRED",
        orderStatus: "EXPIRED",
      };
    }

    if (transactionStatus === "cancel") {
      return {
        kind: "TERMINAL",
        paymentStatus: "CANCELLED",
        orderStatus: "CANCELLED",
      };
    }

    if (failedStatuses.has(transactionStatus)) {
      return {
        kind: "TERMINAL",
        paymentStatus: "FAILED",
        orderStatus: "FAILED",
      };
    }

    throw new AppError(
      "Unsupported Midtrans transaction status",
      StatusCodes.BAD_REQUEST,
      "MIDTRANS_STATUS_UNSUPPORTED",
    );
  }

  private async updatePendingPayment(
    invoiceId: string,
    orderId: string,
    paymentReference: string,
    payload: MidtransNotificationPayload,
  ) {
    await this.prisma.membershipPayment.updateMany({
      where: {
        invoiceId,
        orderId,
        status: "PENDING",
      },
      data: {
        method: "MIDTRANS_SNAP",
        provider: "MIDTRANS",
        providerReference: paymentReference,
        metadata: {
          notificationStatus: payload.transaction_status,
          fraudStatus: payload.fraud_status ?? null,
          paymentType: payload.payment_type ?? null,
          receivedAt: new Date().toISOString(),
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
    payload: MidtransNotificationPayload;
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
            midtransStatus: input.payload.transaction_status,
            midtransTransactionId: input.payload.transaction_id ?? null,
            paymentType: input.payload.payment_type ?? null,
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
            provider: "MIDTRANS",
            providerReference: input.paymentReference,
            metadata: {
              notificationStatus: input.payload.transaction_status,
              fraudStatus: input.payload.fraud_status ?? null,
              paymentType: input.payload.payment_type ?? null,
              receivedAt: new Date().toISOString(),
            },
          },
        });
      }
    });
  }

  private canReadOrder(role: UserRole, requesterId: string, ownerId: string) {
    return (
      requesterId === ownerId || role === "ADMIN" || role === "SUPER_ADMIN"
    );
  }

  private asObject(
    value: Prisma.JsonValue | null | undefined,
  ): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
