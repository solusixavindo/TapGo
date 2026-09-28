import { AccountStatus, User, UserRole } from "@prisma/client";

export type CreateUserInput = {
  fullName: string;
  email?: string;
  /**
   * Diisi HANYA saat pendaftaran lewat penyedia identitas yang sudah
   * membuktikan kepemilikan email (mis. Google Sign-In) — lihat
   * AuthService.completeGoogleRegistration. Pendaftaran phone+password biasa
   * tidak pernah mengisi ini; email di jalur itu tetap tidak terverifikasi
   * sampai pemilik menuntaskan alur /auth/verification/*.
   */
  emailVerifiedAt?: Date;
  phone: string;
  passwordHash?: string;
  role: UserRole;
  referralCode: string;
  sponsorReferralCode?: string;
  registrationEvent?: {
    deviceFingerprintHash?: string;
    ipAddress?: string;
    userAgent?: string;
    distribution?: string;
    installer?: string;
  };
};

export type CreateSessionInput = {
  userId: string;
  refreshTokenHash: string;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: Date;
};

export type SessionRecord = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  /// Hash sebelum rotasi terakhir + waktunya (toleransi refresh ganda); null bila belum pernah dirotasi.
  previousRefreshTokenHash?: string | null;
  rotatedAt?: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
};

export type PublicUser = {
  id: string;
  role: UserRole;
  status: AccountStatus;
  fullName: string;
  email: string | null;
  phone: string;
  avatarUrl: string | null;
  referralCode: string;
};

export interface AuthRepository {
  findUserByPhone(phone: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  findUserByReferralCode(referralCode: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  createUser(input: CreateUserInput): Promise<User>;
  updateLastLogin(userId: string): Promise<void>;
  /** Versi otorisasi akun saat ini. Dipakai saat menerbitkan token. */
  getAuthVersion(userId: string): Promise<number>;
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  findSessionById(sessionId: string): Promise<SessionRecord | null>;
  /// Rotasi ATOMIK: hanya berhasil bila hash saat ini masih `expectedRefreshTokenHash`
  /// dan sesi belum dicabut. Mengembalikan false bila kalah balapan dengan rotasi lain.
  rotateSession(
    sessionId: string,
    expectedRefreshTokenHash: string,
    refreshTokenHash: string,
    expiresAt: Date
  ): Promise<boolean>;
  revokeSession(sessionId: string): Promise<void>;
  /**
   * Menaikkan authVersion SATU langkah dan mencabut seluruh baris Session
   * aktif, dalam SATU transaksi — persis pola applyPasswordChange, tanpa
   * menyentuh password. authVersion (bukan Session.revokedAt saja) yang
   * membuat access token lama langsung ditolak pada request berikutnya,
   * karena requireAuth tidak pernah membaca tabel Session (lihat
   * resolveAuthFromToken). Dipakai saat login DRIVER lewat kanal APP (lihat
   * AuthService.issueTokenPair) untuk menegakkan satu sesi aktif per akun
   * driver — BUKAN dipakai untuk USER/ADMIN, dan tidak pernah dipanggil dari
   * alur refresh (yang merotasi sesi yang sama, bukan menerbitkan sesi baru).
   */
  revokeAllActiveSessions(userId: string, now: Date): Promise<void>;

  /**
   * Menerapkan penggantian password dalam SATU transaksi.
   *
   * Password, kenaikan authVersion, dan pencabutan seluruh Session harus terjadi
   * bersama-sama. Kalau dipisah, ada jendela waktu di mana password sudah
   * berganti tetapi token lama masih sah — dan justru itulah yang ingin
   * dihilangkan oleh penggantian password.
   */
  applyPasswordChange(input: {
    userId: string;
    passwordHash: string;
    now: Date;
  }): Promise<void>;
  createOtpChallenge(input: {
    phone: string;
    codeHash: string;
    purpose: string;
    expiresAt: Date;
  }): Promise<void>;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    referralCode: user.referralCode
  };
}
