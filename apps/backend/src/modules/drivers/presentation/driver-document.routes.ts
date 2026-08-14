import express, { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { requireAuth } from "../../../core/security/authContext.js";
import { DriverDocumentService } from "../application/DriverDocumentService.js";
import { DriverDocumentController } from "./driver-document.controller.js";

const prisma = new PrismaClient();
const controller = new DriverDocumentController(new DriverDocumentService(prisma));

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

export const driverDocumentRouter = Router();

driverDocumentRouter.use(requireAuth);

/**
 * Tidak ada requireRoles di sini, dan itu disengaja.
 *
 * Yang menentukan bukan peran pada token, melainkan ada atau tidaknya profil
 * driver milik pengguna tersebut — diperiksa di dalam service lewat userId.
 * Menyaring dengan peran justru menyesatkan: peran dapat berubah tanpa profil
 * driver ikut ada, dan profil driver adalah satu-satunya hal yang membuat
 * unggahan dokumen ini berarti.
 */
driverDocumentRouter.get("/", asyncHandler(controller.myDocuments));
driverDocumentRouter.post(
  "/:type",
  rawImageBody,
  asyncHandler(controller.upload)
);
