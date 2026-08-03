import { AdminScope, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

/**
 * Otorisasi review driver yang otoritatif dari database.
 *
 * Role SAJA tidak pernah cukup. ADMIN maupun SUPER_ADMIN tetap memerlukan
 * grant scope yang aktif; tidak ada bypass berbasis role di mana pun, dan
 * tidak ada wildcard karena scope berupa enum sehingga nilai di luar daftar
 * mustahil tersimpan.
 *
 * Pemeriksaan dilakukan pada SETIAP permintaan. Pencabutan karena itu berlaku
 * seketika, termasuk terhadap access token lama yang masih valid — token tidak
 * pernah membawa scope.
 */

export const DRIVER_REVIEW_SCOPE_REQUIRED = "DRIVER_REVIEW_SCOPE_REQUIRED";
export const DRIVER_REVIEW_ACCOUNT_INACTIVE = "DRIVER_REVIEW_ACCOUNT_INACTIVE";

/** Role yang boleh sama sekali dipertimbangkan. Bukan pemberi kewenangan. */
const REVIEWER_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

export type ScopeCheckResult = {
  userId: string;
  scope: AdminScope;
  grantId: string;
};

function scopeRequired(): AppError {
  return new AppError(
    "Kewenangan review driver tidak tersedia.",
    StatusCodes.FORBIDDEN,
    DRIVER_REVIEW_SCOPE_REQUIRED
  );
}

function accountInactive(): AppError {
  return new AppError(
    "Akun tidak aktif.",
    StatusCodes.FORBIDDEN,
    DRIVER_REVIEW_ACCOUNT_INACTIVE
  );
}

export class DriverReviewScopeService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Memastikan pemanggil boleh memakai satu scope tertentu.
   *
   * Urutan pemeriksaan disengaja: keberadaan dan status akun lebih dulu,
   * baru role, baru grant. Akun yang tidak aktif tidak boleh dapat
   * menyimpulkan apa pun tentang scope yang dimilikinya.
   */
  async requireScope(userId: string, scope: AdminScope): Promise<ScopeCheckResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true }
    });

    if (!user) {
      throw scopeRequired();
    }
    if (user.status !== "ACTIVE") {
      throw accountInactive();
    }
    // Role adalah SYARAT, bukan pemberi kewenangan. USER yang entah bagaimana
    // memperoleh grant tetap ditolak di sini.
    if (!REVIEWER_ROLES.has(user.role)) {
      throw scopeRequired();
    }

    const grant = await this.prisma.adminScopeGrant.findFirst({
      where: { userId, scope, status: "ACTIVE" },
      select: { id: true }
    });

    if (!grant) {
      throw scopeRequired();
    }

    return { userId, scope, grantId: grant.id };
  }

  /**
   * Kelayakan seorang target menjadi penerima reassignment.
   *
   * Dipisahkan dari requireScope karena kegagalannya berarti hal berbeda:
   * yang tidak layak adalah TARGET, bukan pemanggil.
   */
  async isEligibleReviewer(userId: string, scope: AdminScope): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true }
    });

    if (!user || user.status !== "ACTIVE" || !REVIEWER_ROLES.has(user.role)) {
      return false;
    }

    const grant = await this.prisma.adminScopeGrant.findFirst({
      where: { userId, scope, status: "ACTIVE" },
      select: { id: true }
    });

    return grant !== null;
  }
}
