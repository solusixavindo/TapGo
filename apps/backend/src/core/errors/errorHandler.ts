import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { StatusCodes } from "http-status-codes";
import { AppError } from "./AppError.js";
import { logger } from "../logger/logger.js";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(`Route ${req.method} ${req.path} not found`, StatusCodes.NOT_FOUND, "ROUTE_NOT_FOUND"));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: error.flatten()
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message
    });
  }

  // Kesalahan klien dari middleware (body-parser: JSON rusak = 400, badan terlalu besar = 413, charset/encoding tak didukung =
  // 415/400). Dulu semuanya jatuh ke 500 "Unexpected server error" DAN dicatat sebagai galat server, jadi satu permintaan
  // rusak (atau banjir permintaan rusak) memenuhi Sentry dan log, dan klien (mis. unggahan foto di landing) salah menafsirkan
  // kegagalan. Pesan asli middleware tidak diteruskan ke klien.
  const clientError = error as { status?: unknown; statusCode?: unknown; type?: unknown } | null;
  const clientStatus = typeof clientError?.status === "number" ? clientError.status : clientError?.statusCode;
  if (typeof clientStatus === "number" && clientStatus >= 400 && clientStatus < 500) {
    const known: Record<number, { code: string; message: string }> = {
      400: { code: "BAD_REQUEST", message: "Permintaan tidak dapat dibaca. Periksa format data yang dikirim." },
      413: { code: "PAYLOAD_TOO_LARGE", message: "Ukuran data yang dikirim terlalu besar." },
      415: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Jenis data yang dikirim tidak didukung." }
    };
    const mapped = known[clientStatus] ?? { code: "BAD_REQUEST", message: "Permintaan tidak dapat diproses." };
    return res.status(clientStatus).json({ success: false, code: mapped.code, message: mapped.message });
  }

  // logger.error otomatis meneruskan ke Sentry lewat hook di
  // core/logger/logger.ts — hanya kegagalan tak terduga (bukan AppError/
  // ZodError di atas, itu kegagalan bisnis yang memang terduga) yang sampai
  // ke titik ini sama sekali.
  logger.error({ error, path: req.path }, "Unhandled application error");

  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    success: false,
    code: "INTERNAL_SERVER_ERROR",
    message: "Unexpected server error"
  });
}
