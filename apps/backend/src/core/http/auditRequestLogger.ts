import { NextFunction, Request, Response } from "express";
import { isAdminRole } from "../security/roleHierarchy.js";
import { auditLogger, logger } from "../logger/logger.js";
import { buildAdminRequestRecord } from "./adminActivity.js";

/**
 * Mencatat setiap request ke rute admin/privileged ke file audit.log (stdout + berkas) DAN, untuk akun admin yang sudah
 * masuk, ke tabel audit_logs sebagai baris ADMIN_REQUEST yang rinci (siapa, apa, kapan, dari mana, hasilnya, isian
 * yang dikirim dengan rahasia disamarkan). Baris inilah yang dibaca pemilik di Log Aktivitas.
 *
 * req.auth dibaca di dalam listener "finish" (bukan saat middleware ini dipanggil), supaya nilainya sudah terisi oleh
 * requireAuth di dalam router yang dilewati request ini — middleware ini dipasang SEBELUM router-router itu di app.ts.
 *
 * Penulisan ke database tidak boleh memperlambat atau menggagalkan request: dijalankan tanpa menunggu, dan kegagalan
 * hanya dicatat ke log kesalahan.
 */
type Persist = (data: {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  ipAddress?: string;
}) => Promise<unknown>;

async function defaultPersist(data: Parameters<Persist>[0]) {
  const { prisma } = await import("../../config/prisma.js");
  const { ipAddress, ...rest } = data;
  try {
    await prisma.auditLog.create({ data: { ...rest, metadata: rest.metadata as never, ...(ipAddress ? { ipAddress } : {}) } });
  } catch {
    // Alamat yang tidak berbentuk IP sah: catat tanpa alamat.
    await prisma.auditLog.create({ data: { ...rest, metadata: rest.metadata as never } });
  }
}

let persist: Persist = defaultPersist;
/** Hanya untuk tes. */
export function setAuditPersist(fn: Persist | null) {
  persist = fn ?? defaultPersist;
}

export function auditRequestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = process.hrtime.bigint();
  // Rujukan ke isian asli: validateRequest kelak mengganti req.body dengan versi yang sudah dibersihkan skema.
  const rawBody = req.body;
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
    const auth = req.auth;
    if (!auth || !isAdminRole(auth.role)) return;
    const record = buildAdminRequestRecord(
      req,
      res.statusCode,
      Number(process.hrtime.bigint() - startedAt) / 1e6,
      auth.userId,
      Date.now(),
      rawBody
    );
    if (!record) return;
    void persist({ actorId: auth.userId, ...record, ...(req.ip ? { ipAddress: req.ip } : {}) }).catch((error: unknown) =>
      logger.error({ err: error, action: record.action }, "gagal menyimpan catatan aktivitas admin")
    );
  });
  next();
}
