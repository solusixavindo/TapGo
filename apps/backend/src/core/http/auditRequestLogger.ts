import { NextFunction, Request, Response } from "express";
import { auditLogger } from "../logger/logger.js";

/**
 * Mencatat setiap request ke rute admin/privileged ke file audit.log
 * terpisah dari error.log (lihat core/logger/logger.ts) — melengkapi, bukan
 * menggantikan, audit trail tabel AuditLog di database yang sudah jadi
 * sumber kebenaran utama untuk aksi spesifik (16+ pemanggil `auditLog.create`
 * tersebar di berbagai modul). Ini satu titik integrasi HTTP-level yang
 * menangkap SEMUA request admin — termasuk yang gagal di tahap otorisasi —
 * tanpa perlu menyentuh setiap service satu per satu.
 *
 * req.auth dibaca di dalam listener "finish" (bukan saat middleware ini
 * dipanggil), supaya nilainya sudah terisi oleh requireAuth di dalam router
 * spesifik yang dilewati request ini — middleware ini dipasang SEBELUM
 * router-router itu di app.ts.
 */
export function auditRequestLogger(req: Request, res: Response, next: NextFunction) {
  res.on("finish", () => {
    auditLogger.info(
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        adminUserId: req.auth?.userId ?? null,
        role: req.auth?.role ?? null
      },
      "admin request"
    );
  });
  next();
}
