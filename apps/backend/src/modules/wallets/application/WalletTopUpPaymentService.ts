import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { isAdminRole } from "../../../core/security/roleHierarchy.js";
import { DokuClient } from "../../../lib/doku/client.js";
import { DokuNotificationPayload } from "../../../lib/doku/types.js";
import { assertAuthoritativeAmount } from "../../payments/application/authoritativeAmount.js";
import { REFUNDABLE_PAYMENT_METHODS } from "../../payments/application/MidtransPaymentService.js";
import { verifyMidtransSignature } from "../../payments/application/midtransSignature.js";
import { lazyPushNotifier } from "../../notifications/application/pushServiceFactory.js";
import { accountPushMessages, pushQuietly } from "../../notifications/application/accountNotifications.js";
import type { PushNotifier } from "../../notifications/application/rideNotifications.js";
import { PrismaWalletRepository } from "../infrastructure/PrismaWalletRepository.js";

type MidtransNotificationPayload = {
  order_id: string;
  transaction_id?: string;
  transaction_status: string;
  fraud_status?: string;
  status_code?: string;
  gross_amount?: string;
  currency?: string;
  payment_type?: string;
};

type MidtransSnapResponse = {
  token?: string;
  redirect_url?: string;
  error_messages?: string[];
};

/**
 * Top up TapGoPay via Midtrans/DOKU (Stage R2.10, kanal WEB saja).
 *
 * Bukan generalisasi dari MidtransPaymentService/DokuPaymentService — kedua
 * kelas itu terikat erat ke Invoice/MembershipOrder (bukan hanya lewat
 * helper), dan menggeneralisasinya berisiko mengubah perilaku alur membership
 * yang sudah diaudit. Sebagai gantinya, kelas ini memakai ULANG bagian yang
 * sudah diekstrak sebagai fungsi murni bersama — verifyMidtransSignature dan
 * assertAuthoritativeAmount — sehingga verifikasi signature dan nominal tetap
 * satu sumber kebenaran dengan jalur membership, sementara sisi pembukuannya
 * (order top up, bukan invoice+order+payment tiga tabel) tetap independen dan
 * sederhana.
 */
export class WalletTopUpPaymentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly walletRepository = new PrismaWalletRepository(prisma),
    private readonly dokuClient = new DokuClient(),
    private readonly push: PushNotifier = lazyPushNotifier,
  ) {}

  /** Hanya saat saldo benar-benar bertambah (bukan callback ulang). */
  private notifyTopUpPaid(paid: { userId: string } | null) {
    if (paid) pushQuietly(this.push, paid.userId, accountPushMessages.topUpSuccess, { type: "wallet_topup" });
  }

  private assertCanRead(role: UserRole, requesterId: string, ownerId: string) {
    if (requesterId !== ownerId && !isAdminRole(role)) {
      throw new AppError(
        "You are not allowed to pay this top-up order",
        StatusCodes.FORBIDDEN,
        "WALLET_TOPUP_ORDER_FORBIDDEN",
      );
    }
  }

  private async loadPayableOrder(input: { userId: string; role: UserRole; orderId: string }) {
    const order = await this.walletRepository.findTopUpOrderById(input.orderId);
    if (!order) {
      throw new AppError("Wallet top-up order not found", StatusCodes.NOT_FOUND, "WALLET_TOPUP_ORDER_NOT_FOUND");
    }
    this.assertCanRead(input.role, input.userId, order.userId);
    if (order.provider === "MANUAL_BANK") {
      throw new AppError("Top up manual dibayar lewat transfer bank, bukan gateway.", StatusCodes.CONFLICT, "WALLET_TOPUP_ORDER_NOT_PAYABLE");
    }
    if (order.status !== "PENDING") {
      throw new AppError("Only pending top-up orders can be paid", StatusCodes.CONFLICT, "WALLET_TOPUP_ORDER_NOT_PAYABLE");
    }
    return order;
  }

  async createMidtransPayment(input: { userId: string; role: UserRole; orderId: string }) {
    const order = await this.loadPayableOrder(input);

    const metadata = this.asObject(order.metadata);
    if (order.provider === "MIDTRANS" && typeof metadata.snapToken === "string" && typeof metadata.redirectUrl === "string") {
      return {
        snapToken: metadata.snapToken,
        redirectUrl: metadata.redirectUrl,
        orderId: order.id,
        reference: order.reference,
      };
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: order.userId },
      select: { fullName: true, email: true, phone: true },
    });

    const snapResponse = await this.createSnapTransaction({
      transaction_details: {
        order_id: order.reference,
        gross_amount: Number(new Prisma.Decimal(order.amount).toFixed(0)),
      },
      enabled_payments: REFUNDABLE_PAYMENT_METHODS,
      customer_details: {
        first_name: user.fullName,
        email: user.email ?? undefined,
        phone: user.phone,
      },
      item_details: [
        {
          id: "wallet-topup",
          price: Number(new Prisma.Decimal(order.amount).toFixed(0)),
          quantity: 1,
          name: "Top Up TapGoPay",
        },
      ],
    });

    const snapToken = snapResponse.token;
    const redirectUrl = snapResponse.redirect_url;
    if (!snapToken || !redirectUrl) {
      throw new AppError(
        "Midtrans did not return a usable Snap transaction",
        StatusCodes.BAD_GATEWAY,
        "MIDTRANS_SNAP_RESPONSE_INVALID",
      );
    }

    await this.walletRepository.updateTopUpOrderPaymentMetadata({
      orderId: order.id,
      method: "MIDTRANS_SNAP",
      provider: "MIDTRANS",
      providerReference: order.reference,
      metadata: { snapToken, redirectUrl, midtransOrderId: order.reference, sandbox: !env.MIDTRANS_IS_PRODUCTION },
    });

    return { snapToken, redirectUrl, orderId: order.id, reference: order.reference };
  }

  async createDokuPayment(input: { userId: string; role: UserRole; orderId: string }) {
    const order = await this.loadPayableOrder(input);

    const metadata = this.asObject(order.metadata);
    if (order.provider === "DOKU" && typeof metadata.paymentUrl === "string") {
      return {
        paymentUrl: metadata.paymentUrl,
        redirectUrl: metadata.paymentUrl,
        orderId: order.id,
        reference: order.reference,
      };
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: order.userId },
      select: { fullName: true, email: true, phone: true },
    });

    const amount = Number(new Prisma.Decimal(order.amount).toFixed(0));
    const payment = await this.dokuClient.createPayment({
      order: {
        amount,
        invoice_number: order.reference,
        currency: "IDR",
        auto_redirect: false,
        line_items: [{ id: "wallet-topup", name: "Top Up TapGoPay", quantity: 1, price: amount }],
      },
      payment: { payment_due_date: 1440 },
      customer: {
        id: order.userId,
        name: user.fullName,
        ...(user.email ? { email: user.email } : {}),
        ...(user.phone ? { phone: user.phone } : {}),
      },
    });

    await this.walletRepository.updateTopUpOrderPaymentMetadata({
      orderId: order.id,
      method: "DOKU_CHECKOUT",
      provider: "DOKU",
      providerReference: payment.referenceId,
      metadata: { gateway: "DOKU", paymentUrl: payment.paymentUrl, expiredAt: payment.expiredAt ?? null },
    });

    return { paymentUrl: payment.paymentUrl, redirectUrl: payment.paymentUrl, orderId: order.id, reference: order.reference };
  }

  /** Dipanggil dari webhook Midtrans bersama (lihat midtrans.routes.ts) hanya untuk order_id yang bukan invoice membership. */
  async handleMidtransNotification(payload: MidtransNotificationPayload) {
    verifyMidtransSignature(payload, env.MIDTRANS_SERVER_KEY);

    const order = await this.walletRepository.findTopUpOrderByReference(payload.order_id);
    if (!order) {
      throw new AppError("Midtrans wallet top-up order not found", StatusCodes.NOT_FOUND, "MIDTRANS_WALLET_TOPUP_ORDER_NOT_FOUND");
    }

    const transactionStatus = payload.transaction_status.toLowerCase();
    const fraudStatus = payload.fraud_status?.toLowerCase();
    const paymentReference = payload.transaction_id ?? payload.order_id;

    // Fraud screening SEBELUM keputusan sukses — persis urutan yang sama
    // dengan MidtransPaymentService.resolveNotificationStatus, dan untuk
    // alasan yang sama: "challenge" wajib ditinjau manual, "deny" terminal.
    if (["settlement", "capture"].includes(transactionStatus)) {
      if (fraudStatus === "challenge") {
        return { status: "PENDING", idempotent: order.status === "PENDING" };
      }
      if (fraudStatus === "deny") {
        await this.walletRepository.markTopUpOrderTerminal({ orderId: order.id, status: "FAILED", providerReference: paymentReference });
        return { status: "FAILED", idempotent: order.status !== "PENDING" };
      }

      assertAuthoritativeAmount({
        gateway: "Midtrans",
        codePrefix: "MIDTRANS",
        authoritativeAmount: order.amount,
        providedAmount: payload.gross_amount,
        ...(payload.currency !== undefined ? { providedCurrency: payload.currency } : {}),
      });

      const paid = await this.walletRepository.markTopUpOrderPaid({
        orderId: order.id,
        providerReference: paymentReference,
        ...(payload.payment_type ? { paymentType: payload.payment_type } : {})
      });
      this.notifyTopUpPaid(paid);
      return { status: "PAID", idempotent: paid === null, order: paid };
    }

    if (transactionStatus === "pending") {
      return { status: "PENDING", idempotent: order.status === "PENDING" };
    }

    const terminalStatus = transactionStatus === "expire" ? "EXPIRED" : transactionStatus === "cancel" ? "CANCELLED" : "FAILED";
    await this.walletRepository.markTopUpOrderTerminal({ orderId: order.id, status: terminalStatus, providerReference: paymentReference });
    return { status: terminalStatus, idempotent: order.status !== "PENDING" };
  }

  /** Dipanggil dari webhook DOKU bersama, hanya untuk invoice_number yang bukan invoice membership. */
  async handleDokuNotification(input: {
    payload: DokuNotificationPayload;
    signatureBody?: unknown;
    headers: { clientId?: string; requestId?: string; requestTimestamp?: string; signature?: string };
    requestTarget: string;
  }) {
    if (
      !this.dokuClient.verifyWebhookSignature({
        body: input.signatureBody ?? input.payload,
        requestTarget: input.requestTarget,
        headers: input.headers,
      })
    ) {
      throw new AppError("DOKU webhook signature is invalid", StatusCodes.UNAUTHORIZED, "DOKU_SIGNATURE_INVALID");
    }

    const reference = input.payload.order?.invoice_number;
    if (!reference) {
      throw new AppError("DOKU webhook invoice number is missing", StatusCodes.BAD_REQUEST, "DOKU_INVOICE_NUMBER_MISSING");
    }

    const order = await this.walletRepository.findTopUpOrderByReference(reference);
    if (!order) {
      throw new AppError("DOKU wallet top-up order not found", StatusCodes.NOT_FOUND, "DOKU_WALLET_TOPUP_ORDER_NOT_FOUND");
    }

    const rawStatus = (input.payload.transaction?.status ?? "PENDING").toUpperCase();
    const paymentReference = input.payload.transaction?.original_request_id ?? input.headers.requestId ?? reference;

    if (["SUCCESS", "PAID", "SETTLEMENT", "CAPTURE"].includes(rawStatus)) {
      assertAuthoritativeAmount({
        gateway: "DOKU",
        codePrefix: "DOKU",
        authoritativeAmount: order.amount,
        providedAmount: input.payload.order?.amount,
        ...(input.payload.order?.currency !== undefined ? { providedCurrency: input.payload.order.currency } : {}),
      });
      const paid = await this.walletRepository.markTopUpOrderPaid({ orderId: order.id, providerReference: paymentReference });
      this.notifyTopUpPaid(paid);
      return { status: "PAID", idempotent: paid === null, order: paid };
    }

    if (["PENDING", "INITIATED"].includes(rawStatus)) {
      return { status: "PENDING", idempotent: order.status === "PENDING" };
    }

    const terminalStatus = ["EXPIRED", "TIMEOUT"].includes(rawStatus)
      ? "EXPIRED"
      : ["CANCELLED", "CANCELED", "CANCEL"].includes(rawStatus)
        ? "CANCELLED"
        : "FAILED";
    await this.walletRepository.markTopUpOrderTerminal({ orderId: order.id, status: terminalStatus, providerReference: paymentReference });
    return { status: terminalStatus, idempotent: order.status !== "PENDING" };
  }

  private async createSnapTransaction(payload: Record<string, unknown>): Promise<MidtransSnapResponse> {
    const serverKey = env.MIDTRANS_SERVER_KEY;
    if (!serverKey) {
      throw new AppError("Midtrans server key is not configured", StatusCodes.SERVICE_UNAVAILABLE, "MIDTRANS_NOT_CONFIGURED");
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
      throw new AppError(body.error_messages?.join(", ") || "Midtrans Snap transaction failed", StatusCodes.BAD_GATEWAY, "MIDTRANS_SNAP_FAILED");
    }
    return body;
  }

  private asObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }
}
