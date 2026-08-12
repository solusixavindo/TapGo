import { UserRole } from "@prisma/client";

/**
 * Tangga role administratif.
 *
 * Menambah role di ATAS SUPER_ADMIN punya satu jebakan yang mudah terjadi:
 * puluhan penjaga di repo ini menuliskan "SUPER_ADMIN" secara harfiah, sehingga
 * role yang seharusnya lebih tinggi justru mendapat akses LEBIH SEDIKIT. Berkas
 * ini menutup jebakan itu dengan menjadikan pemenuhan role sebagai satu fungsi
 * yang dipakai bersama, bukan perbandingan yang tersebar.
 *
 * Yang TIDAK dilakukan berkas ini, dan memang disengaja:
 *
 * - Role tetap BUKAN kewenangan. SUPER_ADMIN_VIP sekalipun masih memerlukan
 *   grant ADMIN_SCOPE_MANAGE yang aktif di database untuk mengelola scope.
 *   Lihat AdminScopeGovernanceService.
 * - Tidak ada bypass ke jalur operasional driver. Route driver menuntut profil
 *   driver ACTIVE di database, dan itu tidak dapat dipenuhi role apa pun —
 *   termasuk yang tertinggi. Lihat driverCapability.ts.
 * - USER dan DRIVER tidak berada di tangga ini. Penjaga yang meminta USER atau
 *   DRIVER menuntut kecocokan persis, sehingga admin tidak pernah otomatis
 *   dianggap penumpang maupun pengemudi.
 */

/**
 * Peringkat administratif. Nol berarti "bukan bagian tangga admin" dan menuntut
 * kecocokan persis.
 */
const ADMIN_RANK: Record<UserRole, number> = {
  USER: 0,
  DRIVER: 0,
  ADMIN: 1,
  SUPER_ADMIN: 2,
  SUPER_ADMIN_VIP: 3
};

/**
 * Apakah `actual` memenuhi penjaga yang meminta `required`.
 *
 * Peran yang lebih tinggi memenuhi permintaan peran yang lebih rendah pada
 * tangga admin. Di luar tangga itu, hanya kecocokan persis yang diterima.
 */
export function roleSatisfies(actual: UserRole, required: UserRole): boolean {
  if (actual === required) {
    return true;
  }
  if (ADMIN_RANK[required] === 0) {
    return false;
  }
  return ADMIN_RANK[actual] >= ADMIN_RANK[required];
}

/** Apakah `actual` memenuhi salah satu dari beberapa peran yang diminta. */
export function roleSatisfiesAny(actual: UserRole, required: readonly UserRole[]): boolean {
  return required.some((role) => roleSatisfies(actual, role));
}

/** Setara ADMIN atau lebih tinggi. */
export function isAdminRole(role: UserRole): boolean {
  return roleSatisfies(role, "ADMIN");
}

/** Setara SUPER_ADMIN atau lebih tinggi. */
export function isSuperAdminRole(role: UserRole): boolean {
  return roleSatisfies(role, "SUPER_ADMIN");
}

/**
 * Role puncak. Hanya pemegangnya yang boleh menjadi sasaran maupun pelaku
 * tindakan yang menyentuh akun puncak lain.
 */
export function isTopLevelRole(role: UserRole): boolean {
  return role === "SUPER_ADMIN_VIP";
}
