import crypto from "node:crypto";
import { Prisma, UserRole } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { hashPassword, verifyPassword } from "../../../core/security/passwordHasher.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from "../../../core/security/tokenService.js";
import type { TokenChannel } from "../../../core/security/tokenService.js";
import { env } from "../../../config/env.js";
import { AuthRepository, toPublicUser } from "../domain/AuthRepository.js";

/**
 * Hash argon2id contoh, tidak berkorespondensi dengan password siapa pun.
 *
 * Dipakai semata untuk menyamakan waktu proses saat nomor HP tidak terdaftar
 * dengan waktu proses saat password salah. Tanpa ini, respons untuk "nomor
 * tidak ada" akan selalu lebih cepat daripada "password salah" (argon2 tidak
 * pernah dijalankan), sehingga waktu respons membocorkan nomor HP mana yang
 * terdaftar walau pesan error-nya sengaja dibuat sama persis.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$Ob+EARyIDgJlSiKhP/zNrQ$FjdJxBLG79ZKJ6N6w2eR8qmRY0kujTlhjC9BynQSU/4";

export type AuthClientContext = {
  userAgent?: string;
  ipAddress?: string;
  deviceIdentifier?: string;
  /** Sumber instalasi yang dilaporkan klien (penanda operasional, bukan bukti). */
  distribution?: string;
  installer?: string;
  /**
   * Kanal yang menerbitkan token, di-stamp oleh controller berdasarkan
   * endpoint login yang dipanggil (K1c). Bila tidak diisi, token terbit tanpa
   * klaim kanal — perilaku lama yang masih diterima bertahap (K2a).
   */
  channel?: TokenChannel;
};

export class AuthService {
  private static readonly maxReferralCodeAttempts = 8;
  /// Jendela toleransi permintaan refresh ganda setelah rotasi (lihat refresh()).
  private static readonly refreshRotationGraceMs = 30_000;

  private static sameHash(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  constructor(private readonly authRepository: AuthRepository) {}

  async register(input: {
    fullName: string;
    email?: string;
    phone: string;
    password: string;
	    referralCode?: string;
	    deviceId?: string;
	    deviceFingerprint?: string;
	    context: AuthClientContext;
	  }) {
	    // Batas keamanan: role akun bersifat otoritatif dan ditetapkan SERVER.
	    // Registrasi publik selalu membuat USER. DRIVER/ADMIN/SUPER_ADMIN tidak
	    // dapat diperoleh lewat endpoint ini; validator menolak field "role"
	    // dengan 400 sehingga tidak ada jalur diam-diam.
	    const authoritativeRole: UserRole = UserRole.USER;
    const existing = await this.authRepository.findUserByPhone(input.phone);
    if (existing) {
      throw new AppError("Nomor HP sudah terdaftar", StatusCodes.CONFLICT, "PHONE_ALREADY_REGISTERED");
    }

	    const passwordHash = await hashPassword(input.password);
	    const deviceIdentifier =
	      input.deviceFingerprint ??
	      input.deviceId ??
	      input.context.deviceIdentifier;
	    const deviceFingerprintHash = deviceIdentifier
	      ? this.hashToken(deviceIdentifier)
	      : undefined;
	    let userId: string | null = null;

    for (let attempt = 1; attempt <= AuthService.maxReferralCodeAttempts; attempt += 1) {
      try {
        const user = await this.authRepository.createUser({
          fullName: input.fullName,
          ...(input.email !== undefined ? { email: input.email } : {}),
          phone: input.phone,
          passwordHash,
          role: authoritativeRole,
	          referralCode: await this.generateUniqueReferralCode(input.fullName),
	          ...(input.referralCode !== undefined && input.referralCode.trim() !== ""
	            ? { sponsorReferralCode: input.referralCode.trim().toUpperCase() }
	            : {}),
	          registrationEvent: {
	            ...(deviceFingerprintHash !== undefined ? { deviceFingerprintHash } : {}),
	            ...(input.context.ipAddress !== undefined ? { ipAddress: input.context.ipAddress } : {}),
	            ...(input.context.userAgent !== undefined ? { userAgent: input.context.userAgent } : {}),
	            ...(input.context.distribution !== undefined ? { distribution: input.context.distribution } : {}),
	            ...(input.context.installer !== undefined ? { installer: input.context.installer } : {})
	          }
	        });
        userId = user.id;
        break;
      } catch (error) {
        if (this.isReferralCodeUniqueViolation(error) && attempt < AuthService.maxReferralCodeAttempts) {
          continue;
        }
        if (this.isReferralCodeUniqueViolation(error)) {
          throw new AppError(
            "Kode referral belum dapat dibuat. Silakan coba lagi.",
            StatusCodes.CONFLICT,
            "REFERRAL_CODE_COLLISION"
          );
        }
        throw error;
      }
    }

    if (!userId) {
      throw new AppError(
        "Kode referral belum dapat dibuat. Silakan coba lagi.",
        StatusCodes.CONFLICT,
        "REFERRAL_CODE_COLLISION"
      );
    }

    return this.issueTokenPair(userId, authoritativeRole, input.context);
  }

  async login(input: { phone: string; password: string; context: AuthClientContext }) {
    const user = await this.authRepository.findUserByPhone(input.phone);
    if (!user?.passwordHash) {
      // Jalankan verifikasi argon2 sungguhan terhadap hash contoh, supaya
      // waktu responsnya sama dengan jalur password salah di bawah.
      await verifyPassword(DUMMY_PASSWORD_HASH, input.password);
      throw new AppError("Invalid phone or password", StatusCodes.UNAUTHORIZED, "INVALID_CREDENTIALS");
    }

    if (user.status !== "ACTIVE") {
      throw new AppError("Account is not active", StatusCodes.FORBIDDEN, "ACCOUNT_INACTIVE");
    }

    const validPassword = await verifyPassword(user.passwordHash, input.password);
    if (!validPassword) {
      throw new AppError("Invalid phone or password", StatusCodes.UNAUTHORIZED, "INVALID_CREDENTIALS");
    }

    await this.authRepository.updateLastLogin(user.id);

    return this.issueTokenPair(user.id, user.role, input.context);
  }

  async refresh(refreshToken: string, context: AuthClientContext) {
    const payload = verifyRefreshToken(refreshToken);
    const session = await this.authRepository.findSessionById(payload.sessionId);

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new AppError("Refresh session is invalid", StatusCodes.UNAUTHORIZED, "SESSION_INVALID");
    }

    const tokenHash = this.hashToken(refreshToken);
    if (!AuthService.sameHash(tokenHash, session.refreshTokenHash)) {
      // Token ini bukan yang terbaru. Bila itu token SEBELUM rotasi terakhir dan
      // rotasinya baru saja terjadi, ini hampir pasti permintaan refresh ganda yang
      // berbarengan dari perangkat yang sama (dua layar/proses, atau retry) — bukan
      // pencurian. Tolak dengan 409 tanpa mencabut sesi: pihak yang menang sudah
      // memegang token baru. Klien lama memperlakukan 409 sebagai gangguan sementara
      // (sesi dipertahankan), bukan penolakan.
      const rotatedRecently =
        session.previousRefreshTokenHash !== null &&
        session.previousRefreshTokenHash !== undefined &&
        session.rotatedAt !== null &&
        session.rotatedAt !== undefined &&
        Date.now() - session.rotatedAt.getTime() <= AuthService.refreshRotationGraceMs &&
        AuthService.sameHash(tokenHash, session.previousRefreshTokenHash);
      if (rotatedRecently) {
        throw new AppError(
          "Refresh token baru saja dirotasi oleh permintaan lain",
          StatusCodes.CONFLICT,
          "TOKEN_ROTATED"
        );
      }
      await this.authRepository.revokeSession(session.id);
      throw new AppError("Refresh token reuse detected", StatusCodes.UNAUTHORIZED, "TOKEN_REUSE_DETECTED");
    }

    const user = await this.authRepository.findUserById(payload.sub);
    if (!user || user.status !== "ACTIVE") {
      throw new AppError("Account is not active", StatusCodes.FORBIDDEN, "ACCOUNT_INACTIVE");
    }

    // Jalur refresh memakai aturan versi yang sama dengan requireAuth.
    // Tanpa ini, refresh token lama masih dapat menukar dirinya menjadi
    // access token baru setelah pencabutan.
    const tokenVersion = payload.authVersion;
    const versionAcceptable =
      tokenVersion === undefined
        ? user.authVersion === 0
        : Number.isInteger(tokenVersion) && tokenVersion >= 0 && tokenVersion === user.authVersion;

    if (!versionAcceptable) {
      await this.authRepository.revokeSession(session.id);
      throw new AppError(
        "Sesi sudah tidak berlaku. Silakan login kembali.",
        StatusCodes.UNAUTHORIZED,
        "AUTH_SESSION_REVOKED"
      );
    }

    // Kanal token baru mengikuti kanal token lama (bila ada): refresh tidak
    // boleh memindahkan token dari satu kanal ke kanal lain.
    const channel = payload.channel ?? context.channel;
    const accessToken = signAccessToken({
      sub: user.id, role: user.role, sessionId: session.id, authVersion: user.authVersion,
      ...(channel !== undefined ? { channel } : {})
    });
    const newRefreshToken = signRefreshToken({
      sub: user.id, role: user.role, sessionId: session.id, authVersion: user.authVersion,
      ...(channel !== undefined ? { channel } : {})
    });
    const expiresAt = this.refreshExpiryDate();

    const rotated = await this.authRepository.rotateSession(
      session.id,
      session.refreshTokenHash,
      this.hashToken(newRefreshToken),
      expiresAt
    );
    if (!rotated) {
      // Kalah balapan dengan refresh lain yang sah pada token yang sama: token baru
      // kita tidak tersimpan, jadi jangan diberikan ke klien.
      throw new AppError(
        "Refresh token baru saja dirotasi oleh permintaan lain",
        StatusCodes.CONFLICT,
        "TOKEN_ROTATED"
      );
    }

    return {
      user: toPublicUser(user),
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt,
      context
    };
  }

  async logout(sessionId: string) {
    await this.authRepository.revokeSession(sessionId);
  }

  /**
   * Ganti password oleh pemilik akun yang sedang masuk.
   *
   * Password lama WAJIB dibuktikan, walaupun pemanggilnya sudah membawa token
   * yang sah. Tanpa itu, satu token yang bocor cukup untuk mengambil alih akun
   * secara permanen — penyerang tinggal mengganti passwordnya sendiri.
   */
  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }) {
    if (input.currentPassword === input.newPassword) {
      throw new AppError(
        "Password baru harus berbeda dari password lama.",
        StatusCodes.BAD_REQUEST,
        "PASSWORD_UNCHANGED"
      );
    }

    const user = await this.authRepository.findUserById(input.userId);
    if (!user?.passwordHash) {
      throw new AppError("User not found", StatusCodes.NOT_FOUND, "USER_NOT_FOUND");
    }

    const cocok = await verifyPassword(user.passwordHash, input.currentPassword);
    if (!cocok) {
      // Pesannya sengaja tidak membedakan "akun tidak ada" dari "password
      // salah"; keduanya menghasilkan jawaban yang sama.
      throw new AppError(
        "Password lama tidak cocok.",
        StatusCodes.UNAUTHORIZED,
        "INVALID_CREDENTIALS"
      );
    }

    await this.authRepository.applyPasswordChange({
      userId: user.id,
      passwordHash: await hashPassword(input.newPassword),
      now: new Date()
    });
  }

  async me(userId: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new AppError("User not found", StatusCodes.NOT_FOUND, "USER_NOT_FOUND");
    }

    return toPublicUser(user);
  }

  private async issueTokenPair(userId: string, role: UserRole, context: AuthClientContext) {
    // Versi otorisasi dibaca SEKARANG dan disematkan pada kedua token.
    // Token yang lahir setelah pencabutan otomatis membawa versi baru dan
    // langsung sah — termasuk bila diterbitkan pada detik yang sama.
    const authVersion = await this.authRepository.getAuthVersion(userId);
    // Kanal distempel dari konteks login (server-stamped per endpoint, K1c).
    const channel = context.channel;
    const channelClaim = channel !== undefined ? { channel } : {};
    const provisionalSessionId = crypto.randomUUID();
    const accessToken = signAccessToken({ sub: userId, role, sessionId: provisionalSessionId, authVersion, ...channelClaim });
    const refreshToken = signRefreshToken({ sub: userId, role, sessionId: provisionalSessionId, authVersion, ...channelClaim });
    const expiresAt = this.refreshExpiryDate();

    const session = await this.authRepository.createSession({
      userId,
      refreshTokenHash: this.hashToken(refreshToken),
      ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      ...(context.ipAddress !== undefined ? { ipAddress: context.ipAddress } : {}),
      expiresAt
    });

    const finalAccessToken = signAccessToken({ sub: userId, role, sessionId: session.id, authVersion, ...channelClaim });
    const finalRefreshToken = signRefreshToken({ sub: userId, role, sessionId: session.id, authVersion, ...channelClaim });

    await this.authRepository.rotateSession(
      session.id,
      this.hashToken(refreshToken),
      this.hashToken(finalRefreshToken),
      expiresAt
    );

    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new AppError("User not found after session creation", StatusCodes.INTERNAL_SERVER_ERROR, "USER_SESSION_ERROR");
    }

    return {
      user: toPublicUser(user),
      accessToken: finalAccessToken,
      refreshToken: finalRefreshToken,
      expiresAt
    };
  }

  private refreshExpiryDate() {
    const date = new Date();
    date.setDate(date.getDate() + env.JWT_REFRESH_TTL_DAYS);
    return date;
  }

  private hashToken(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private generateOtp() {
    return crypto.randomInt(100000, 999999).toString();
  }

  private generateReferralCode(fullName: string) {
    const prefix = fullName.replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase().padEnd(4, "TAPG");
    return `${prefix}${crypto.randomInt(100000, 999999)}`;
  }

  private async generateUniqueReferralCode(fullName: string) {
    for (let attempt = 1; attempt <= AuthService.maxReferralCodeAttempts; attempt += 1) {
      const referralCode = this.generateReferralCode(fullName);
      const existing = await this.authRepository.findUserByReferralCode(referralCode);
      if (!existing) {
        return referralCode;
      }
    }

    throw new AppError(
      "Kode referral belum dapat dibuat. Silakan coba lagi.",
      StatusCodes.CONFLICT,
      "REFERRAL_CODE_COLLISION"
    );
  }

  private isReferralCodeUniqueViolation(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return false;
    }

    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.includes("referral_code") || target.includes("referralCode");
    }
    return typeof target === "string" && target.toLowerCase().includes("referral");
  }
}
