import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import {
  TOPUP_METHODS,
  availableTopUpMethods,
  customerTopUpFee,
  parseTopUpMethodList,
  gatewayFeeFor,
  isTopUpMethod,
  snapCodesFor,
  topUpOnlineFee,
  type TopUpMethod
} from "../../../core/finance/midtransFees.js";
import { isAdminRole } from "../../../core/security/roleHierarchy.js";
import { DokuClient } from "../../../lib/doku/client.js";
import { DokuNotificationPayload } from "../../../lib/doku/types.js";
import { assertAuthoritativeAmount } from "../../payments/application/authoritativeAmount.js";
import { resolveMidtransEnabledPayments, snapFinishCallbackPart } from "../../payments/application/MidtransPaymentService.js";
import { verifyMidtransSignature } from "../../payments/application/midtransSignature.js";
import { lazyPushNotifier } from "../../notifications/application/pushServiceFactory.js";
import { accountPushMessages, pushQuietly } from "../../notifications/application/accountNotifications.js";
import type { PushNotifier } from "../../notifications/application/rideNotifications.js";
import { PrismaWalletRepository } from "../infrastructure/PrismaWalletRepository.js";
import { minimumAmountFor, topUpTargetOf, type TopUpTarget } from "./ManualTopUpService.js";

const MAX_OPEN_ONLINE_ORDERS_PER_USER = 3;
const ONLINE_ORDER_EXPIRY_MS = 24 * 3600_000;

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

  /** Nominal yang ditagihkan gateway: nominal top up + biaya layanan bila ditanggung pelanggan. */
  private chargedAmount(order: { amount: Prisma.Decimal; metadata: Prisma.JsonValue | null }): Prisma.Decimal {
    const gross = this.asObject(order.metadata).grossAmount;
    return typeof gross === "number" && Number.isInteger(gross) && gross >= Number(order.amount)
      ? new Prisma.Decimal(gross)
      : new Prisma.Decimal(order.amount);
  }

  /** Daftar `enabled_payments` yang berlaku (undefined = semua metode aktif di akun Midtrans). */
  private enabledPayments() {
    return resolveMidtransEnabledPayments(env.MIDTRANS_ENABLED_PAYMENTS);
  }

  /**
   * Metode yang ditawarkan: aktif menurut daftar Snap DAN dinyalakan untuk top up lewat WALLET_TOPUP_METHODS
   * (bawaan hanya transfer bank).
   */
  private offeredMethods(): TopUpMethod[] {
    const allowed = parseTopUpMethodList(env.WALLET_TOPUP_METHODS);
    return availableTopUpMethods(this.enabledPayments()).filter((method) => allowed.includes(method));
  }

  /** Pemilik akun punya profil driver (status apa pun): top up Saldo TapGo-nya menjadi komisi, jadi biaya dibatasi. */
  private async isDriverAccount(userId: string): Promise<boolean> {
    const profile = await this.prisma.rideDriverProfile.findUnique({ where: { userId }, select: { id: true } });
    return profile !== null;
  }

  /** Biaya yang ditagihkan ke pelanggan untuk kombinasi tujuan, metode, dan nominal ini. */
  private customerFeeFor(target: TopUpTarget, method: TopUpMethod, amount: number, payerIsDriver: boolean) {
    return customerTopUpFee({ target, method, amount, walletCap: env.WALLET_TOPUP_FEE_CAP, payerIsDriver });
  }

  /**
   * Opsi top up yang boleh ditawarkan halaman web saat ini. Bila `amount` dan `target` diberikan, tiap metode
   * disertai penawaran harga (biaya dan total) supaya pelanggan melihat biaya sebelum membayar.
   */
  async onlineOptions(query: { userId: string; amount?: number; target?: TopUpTarget }) {
    const payerIsDriver = await this.isDriverAccount(query.userId);
    const gatewayReady = env.DOKU_ENABLED || Boolean(env.MIDTRANS_SERVER_KEY);
    const methods = env.DOKU_ENABLED ? [] : this.offeredMethods();
    const quotes =
      query.amount !== undefined && query.target !== undefined && Number.isInteger(query.amount) && query.amount > 0
        ? methods.map((method) => {
            const fee = this.customerFeeFor(query.target!, method, query.amount!, payerIsDriver);
            return { method, fee, gross: query.amount! + fee };
          })
        : undefined;
    return {
      online: env.WALLET_TOPUP_ENABLED && gatewayReady,
      // Biaya transfer bank penuh; dipertahankan untuk halaman lama. Halaman baru memakai `quotes` per metode.
      onlineFee: env.DOKU_ENABLED ? 0 : topUpOnlineFee(),
      methods: methods.map((id) => ({ id, label: TOPUP_METHODS[id].label, description: TOPUP_METHODS[id].description })),
      ...(quotes ? { quotes } : {}),
      // Hanya untuk akun driver; akun lain membayar biaya penuh sehingga tidak ada batas yang perlu ditampilkan.
      walletFeeCap: payerIsDriver ? env.WALLET_TOPUP_FEE_CAP : null,
      // Persen komisi pesanan tunai, hanya untuk driver dan hanya bila komisi menyala: halaman top up memakainya untuk
      // menunjukkan seberapa banyak pesanan tunai yang dibuka oleh saldo yang diisi (nilai riil biaya Rp2.500 bagi driver).
      commissionPercent: payerIsDriver && env.DRIVER_COMMISSION_ENABLED ? env.DRIVER_COMMISSION_PERCENT : null,
      minimum: { WALLET: minimumAmountFor("WALLET"), PPOB: minimumAmountFor("PPOB") },
      maximum: env.MANUAL_TOPUP_MAX_AMOUNT,
    };
  }

  /** Metode terpilih untuk pesanan Midtrans: yang diminta bila tersedia, atau yang pertama tersedia bila tidak diminta. */
  private resolveMethod(requested: string | undefined | null): TopUpMethod {
    const available = this.offeredMethods();
    if (requested !== undefined && requested !== null && requested !== "") {
      if (!isTopUpMethod(requested) || !available.includes(requested)) {
        throw new AppError("Metode pembayaran itu belum tersedia.", StatusCodes.BAD_REQUEST, "WALLET_TOPUP_METHOD_UNAVAILABLE");
      }
      return requested;
    }
    const first = available[0];
    if (!first) {
      throw new AppError("Top up online belum tersedia.", StatusCodes.FORBIDDEN, "WALLET_TOPUP_DISABLED");
    }
    return first;
  }

  /**
   * Top up online dalam satu langkah: buat pesanan lalu siapkan pembayaran. Pelanggan membayar nominal
   * ditambah biaya layanan (Midtrans); saldo yang dikredit hanya nominal top up.
   */
  async createOnlineOrder(input: { userId: string; role: UserRole; amount: number; target: TopUpTarget; method?: string }) {
    if (!env.WALLET_TOPUP_ENABLED || !(env.DOKU_ENABLED || env.MIDTRANS_SERVER_KEY)) {
      throw new AppError("Top up online belum tersedia.", StatusCodes.FORBIDDEN, "WALLET_TOPUP_DISABLED");
    }
    const minimum = minimumAmountFor(input.target);
    if (!Number.isInteger(input.amount) || input.amount < minimum || input.amount > env.MANUAL_TOPUP_MAX_AMOUNT) {
      throw new AppError(
        `Nominal top up ${input.target === "PPOB" ? "Saldo PPOB" : "Saldo TapGo"} harus antara Rp${minimum.toLocaleString("id-ID")} dan Rp${env.MANUAL_TOPUP_MAX_AMOUNT.toLocaleString("id-ID")}.`,
        StatusCodes.BAD_REQUEST,
        "WALLET_TOPUP_AMOUNT_INVALID",
      );
    }
    const now = new Date();
    const open = await this.prisma.walletTopUpOrder.count({
      where: { userId: input.userId, status: "PENDING", provider: { in: ["MIDTRANS", "DOKU"] }, createdAt: { gt: new Date(now.getTime() - ONLINE_ORDER_EXPIRY_MS) } },
    });
    if (open >= MAX_OPEN_ONLINE_ORDERS_PER_USER) {
      throw new AppError(
        "Anda masih memiliki beberapa top up yang belum dibayar. Selesaikan atau tunggu kedaluwarsa dulu.",
        StatusCodes.TOO_MANY_REQUESTS,
        "WALLET_TOPUP_TOO_MANY_OPEN",
      );
    }
    // Metode dan biaya ditetapkan SEKARANG (sebelum pesanan dibuat) dan tersimpan di pesanan, sehingga yang ditagihkan
    // persis sama dengan yang ditampilkan ke pelanggan.
    const method = env.DOKU_ENABLED ? null : this.resolveMethod(input.method);
    const plannedFee = method ? this.customerFeeFor(input.target, method, input.amount, await this.isDriverAccount(input.userId)) : 0;
    const order = await this.walletRepository.createTopUpOrder({
      userId: input.userId,
      amount: new Prisma.Decimal(input.amount),
      metadata: {
        target: input.target,
        baseAmount: input.amount,
        ...(method ? { method, feeAmount: plannedFee, grossAmount: input.amount + plannedFee } : {}),
      },
      expiresAt: new Date(now.getTime() + ONLINE_ORDER_EXPIRY_MS),
    });
    const payInput = { userId: input.userId, role: input.role, orderId: order.id };
    try {
      const payment = env.DOKU_ENABLED
        ? await this.createDokuPayment(payInput)
        : await this.createMidtransPayment(payInput);
      const feeAmount = plannedFee;
      return {
        id: order.id,
        reference: order.reference,
        target: input.target,
        method,
        baseAmount: input.amount,
        feeAmount,
        grossAmount: input.amount + feeAmount,
        redirectUrl: payment.redirectUrl,
        expiresAt: order.expiresAt,
      };
    } catch (error) {
      // Pesanan tanpa tautan bayar tidak boleh menumpuk dan menghabiskan jatah pesanan terbuka.
      await this.walletRepository.markTopUpOrderTerminal({ orderId: order.id, status: "FAILED" });
      throw error;
    }
  }

  /** Ringkasan pesanan untuk halaman status: nominal dasar, biaya, dan tujuan. */
  orderSummary(order: { id: string; reference: string; status: string; provider: string | null; amount: Prisma.Decimal; metadata: Prisma.JsonValue | null; paidAt: Date | null; createdAt: Date }) {
    const meta = this.asObject(order.metadata);
    const online = order.provider === "MIDTRANS" || order.provider === "DOKU";
    const resumeUrl = typeof meta.redirectUrl === "string" ? meta.redirectUrl : typeof meta.paymentUrl === "string" ? meta.paymentUrl : null;
    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      online,
      // Pelanggan yang menutup halaman bayar dapat melanjutkan selama pesanan masih menunggu.
      resumeUrl: online && order.status === "PENDING" ? resumeUrl : null,
      target: topUpTargetOf(order.metadata),
      method: isTopUpMethod(meta.method) ? meta.method : null,
      baseAmount: Number(order.amount),
      feeAmount: typeof meta.feeAmount === "number" ? meta.feeAmount : 0,
      grossAmount: Number(this.chargedAmount(order)),
      paidAt: order.paidAt,
      createdAt: order.createdAt,
    };
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

    // Yang dibayar di Midtrans = nominal top up + biaya layanan pelanggan, sedangkan saldo yang dikredit tetap nominal
    // top up (order.amount). Metode dan biaya sudah ditetapkan saat pesanan dibuat; pesanan dari jalur lama (buat lalu
    // bayar) belum memilikinya, jadi dihitung di sini dengan metode pertama yang tersedia.
    const baseAmount = Number(new Prisma.Decimal(order.amount).toFixed(0));
    const method = this.resolveMethod(typeof metadata.method === "string" ? metadata.method : undefined);
    const storedFee = metadata.feeAmount;
    const feeAmount =
      typeof storedFee === "number" && Number.isInteger(storedFee) && storedFee >= 0 && metadata.method === method
        ? storedFee
        : this.customerFeeFor(topUpTargetOf(order.metadata), method, baseAmount, await this.isDriverAccount(order.userId));
    const grossAmount = baseAmount + feeAmount;
    const snapCodes = snapCodesFor(method, this.enabledPayments());
    if (snapCodes.length === 0) {
      throw new AppError("Metode pembayaran itu belum tersedia.", StatusCodes.BAD_REQUEST, "WALLET_TOPUP_METHOD_UNAVAILABLE");
    }
    const gatewayFeeEstimate = gatewayFeeFor(method, grossAmount);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: order.userId },
      select: { fullName: true, email: true, phone: true },
    });

    const snapResponse = await this.createSnapTransaction({
      transaction_details: {
        order_id: order.reference,
        gross_amount: grossAmount,
      },
      enabled_payments: snapCodes,
      ...snapFinishCallbackPart("/topup/status/"),
      customer_details: {
        first_name: user.fullName,
        email: user.email ?? undefined,
        phone: user.phone,
      },
      item_details: [
        {
          id: "wallet-topup",
          price: baseAmount,
          quantity: 1,
          name: "Top Up TapGoPay",
        },
        ...(feeAmount > 0 ? [{ id: "payment-fee", price: feeAmount, quantity: 1, name: "Biaya layanan pembayaran" }] : []),
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
      metadata: {
        ...metadata,
        snapToken,
        redirectUrl,
        midtransOrderId: order.reference,
        sandbox: !env.MIDTRANS_IS_PRODUCTION,
        baseAmount,
        feeAmount,
        grossAmount,
        method,
        // Perkiraan biaya Midtrans untuk total ini; biaya sebenarnya dihitung ulang dari metode yang benar-benar
        // dibayar. Selisih di atas feeAmount ditanggung perusahaan (lihat Laba Rugi).
        gatewayFeeEstimate: gatewayFeeEstimate.toFixed(2),
        feeBorneByCustomer: feeAmount >= gatewayFeeEstimate.toNumber(),
      } as Prisma.InputJsonValue,
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
        authoritativeAmount: this.chargedAmount(order),
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
      // Catat metode yang dipilih pembeli (VA, Mandiri Bill, dll.) supaya pemantauan di konsol admin menampilkannya
      // walau pembayaran belum lunas. Hanya menambah metadata; status tetap PENDING.
      const metadata = this.asObject(order.metadata);
      if (order.status === "PENDING" && payload.payment_type && metadata.paymentType !== payload.payment_type) {
        await this.walletRepository.updateTopUpOrderPaymentMetadata({
          orderId: order.id,
          method: order.method ?? "MIDTRANS_SNAP",
          provider: order.provider ?? "MIDTRANS",
          providerReference: order.providerReference ?? order.reference,
          metadata: { ...metadata, paymentType: payload.payment_type } as Prisma.InputJsonValue,
        });
      }
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
