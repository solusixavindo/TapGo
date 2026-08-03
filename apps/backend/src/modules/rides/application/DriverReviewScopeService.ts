import { AdminScope, Prisma, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

/**
 * Otorisasi review driver yang otoritatif dari database.
 *
 * Role SAJA tidak pernah cukup, dan role dari JWT tidak pernah dipercaya untuk
 * keputusan akhir. Setiap operasi review membaca ulang `User.role` dan
 * `User.status` dari database, lalu menuntut grant scope yang aktif.
 * `requireRoles` pada router hanya penyaring kasar: ia menutup pintu lebih awal
 * dan tidak pernah memberi kewenangan.
 *
 * Konsekuensinya penurunan role maupun pencabutan scope berlaku pada request
 * berikutnya — termasuk terhadap access token lama yang masih valid, karena
 * token tidak pernah membawa role efektif maupun scope. Scope juga tidak
 * mengenal wildcard: tipenya enum, sehingga nilai di luar daftar mustahil
 * tersimpan.
 */

export const DRIVER_REVIEW_SCOPE_REQUIRED = "DRIVER_REVIEW_SCOPE_REQUIRED";
export const DRIVER_REVIEW_ACCOUNT_INACTIVE = "DRIVER_REVIEW_ACCOUNT_INACTIVE";
export const DRIVER_REVIEW_ROLE_REQUIRED = "DRIVER_REVIEW_ROLE_REQUIRED";

/** Role yang boleh dipertimbangkan. Bukan pemberi kewenangan. */
const REVIEWER_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);

export const SCOPE_AUDIT_ALLOWED_ACTION = "admin.scope.checked";
export const SCOPE_AUDIT_DENIED_ACTION = "admin.scope.denied";

/** Alasan penolakan yang dibatasi. Ikut ke audit, jadi tidak boleh teks bebas. */
export type ScopeDenialReason =
  | "SCOPE_MISSING"
  | "SCOPE_REVOKED"
  | "ACCOUNT_INACTIVE"
  | "ROLE_NOT_ELIGIBLE"
  | "SUBJECT_NOT_FOUND";

/**
 * Kunci yang boleh muncul pada metadata audit scope.
 *
 * Daftar ini DITEGAKKAN saat penulisan, bukan hanya didokumentasikan: metadata
 * dibangun ulang dari daftar ini sehingga field tak terduga mustahil ikut
 * tersimpan.
 */
export const SCOPE_AUDIT_METADATA_KEYS = [
  "scope",
  "outcome",
  "reasonCode",
  "applicationId"
] as const;

type ScopeAuditMetadata = {
  scope: AdminScope;
  outcome: "ALLOWED" | "DENIED";
  reasonCode?: ScopeDenialReason;
  applicationId?: string;
};

export type ScopeCheckResult = {
  userId: string;
  scope: AdminScope;
  grantId: string;
};

export class DriverReviewScopeService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Memastikan pemanggil boleh memakai satu scope tertentu.
   *
   * Urutan disengaja: keberadaan dan status akun lebih dulu, lalu role dari
   * DATABASE, baru grant. Akun yang tidak aktif tidak boleh dapat menyimpulkan
   * apa pun tentang scope yang dimilikinya.
   *
   * `auditAllowed` dipisah agar hanya operasi yang MENGUBAH state menulis event
   * ALLOWED. Pembacaan antrian tidak menghasilkan event sukses, supaya audit
   * tidak tenggelam oleh polling.
   */
  async requireScope(
    userId: string,
    scope: AdminScope,
    options: { applicationId?: string; auditAllowed?: boolean } = {}
  ): Promise<ScopeCheckResult> {
    const applicationId = options.applicationId;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true }
    });

    if (!user) {
      await this.writeScopeAudit(userId, {
        scope,
        outcome: "DENIED",
        reasonCode: "SUBJECT_NOT_FOUND",
        ...(applicationId ? { applicationId } : {})
      });
      throw this.scopeRequired();
    }

    if (user.status !== "ACTIVE") {
      await this.writeScopeAudit(userId, {
        scope,
        outcome: "DENIED",
        reasonCode: "ACCOUNT_INACTIVE",
        ...(applicationId ? { applicationId } : {})
      });
      throw new AppError(
        "Akun tidak aktif.",
        StatusCodes.FORBIDDEN,
        DRIVER_REVIEW_ACCOUNT_INACTIVE
      );
    }

    // Role dibaca dari DATABASE, bukan dari klaim token. Admin yang diturunkan
    // menjadi USER kehilangan akses pada request berikutnya meski masih
    // memegang token lama yang sah.
    if (!REVIEWER_ROLES.has(user.role)) {
      await this.writeScopeAudit(userId, {
        scope,
        outcome: "DENIED",
        reasonCode: "ROLE_NOT_ELIGIBLE",
        ...(applicationId ? { applicationId } : {})
      });
      // Kode terpisah agar penyebabnya jelas bagi operator, tanpa
      // membocorkan role internal yang sedang berlaku.
      throw new AppError(
        "Kewenangan review driver tidak tersedia.",
        StatusCodes.FORBIDDEN,
        DRIVER_REVIEW_ROLE_REQUIRED
      );
    }

    const grants = await this.prisma.adminScopeGrant.findMany({
      where: { userId, scope },
      select: { id: true, status: true },
      orderBy: { createdAt: "desc" }
    });

    const active = grants.find((grant) => grant.status === "ACTIVE");
    if (!active) {
      await this.writeScopeAudit(userId, {
        scope,
        outcome: "DENIED",
        // Dibedakan agar operator dapat melihat perbedaan antara scope yang
        // belum pernah diberikan dan scope yang sengaja dicabut.
        reasonCode: grants.length > 0 ? "SCOPE_REVOKED" : "SCOPE_MISSING",
        ...(applicationId ? { applicationId } : {})
      });
      throw this.scopeRequired();
    }

    if (options.auditAllowed) {
      await this.writeScopeAudit(userId, {
        scope,
        outcome: "ALLOWED",
        ...(applicationId ? { applicationId } : {})
      });
    }

    return { userId, scope, grantId: active.id };
  }

  /**
   * Kelayakan seorang target menjadi penerima reassignment.
   *
   * Role target juga dibaca dari database: kewenangan pemanggil tidak menular,
   * dan target yang sudah diturunkan rolenya tidak layak menerima klaim.
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

  private scopeRequired(): AppError {
    return new AppError(
      "Kewenangan review driver tidak tersedia.",
      StatusCodes.FORBIDDEN,
      DRIVER_REVIEW_SCOPE_REQUIRED
    );
  }

  /**
   * Menulis event audit scope memakai infrastruktur AuditLog yang sudah ada.
   * Tidak ada sistem audit kedua.
   *
   * Metadata dibangun ulang dari allowlist sehingga hanya kunci terdaftar dapat
   * tersimpan — nol token, nol PII, nol pesan exception.
   *
   * Ditulis di LUAR transaksi mutasi dan SEBELUM mutasi terjadi: bila penulisan
   * audit gagal, operasi berhenti dan lease tidak berubah sama sekali.
   */
  private async writeScopeAudit(actorId: string, metadata: ScopeAuditMetadata) {
    const safe: Record<string, unknown> = {};
    for (const key of SCOPE_AUDIT_METADATA_KEYS) {
      const value = metadata[key];
      if (value !== undefined) {
        safe[key] = value;
      }
    }

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action:
          metadata.outcome === "ALLOWED"
            ? SCOPE_AUDIT_ALLOWED_ACTION
            : SCOPE_AUDIT_DENIED_ACTION,
        entityType: "AdminScopeGrant",
        ...(metadata.applicationId ? { entityId: metadata.applicationId } : {}),
        metadata: safe as Prisma.InputJsonValue
      }
    });
  }
}
