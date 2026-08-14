import { AbuseFlagSeverity, Prisma, PrismaClient, UserRole } from "@prisma/client";
import crypto from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { phoneLookupVariants } from "../../../core/security/phone.js";
import {
  AuthRepository,
  CreateSessionInput,
  CreateUserInput,
  SessionRecord
} from "../domain/AuthRepository.js";

// P1-4: advisory-lock key konstan untuk klaim kuota benefit Basic PPOB.
// Banyak registrasi yang meng-UPDATE baris kuota yang sama harus diantre, bukan
// dibiarkan saling menabrak. Advisory lock (lock DB tingkat transaksi)
// mengantre klaim sehingga tetap atomik, tidak over-grant, dan registrasi tidak
// gagal karena race — tanpa memerlukan Serializable isolation (lihat catatan
// pada opsi $transaction di createUser).
const BASIC_PPOB_QUOTA_LOCK_KEY = 552025001;

/**
 * Namespace (classid) advisory lock per jenis sinyal anti-abuse registrasi.
 *
 * Memakai bentuk dua-argumen pg_advisory_xact_lock(classid, objid) agar sinyal
 * berbeda tidak pernah bertabrakan meski objid-nya sama. Nilai sensitif tidak
 * pernah menjadi bagian dari key: objid diturunkan lewat SHA-256 (lihat
 * advisoryObjectId) dan tidak di-log.
 */
const ABUSE_LOCK_NAMESPACE = {
  device: 5581,
  ip: 5582,
  referral: 5583
} as const;

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findUserByPhone(phone: string) {
    return this.prisma.user.findFirst({
      where: { phone: { in: phoneLookupVariants(phone) } },
      orderBy: { createdAt: "asc" }
    });
  }

  findUserByReferralCode(referralCode: string) {
    return this.prisma.user.findUnique({ where: { referralCode } });
  }

  async getAuthVersion(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { authVersion: true }
    });
    return user?.authVersion ?? 0;
  }

  findUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  createUser(input: CreateUserInput) {
    return this.runWithSerializationRetry(() => this.prisma.$transaction(async (tx) => {
      const basic = await tx.membership.findUnique({ where: { tier: "BASIC" } });
      // P1-4: klaim slot benefit Basic PPOB Rp5.000 secara atomik. Conditional
      // UPDATE ... RETURNING mengambil row lock pada baris kuota sehingga dua
      // registrasi yang berlomba di batas ke-1.000 tidak dapat double-claim dan
      // total penerima tidak akan melebihi limit. Hanya role USER yang memakai slot.
      let registrationBonus = new Prisma.Decimal(0);
      if (input.role === UserRole.USER) {
        // Advisory lock mengantre (bukan meng-abort) klaim kuota, sehingga
        // hanya satu registrasi menyentuh baris kuota pada satu waktu.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BASIC_PPOB_QUOTA_LOCK_KEY})`;
        const claimed = await tx.$queryRaw<Array<{ granted: number }>>`
          UPDATE "registration_quota"
          SET "granted" = "granted" + 1, "updated_at" = CURRENT_TIMESTAMP
          WHERE "key" = 'BASIC_PPOB_FIRST_1000' AND "granted" < "limit"
          RETURNING "granted"
        `;
        if (claimed.length > 0) {
          registrationBonus = new Prisma.Decimal(5000);
        }
      }
	      const sponsorReferralCode = input.sponsorReferralCode?.trim().toUpperCase();
      const sponsor = sponsorReferralCode
        ? await tx.user.findUnique({ where: { referralCode: sponsorReferralCode } })
        : null;

      if (sponsorReferralCode && !sponsor) {
        throw new AppError(
          "Kode referral tidak valid",
          StatusCodes.BAD_REQUEST,
          "SPONSOR_NOT_FOUND"
        );
      }

      const user = await tx.user.create({
        data: {
          fullName: input.fullName,
          ...(input.email !== undefined ? { email: input.email } : {}),
          phone: input.phone,
          ...(input.passwordHash !== undefined ? { passwordHash: input.passwordHash } : {}),
          role: input.role,
          referralCode: input.referralCode,
          ...(basic ? { membershipId: basic.id } : {})
        }
      });

      const wallet = await tx.wallet.create({
        data: {
          userId: user.id,
          balance: new Prisma.Decimal(0),
          cashBalance: new Prisma.Decimal(0),
          ppobBalance: registrationBonus,
          currency: "IDR"
        }
      });

      if (registrationBonus.gt(0)) {
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: "REGISTRATION_BONUS",
            amount: registrationBonus,
            referenceType: "BASIC_REGISTRATION",
            referenceId: user.id,
            metadata: {
              company: "PT. TAPGO LION INDONESIA",
              rule: "first_1000_basic_users"
            }
          }
        });
      }

	      if (sponsor) {
        const referral = await tx.referral.create({
          data: {
            sponsorId: sponsor.id,
            userId: user.id,
            metadata: {
              source: "auth_register",
              sponsorReferralCode
            }
          },
          select: { id: true }
        });

        const sponsorAncestors = await tx.referralLevel.findMany({
          where: { descendantId: sponsor.id },
          select: { ancestorId: true, level: true },
          orderBy: { level: "asc" }
        });

        await tx.referralLevel.createMany({
          data: [
            { ancestorId: sponsor.id, descendantId: user.id, level: 1 },
            ...sponsorAncestors
              .filter((ancestor) => ancestor.level + 1 <= 10)
              .map((ancestor) => ({
                ancestorId: ancestor.ancestorId,
                descendantId: user.id,
                level: ancestor.level + 1
              }))
          ],
          skipDuplicates: true
        });

        // Sponsor bonus is intentionally posted from the paid membership approval flow.
	        // Registration only persists the genealogy so pending/failed upgrades cannot pay bonuses.
	      }

	      await this.recordRegistrationEvent(tx, {
	        userId: user.id,
	        normalizedPhone: input.phone,
	        ...(sponsorReferralCode !== undefined ? { sponsorReferralCode } : {}),
	        ...(input.registrationEvent ?? {})
	      });

	      return user;
    }, {
      // Isolation: Read Committed (default PostgreSQL).
      //
      // Serializable SENGAJA tidak dipakai di sini. Invarian kuota first-1000
      // dijamin sepenuhnya oleh dua mekanisme di atas, bukan oleh isolation
      // level: (1) pg_advisory_xact_lock menyerialkan klaim, dan (2) conditional
      // UPDATE ... WHERE "granted" < "limit" RETURNING bersifat atomik — row
      // lock ditahan sampai COMMIT dan predikat dievaluasi ulang terhadap versi
      // baris terbaru, sehingga over-grant tidak mungkin terjadi. Seluruh
      // penambahan counter, pembuatan wallet, dan kredit bonus berada dalam satu
      // transaksi, jadi rollback membatalkan semuanya.
      //
      // Sebaliknya, Serializable memunculkan SQLSTATE 40001 ("could not
      // serialize access due to read/write dependencies", Prisma P2034) sebagai
      // false positive pada registrasi konkuren — konflik SSI pada INSERT ke
      // users/wallets/registration_events, bukan pada baris kuota. Di bawah 20
      // registrasi bersamaan, retry bisa habis dan registrasi yang sah gagal.
      timeout: 15000
    }));
  }

  // P1-4: jaring pengaman untuk kegagalan transient DB yang SUDAH dipastikan
  // aman di-retry (lihat isSerializationFailure). Transaksi yang dibatalkan
  // PostgreSQL selalu di-rollback penuh — penambahan counter kuota, pembuatan
  // user/wallet, dan kredit bonus batal bersama — sehingga menjalankan ulang
  // seluruh operasi tidak dapat menghasilkan double credit atau over-grant.
  //
  // Backoff memakai jitter acak: tanpa jitter, seluruh registrasi yang
  // bertabrakan akan retry pada tick yang sama (thundering herd) dan terus
  // bertabrakan sampai attempt habis.
  private async runWithSerializationRetry<T>(
    operation: () => Promise<T>,
    maxAttempts = 8
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (this.isSerializationFailure(error)) {
          lastError = error;
          if (attempt < maxAttempts) {
            const base = 10 * attempt;
            const delay = base + Math.floor(Math.random() * base);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          // Attempt habis: kembalikan error aplikasi terkendali, bukan error
          // Prisma mentah, agar klien menerima 503 + kode stabil dan tidak
          // pernah melihat detail internal database.
          throw new AppError(
            "Sistem sedang sibuk. Silakan coba lagi sesaat lagi.",
            StatusCodes.SERVICE_UNAVAILABLE,
            "REGISTRATION_TEMPORARILY_UNAVAILABLE"
          );
        }
        throw error;
      }
    }
    throw lastError;
  }

  private isSerializationFailure(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }
    // P2034/P2037: write conflict / deadlock pada transaksi Prisma.
    if (error.code === "P2034" || error.code === "P2037") {
      return true;
    }
    // P2010: raw query gagal. Klaim kuota memakai $queryRaw, sehingga
    // serialization failure PostgreSQL (SQLSTATE 40001) dan deadlock (40P01)
    // muncul terbungkus di sini pada error.meta.code.
    if (error.code === "P2010") {
      const pgCode = (error.meta as { code?: string } | undefined)?.code;
      return pgCode === "40001" || pgCode === "40P01";
    }
    return false;
  }

	  private async recordRegistrationEvent(
	    tx: Prisma.TransactionClient,
	    input: {
	      userId: string;
	      normalizedPhone: string;
	      sponsorReferralCode?: string;
	      deviceFingerprintHash?: string;
	      ipAddress?: string;
	      userAgent?: string;
	    }
	  ) {
	    const suspiciousReasons: string[] = [];
	    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

	    // Serialkan evaluasi sinyal anti-abuse per-key (bukan satu lock global).
	    // Tanpa ini, dua registrasi bersamaan yang berbagi device/IP/kode
	    // referral bisa sama-sama membaca count lama sehingga flag tidak naik.
	    await this.lockAbuseSignals(tx, input);

	    if (input.deviceFingerprintHash) {
	      const sameDeviceCount = await tx.registrationEvent.count({
	        where: { deviceFingerprintHash: input.deviceFingerprintHash }
	      });
	      if (sameDeviceCount >= 1) {
	        suspiciousReasons.push("DEVICE_ALREADY_REGISTERED");
	      }
	    }

	    if (input.ipAddress) {
	      const sameIpRecentCount = await tx.registrationEvent.count({
	        where: {
	          ipAddress: input.ipAddress,
	          createdAt: { gte: since24h }
	        }
	      });
	      if (sameIpRecentCount >= 5) {
	        suspiciousReasons.push("IP_HIGH_VELOCITY_REGISTRATION");
	      }
	    }

	    if (input.sponsorReferralCode) {
	      const referralRecentCount = await tx.registrationEvent.count({
	        where: {
	          referralCodeUsed: input.sponsorReferralCode,
	          createdAt: { gte: since24h }
	        }
	      });
	      if (referralRecentCount >= 10) {
	        suspiciousReasons.push("REFERRAL_HIGH_VELOCITY_REGISTRATION");
	      }
	    }

	    const event = await tx.registrationEvent.create({
	      data: {
	        userId: input.userId,
	        normalizedPhone: input.normalizedPhone,
	        phoneHash: this.hashValue(input.normalizedPhone),
	        ...(input.deviceFingerprintHash !== undefined ? { deviceFingerprintHash: input.deviceFingerprintHash } : {}),
	        ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
	        ...(input.userAgent !== undefined ? { userAgent: input.userAgent.slice(0, 500) } : {}),
	        ...(input.sponsorReferralCode !== undefined ? { referralCodeUsed: input.sponsorReferralCode } : {}),
	        suspicious: suspiciousReasons.length > 0,
	        ...(suspiciousReasons.length > 0 ? { suspiciousReasons } : {})
	      },
	      select: { id: true }
	    });

	    if (suspiciousReasons.length === 0) {
	      return;
	    }

	    await tx.abuseFlag.createMany({
	      data: suspiciousReasons.map((reason) => ({
	        userId: input.userId,
	        registrationEventId: event.id,
	        flagType: "REGISTRATION_ABUSE_RISK",
	        severity: this.severityForReason(reason),
	        reason,
	        metadata: {
	          normalizedPhoneHash: this.hashValue(input.normalizedPhone),
	          hasDeviceFingerprint: Boolean(input.deviceFingerprintHash),
	          hasReferralCode: Boolean(input.sponsorReferralCode)
	        }
	      }))
	    });
	  }

	  private hashValue(value: string) {
	    return crypto.createHash("sha256").update(value).digest("hex");
	  }

	  /**
	   * Turunkan objid int32 signed yang deterministik dari nilai sensitif.
	   *
	   * Nilai mentah (IP, device identifier, kode referral) TIDAK pernah keluar
	   * dari fungsi ini: hanya 4 byte pertama SHA-256 yang dipakai sebagai angka
	   * lock. Angka ini tidak di-log dan tidak dikembalikan ke klien.
	   */
	  private advisoryObjectId(value: string): number {
	    return crypto.createHash("sha256").update(value).digest().readInt32BE(0);
	  }

	  /**
	   * Ambil transaction-scoped advisory lock untuk setiap sinyal anti-abuse yang
	   * relevan, sehingga blok count -> evaluate -> write event berjalan
	   * sequentially consistent terhadap registrasi lain yang berbagi key yang
	   * sama.
	   *
	   * Desain:
	   * - Dua-argumen pg_advisory_xact_lock(classid, objid). classid adalah
	   *   namespace per jenis sinyal sehingga device/IP/referral tidak pernah
	   *   bertabrakan satu sama lain.
	   * - Key di-dedupe, lalu diurutkan deterministik (classid, objid) sebelum
	   *   diambil. Semua transaksi memakai urutan yang sama, sehingga tidak ada
	   *   siklus tunggu -> tidak ada deadlock.
	   * - Lock bersifat transaction-scoped: dilepas otomatis saat COMMIT maupun
	   *   ROLLBACK, jadi kegagalan tidak meninggalkan lock menggantung.
	   * - Registrasi yang tidak membawa sinyal apa pun tidak mengambil lock.
	   */
	  private async lockAbuseSignals(
	    tx: Prisma.TransactionClient,
	    input: {
	      sponsorReferralCode?: string;
	      deviceFingerprintHash?: string;
	      ipAddress?: string;
	    }
	  ) {
	    const keys: Array<[number, number]> = [];

	    if (input.deviceFingerprintHash) {
	      keys.push([
	        ABUSE_LOCK_NAMESPACE.device,
	        this.advisoryObjectId(input.deviceFingerprintHash)
	      ]);
	    }
	    if (input.ipAddress) {
	      keys.push([ABUSE_LOCK_NAMESPACE.ip, this.advisoryObjectId(input.ipAddress)]);
	    }
	    if (input.sponsorReferralCode) {
	      keys.push([
	        ABUSE_LOCK_NAMESPACE.referral,
	        this.advisoryObjectId(input.sponsorReferralCode)
	      ]);
	    }

	    if (keys.length === 0) {
	      return;
	    }

	    // Dedupe lalu urutkan deterministik untuk mencegah deadlock.
	    const unique = new Map<string, [number, number]>();
	    for (const key of keys) {
	      unique.set(`${key[0]}:${key[1]}`, key);
	    }
	    const ordered = [...unique.values()].sort(
	      (left, right) => left[0] - right[0] || left[1] - right[1]
	    );

	    for (const [classId, objectId] of ordered) {
	      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${classId}::int, ${objectId}::int)`;
	    }
	  }

	  private severityForReason(reason: string): AbuseFlagSeverity {
	    if (reason === "DEVICE_ALREADY_REGISTERED") {
	      return "HIGH";
	    }
	    if (reason === "IP_HIGH_VELOCITY_REGISTRATION") {
	      return "MEDIUM";
	    }
	    return "LOW";
	  }

  async updateLastLogin(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() }
    });
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    return this.prisma.session.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
        ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
        expiresAt: input.expiresAt
      }
    });
  }

  findSessionById(sessionId: string) {
    return this.prisma.session.findUnique({ where: { id: sessionId } });
  }

  async rotateSession(sessionId: string, refreshTokenHash: string, expiresAt: Date) {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash,
        expiresAt
      }
    });
  }

  async revokeSession(sessionId: string) {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() }
    });
  }

  async applyPasswordChange(input: {
    userId: string;
    passwordHash: string;
    now: Date;
  }) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: input.userId },
        data: {
          passwordHash: input.passwordHash,
          // Increment relatif, bukan penetapan nilai absolut: dua penggantian
          // yang berjalan bersamaan tetap konsisten karena database yang
          // menambahkannya.
          authVersion: { increment: 1 },
          sessionsRevokedAt: input.now
        }
      }),
      this.prisma.session.updateMany({
        where: { userId: input.userId, revokedAt: null },
        data: { revokedAt: input.now }
      })
    ]);
  }

  async createOtpChallenge(input: {
    phone: string;
    codeHash: string;
    purpose: string;
    expiresAt: Date;
  }) {
    await this.prisma.otpChallenge.create({ data: input });
  }
}
