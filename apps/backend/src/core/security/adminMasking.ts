import { NextFunction, Request, Response } from "express";

/**
 * Penyamaran data pribadi untuk operator (peran ADMIN).
 *
 * ADMIN memverifikasi dan membantu, tetapi tidak perlu memegang nomor HP atau
 * nomor rekening utuh. Penyamaran dilakukan di SATU tempat pada respons JSON,
 * berdasarkan nama kolom, sehingga endpoint baru tidak bisa lupa menyamarkan.
 * SUPER_ADMIN dan di atasnya menerima data utuh.
 *
 * Yang sengaja tidak disamarkan: isi dokumen KYC (harus terbaca untuk
 * verifikasi, dan setiap pembukaannya sudah tercatat di audit log) dan nama.
 */

const PHONE_KEYS = new Set(["phone", "recipientPhone"]);
const ACCOUNT_KEYS = new Set(["accountNumber"]);
const MAX_DEPTH = 12;

/** Contoh: 085863268373 -> 0858*****373 (4 awal dan 3 akhir tampak). */
export function maskPhone(value: string): string {
  const digits = value.trim();
  if (digits.length <= 7) return "*".repeat(digits.length);
  return `${digits.slice(0, 4)}${"*".repeat(digits.length - 7)}${digits.slice(-3)}`;
}

/** Contoh: 8830123456 -> ******3456 (4 akhir tampak). */
export function maskAccountNumber(value: string): string {
  const digits = value.trim();
  if (digits.length <= 4) return "*".repeat(digits.length);
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Menyalin struktur data dan menyamarkan kolom sensitif; tidak mengubah aslinya. */
export function maskSensitiveFields(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((item) => maskSensitiveFields(item, depth + 1));
  }
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner === "string" && PHONE_KEYS.has(key)) {
      result[key] = maskPhone(inner);
    } else if (typeof inner === "string" && ACCOUNT_KEYS.has(key)) {
      result[key] = maskAccountNumber(inner);
    } else {
      result[key] = maskSensitiveFields(inner, depth + 1);
    }
  }
  return result;
}

/**
 * Middleware: hanya untuk peran ADMIN persis. Dipasang SETELAH requireAuth dan
 * requireRoles agar req.auth sudah terisi.
 */
export function maskForOperator(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.role !== "ADMIN") {
    next();
    return;
  }
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => originalJson(maskSensitiveFields(body))) as Response["json"];
  next();
}
