import { AccountStatus, User, UserRole } from "@prisma/client";

export type CreateUserInput = {
  fullName: string;
  email?: string;
  phone: string;
  passwordHash?: string;
  role: UserRole;
  referralCode: string;
  sponsorReferralCode?: string;
  registrationEvent?: {
    deviceFingerprintHash?: string;
    ipAddress?: string;
    userAgent?: string;
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
  findUserByReferralCode(referralCode: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  createUser(input: CreateUserInput): Promise<User>;
  updateLastLogin(userId: string): Promise<void>;
  /** Versi otorisasi akun saat ini. Dipakai saat menerbitkan token. */
  getAuthVersion(userId: string): Promise<number>;
  createSession(input: CreateSessionInput): Promise<SessionRecord>;
  findSessionById(sessionId: string): Promise<SessionRecord | null>;
  rotateSession(sessionId: string, refreshTokenHash: string, expiresAt: Date): Promise<void>;
  revokeSession(sessionId: string): Promise<void>;

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
