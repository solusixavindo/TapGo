import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { MembershipOrderService } from "../application/MembershipOrderService.js";
import { MidtransPaymentService } from "../../payments/application/MidtransPaymentService.js";
import { DokuPaymentService } from "../../payments/application/DokuPaymentService.js";
import {
  MembershipPurchaseChannel,
  membershipPurchaseEnabled,
  paidMembershipVisible
} from "../application/purchaseChannel.js";

type PaymentServiceFactory<T> = () => T;

export class MembershipOrderController {
  /**
   * Kanal controller ini melayani.
   *
   * Satu kelas dipakai dua router: instance APP untuk aplikasi mobile dan
   * instance WEB untuk kanal web. Kanal ditetapkan saat konstruksi, bukan
   * dibaca dari header permintaan — header dikendalikan klien dan bukan batas
   * keamanan.
   */
  constructor(
    private readonly membershipOrderService: MembershipOrderService,
    private readonly midtransPaymentServiceFactory?: PaymentServiceFactory<MidtransPaymentService>,
    private readonly dokuPaymentServiceFactory?: PaymentServiceFactory<DokuPaymentService>,
    private readonly channel: MembershipPurchaseChannel = "APP",
  ) {}

  /**
   * Penjaga tunggal untuk pembelian membership.
   *
   * Pesannya menyebut kanal agar log dan dukungan dapat membedakan penolakan
   * pada aplikasi mobile dari penolakan pada web.
   */
  private assertPurchaseAllowed(appMessage: string, appCode: string) {
    if (membershipPurchaseEnabled(this.channel)) {
      return;
    }
    // Kode error per endpoint dipertahankan apa adanya. Aplikasi klien
    // memetakan kode ini, jadi menyatukannya menjadi satu kode baru akan
    // mengubah kontrak API tanpa alasan.
    if (this.channel === "APP") {
      throw new AppError(appMessage, StatusCodes.FORBIDDEN, appCode);
    }
    throw new AppError(
      "Pembelian membership belum tersedia pada kanal ini.",
      StatusCodes.FORBIDDEN,
      "MEMBERSHIP_PURCHASE_CHANNEL_DISABLED",
    );
  }

  packages = async (_req: Request, res: Response) => {
    const result = await this.membershipOrderService.listPackages();
    // Paket berbayar hanya terlihat pada kanal yang memang boleh membeli.
    // Menampilkan daftar harga di aplikasi mobile tanpa jalan membeli justru
    // mengundang pertanyaan anti-steering Google Play.
    const packages = paidMembershipVisible(this.channel)
      ? result
      : result.filter((item) => item.tier === "BASIC");
    res.json({ success: true, data: packages });
  };

  createOrder = async (req: Request, res: Response) => {
    this.assertPurchaseAllowed(
      "Upgrade membership berbayar tidak tersedia pada rilis Google Play.",
      "PAID_MEMBERSHIP_DISABLED_FOR_PLAY",
    );

    const result = await this.membershipOrderService.createOrder({
      userId: req.auth!.userId,
      packageId: req.body.packageId,
      channel: this.channel,
      ...(req.body.registrationData
        ? { registrationData: req.body.registrationData }
        : {}),
    });

    res.status(201).json({ success: true, data: result });
  };

  order = async (req: Request, res: Response) => {
    const result = await this.membershipOrderService.getOrder({
      userId: req.auth!.userId,
      role: req.auth!.role,
      orderId: String(req.params.id),
    });

    res.json({ success: true, data: result });
  };

  paymentSuccess = async (req: Request, res: Response) => {
    if (env.NODE_ENV === "production") {
      throw new AppError(
        "Development payment simulator is disabled in production",
        StatusCodes.FORBIDDEN,
        "PAYMENT_SIMULATOR_DISABLED",
      );
    }

    const result = await this.membershipOrderService.markPaymentSuccess({
      userId: req.auth!.userId,
      role: req.auth!.role,
      orderId: String(req.params.id),
      ...(typeof req.body?.paymentReference === "string"
        ? { paymentReference: req.body.paymentReference }
        : {}),
    });

    res.json({ success: true, data: result });
  };

  pay = async (req: Request, res: Response) => {
    this.assertPurchaseAllowed(
      "Pembayaran membership eksternal belum tersedia untuk rilis Google Play.",
      "EXTERNAL_MEMBERSHIP_PAYMENTS_DISABLED",
    );

    if (env.DOKU_ENABLED) {
      if (!this.dokuPaymentServiceFactory) {
        throw new Error("DOKU payment service is not configured");
      }

      const result = await this.dokuPaymentServiceFactory().createMembershipPayment({
        userId: req.auth!.userId,
        role: req.auth!.role,
        orderId: String(req.params.id),
      });

      res.json({ success: true, data: result });
      return;
    }

    if (!this.midtransPaymentServiceFactory) {
      throw new Error("Midtrans payment service is not configured");
    }

    // Tidak ada jalur "auto-paid" di sini, dan itu disengaja.
    //
    // Sebelumnya kegagalan MIDTRANS_NOT_CONFIGURED ditangkap dan order langsung
    // ditandai LUNAS lewat markPaymentSuccess dengan mode UAT_SANDBOX_AUTO_PAID,
    // digerbangi hanya oleh `!env.MIDTRANS_IS_PRODUCTION`. Flag itu bernilai
    // false secara bawaan dan tidak wajib ada di environment, sehingga satu
    // variabel yang terlupa saat menyalakan penjualan cukup untuk membuat
    // SETIAP pengguna dapat melunasi paket termahal tanpa membayar sepeser pun.
    //
    // Gerbang berbasis flag pembayaran juga keliru tempatnya: yang membedakan
    // simulator dari transaksi nyata adalah environment aplikasi, bukan mode
    // gateway. Simulator pembayaran yang sah sudah ada pada `paymentSuccess` di
    // berkas ini — menuntut token pemilik order DAN mati keras di production.
    //
    // Gateway yang belum dikonfigurasi kini muncul sebagai 503 yang jujur.
    const result = await this.midtransPaymentServiceFactory().createMembershipPayment({
      userId: req.auth!.userId,
      role: req.auth!.role,
      orderId: String(req.params.id),
    });

    res.json({ success: true, data: result });
  };

  me = async (req: Request, res: Response) => {
    const result = await this.membershipOrderService.getMyMembership(
      req.auth!.userId,
    );
    res.json({ success: true, data: result });
  };

  myOrders = async (req: Request, res: Response) => {
    const result = await this.membershipOrderService.listMyOrders(
      req.auth!.userId,
    );
    res.json({ success: true, data: result });
  };
}
