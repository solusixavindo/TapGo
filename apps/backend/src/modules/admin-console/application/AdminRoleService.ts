import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { isTopLevelRole } from "../../../core/security/roleHierarchy.js";

/**
 * Pengelolaan role admin oleh pemilik sistem.
 *
 * Hanya SUPER_ADMIN_VIP yang boleh menaikkan, menurunkan, atau mengganti role
 * ADMIN dan SUPER_ADMIN. SUPER_ADMIN sendiri TIDAK dapat mengubah role siapa
 * pun — itulah yang membedakan keduanya.
 *
 * Tiga hal yang tidak boleh dilewatkan saat membaca berkas ini:
 *
 * 1. Role puncak tidak pernah diberikan lewat HTTP. Endpoint ini hanya
 *    menerima USER, ADMIN, dan SUPER_ADMIN. Pemegang puncak hanya lahir dari
 *    CLI bootstrap, sama seperti kebijakan ADMIN_SCOPE_MANAGE.
 * 2. Perubahan role harus berlaku SEKETIKA. Token akses berumur 15 menit dan
 *    membawa klaim role di dalamnya, jadi tanpa mencabut sesi, admin yang baru
 *    diturunkan tetap memegang kewenangan lamanya selama itu. Karena itu
 *    authVersion dinaikkan dan seluruh sesi dicabut dalam transaksi yang sama.
 * 3. Menurunkan SUPER_ADMIN yang masih memegang ADMIN_SCOPE_MANAGE ditolak.
 *    Kalau dibiarkan, grant-nya tetap ACTIVE tetapi tidak lagi dihitung sebagai
 *    pengelola yang layak, sehingga sistem bisa diam-diam kehabisan pengelola
 *    scope. Cabut scope-nya lebih dulu, baru turunkan rolenya.
 */

// --- Kode error stabil -----------------------------------------------------

export const ADMIN_ROLE_ACTOR_NOT_TOP_LEVEL = "ADMIN_ROLE_ACTOR_NOT_TOP_LEVEL";
export const ADMIN_ROLE_ACTOR_INACTIVE = "ADMIN_ROLE_ACTOR_INACTIVE";
export const ADMIN_ROLE_TARGET_NOT_FOUND = "ADMIN_ROLE_TARGET_NOT_FOUND";
export const ADMIN_ROLE_TARGET_INACTIVE = "ADMIN_ROLE_TARGET_INACTIVE";
export const ADMIN_ROLE_TARGET_PROTECTED = "ADMIN_ROLE_TARGET_PROTECTED";
export const ADMIN_ROLE_SELF_CHANGE_FORBIDDEN = "ADMIN_ROLE_SELF_CHANGE_FORBIDDEN";
export const ADMIN_ROLE_NOT_ASSIGNABLE = "ADMIN_ROLE_NOT_ASSIGNABLE";
export const ADMIN_ROLE_UNCHANGED = "ADMIN_ROLE_UNCHANGED";
export const ADMIN_ROLE_DRIVER_NOT_ELIGIBLE = "ADMIN_ROLE_DRIVER_NOT_ELIGIBLE";
export const ADMIN_ROLE_SCOPE_STILL_HELD = "ADMIN_ROLE_SCOPE_STILL_HELD";
export const ADMIN_ROLE_REASON_INVALID = "ADMIN_ROLE_REASON_INVALID";

/** Role yang boleh diberikan lewat HTTP. SUPER_ADMIN_VIP sengaja tidak ada. */
export const ASSIGNABLE_ROLES: UserRole[] = ["USER", "ADMIN", "SUPER_ADMIN"];

/**
 * Daftar tertutup. Alasan ikut ke audit log, dan teks bebas di sana cepat
 * berubah menjadi tempat bocornya pesan exception atau PII.
 */
export const ROLE_REASON_CODES = [
  "NEW_ADMIN_ASSIGNMENT",
  "PROMOTION",
  "DEMOTION",
  "RESPONSIBILITY_CHANGE",
  "ACCESS_REMOVAL",
  "OFFBOARDING",
  "SECURITY_INCIDENT"
] as const;
export type RoleReasonCode = (typeof ROLE_REASON_CODES)[number];

export function isRoleReasonCode(value: unknown): value is RoleReasonCode {
  return typeof value === "string" && (ROLE_REASON_CODES as readonly string[]).includes(value);
}

export const ADMIN_ROLE_ACTIONS = {
  assigned: "ADMIN_ROLE_ASSIGNED",
  denied: "ADMIN_ROLE_ASSIGN_DENIED"
} as const;

const ADMIN_ROLES: UserRole[] = ["ADMIN", "SUPER_ADMIN", "SUPER_ADMIN_VIP"];

export class AdminRoleService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Seluruh akun yang saat ini memegang role administratif. */
  async listAdmins() {
    const users = await this.prisma.user.findMany({
      where: { role: { in: ADMIN_ROLES } },
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true
      },
      orderBy: [{ role: "desc" }, { fullName: "asc" }]
    });

    const manageGrants = await this.prisma.adminScopeGrant.findMany({
      where: { scope: "ADMIN_SCOPE_MANAGE", status: "ACTIVE" },
      select: { userId: true }
    });
    const managers = new Set(manageGrants.map((grant) => grant.userId));

    return users.map((user) => ({
      ...user,
      // Ditampilkan supaya pemilik tahu sebelum menurunkan seseorang bahwa
      // orang itu masih memegang kewenangan pengelolaan scope.
      holdsScopeManage: managers.has(user.id)
    }));
  }

  /** Kandidat untuk diangkat menjadi admin. Pencarian sempit, bukan dump user. */
  async searchCandidates(query: string) {
    const term = query.trim();
    if (term.length < 3) {
      return [];
    }

    return this.prisma.user.findMany({
      where: {
        role: "USER",
        status: "ACTIVE",
        OR: [
          { phone: { contains: term } },
          { referralCode: { contains: term, mode: "insensitive" } },
          { fullName: { contains: term, mode: "insensitive" } }
        ]
      },
      select: { id: true, fullName: true, phone: true, referralCode: true, role: true },
      take: 10,
      orderBy: { fullName: "asc" }
    });
  }

  async assignRole(input: {
    actorId: string;
    targetUserId: string;
    role: unknown;
    reasonCode: unknown;
  }) {
    if (!isRoleReasonCode(input.reasonCode)) {
      throw new AppError(
        "Kode alasan tidak dikenal.",
        StatusCodes.BAD_REQUEST,
        ADMIN_ROLE_REASON_INVALID
      );
    }
    const reasonCode = input.reasonCode;

    const nextRole = input.role as UserRole;
    if (!ASSIGNABLE_ROLES.includes(nextRole)) {
      // Termasuk SUPER_ADMIN_VIP: role puncak tidak pernah lewat HTTP.
      throw new AppError(
        "Role ini tidak dapat diberikan lewat konsol.",
        StatusCodes.BAD_REQUEST,
        ADMIN_ROLE_NOT_ASSIGNABLE
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Role aktor dibaca dari database, bukan dari klaim token. Token berumur
      // 15 menit; pemilik yang baru saja diturunkan tidak boleh masih bisa
      // mengubah role orang lain.
      const actor = await tx.user.findUnique({
        where: { id: input.actorId },
        select: { id: true, role: true, status: true }
      });

      if (!actor || !isTopLevelRole(actor.role)) {
        await this.writeDenied(input.actorId, input.targetUserId, reasonCode);
        throw new AppError(
          "Hanya pemegang role puncak yang dapat mengubah role.",
          StatusCodes.FORBIDDEN,
          ADMIN_ROLE_ACTOR_NOT_TOP_LEVEL
        );
      }
      if (actor.status !== "ACTIVE") {
        throw new AppError("Akun tidak aktif.", StatusCodes.FORBIDDEN, ADMIN_ROLE_ACTOR_INACTIVE);
      }

      if (input.targetUserId === actor.id) {
        // Mencegah pemilik mengunci dirinya sendiri keluar, dan mencegah
        // sistem kehilangan pemegang puncak terakhirnya.
        throw new AppError(
          "Role diri sendiri tidak dapat diubah dari konsol.",
          StatusCodes.CONFLICT,
          ADMIN_ROLE_SELF_CHANGE_FORBIDDEN
        );
      }

      const target = await tx.user.findUnique({
        where: { id: input.targetUserId },
        select: { id: true, fullName: true, role: true, status: true }
      });

      if (!target) {
        throw new AppError(
          "Akun tidak ditemukan.",
          StatusCodes.NOT_FOUND,
          ADMIN_ROLE_TARGET_NOT_FOUND
        );
      }
      if (isTopLevelRole(target.role)) {
        // Sesama pemegang puncak hanya dapat diturunkan lewat CLI, jalur yang
        // sama dengan yang menaikkannya.
        await this.writeDenied(actor.id, target.id, reasonCode);
        throw new AppError(
          "Akun role puncak hanya dapat diubah lewat CLI.",
          StatusCodes.FORBIDDEN,
          ADMIN_ROLE_TARGET_PROTECTED
        );
      }
      if (target.status !== "ACTIVE") {
        throw new AppError(
          "Akun target tidak aktif.",
          StatusCodes.CONFLICT,
          ADMIN_ROLE_TARGET_INACTIVE
        );
      }
      if (target.role === "DRIVER") {
        // Kewenangan driver berasal dari profil driver, bukan role. Menukar
        // role akun driver akan mengaburkan dua jalur yang sengaja terpisah.
        throw new AppError(
          "Akun driver tidak dapat diubah rolenya dari konsol.",
          StatusCodes.CONFLICT,
          ADMIN_ROLE_DRIVER_NOT_ELIGIBLE
        );
      }
      if (target.role === nextRole) {
        throw new AppError("Role tidak berubah.", StatusCodes.CONFLICT, ADMIN_ROLE_UNCHANGED);
      }

      // Penurunan dari SUPER_ADMIN sementara masih memegang manage-scope akan
      // menyisakan grant ACTIVE yang tidak lagi layak. Tolak, jangan diam-diam
      // mencabutnya: pencabutan scope punya alur audit sendiri.
      if (target.role === "SUPER_ADMIN" && nextRole !== "SUPER_ADMIN") {
        const manageGrant = await tx.adminScopeGrant.findFirst({
          where: { userId: target.id, scope: "ADMIN_SCOPE_MANAGE", status: "ACTIVE" },
          select: { id: true }
        });
        if (manageGrant) {
          await this.writeDenied(actor.id, target.id, reasonCode);
          throw new AppError(
            "Cabut dulu kewenangan pengelolaan scope milik akun ini.",
            StatusCodes.CONFLICT,
            ADMIN_ROLE_SCOPE_STILL_HELD
          );
        }
      }

      const previousRole = target.role;
      const now = new Date();

      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          role: nextRole,
          // Token akses membawa klaim role dan berumur 15 menit. Menaikkan
          // authVersion menggugurkan seluruh token lama seketika, sehingga
          // perubahan role berlaku pada permintaan berikutnya, bukan 15 menit
          // kemudian. Increment relatif supaya dua perubahan yang berbarengan
          // tetap konsisten.
          authVersion: { increment: 1 },
          sessionsRevokedAt: now
        },
        select: { id: true, fullName: true, phone: true, role: true, status: true }
      });

      await tx.session.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: now }
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: ADMIN_ROLE_ACTIONS.assigned,
          entityType: "USER",
          entityId: target.id,
          metadata: { previousRole, newRole: nextRole, reasonCode, sessionsRevoked: true }
        }
      });

      return { ...updated, previousRole };
    });
  }

  /**
   * Jejak penolakan SENGAJA ditulis lewat koneksi terpisah, bukan lewat
   * transaksi pemanggil. Pemanggil selalu melempar error tepat sesudahnya, dan
   * transaksinya dibatalkan — audit yang ikut di dalamnya akan lenyap justru
   * pada kejadian yang paling perlu tercatat. Pola yang sama dipakai
   * AdminScopeGovernanceService.
   */
  private async writeDenied(
    actorId: string,
    targetUserId: string,
    reasonCode: RoleReasonCode
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: ADMIN_ROLE_ACTIONS.denied,
        entityType: "USER",
        entityId: targetUserId,
        metadata: { reasonCode, outcome: "DENIED" }
      }
    });
  }
}
