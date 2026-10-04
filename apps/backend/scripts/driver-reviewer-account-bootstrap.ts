/**
 * CLI bootstrap akun reviewer Google Play untuk driver_app — offline, eksplisit.
 *
 * Play Console mensyaratkan akun uji yang bisa dipakai reviewer Google login
 * dan melihat alur kerja aplikasi tanpa pendampingan Owner. Skrip ini membuat
 * akun driver berstatus ACTIVE (bisa login, lihat seluruh tab: Beranda,
 * Pesanan, Pendapatan, Akun) TAPI SENGAJA TANPA kendaraan terverifikasi.
 *
 * Kenapa tanpa kendaraan: `RideService.listOffersForDriver` dan
 * `notifyNearbyDrivers` SAMA-SAMA menuntut minimal satu RideVehicle dengan
 * isActive=true DAN verificationStatus=VERIFIED sebelum driver bisa melihat
 * ATAU menerima tawaran apa pun (lihat baris "if (vehicleTypes.length === 0)
 * return []"). Tanpa kendaraan, akun reviewer bisa online/offline dan
 * menjelajahi seluruh aplikasi dengan aman, TAPI TIDAK PERNAH bisa menerima
 * pesanan sungguhan dari penumpang sungguhan — mencegah skenario reviewer
 * Google tidak sengaja "menerima" order pelanggan asli selama proses review.
 *
 * Password TIDAK PERNAH lewat argumen CLI — wajib dari env
 * TAPGO_REVIEWER_PASSWORD (pola sama seperti owner-account-bootstrap.ts).
 *
 * Jalankan (di server, dari apps/backend):
 *   read -s TAPGO_REVIEWER_PASSWORD && export TAPGO_REVIEWER_PASSWORD
 *   npm run driver:reviewer-bootstrap -- \
 *     --phone 081234567890 \
 *     --full-name "Google Play Reviewer" \
 *     --confirm-reviewer-bootstrap
 *
 * Output tidak pernah memuat password atau nomor utuh.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/core/security/passwordHasher.js";
import { normalizePhoneNumber, phoneLookupVariants } from "../src/core/security/phone.js";

const CONFIRM_FLAG = "--confirm-reviewer-bootstrap";
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

async function main() {
  if (!process.argv.includes(CONFIRM_FLAG)) {
    fail(`akun ini akan menjadi akun uji reviewer Google Play; ulangi dengan ${CONFIRM_FLAG}`);
  }

  const rawPhone = readArg("--phone");
  if (!rawPhone) {
    fail("--phone wajib diisi (nomor khusus akun reviewer, bukan nomor pribadi Owner)");
  }
  const phone = normalizePhoneNumber(rawPhone);
  if (!/^0\d{8,14}$/.test(phone)) {
    fail("--phone harus berupa nomor Indonesia valid (08…, 9-15 digit)");
  }

  const fullName = readArg("--full-name")?.trim() || "Google Play Reviewer";

  const password = process.env.TAPGO_REVIEWER_PASSWORD;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    fail(`env TAPGO_REVIEWER_PASSWORD wajib diisi, minimal ${MIN_PASSWORD_LENGTH} karakter`);
  }

  const prisma = new PrismaClient();
  try {
    const variants = phoneLookupVariants(phone);
    const existing = await prisma.user.findFirst({ where: { phone: { in: variants } } });
    const passwordHash = await hashPassword(password);

    const result = await prisma.$transaction(async (tx) => {
      let userId: string;

      if (existing) {
        userId = existing.id;
        await tx.user.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            passwordHash,
            // Cabut sesi lama supaya kredensial baru ini yang berlaku.
            authVersion: { increment: 1 }
          }
        });
        await tx.session.updateMany({
          where: { userId: existing.id, revokedAt: null },
          data: { revokedAt: new Date() }
        });
      } else {
        let referralCode = `RVWR${Math.floor(100000 + Math.random() * 900000)}`;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const collision = await tx.user.findUnique({ where: { referralCode } });
          if (!collision) break;
          referralCode = `RVWR${Math.floor(100000 + Math.random() * 900000)}`;
          if (attempt === 9) fail("kode referral unik belum dapat dibuat, coba lagi");
        }
        const created = await tx.user.create({
          data: { fullName, phone, passwordHash, status: "ACTIVE", referralCode },
          select: { id: true }
        });
        userId = created.id;
      }

      // Profil driver ACTIVE, TANPA kendaraan (lihat komentar di atas file
      // ini soal alasan keamanannya). availability dibiarkan OFFLINE — bila
      // reviewer menekan tombol Online, tetap aman karena tanpa kendaraan
      // terverifikasi ia tidak akan pernah menerima tawaran apa pun.
      const existingProfile = await tx.rideDriverProfile.findUnique({ where: { userId } });
      if (existingProfile) {
        await tx.rideDriverProfile.update({
          where: { userId },
          data: { status: "ACTIVE" }
        });
      } else {
        await tx.rideDriverProfile.create({
          data: { userId, status: "ACTIVE", availability: "OFFLINE" }
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: null,
          action: existing ? "DRIVER_REVIEWER_ACCOUNT_RESET" : "DRIVER_REVIEWER_ACCOUNT_CREATED",
          entityType: "USER",
          entityId: userId,
          metadata: {
            source: "DRIVER_REVIEWER_BOOTSTRAP_CLI",
            purpose: "GOOGLE_PLAY_REVIEW",
            hasVehicle: false
          }
        }
      });

      return { userId };
    });

    console.log(
      JSON.stringify({
        status: "OK",
        phone: maskPhone(phone),
        userId: result.userId,
        driverProfileStatus: "ACTIVE",
        vehicle: "NONE (sengaja — lihat komentar berkas ini)",
        note: "Akun ini TIDAK akan pernah menerima tawaran pesanan sungguhan karena tidak punya kendaraan terverifikasi."
      })
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
