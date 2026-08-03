import { AuthChallengeChannel, AuthChallengePurpose, PrismaClient, User } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { hashPassword } from "../../../core/security/passwordHasher.js";
import { phoneLookupVariants } from "../../../core/security/phone.js";
import {
  AUTH_RECOVERY_KEY_VERSION,
  isAuthRecoveryConfigured,
  digestDestination,
  digestEquals,
  digestOtpCode,
  digestResetToken,
  generateOtpCode,
  generateResetToken
} from "../../../core/security/otpDigest.js";
import { OtpDeliveryProvider, channelUnavailableError } from "../domain/OtpDeliveryProvider.js";

/**
 * Pemulihan akun dan verifikasi kepemilikan kontak.
 *
 * Respons publik untuk permintaan pemulihan SELALU sama, baik akun ditemukan
 * maupun tidak. Tidak ada kode error, status HTTP, maupun bentuk payload yang
 * dapat dipakai untuk account enumeration.
 */

export const RECOVERY_GENERIC_MESSAGE =
  "Jika akun ditemukan, instruksi pemulihan telah dikirim.";

export const AUTH_RECOVERY_INVALID_OR_EXPIRED = "AUTH_RECOVERY_INVALID_OR_EXPIRED";
export const AUTH_RECOVERY_ATTEMPTS_EXCEEDED = "AUTH_RECOVERY_ATTEMPTS_EXCEEDED";
export const AUTH_RECOVERY_RATE_LIMITED = "AUTH_RECOVERY_RATE_LIMITED";
export const AUTH_CONTACT_NOT_VERIFIED = "AUTH_CONTACT_NOT_VERIFIED";
export const AUTH_PASSWORD_POLICY_FAILED = "AUTH_PASSWORD_POLICY_FAILED";

/** Umur tantangan OTP. */
export const OTP_TTL_MS = 5 * 60 * 1000;
/** Jeda minimum antar pengiriman ulang untuk satu tantangan. */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/** Percobaan salah maksimum sebelum tantangan dimatikan. */
export const OTP_MAX_ATTEMPTS = 5;
/** Umur reset token setelah OTP terbukti benar. */
export const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
/**
 * Durasi minimum endpoint permintaan pemulihan.
 *
 * Tanpa lantai waktu ini, akun yang tidak ada akan merespons jauh lebih cepat
 * daripada akun yang ada (yang melakukan digest + tulis database + panggil
 * provider), sehingga selisih waktu menjadi oracle keberadaan akun.
 */
export const RECOVERY_MIN_RESPONSE_MS = 350;

export type RecoveryContext = {
  ipAddress?: string;
  userAgent?: string;
};

type ChallengeTarget = {
  user: User;
  channel: AuthChallengeChannel;
  destination: string;
};

export type PasswordPolicyIssue = "TOO_SHORT" | "TOO_LONG" | "NEEDS_LETTER_AND_DIGIT";

/**
 * Kebijakan password untuk password BARU.
 *
 * Login lama tetap memakai aturan minimum 6 karakter agar akun yang sudah ada
 * tidak terkunci. Kebijakan yang lebih ketat ini hanya berlaku saat pengguna
 * menetapkan password baru.
 */
export function validatePasswordPolicy(password: string): PasswordPolicyIssue | null {
  if (password.length < 8) {
    return "TOO_SHORT";
  }
  if (password.length > 128) {
    return "TOO_LONG";
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "NEEDS_LETTER_AND_DIGIT";
  }
  return null;
}

/** Menyamarkan nomor telepon: hanya 4 digit terakhir yang ditampilkan. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) {
    return "*".repeat(digits.length);
  }
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** Menyamarkan email: satu huruf pertama pada local part, domain utuh. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) {
    return "*".repeat(email.length);
  }
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes("@");
}

async function enforceMinimumDuration<T>(startedAt: number, value: T): Promise<T> {
  const elapsed = Date.now() - startedAt;
  const remaining = RECOVERY_MIN_RESPONSE_MS - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  return value;
}

function invalidOrExpired(): AppError {
  return new AppError(
    "Kode tidak valid atau sudah kedaluwarsa.",
    StatusCodes.BAD_REQUEST,
    AUTH_RECOVERY_INVALID_OR_EXPIRED
  );
}

export class AccountRecoveryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: OtpDeliveryProvider
  ) {}

  // -------------------------------------------------------------------
  // P2 — pemulihan password
  // -------------------------------------------------------------------

  /**
   * Langkah 1. Selalu mengembalikan pesan generik yang sama.
   *
   * Kegagalan internal apa pun — akun tidak ada, kanal tidak memenuhi syarat,
   * cooldown, provider mati — tidak boleh mengubah respons publik. Kegagalan
   * provider sengaja ditelan di sini karena membedakannya akan membocorkan
   * bahwa akun tersebut memang ada.
   */
  async requestRecovery(input: { identifier: string; context: RecoveryContext }) {
    const startedAt = Date.now();
    const response = { message: RECOVERY_GENERIC_MESSAGE };

    // KONTRAK RESPONS (Owner Decision Stage R2.1).
    //
    // Ketidaktersediaan yang bersifat GLOBAL — secret belum dikonfigurasi atau
    // tidak ada provider yang mendukung kanal mana pun — diperiksa SEBELUM
    // account lookup, lalu dijawab 503 yang seragam.
    //
    // Diperiksa lebih dulu justru demi keamanan: keputusan ini tidak
    // bergantung pada identifier sama sekali, sehingga status, body, dan waktu
    // responsnya identik untuk nomor terdaftar maupun tidak. Bila diperiksa
    // setelah lookup, lamanya pencarian akun akan menjadi oracle.
    //
    // Kegagalan yang SPESIFIK TERHADAP TARGET — akun tidak ada, kanal tidak
    // memenuhi syarat, cooldown, atau provider menolak satu tujuan tertentu —
    // tetap menghasilkan 202 generik di bawah.
    if (!this.isRecoveryGloballyAvailable()) {
      throw channelUnavailableError();
    }

    let target: ChallengeTarget | null = null;
    try {
      target = await this.resolveRecoveryTarget(input.identifier);
    } catch {
      return enforceMinimumDuration(startedAt, response);
    }

    if (!target) {
      return enforceMinimumDuration(startedAt, response);
    }

    try {
      await this.issueChallenge({
        user: target.user,
        purpose: "PASSWORD_RECOVERY",
        channel: target.channel,
        destination: target.destination
      });
    } catch {
      // Ditelan dengan sengaja: lihat doc-comment di atas.
    }

    return enforceMinimumDuration(startedAt, response);
  }

  /**
   * Apakah pemulihan dapat beroperasi sama sekali, tanpa melihat identifier.
   *
   * Sengaja tidak menerima argumen: hasilnya harus mustahil bergantung pada
   * akun mana pun, karena nilainya menentukan status HTTP yang terlihat publik.
   */
  private isRecoveryGloballyAvailable(): boolean {
    if (!isAuthRecoveryConfigured()) {
      return false;
    }
    return this.provider.supports("PHONE") || this.provider.supports("EMAIL");
  }

  /** Langkah 2. Membuktikan OTP dan menerbitkan reset token sekali pakai. */
  async verifyRecovery(input: { identifier: string; code: string }) {
    const target = await this.resolveRecoveryTarget(input.identifier);
    if (!target) {
      // Bentuk error sama persis dengan OTP salah, sehingga langkah ini pun
      // tidak dapat dipakai untuk menebak keberadaan akun.
      throw invalidOrExpired();
    }

    const challenge = await this.consumeAttempt({
      userId: target.user.id,
      purpose: "PASSWORD_RECOVERY",
      code: input.code
    });

    const resetToken = generateResetToken();
    await this.prisma.authChallenge.update({
      where: { id: challenge.id },
      data: {
        verifiedAt: new Date(),
        resetTokenDigest: digestResetToken(resetToken),
        resetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS)
      }
    });

    return {
      resetToken,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      maskedDestination:
        target.channel === "PHONE" ? maskPhone(target.destination) : maskEmail(target.destination)
    };
  }

  /**
   * Langkah 3. Menetapkan password baru, mengonsumsi tantangan secara atomik,
   * dan mencabut seluruh sesi.
   *
   * TIDAK menerbitkan token apa pun: pengguna wajib login ulang.
   */
  async resetPassword(input: { resetToken: string; newPassword: string }) {
    const policyIssue = validatePasswordPolicy(input.newPassword);
    if (policyIssue) {
      throw new AppError(
        "Password baru belum memenuhi ketentuan.",
        StatusCodes.BAD_REQUEST,
        AUTH_PASSWORD_POLICY_FAILED
      );
    }

    const tokenDigest = digestResetToken(input.resetToken);
    const now = new Date();

    // Konsumsi atomik: hanya satu permintaan yang dapat mengubah baris dari
    // "belum dikonsumsi" menjadi "dikonsumsi". Pemenang ditentukan database,
    // bukan urutan pembacaan di aplikasi.
    const claimed = await this.prisma.authChallenge.updateMany({
      where: {
        resetTokenDigest: tokenDigest,
        consumedAt: null,
        verifiedAt: { not: null },
        resetExpiresAt: { gt: now }
      },
      data: { consumedAt: now }
    });

    if (claimed.count !== 1) {
      throw invalidOrExpired();
    }

    const challenge = await this.prisma.authChallenge.findFirstOrThrow({
      where: { resetTokenDigest: tokenDigest }
    });

    const passwordHash = await hashPassword(input.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: challenge.userId },
        data: {
          passwordHash,
          // Kepemilikan kanal baru saja dibuktikan lewat OTP. Untuk akun
          // legacy inilah saat phoneVerifiedAt pertama kali terisi — lewat
          // bukti nyata, bukan lewat backfill migration.
          ...(challenge.channel === "PHONE" ? { phoneVerifiedAt: now } : {}),
          sessionsRevokedAt: now
        }
      }),
      this.prisma.session.updateMany({
        where: { userId: challenge.userId, revokedAt: null },
        data: { revokedAt: now }
      }),
      // Tantangan lain milik user ini dimatikan agar tidak ada jalur kedua
      // yang masih terbuka setelah password berganti.
      this.prisma.authChallenge.updateMany({
        where: { userId: challenge.userId, consumedAt: null },
        data: { consumedAt: now }
      })
    ]);

    return { userId: challenge.userId, revokedAt: now };
  }

  // -------------------------------------------------------------------
  // P3 — verifikasi kontak (terautentikasi)
  // -------------------------------------------------------------------

  /**
   * Meminta OTP verifikasi untuk pengguna yang sudah login.
   *
   * Berbeda dari alur pemulihan, di sini identitas pemanggil sudah pasti,
   * sehingga destination yang disamarkan boleh dikembalikan tanpa risiko
   * enumeration.
   */
  async requestContactVerification(input: {
    userId: string;
    channel: AuthChallengeChannel;
  }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

    const destination = input.channel === "PHONE" ? user.phone : user.email;
    if (!destination) {
      throw new AppError(
        "Email belum diisi pada akun ini.",
        StatusCodes.BAD_REQUEST,
        AUTH_CONTACT_NOT_VERIFIED
      );
    }

    await this.issueChallenge({
      user,
      purpose: input.channel === "PHONE" ? "PHONE_VERIFICATION" : "EMAIL_VERIFICATION",
      channel: input.channel,
      destination
    });

    return {
      maskedDestination:
        input.channel === "PHONE" ? maskPhone(destination) : maskEmail(destination),
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      resendCooldownSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000)
    };
  }

  /** Mengonfirmasi OTP verifikasi dan menandai kanal sebagai terbukti. */
  async confirmContactVerification(input: {
    userId: string;
    channel: AuthChallengeChannel;
    code: string;
  }) {
    const purpose: AuthChallengePurpose =
      input.channel === "PHONE" ? "PHONE_VERIFICATION" : "EMAIL_VERIFICATION";

    const challenge = await this.consumeAttempt({
      userId: input.userId,
      purpose,
      code: input.code
    });

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.authChallenge.update({
        where: { id: challenge.id },
        data: { verifiedAt: now, consumedAt: now }
      }),
      this.prisma.user.update({
        where: { id: input.userId },
        data:
          input.channel === "PHONE" ? { phoneVerifiedAt: now } : { emailVerifiedAt: now }
      })
    ]);

    return { channel: input.channel, verifiedAt: now };
  }

  /** Status verifikasi untuk verification gate di aplikasi. */
  async verificationStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { phone: true, email: true, phoneVerifiedAt: true, emailVerifiedAt: true }
    });

    return {
      phone: {
        masked: maskPhone(user.phone),
        verified: user.phoneVerifiedAt !== null,
        verifiedAt: user.phoneVerifiedAt
      },
      email: user.email
        ? {
            masked: maskEmail(user.email),
            verified: user.emailVerifiedAt !== null,
            verifiedAt: user.emailVerifiedAt
          }
        : null,
      // Nomor telepon adalah primary identifier dan wajib terbukti.
      requiresVerification: user.phoneVerifiedAt === null
    };
  }

  // -------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------

  /**
   * Menentukan akun dan kanal yang berhak menerima OTP pemulihan.
   *
   * KEPUTUSAN YANG PERLU DICATAT — dua keputusan Owner bersinggungan di sini:
   *   - Keputusan 3: pemulihan hanya lewat kanal yang sudah diverifikasi.
   *   - Keputusan 4: akun legacy belum punya status verifikasi dan harus
   *     membuktikan kepemilikan lewat OTP.
   *
   * Keduanya didamaikan berdasarkan peran kanal:
   *   - PHONE adalah primary identifier. OTP ke nomor terdaftar ITU SENDIRI
   *     adalah bukti kepemilikan, sehingga diizinkan meski phoneVerifiedAt
   *     masih NULL. Reset yang berhasil kemudian mengisi phoneVerifiedAt.
   *     Tanpa ini, seluruh akun legacy akan terkunci permanen.
   *   - EMAIL bersifat opsional dan sekunder, sehingga WAJIB sudah
   *     terverifikasi. Email yang belum terbukti tidak pernah menjadi
   *     recovery channel.
   */
  private async resolveRecoveryTarget(identifier: string): Promise<ChallengeTarget | null> {
    const trimmed = identifier.trim();
    if (!trimmed) {
      return null;
    }

    if (isEmailIdentifier(trimmed)) {
      const email = trimmed.toLowerCase();
      const user = await this.prisma.user.findFirst({ where: { email } });
      if (!user?.email || user.status !== "ACTIVE") {
        return null;
      }
      if (user.emailVerifiedAt === null) {
        return null;
      }
      return { user, channel: "EMAIL", destination: user.email };
    }

    const user = await this.prisma.user.findFirst({
      where: { phone: { in: phoneLookupVariants(trimmed) } },
      orderBy: { createdAt: "asc" }
    });
    if (!user || user.status !== "ACTIVE") {
      return null;
    }
    return { user, channel: "PHONE", destination: user.phone };
  }

  /**
   * Membuat atau memperbarui satu tantangan aktif, lalu mengirim OTP.
   *
   * Satu tantangan aktif per (user, purpose) ditegakkan partial unique index
   * pada database; pengiriman ulang memperbarui baris yang sama, bukan
   * membuat baris baru.
   */
  private async issueChallenge(input: {
    user: User;
    purpose: AuthChallengePurpose;
    channel: AuthChallengeChannel;
    destination: string;
  }) {
    const now = new Date();
    const existing = await this.prisma.authChallenge.findFirst({
      where: { userId: input.user.id, purpose: input.purpose, consumedAt: null }
    });

    if (existing && now.getTime() - existing.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new AppError(
        "Mohon tunggu sebelum meminta kode lagi.",
        StatusCodes.TOO_MANY_REQUESTS,
        AUTH_RECOVERY_RATE_LIMITED
      );
    }

    const code = generateOtpCode();
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
    const payload = {
      destinationDigest: digestDestination(input.destination),
      codeDigest: digestOtpCode(code),
      keyVersion: AUTH_RECOVERY_KEY_VERSION,
      channel: input.channel,
      // Percobaan direset saat kode baru dikirim: batas percobaan berlaku
      // per kode, bukan seumur hidup akun.
      attempts: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
      lastSentAt: now,
      expiresAt,
      verifiedAt: null,
      resetTokenDigest: null,
      resetExpiresAt: null
    };

    if (existing) {
      await this.prisma.authChallenge.update({
        where: { id: existing.id },
        data: { ...payload, resendCount: { increment: 1 } }
      });
    } else {
      await this.prisma.authChallenge.create({
        data: { userId: input.user.id, purpose: input.purpose, resendCount: 0, ...payload }
      });
    }

    // Pengiriman dilakukan SETELAH tantangan tersimpan. Bila provider gagal,
    // tantangan tetap ada tetapi tidak ada kode yang beredar — aman, dan
    // pengguna dapat mencoba lagi setelah cooldown.
    await this.provider.send({
      channel: input.channel,
      destination: input.destination,
      code,
      expiresAt,
      purpose: input.purpose
    });
  }

  /**
   * Memeriksa satu percobaan OTP.
   *
   * Penghitung percobaan dinaikkan lebih dulu dan secara atomik, sehingga
   * permintaan paralel tidak dapat memakai kuota yang sama dua kali.
   */
  private async consumeAttempt(input: {
    userId: string;
    purpose: AuthChallengePurpose;
    code: string;
  }) {
    const now = new Date();
    // `verifiedAt: null` membuat OTP benar-benar sekali pakai. Tanpa filter
    // ini, kode yang sudah terbukti masih dapat diverifikasi berulang untuk
    // menerbitkan reset token kedua — baris tetap ada sampai langkah reset
    // mengonsumsinya.
    const challenge = await this.prisma.authChallenge.findFirst({
      where: {
        userId: input.userId,
        purpose: input.purpose,
        consumedAt: null,
        verifiedAt: null
      }
    });

    if (!challenge || challenge.expiresAt <= now) {
      throw invalidOrExpired();
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new AppError(
        "Percobaan kode sudah melebihi batas.",
        StatusCodes.TOO_MANY_REQUESTS,
        AUTH_RECOVERY_ATTEMPTS_EXCEEDED
      );
    }

    const claimed = await this.prisma.authChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        attempts: challenge.attempts,
        expiresAt: { gt: now }
      },
      data: { attempts: { increment: 1 } }
    });

    if (claimed.count !== 1) {
      // Kalah balapan dengan permintaan lain: perlakukan sebagai gagal,
      // jangan coba ulang, agar batas percobaan tidak dapat dilewati.
      throw invalidOrExpired();
    }

    if (!digestEquals(digestOtpCode(input.code), challenge.codeDigest)) {
      throw invalidOrExpired();
    }

    return challenge;
  }
}
