import express, { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireChannel } from "../../../core/security/authContext.js";
import { DokuPaymentService } from "../../payments/application/DokuPaymentService.js";
import { MidtransPaymentService } from "../../payments/application/MidtransPaymentService.js";
import { MembershipDocumentService } from "../application/MembershipDocumentService.js";
import { MembershipOrderService } from "../application/MembershipOrderService.js";
import { MembershipDocumentController } from "./membership-document.controller.js";
import { MembershipOrderController } from "./membership-order.controller.js";
import {
  createMembershipOrderSchema,
  membershipDocumentListSchema,
  membershipDocumentUploadSchema,
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

const documentService = new MembershipDocumentService(prisma);
const documentController = new MembershipDocumentController(documentService);

/**
 * Berkas gambar dikirim mentah, bukan base64 di dalam JSON.
 *
 * Base64 membengkakkan muatan sekitar sepertiga dan memaksa menaikkan batas
 * parser JSON global — batas itu melindungi SELURUH endpoint lain, jadi tidak
 * layak dilonggarkan hanya demi unggahan dokumen. Parser mentah ini hanya
 * dipasang pada satu rute dan hanya menerima dua content-type.
 */
const rawImageBody = express.raw({
  type: ["image/png", "image/jpeg"],
  limit: "6mb"
});

export const webMembershipRouter = Router();

// Daftar paket dapat dibaca tanpa login agar halaman harga di web dapat dibuka
// publik. Visibilitas paket berbayar tetap mengikuti kebijakan kanal.
webMembershipRouter.get("/packages", asyncHandler(controller.packages));

// Penegakan kanal (R2.9): rute-rute di bawah ini hanya boleh dipanggil dengan
// token ber-klaim "WEB". Token app Play Store ditolak 403 — pembelian
// membership dari dalam app bukan hanya disembunyikan di UI, melainkan ditutup
// di batas keamanan, sesuai catatan anti-steering di atas.
webMembershipRouter.use(requireAuth, requireChannel("WEB"));
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
webMembershipRouter.post(
  "/orders/:id/documents/:type",
  rawImageBody,
  validateRequest(membershipDocumentUploadSchema),
  asyncHandler(documentController.upload),
);
webMembershipRouter.get(
  "/orders/:id/documents",
  validateRequest(membershipDocumentListSchema),
  asyncHandler(documentController.myDocuments),
);
