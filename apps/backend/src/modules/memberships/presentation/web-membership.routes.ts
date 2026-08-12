import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { DokuPaymentService } from "../../payments/application/DokuPaymentService.js";
import { MidtransPaymentService } from "../../payments/application/MidtransPaymentService.js";
import { MembershipOrderService } from "../application/MembershipOrderService.js";
import { MembershipOrderController } from "./membership-order.controller.js";
import {
  createMembershipOrderSchema,
  membershipOrderDetailSchema,
  payMembershipOrderSchema
} from "./membership.validators.js";

/**
 * Kanal web untuk pembelian membership (Stage R2.6 jalur A).
 *
 * Pembelian membership terjadi di web, bukan di dalam aplikasi mobile. Aplikasi
 * yang diunggah ke Google Play hanya menampilkan paket aktif, tanpa jalan
 * membeli dan tanpa tautan keluar — mengarahkan pengguna ke pembayaran luar
 * dari dalam app melanggar aturan anti-steering.
 *
 * Namespace terpisah dipilih supaya kebijakan kanal terbaca dari peta rute,
 * bukan tersembunyi di dalam controller. Perlu dicatat jujur: namespace adalah
 * pemisahan yang RAPI, bukan batas keamanan — klien yang dimodifikasi tetap
 * dapat memanggil rute ini. Penegakan sungguhan menuntut klaim kanal pada
 * token, dan itu digabung ke pengetatan Auth pada Stage R2.9. Untuk kepatuhan
 * Play ini memadai, karena yang dinilai adalah apa yang aplikasi TAMPILKAN.
 *
 * Sengaja TIDAK diekspos di sini:
 * - `/orders/:id/payment-success` — simulator pembayaran; aktivasi hanya boleh
 *   berasal dari webhook penyedia pembayaran, bukan dari klien.
 */
const service = new MembershipOrderService(prisma);
const controller = new MembershipOrderController(
  service,
  () => new MidtransPaymentService(prisma, service),
  () => new DokuPaymentService(prisma, service),
  "WEB",
);

export const webMembershipRouter = Router();

// Daftar paket dapat dibaca tanpa login agar halaman harga di web dapat dibuka
// publik. Visibilitas paket berbayar tetap mengikuti kebijakan kanal.
webMembershipRouter.get("/packages", asyncHandler(controller.packages));

webMembershipRouter.use(requireAuth);
webMembershipRouter.get("/me", asyncHandler(controller.me));
webMembershipRouter.get("/orders/me", asyncHandler(controller.myOrders));
webMembershipRouter.post(
  "/orders",
  validateRequest(createMembershipOrderSchema),
  asyncHandler(controller.createOrder),
);
webMembershipRouter.post(
  "/orders/:id/pay",
  validateRequest(payMembershipOrderSchema),
  asyncHandler(controller.pay),
);
webMembershipRouter.get(
  "/orders/:id",
  validateRequest(membershipOrderDetailSchema),
  asyncHandler(controller.order),
);
