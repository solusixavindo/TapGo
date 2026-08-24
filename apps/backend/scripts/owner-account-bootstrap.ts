/**
 * CLI bootstrap akun pemilik (SUPER_ADMIN_VIP) — offline, eksplisit, tercatat.
 *
 * Skrip ini untuk SATU keadaan: pemilik kehilangan akses ke akun puncaknya dan
 * perlu memulihkannya tanpa membuka jalur HTTP apa pun. Ia boleh berjalan di
 * dua mode:
 *
 * - Akun dengan nomor itu SUDAH ADA  → setel ulang password, naikkan ke
 *   SUPER_ADMIN_VIP, cabut seluruh sesi (authVersion naik + sesi di-revoke).
 * - Akun BELUM ADA → buat akun baru langsung ber-role SUPER_ADMIN_VIP.
 *
 * Dua aturan yang tidak boleh dilonggarkan:
 *
 * 1. Password TIDAK PERNAH diterima lewat argumen CLI (akan tercatat di shell
 *    history dan proses list). Ia wajib datang dari env TAPGO_OWNER_PASSWORD.
 * 2. Setelah akun pemilik berdiri, setiap pemegang SUPER_ADMIN_VIP LAIN
 *    diturunkan ke SUPER_ADMIN dalam transaksi yang sama — sesuai keputusan
 *    pemilik bahwa kredensial ini satu-satunya pemegang role puncak.
 *
 * Jalankan (di server, dari apps/backend):
 *   read -s TAPGO_OWNER_PASSWORD && export TAPGO_OWNER_PASSWORD
 *   npm run admin:owner-bootstrap -- \
 *     --phone 08139536886 \
 *     --full-name "Nama Pemilik" \
 *     --confirm-owner-bootstrap
 *
 * Output tidak pernah memuat password, nomor utuh, maupun PII lain.
 */
import crypto from "node:crypto";
import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "../src/core/security/passwordHasher.js";
import { normalizePhoneNumber, phoneLookupVariants } from "../src/core/security/phone.js";

const CONFIRM_FLAG = "--confirm-owner-bootstrap";
const MIN_PASSWORD_LENGTH = 8;

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`GAGAL: ${message}`);
  process.exit(1);
}

function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
}

function generateReferralCode(fullName: string): string {
  const prefix = fullName.replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase().padEnd(4, "TAPG");
  return `${prefix}${crypto.randomInt(100000, 999999)}`;
}

async function main() {
  if (!process.argv.includes(CONFIRM_FLAG)) {
    fail(`tindakan ini menyetel otoritas tertinggi sistem; ulangi dengan ${CONFIRM_FLAG}`);
  }

  const rawPhone = readArg("--phone");
  if (!rawPhone) {
    fail("--phone wajib diisi (nomor yang akan menjadi akun pemilik)");
  }
  const phone = normalizePhoneNumber(rawPhone);
  if (!/^0\d{8,14}$/.test(phone)) {
    fail("--phone harus berupa nomor Indonesia valid (08…, 9-15 digit)");
  }

  const fullName = readArg("--full-name")?.trim() || "Pemilik TapGo";

  const password = process.env.TAPGO_OWNER_PASSWORD;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    fail(`env TAPGO_OWNER_PASSWORD wajib diisi, minimal ${MIN_PASSWORD_LENGTH} karakter`);
  }

  const prisma = new PrismaClient();
  try {
    const variants = phoneLookupVariants(phone);
    const existing = await prisma.user.findFirst({ where: { phone: { in: variants } } });
    const passwordHash = await hashPassword(password);
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      let userId: string;
      let previousRole: UserRole | null = null;

      if (existing) {
        previousRole = existing.role;
        userId = existing.id;
        await tx.user.update({
          where: { id: existing.id },
          data: {
            role: "SUPER_ADMIN_VIP",
            status: "ACTIVE",
            passwordHash,
            // Naikkan authVersion agar SELURUH token lama akun ini gugur seketika.
            authVersion: { increment: 1 },
            sessionsRevokedAt: now
          }
        });
        await tx.session.updateMany({
          where: { userId: existing.id, revokedAt: null },
          data: { revokedAt: now }
        });
      } else {
        // Kode referral unik wajib ada untuk setiap akun baru.
        let referralCode = generateReferralCode(fullName);
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const collision = await tx.user.findUnique({ where: { referralCode } });
          if (!collision) break;
          referralCode = generateReferralCode(fullName);
          if (attempt === 9) fail("kode referral unik belum dapat dibuat, coba lagi");
        }
        const created = await tx.user.create({
          data: {
            fullName,
            phone,
            passwordHash,
            role: "SUPER_ADMIN_VIP",
            status: "ACTIVE",
            referralCode
          },
          select: { id: true }
        });
        userId = created.id;
      }

      // Keputusan pemilik: kredensial ini satu-satunya pemegang role puncak.
      // Pemegang VIP lain diturunkan ke SUPER_ADMIN (bukan dicabut ke USER,
      // supaya kewenangan operasional mereka tidak hilang diam-diam).
      const otherVips = await tx.user.findMany({
        where: { role: "SUPER_ADMIN_VIP", id: { not: userId } },
        select: { id: true, phone: true }
      });
      for (const vip of otherVips) {
        await tx.user.update({
          where: { id: vip.id },
          data: {
            role: "SUPER_ADMIN",
            authVersion: { increment: 1 },
            sessionsRevokedAt: now
          }
        });
        await tx.session.updateMany({
          where: { userId: vip.id, revokedAt: null },
          data: { revokedAt: now }
        });
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "SUPER_ADMIN_VIP_REVOKED",
            entityType: "USER",
            entityId: vip.id,
            metadata: {
              previousRole: "SUPER_ADMIN_VIP",
              newRole: "SUPER_ADMIN",
              source: "OWNER_BOOTSTRAP",
              reason: "OWNER_ACCOUNT_MUST_BE_SOLE_TOP_LEVEL"
            }
          }
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: null,
          action: existing ? "OWNER_ACCOUNT_CREDENTIALS_RESET" : "OWNER_ACCOUNT_CREATED",
          entityType: "USER",
          entityId: userId,
          metadata: {
            previousRole,
            newRole: "SUPER_ADMIN_VIP",
            sessionsRevoked: true,
            demotedVipCount: otherVips.length,
            source: "OWNER_BOOTSTRAP_CLI"
          }
        }
      });

      return { userId, previousRole, demotedVips: otherVips.map((vip) => maskPhone(vip.phone)) };
    });

    console.log(
      JSON.stringify({
        status: "OK",
        mode: existing ? "reset" : "created",
        phone: maskPhone(phone),
        userId: result.userId,
        previousRole: result.previousRole,
        newRole: "SUPER_ADMIN_VIP",
        sessionsRevoked: true,
        demotedOtherVips: result.demotedVips
      })
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
