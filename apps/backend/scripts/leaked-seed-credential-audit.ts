/**
 * Audit dan rotasi kredensial seed yang pernah bocor lewat Git.
 *
 * LATAR BELAKANG
 *
 * `prisma/seed.ts` dulu menanam tiga password harfiah di dalam kode, dan berkas
 * itu ter-track di Git — berbeda dari seed-admin.ts/seed-demo.ts/
 * seed-uat-credentials.ts yang sudah dikecualikan .gitignore. Salah satu akun
 * yang dibuatnya berperan SUPER_ADMIN. Karena `npm run db:seed` adalah langkah
 * setup yang didokumentasikan di README, akun itu bisa saja pernah dibuat pada
 * environment mana pun, termasuk production.
 *
 * Menambal seed.ts saja tidak menutup celahnya: baris yang sudah tertulis di
 * database tetap memegang password yang dapat dibaca siapa pun yang memegang
 * salinan repositori — dan riwayat Git tetap menyimpannya walau berkasnya sudah
 * diperbaiki. Karena itu perlu dua langkah terpisah: MEMASTIKAN apakah akunnya
 * ada, lalu MEROTASI bila ada.
 *
 * Password bocor tetap tertulis di bawah HANYA sebagai bahan pendeteksi. Nilai
 * itu sudah publik di riwayat Git, sehingga mencantumkannya di sini tidak
 * menambah paparan sedikit pun — sementara tanpanya skrip ini tidak dapat
 * membedakan "akun ada tetapi passwordnya sudah diganti" dari "akun ada dan
 * masih memakai password bocor", dan justru perbedaan itulah yang menentukan
 * apakah ada insiden.
 *
 * JALANKAN
 *
 * 1. Audit saja (read-only, aman untuk production):
 *
 *      npm --workspace apps/backend run audit:leaked-seed
 *
 * 2. Rotasi password akun yang masih memakai password bocor:
 *
 *      ROTATE_ADMIN_PASSWORD='<password baru>' \
 *      ROTATE_DRIVER_PASSWORD='<password baru>' \
 *      ROTATE_USER_PASSWORD='<password baru>' \
 *      npm --workspace apps/backend run audit:leaked-seed -- \
 *        --rotate --confirm-credential-rotation
 *
 *    Password baru hanya wajib untuk akun yang memang perlu dirotasi; akun yang
 *    tidak terdampak dilewati tanpa menuntut variabel apa pun.
 *
 * Rotasi menaikkan `authVersion` dan mencabut seluruh sesi dalam satu transaksi,
 * sehingga token akses lama gugur seketika — bukan 15 menit kemudian.
 *
 * Output TIDAK pernah memuat password, hash, connection string, nama, email,
 * maupun nomor telepon. Hanya UUID internal, role, dan status.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword } from "../src/core/security/passwordHasher.js";

const CONFIRM_FLAG = "--confirm-credential-rotation";
const MIN_PASSWORD_LENGTH = 12;

/**
 * Akun yang pernah dibuat seed lama, beserta password bocornya.
 *
 * `phone` ditulis persis seperti yang ditulis seed lama. Pencarian di bawah juga
 * mencoba bentuk normalnya, karena akun yang sama bisa tersimpan sebagai
 * "+628111000001" maupun "08111000001" tergantung jalur pembuatannya.
 */
const LEAKED_SEED_ACCOUNTS = [
  {
    label: "admin",
    phone: "+628111000001",
    leakedPassword: "Admin@TapGo2026!",
    rotateEnvVar: "ROTATE_ADMIN_PASSWORD"
  },
  {
    label: "driver",
    phone: "+628122000001",
    leakedPassword: "Driver@TapGo2026!",
    rotateEnvVar: "ROTATE_DRIVER_PASSWORD"
  },
  {
    label: "user",
    phone: "+628133000001",
    leakedPassword: "User@TapGo2026!",
    rotateEnvVar: "ROTATE_USER_PASSWORD"
  }
] as const;

type AccountFinding = {
  label: string;
  present: boolean;
  userId?: string;
  role?: string;
  status?: string;
  /** True bila password bocor MASIH membuka akun ini. */
  leakedPasswordStillWorks?: boolean;
  rotated?: boolean;
  rotationSkippedReason?: string;
};

function fail(message: string): never {
  console.error(`GAGAL: ${message}`);
  process.exit(1);
}

/**
 * Bentuk nomor yang perlu dicoba.
 *
 * Sengaja tidak memakai core/security/phone.ts: skrip audit tidak boleh ikut
 * berubah perilakunya ketika aturan normalisasi aplikasi berubah. Yang dicari di
 * sini adalah baris konkret yang ditulis seed lama, bukan pencocokan nomor
 * secara umum.
 */
function phoneVariants(phone: string): string[] {
  const variants = new Set<string>([phone]);
  if (phone.startsWith("+62")) {
    variants.add(`0${phone.slice(3)}`);
    variants.add(`62${phone.slice(3)}`);
  }
  return [...variants];
}

async function main() {
  const shouldRotate = process.argv.includes("--rotate");
  if (shouldRotate && !process.argv.includes(CONFIRM_FLAG)) {
    fail(`rotasi mengubah password akun sungguhan; ulangi dengan ${CONFIRM_FLAG}`);
  }

  const prisma = new PrismaClient();
  const findings: AccountFinding[] = [];

  try {
    for (const account of LEAKED_SEED_ACCOUNTS) {
      const user = await prisma.user.findFirst({
        where: { phone: { in: phoneVariants(account.phone) } },
        select: { id: true, role: true, status: true, passwordHash: true }
      });

      if (!user) {
        findings.push({ label: account.label, present: false });
        continue;
      }

      // Akun tanpa passwordHash tidak dapat dibuka dengan password apa pun,
      // sehingga password bocor tidak relevan untuk baris itu.
      const leakedPasswordStillWorks = user.passwordHash
        ? await verifyPassword(user.passwordHash, account.leakedPassword)
        : false;

      const finding: AccountFinding = {
        label: account.label,
        present: true,
        userId: user.id,
        role: user.role,
        status: user.status,
        leakedPasswordStillWorks
      };

      if (!shouldRotate || !leakedPasswordStillWorks) {
        if (shouldRotate && !leakedPasswordStillWorks) {
          finding.rotated = false;
          finding.rotationSkippedReason = "PASSWORD_ALREADY_CHANGED";
        }
        findings.push(finding);
        continue;
      }

      const replacement = process.env[account.rotateEnvVar];
      if (!replacement || replacement.length < MIN_PASSWORD_LENGTH) {
        finding.rotated = false;
        finding.rotationSkippedReason = `${account.rotateEnvVar}_MISSING_OR_TOO_SHORT`;
        findings.push(finding);
        continue;
      }
      if (replacement === account.leakedPassword) {
        finding.rotated = false;
        finding.rotationSkippedReason = `${account.rotateEnvVar}_SAME_AS_LEAKED_PASSWORD`;
        findings.push(finding);
        continue;
      }

      const passwordHash = await hashPassword(replacement);
      const now = new Date();

      // Satu transaksi: password baru, authVersion naik, seluruh sesi dicabut.
      // Tanpa kenaikan authVersion, access token lama tetap sah sampai TTL 15
      // menitnya habis — dan itu justru jendela yang sedang kita tutup.
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            authVersion: { increment: 1 },
            sessionsRevokedAt: now
          }
        });
        await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now }
        });
        await tx.auditLog.create({
          data: {
            // Tindakan offline: tidak ada aktor HTTP yang dapat dicatat.
            actorId: null,
            action: "LEAKED_SEED_CREDENTIAL_ROTATED",
            entityType: "USER",
            entityId: user.id,
            metadata: {
              source: "CLI_LEAKED_SEED_AUDIT",
              seedLabel: account.label,
              sessionsRevoked: true
            }
          }
        });
      });

      finding.rotated = true;
      findings.push(finding);
    }
  } finally {
    await prisma.$disconnect();
  }

  const exposed = findings.filter((finding) => finding.leakedPasswordStillWorks && !finding.rotated);
  const summary = {
    status: exposed.length === 0 ? "OK" : "ACTION_REQUIRED",
    mode: shouldRotate ? "ROTATE" : "AUDIT",
    accountsStillOpenWithLeakedPassword: exposed.length,
    findings
  };

  console.log(JSON.stringify(summary, null, 2));

  // Exit code bukan nol supaya CI atau runbook dapat menjadikannya gerbang.
  if (exposed.length > 0) {
    process.exit(2);
  }
}

void main();
