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
import { env } from "../../../config/env.js";
import { AuthRepository, toPublicUser } from "../domain/AuthRepository.js";

export type AuthClientContext = {
  userAgent?: string;
  ipAddress?: string;
  deviceIdentifier?: string;
};

export class AuthService {
  private static readonly maxReferralCodeAttempts = 8;

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
	            ...(input.context.userAgent !== undefined ? { userAgent: input.context.userAgent } : {})
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

  async requestOtp(input: { phone: string; purpose: "LOGIN" | "REGISTER" }) {
    const code = this.generateOtp();
    const codeHash = await hashPassword(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.authRepository.createOtpChallenge({
      phone: input.phone,
      codeHash,
      purpose: input.purpose,
      expiresAt
    });

    return {
      expiresAt,
      delivery: "SMS",
      developmentCode: env.NODE_ENV === "production" ? undefined : code
    };
  }

  async refresh(refreshToken: string, context: AuthClientContext) {
    const payload = verifyRefreshToken(refreshToken);
    const session = await this.authRepository.findSessionById(payload.sessionId);

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new AppError("Refresh session is invalid", StatusCodes.UNAUTHORIZED, "SESSION_INVALID");
    }

    const tokenHash = this.hashToken(refreshToken);
    if (!crypto.timingSafeEqual(Buffer.from(tokenHash), Buffer.from(session.refreshTokenHash))) {
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

    const accessToken = signAccessToken({
      sub: user.id, role: user.role, sessionId: session.id, authVersion: user.authVersion
    });
    const newRefreshToken = signRefreshToken({
      sub: user.id, role: user.role, sessionId: session.id, authVersion: user.authVersion
    });
    const expiresAt = this.refreshExpiryDate();

    await this.authRepository.rotateSession(session.id, this.hashToken(newRefreshToken), expiresAt);

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
    const provisionalSessionId = crypto.randomUUID();
    const accessToken = signAccessToken({ sub: userId, role, sessionId: provisionalSessionId, authVersion });
    const refreshToken = signRefreshToken({ sub: userId, role, sessionId: provisionalSessionId, authVersion });
    const expiresAt = this.refreshExpiryDate();

    const session = await this.authRepository.createSession({
      userId,
      refreshTokenHash: this.hashToken(refreshToken),
      ...(context.userAgent !== undefined ? { userAgent: context.userAgent } : {}),
      ...(context.ipAddress !== undefined ? { ipAddress: context.ipAddress } : {}),
      expiresAt
    });

    const finalAccessToken = signAccessToken({ sub: userId, role, sessionId: session.id, authVersion });
    const finalRefreshToken = signRefreshToken({ sub: userId, role, sessionId: session.id, authVersion });

    await this.authRepository.rotateSession(session.id, this.hashToken(finalRefreshToken), expiresAt);

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
