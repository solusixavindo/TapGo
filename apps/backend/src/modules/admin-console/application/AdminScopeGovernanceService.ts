import { AdminScope, AdminScopeGrantStatus, Prisma, PrismaClient, UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { isAdminRole, isSuperAdminRole, isTopLevelRole, roleSatisfies } from "../../../core/security/roleHierarchy.js";

/**
 * Tata kelola scope admin.
 *
 * Role bukan kewenangan. SUPER_ADMIN sekalipun tidak dapat mengelola scope
 * tanpa grant `ADMIN_SCOPE_MANAGE` yang aktif di database, dan grant itu tidak
 * pernah diberikan otomatis — tidak oleh migration, tidak oleh seed, tidak
 * oleh startup. Pemegang pertama hanya lahir dari CLI bootstrap sekali pakai.
 *
 * Founder Platinum dan Chairman BUKAN otoritas keamanan sistem dan tidak
 * pernah menjadi syarat di berkas ini.
 *
 * Seluruh pemeriksaan membaca database pada setiap permintaan, sehingga
 * pencabutan maupun penurunan role berlaku pada request berikutnya meski
 * token lama masih sah. JWT tidak pernah menjadi sumber kebenaran scope.
 */

// --- Stable error codes ----------------------------------------------------

export const ADMIN_SCOPE_MANAGE_REQUIRED = "ADMIN_SCOPE_MANAGE_REQUIRED";
export const ADMIN_SCOPE_ACTOR_INACTIVE = "ADMIN_SCOPE_ACTOR_INACTIVE";
export const ADMIN_SCOPE_ACTOR_ROLE_REQUIRED = "ADMIN_SCOPE_ACTOR_ROLE_REQUIRED";
export const ADMIN_SCOPE_TARGET_NOT_FOUND = "ADMIN_SCOPE_TARGET_NOT_FOUND";
export const ADMIN_SCOPE_TARGET_INACTIVE = "ADMIN_SCOPE_TARGET_INACTIVE";
export const ADMIN_SCOPE_TARGET_ROLE_INVALID = "ADMIN_SCOPE_TARGET_ROLE_INVALID";
export const ADMIN_SCOPE_ALREADY_ACTIVE = "ADMIN_SCOPE_ALREADY_ACTIVE";
export const ADMIN_SCOPE_GRANT_NOT_FOUND = "ADMIN_SCOPE_GRANT_NOT_FOUND";
export const ADMIN_SCOPE_ALREADY_REVOKED = "ADMIN_SCOPE_ALREADY_REVOKED";
export const ADMIN_SCOPE_LAST_MANAGER_PROTECTED = "ADMIN_SCOPE_LAST_MANAGER_PROTECTED";
export const ADMIN_SCOPE_REASON_INVALID = "ADMIN_SCOPE_REASON_INVALID";
export const ADMIN_SCOPE_BOOTSTRAP_NOT_ALLOWED = "ADMIN_SCOPE_BOOTSTRAP_NOT_ALLOWED";
export const ADMIN_SCOPE_VERSION_CONFLICT = "ADMIN_SCOPE_VERSION_CONFLICT";
/// Akun role puncak hanya boleh disentuh oleh sesama role puncak.
export const ADMIN_SCOPE_TOP_LEVEL_PROTECTED = "ADMIN_SCOPE_TOP_LEVEL_PROTECTED";

// --- Bounded reason codes --------------------------------------------------

/**
 * Daftar tertutup. Alasan ikut ke audit log, dan teks bebas di sana cepat
 * berubah menjadi tempat bocornya pesan exception atau PII.
 */
export const SCOPE_REASON_CODES = [
  "INITIAL_BOOTSTRAP",
  "BREAK_GLASS_RECOVERY",
  "OPERATIONAL_ASSIGNMENT",
  "RESPONSIBILITY_CHANGE",
  "TEMPORARY_ACCESS",
  "ACCESS_REMOVAL",
  "ROLE_CHANGE",
  "SECURITY_INCIDENT"
] as const;
export type ScopeReasonCode = (typeof SCOPE_REASON_CODES)[number];

export function isScopeReasonCode(value: unknown): value is ScopeReasonCode {
  return typeof value === "string" && (SCOPE_REASON_CODES as readonly string[]).includes(value);
}

// --- Audit ----------------------------------------------------------------

export const SCOPE_GOVERNANCE_ACTIONS = {
  bootstrapCompleted: "admin.scope.bootstrap_completed",
  breakGlassCompleted: "admin.scope.break_glass_completed",
  granted: "admin.scope.granted",
  selfGranted: "admin.scope.self_granted",
  revoked: "admin.scope.revoked",
  grantDenied: "admin.scope.grant_denied",
  revokeDenied: "admin.scope.revoke_denied",
  lastManagerProtected: "admin.scope.last_manager_protected"
} as const;

/**
 * Kunci yang boleh muncul pada metadata audit governance.
 *
 * DITEGAKKAN saat penulisan: metadata dibangun ulang dari daftar ini sehingga
 * field tak terduga mustahil tersimpan.
 */
export const GOVERNANCE_AUDIT_METADATA_KEYS = [
  "actorId",
  "targetUserId",
  "grantId",
  "scope",
  "reasonCode",
  "outcome",
  "previousStatus",
  "newStatus"
] as const;

type GovernanceAuditMetadata = {
  actorId: string;
  targetUserId?: string;
  grantId?: string;
  scope?: AdminScope;
  reasonCode?: ScopeReasonCode;
  outcome: "ALLOWED" | "DENIED" | "PROTECTED";
  previousStatus?: AdminScopeGrantStatus;
  newStatus?: AdminScopeGrantStatus;
};

// --- Konstanta ------------------------------------------------------------

export const MANAGE_SCOPE: AdminScope = "ADMIN_SCOPE_MANAGE";

/** Scope review yang boleh dipegang ADMIN maupun SUPER_ADMIN. */
export const REVIEW_SCOPES: AdminScope[] = [
  "DRIVER_APPLICATION_QUEUE_READ",
  "DRIVER_APPLICATION_CLAIM",
  "DRIVER_APPLICATION_RENEW",
  "DRIVER_APPLICATION_RELEASE",
  "DRIVER_APPLICATION_REASSIGN"
];

/**
 * Kunci advisory lock untuk seluruh mutasi ADMIN_SCOPE_MANAGE.
 *
 * Perlindungan manager terakhir adalah pemeriksaan baca-lalu-tulis, dan pada
 * Read Committed dua pencabutan bersamaan bisa sama-sama melihat dua manager
 * lalu keduanya commit — menyisakan nol. Advisory lock transaksional
 * membuat mutasi manage-scope berurutan, sehingga hitungannya selalu benar
 * tanpa bergantung pada serialization failure yang harus di-retry.
 */
/**
 * Role yang layak memegang ADMIN_SCOPE_MANAGE. Dipakai penghitung manager,
 * sehingga perlindungan "jangan menyisakan nol pengelola" melihat seluruh
 * tangga role, bukan hanya SUPER_ADMIN.
 */
const SCOPE_MANAGER_ROLES: UserRole[] = ["SUPER_ADMIN", "SUPER_ADMIN_VIP"];

const MANAGE_LOCK_KEY = 918_273_645;

type TxClient = Prisma.TransactionClient;

/**
 * Penanda internal: transaksi ini kalah balapan pada partial unique index.
 *
 * Tidak pernah mencapai pemanggil HTTP — ditangkap di luar transaksi lalu
 * diubah menjadi respons idempoten. Dibuat sebagai kelas tersendiri agar tidak
 * tertukar dengan AppError yang memang untuk pengguna.
 */
class ConcurrentGrantWinnerExists extends Error {}

export type ActorContext = { userId: string };

export class AdminScopeGovernanceService {
  constructor(private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------
  // Otorisasi aktor
  // -------------------------------------------------------------------

  /**
   * Memastikan pemanggil boleh mengelola scope.
   *
   * Urutan disengaja: status, lalu role dari DATABASE, lalu grant. Akun yang
   * tidak aktif tidak boleh dapat menyimpulkan apa pun tentang grant yang
   * dimilikinya.
   */
  private async requireScopeManager(actorId: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, role: true, status: true }
    });

    if (!actor) {
      throw new AppError(
        "Kewenangan pengelolaan scope tidak tersedia.",
        StatusCodes.FORBIDDEN,
        ADMIN_SCOPE_MANAGE_REQUIRED
      );
    }
    if (actor.status !== "ACTIVE") {
      throw new AppError(
        "Akun tidak aktif.",
        StatusCodes.FORBIDDEN,
        ADMIN_SCOPE_ACTOR_INACTIVE
      );
    }
    // SUPER_ADMIN adalah SYARAT, bukan pemberi kewenangan. ADMIN yang memegang
    // ADMIN_SCOPE_MANAGE tetap ditolak di sini.
    if (!isSuperAdminRole(actor.role)) {
      throw new AppError(
        "Kewenangan pengelolaan scope tidak tersedia.",
        StatusCodes.FORBIDDEN,
        ADMIN_SCOPE_ACTOR_ROLE_REQUIRED
      );
    }

    const grant = await this.prisma.adminScopeGrant.findFirst({
      where: { userId: actorId, scope: MANAGE_SCOPE, status: "ACTIVE" },
      select: { id: true }
    });
    if (!grant) {
      throw new AppError(
        "Kewenangan pengelolaan scope tidak tersedia.",
        StatusCodes.FORBIDDEN,
        ADMIN_SCOPE_MANAGE_REQUIRED
      );
    }

    return actor;
  }

  /**
   * Akun role puncak hanya boleh menjadi sasaran tindakan oleh sesama role
   * puncak. Berlaku untuk pencabutan scope maupun pemberiannya.
   */
  private async assertMayActOnTarget(
    tx: Prisma.TransactionClient,
    actorRole: UserRole,
    targetUserId: string,
    audit: { actorId: string; grantId?: string; scope?: AdminScope; reasonCode?: ScopeReasonCode }
  ) {
    const target = await tx.user.findUnique({
      where: { id: targetUserId },
      select: { role: true }
    });
    if (!target || !isTopLevelRole(target.role) || isTopLevelRole(actorRole)) {
      return;
    }

    await this.writeAudit(SCOPE_GOVERNANCE_ACTIONS.revokeDenied, {
      ...audit,
      targetUserId,
      outcome: "DENIED"
    });
    throw new AppError(
      "Akun ini hanya dapat dikelola oleh pemegang role puncak.",
      StatusCodes.FORBIDDEN,
      ADMIN_SCOPE_TOP_LEVEL_PROTECTED
    );
  }

  /** Aktor untuk endpoint baca-diri-sendiri: cukup admin aktif. */
  private async requireActiveAdmin(actorId: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, role: true, status: true }
    });
    if (!actor || !isAdminRole(actor.role)) {
      throw new AppError(
        "Kewenangan tidak tersedia.",
        StatusCodes.FORBIDDEN,
        ADMIN_SCOPE_ACTOR_ROLE_REQUIRED
      );
    }
    if (actor.status !== "ACTIVE") {
      throw new AppError("Akun tidak aktif.", StatusCodes.FORBIDDEN, ADMIN_SCOPE_ACTOR_INACTIVE);
    }
    return actor;
  }

  // -------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------

  /** Scope aktif milik pemanggil sendiri. Tidak pernah milik orang lain. */
  async listOwnScopes(actorId: string) {
    await this.requireActiveAdmin(actorId);

    const grants = await this.prisma.adminScopeGrant.findMany({
      where: { userId: actorId, status: "ACTIVE" },
      orderBy: { scope: "asc" },
      select: { id: true, scope: true, status: true, grantedAt: true }
    });

    // Nol PII: hanya UUID internal dan scope.
    return { userId: actorId, scopes: grants };
  }

  /** Daftar seluruh grant, terpaginasi. Hanya untuk scope manager. */
  async listGrants(
    actorId: string,
    filter: {
      userId?: string;
      scope?: AdminScope;
      status?: AdminScopeGrantStatus;
      page?: number;
      pageSize?: number;
    }
  ) {
    await this.requireScopeManager(actorId);

    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 25));

    const where: Prisma.AdminScopeGrantWhereInput = {
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.scope ? { scope: filter.scope } : {}),
      ...(filter.status ? { status: filter.status } : {})
    };

    const [total, rows] = await Promise.all([
      this.prisma.adminScopeGrant.count({ where }),
      this.prisma.adminScopeGrant.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Nol PII dan nol metadata audit mentah: hanya identitas internal,
        // scope, status, alasan terbatas, dan waktu.
        select: {
          id: true,
          userId: true,
          scope: true,
          status: true,
          grantedById: true,
          grantedAt: true,
          revokedById: true,
          revokedAt: true,
          reasonCode: true
        }
      })
    ]);

    return { page, pageSize, total, items: rows };
  }

  // -------------------------------------------------------------------
  // Grant
  // -------------------------------------------------------------------

  async grantScope(input: {
    actorId: string;
    targetUserId: string;
    scope: AdminScope;
    reasonCode: unknown;
  }) {
    const actor = await this.requireScopeManager(input.actorId);

    if (!isScopeReasonCode(input.reasonCode)) {
      await this.writeAudit(SCOPE_GOVERNANCE_ACTIONS.grantDenied, {
        actorId: input.actorId,
        targetUserId: input.targetUserId,
        scope: input.scope,
        outcome: "DENIED"
      });
      throw new AppError(
        "Kode alasan tidak dikenal.",
        StatusCodes.BAD_REQUEST,
        ADMIN_SCOPE_REASON_INVALID
      );
    }
    const reasonCode = input.reasonCode;

    const target = await this.prisma.user.findUnique({
      where: { id: input.targetUserId },
      select: { id: true, role: true, status: true }
    });

    if (!target) {
      await this.writeAudit(SCOPE_GOVERNANCE_ACTIONS.grantDenied, {
        actorId: input.actorId,
        targetUserId: input.targetUserId,
        scope: input.scope,
        reasonCode,
        outcome: "DENIED"
      });
      throw new AppError(
        "Target tidak ditemukan.",
        StatusCodes.NOT_FOUND,
        ADMIN_SCOPE_TARGET_NOT_FOUND
      );
    }
    if (target.status !== "ACTIVE") {
      await this.writeAudit(SCOPE_GOVERNANCE_ACTIONS.grantDenied, {
        actorId: input.actorId,
        targetUserId: target.id,
        scope: input.scope,
        reasonCode,
        outcome: "DENIED"
      });
      throw new AppError(
        "Target tidak aktif.",
        StatusCodes.CONFLICT,
        ADMIN_SCOPE_TARGET_INACTIVE
      );
    }

    // ADMIN_SCOPE_MANAGE hanya boleh dipegang SUPER_ADMIN; scope review boleh
    // ADMIN maupun SUPER_ADMIN. USER tidak boleh memegang apa pun.
    const requiredTargetRole: UserRole = input.scope === MANAGE_SCOPE ? "SUPER_ADMIN" : "ADMIN";
    if (!roleSatisfies(target.role, requiredTargetRole)) {
      await this.writeAudit(SCOPE_GOVERNANCE_ACTIONS.grantDenied, {
        actorId: input.actorId,
        targetUserId: target.id,
        scope: input.scope,
        reasonCode,
        outcome: "DENIED"
      });
      throw new AppError(
        "Role target tidak sesuai untuk scope ini.",
        StatusCodes.CONFLICT,
        ADMIN_SCOPE_TARGET_ROLE_INVALID
      );
    }

    const isSelf = target.id === actor.id;

    // Aktor tidak boleh menciptakan ADMIN_SCOPE_MANAGE kedua untuk dirinya
    // sendiri. Ia sudah memegangnya — itulah sebabnya ia bisa sampai di sini.
    if (isSelf && input.scope === MANAGE_SCOPE) {
      await this.writeAudit(SCOPE_GOVERNANCE_ACTIONS.grantDenied, {
        actorId: input.actorId,
        targetUserId: target.id,
        scope: input.scope,
        reasonCode,
        outcome: "DENIED"
      });
      throw new AppError(
        "Scope ini sudah aktif untuk akun tersebut.",
        StatusCodes.CONFLICT,
        ADMIN_SCOPE_ALREADY_ACTIVE
      );
    }

    try {
      return await this.runGrantTransaction(actor.id, target.id, input.scope, reasonCode, isSelf);
    } catch (error) {
      if (error instanceof ConcurrentGrantWinnerExists) {
        // Pemenang sudah menulis barisnya; kembalikan baris itu.
        const winner = await this.prisma.adminScopeGrant.findFirstOrThrow({
          where: { userId: target.id, scope: input.scope, status: "ACTIVE" },
          select: { id: true, scope: true, status: true, grantedAt: true }
        });
        return { grant: winner, alreadyActive: true as const };
      }
      throw error;
    }
  }

  private runGrantTransaction(
    actorId: string,
    targetId: string,
    scope: AdminScope,
    reasonCode: ScopeReasonCode,
    isSelf: boolean
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Mutasi manage-scope diserialkan; lihat MANAGE_LOCK_KEY.
      if (scope === MANAGE_SCOPE) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MANAGE_LOCK_KEY}::bigint)`;
      }

      const existing = await tx.adminScopeGrant.findFirst({
        where: { userId: targetId, scope: scope, status: "ACTIVE" },
        select: { id: true, scope: true, status: true, grantedAt: true }
      });

      // IDEMPOTEN: grant aktif yang sama tidak membuat baris kedua dan tidak
      // menulis audit mutasi kedua. Respons stabil menandainya eksplisit.
      if (existing) {
        return { grant: existing, alreadyActive: true as const };
      }

      let created;
      try {
        created = await tx.adminScopeGrant.create({
          data: {
            userId: targetId,
            scope: scope,
            status: "ACTIVE",
            grantedById: actorId,
            reasonCode
          },
          select: { id: true, scope: true, status: true, grantedAt: true }
        });
      } catch (error) {
        // Partial unique index adalah PENJAGA AKHIR. Dua grant bersamaan untuk
        // target dan scope yang sama membuat salah satunya kalah di sini.
        // Yang kalah tidak boleh memunculkan error database mentah: hasil
        // akhirnya sama dengan permintaan duplikat biasa, yaitu satu baris
        // aktif dan respons idempoten yang stabil.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new ConcurrentGrantWinnerExists();
        }
        throw error;
      }

      // Audit ditulis dalam transaksi yang SAMA: bila insert audit gagal,
      // grant ikut dibatalkan.
      await this.writeAudit(
        isSelf ? SCOPE_GOVERNANCE_ACTIONS.selfGranted : SCOPE_GOVERNANCE_ACTIONS.granted,
        {
          actorId: actorId,
          targetUserId: targetId,
          grantId: created.id,
          scope: scope,
          reasonCode,
          outcome: "ALLOWED",
          newStatus: "ACTIVE"
        },
        tx
      );

      return { grant: created, alreadyActive: false as const };
    });
  }

  // -------------------------------------------------------------------
  // Revoke
  // -------------------------------------------------------------------

  async revokeScope(input: { actorId: string; grantId: string; reasonCode: unknown }) {
    const actor = await this.requireScopeManager(input.actorId);

    if (!isScopeReasonCode(input.reasonCode)) {
      await this.writeAudit(SCOPE_GOVERNANCE_ACTIONS.revokeDenied, {
        actorId: input.actorId,
        grantId: input.grantId,
        outcome: "DENIED"
      });
      throw new AppError(
        "Kode alasan tidak dikenal.",
        StatusCodes.BAD_REQUEST,
        ADMIN_SCOPE_REASON_INVALID
      );
    }
    const reasonCode = input.reasonCode;

    return this.prisma.$transaction(async (tx) => {
      // Dikunci untuk SETIAP pencabutan, bukan hanya manage-scope: pencabutan
      // scope apa pun tidak boleh berjalan bersamaan dengan penghitungan
      // manager, dan biayanya tidak signifikan pada operasi administratif.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MANAGE_LOCK_KEY}::bigint)`;

      const grant = await tx.adminScopeGrant.findUnique({
        where: { id: input.grantId },
        select: { id: true, userId: true, scope: true, status: true }
      });

      if (!grant) {
        await this.writeAudit(SCOPE_GOVERNANCE_ACTIONS.revokeDenied, {
          actorId: actor.id,
          grantId: input.grantId,
          reasonCode,
          outcome: "DENIED"
        });
        throw new AppError(
          "Grant tidak ditemukan.",
          StatusCodes.NOT_FOUND,
          ADMIN_SCOPE_GRANT_NOT_FOUND
        );
      }
      if (grant.status !== "ACTIVE") {
        await this.writeAudit(SCOPE_GOVERNANCE_ACTIONS.revokeDenied, {
          actorId: actor.id,
          grantId: grant.id,
          scope: grant.scope,
          reasonCode,
          previousStatus: grant.status,
          outcome: "DENIED"
        });
        throw new AppError(
          "Grant sudah dicabut.",
          StatusCodes.CONFLICT,
          ADMIN_SCOPE_ALREADY_REVOKED
        );
      }

      // PERLINDUNGAN ROLE PUNCAK. Tanpa ini, SUPER_ADMIN dapat melucuti
      // kewenangan pemilik sistem — persis kebalikan dari maksud role yang
      // berada di atasnya.
      await this.assertMayActOnTarget(tx, actor.role, grant.userId, {
        actorId: actor.id,
        grantId: grant.id,
        scope: grant.scope,
        reasonCode
      });

      // PERLINDUNGAN MANAGER TERAKHIR. Dihitung di dalam lock, sehingga dua
      // pencabutan silang tidak dapat sama-sama melihat dua manager.
      if (grant.scope === MANAGE_SCOPE) {
        const remaining = await this.countEligibleManagers(tx, grant.id);
        if (remaining === 0) {
          await this.writeAudit(SCOPE_GOVERNANCE_ACTIONS.lastManagerProtected, {
            actorId: actor.id,
            targetUserId: grant.userId,
            grantId: grant.id,
            scope: grant.scope,
            reasonCode,
            outcome: "PROTECTED"
          });
          throw new AppError(
            "Tidak boleh menyisakan nol pengelola scope.",
            StatusCodes.CONFLICT,
            ADMIN_SCOPE_LAST_MANAGER_PROTECTED
          );
        }
      }

      // Pencabutan bersyarat: hanya baris yang masih ACTIVE yang berubah.
      // Pemenang tunggal ditentukan database, bukan urutan pembacaan.
      const revoked = await tx.adminScopeGrant.updateMany({
        where: { id: grant.id, status: "ACTIVE" },
        data: {
          status: "REVOKED",
          revokedById: actor.id,
          revokedAt: new Date(),
          reasonCode
        }
      });

      if (revoked.count !== 1) {
        throw new AppError(
          "Grant sudah berubah.",
          StatusCodes.CONFLICT,
          ADMIN_SCOPE_VERSION_CONFLICT
        );
      }

      await this.writeAudit(
        SCOPE_GOVERNANCE_ACTIONS.revoked,
        {
          actorId: actor.id,
          targetUserId: grant.userId,
          grantId: grant.id,
          scope: grant.scope,
          reasonCode,
          outcome: "ALLOWED",
          previousStatus: "ACTIVE",
          newStatus: "REVOKED"
        },
        tx
      );

      // Baris TIDAK dihapus: statusnya berubah dan riwayatnya utuh.
      return tx.adminScopeGrant.findUniqueOrThrow({
        where: { id: grant.id },
        select: {
          id: true,
          userId: true,
          scope: true,
          status: true,
          revokedById: true,
          revokedAt: true,
          reasonCode: true
        }
      });
    });
  }

  // -------------------------------------------------------------------
  // Kelayakan manager
  // -------------------------------------------------------------------

  /**
   * Jumlah pemegang ADMIN_SCOPE_MANAGE yang benar-benar layak.
   *
   * Layak berarti ketiganya sekaligus: grant ACTIVE, akun ACTIVE, dan role
   * SUPER_ADMIN saat ini. Grant tanpa role yang mendukung tidak dihitung —
   * itulah kondisi yang membuat CLI break-glass menjadi jalan pemulihan.
   */
  async countEligibleManagers(
    client: TxClient | PrismaClient,
    excludeGrantId?: string
  ): Promise<number> {
    return client.adminScopeGrant.count({
      where: {
        scope: MANAGE_SCOPE,
        status: "ACTIVE",
        ...(excludeGrantId ? { id: { not: excludeGrantId } } : {}),
        // Role puncak ikut dihitung. Kalau tidak, mencabut grant milik
        // SUPER_ADMIN terakhir akan tertolak walau pemilik sistem masih
        // memegangnya — dan sebaliknya, pemegang puncak terakhir bisa dicabut
        // tanpa perlindungan.
        user: { status: "ACTIVE", role: { in: SCOPE_MANAGER_ROLES } }
      }
    });
  }

  // -------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------

  /**
   * Menulis audit memakai infrastruktur AuditLog yang sudah ada.
   *
   * Metadata dibangun ulang dari allowlist, sehingga field tak terduga
   * mustahil tersimpan. Nol nomor telepon, email, NIK, SIM, STNK, plate,
   * password, token, secret, maupun pesan exception.
   */
  private async writeAudit(
    action: string,
    metadata: GovernanceAuditMetadata,
    tx?: TxClient
  ) {
    const safe: Record<string, unknown> = {};
    for (const key of GOVERNANCE_AUDIT_METADATA_KEYS) {
      const value = metadata[key];
      if (value !== undefined) {
        safe[key] = value;
      }
    }

    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorId: metadata.actorId,
        action,
        entityType: "AdminScopeGrant",
        ...(metadata.grantId ? { entityId: metadata.grantId } : {}),
        metadata: safe as Prisma.InputJsonValue
      }
    });
  }

  /** Dipakai CLI bootstrap; tidak diekspos lewat HTTP. */
  auditForBootstrap(action: string, metadata: GovernanceAuditMetadata, tx: TxClient) {
    return this.writeAudit(action, metadata, tx);
  }
}
