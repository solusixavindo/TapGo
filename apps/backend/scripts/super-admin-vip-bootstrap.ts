/**
 * CLI bootstrap SUPER_ADMIN_VIP — offline, eksplisit, tercatat.
 *
 * SUPER_ADMIN_VIP adalah role puncak pemilik sistem. Tidak ada endpoint HTTP
 * yang dapat memberikannya, dan tidak ada migration, seed, maupun startup yang
 * membuatnya. Alasannya sama dengan kebijakan ADMIN_SCOPE_MANAGE: otoritas
 * tertinggi tidak boleh lahir diam-diam dari kode yang berjalan otomatis.
 *
 * Yang DIUBAH skrip ini hanyalah kolom role satu akun yang sudah ada. Skrip ini
 * tidak membuat akun, tidak menyetel password, dan tidak memberikan scope apa
 * pun — pengelolaan scope tetap menuntut grant ADMIN_SCOPE_MANAGE tersendiri.
 *
 * Jalankan:
 *   npm run admin:vip-bootstrap -- \
 *     --user-id <UUID> \
 *     --confirm-top-level-role
 *
 * Menurunkan kembali:
 *   npm run admin:vip-bootstrap -- \
 *     --user-id <UUID> \
 *     --demote-to SUPER_ADMIN \
 *     --confirm-top-level-role
 *
 * Output tidak pernah memuat credential, connection string, token, nama, email,
 * nomor telepon, maupun PII lain — hanya status, UUID internal, dan role.
 */
import { PrismaClient, UserRole } from "@prisma/client";

const CONFIRM_FLAG = "--confirm-top-level-role";
const DEMOTABLE_ROLES: UserRole[] = ["SUPER_ADMIN", "ADMIN"];

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`GAGAL: ${message}`);
  process.exit(1);
}

async function main() {
  const userId = readArg("--user-id");
  const demoteTo = readArg("--demote-to");

  if (!process.argv.includes(CONFIRM_FLAG)) {
    fail(`tindakan ini mengubah otoritas tertinggi sistem; ulangi dengan ${CONFIRM_FLAG}`);
  }
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    fail("--user-id wajib berupa UUID");
  }

  const targetRole: UserRole = demoteTo ? (demoteTo as UserRole) : "SUPER_ADMIN_VIP";
  if (demoteTo && !DEMOTABLE_ROLES.includes(targetRole)) {
    fail(`--demote-to hanya menerima ${DEMOTABLE_ROLES.join(" atau ")}`);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true }
    });

    if (!user) fail("akun tidak ditemukan");
    if (user.status !== "ACTIVE") fail(`akun berstatus ${user.status}, bukan ACTIVE`);
    if (user.role === targetRole) fail(`akun sudah berperan ${targetRole}`);

    // Menaikkan ke puncak hanya dari SUPER_ADMIN. Melompat dari USER berarti
    // melewati seluruh pemeriksaan yang biasanya menyertai kenaikan role.
    if (targetRole === "SUPER_ADMIN_VIP" && user.role !== "SUPER_ADMIN") {
      fail(`hanya SUPER_ADMIN yang dapat dinaikkan ke puncak; akun ini ${user.role}`);
    }

    const previousRole = user.role;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { role: targetRole } });
      await tx.auditLog.create({
        data: {
          // Tindakan offline: tidak ada aktor HTTP yang dapat dicatat.
          actorId: null,
          action:
            targetRole === "SUPER_ADMIN_VIP"
              ? "SUPER_ADMIN_VIP_GRANTED"
              : "SUPER_ADMIN_VIP_REVOKED",
          entityType: "USER",
          entityId: user.id,
          metadata: { previousRole, newRole: targetRole, source: "CLI_BOOTSTRAP" }
        }
      });
    });

    console.log(
      JSON.stringify({ status: "OK", userId: user.id, previousRole, newRole: targetRole })
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
