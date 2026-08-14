/**
 * CLI bootstrap ADMIN_SCOPE_MANAGE — sekali pakai, offline.
 *
 * Alasan keberadaannya: scope manager pertama tidak dapat diberikan lewat HTTP,
 * karena endpoint grant sendiri menuntut ADMIN_SCOPE_MANAGE. Tanpa jalur
 * offline, sistem tidak akan pernah memiliki manager pertama; dengan
 * pembuatan otomatis, migration atau startup akan diam-diam menciptakan
 * otoritas keamanan. CLI ini adalah jalan tengah yang eksplisit dan tercatat.
 *
 * SENGAJA TIDAK memiliki endpoint HTTP, tidak dipanggil server startup, dan
 * tidak dipanggil migration maupun seed.
 *
 * Jalankan:
 *   npm run admin:scope-bootstrap -- \
 *     --user-id <UUID> \
 *     --reason INITIAL_BOOTSTRAP \
 *     --confirm-one-time-bootstrap
 *
 * Break-glass, hanya sah bila NOL manager yang layak:
 *   npm run admin:scope-bootstrap -- \
 *     --user-id <UUID> \
 *     --reason BREAK_GLASS_RECOVERY \
 *     --confirm-one-time-bootstrap
 *
 * Output tidak pernah memuat credential, connection string, token, email,
 * nomor telepon, maupun PII lain — hanya status, UUID internal, scope, dan
 * kode alasan terbatas.
 */
import { PrismaClient } from "@prisma/client";
import {
  AdminScopeGovernanceService,
  MANAGE_SCOPE,
  SCOPE_GOVERNANCE_ACTIONS,
  isScopeReasonCode
} from "../src/modules/admin-console/application/AdminScopeGovernanceService.js";

/** Kunci advisory lock yang sama dengan service, agar keduanya berurutan. */
const MANAGE_LOCK_KEY = 918_273_645;

const BOOTSTRAP_REASONS = ["INITIAL_BOOTSTRAP", "BREAK_GLASS_RECOVERY"] as const;

type Args = {
  userId: string;
  reason: string;
  confirmed: boolean;
};

function parseArgs(argv: string[]): Args {
  let userId = "";
  let reason = "";
  let confirmed = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--user-id") {
      userId = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--reason") {
      reason = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--confirm-one-time-bootstrap") {
      confirmed = true;
    }
  }

  // TIDAK ADA target default. Operator wajib menyebut UUID secara eksplisit
  // supaya tidak ada akun yang dinaikkan haknya karena kelalaian.
  return { userId, reason, confirmed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.confirmed) {
    throw new Error("Dihentikan: --confirm-one-time-bootstrap belum diberikan.");
  }
  if (!args.userId) {
    throw new Error("Dihentikan: --user-id wajib diisi dan tidak punya nilai default.");
  }
  if (!isScopeReasonCode(args.reason) || !(BOOTSTRAP_REASONS as readonly string[]).includes(args.reason)) {
    throw new Error(
      `Dihentikan: --reason harus salah satu dari ${BOOTSTRAP_REASONS.join(", ")}.`
    );
  }
  const reasonCode = args.reason as (typeof BOOTSTRAP_REASONS)[number];

  const prisma = new PrismaClient();
  const service = new AdminScopeGovernanceService(prisma);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock yang sama dengan service: dua bootstrap serentak berurutan,
      // sehingga hanya satu yang dapat melihat nol manager.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MANAGE_LOCK_KEY}::bigint)`;

      // FAIL-CLOSED: hanya sah bila belum ada manager yang layak. Aturan ini
      // sekaligus membuat break-glass tidak dapat dipakai sebagai bypass —
      // selama masih ada satu manager layak, CLI ini menolak.
      const eligible = await service.countEligibleManagers(tx);
      if (eligible > 0) {
        throw new Error(
          `Dihentikan: sudah ada ${eligible} pengelola scope yang layak. Gunakan endpoint grant.`
        );
      }

      const target = await tx.user.findUnique({
        where: { id: args.userId },
        select: { id: true, role: true, status: true }
      });

      if (!target) {
        throw new Error("Dihentikan: user target tidak ditemukan.");
      }
      if (target.status !== "ACTIVE") {
        throw new Error("Dihentikan: user target tidak berstatus ACTIVE.");
      }
      if (target.role !== "SUPER_ADMIN") {
        throw new Error("Dihentikan: user target harus berrole SUPER_ADMIN.");
      }

      // Grant yang sudah ada tetapi tidak layak (mis. role sudah turun) tidak
      // dihapus; pencabutan tetap lewat jalur normal agar riwayat utuh.
      const existing = await tx.adminScopeGrant.findFirst({
        where: { userId: target.id, scope: MANAGE_SCOPE, status: "ACTIVE" },
        select: { id: true }
      });
      if (existing) {
        throw new Error("Dihentikan: target sudah memegang grant aktif.");
      }

      const grant = await tx.adminScopeGrant.create({
        data: {
          userId: target.id,
          scope: MANAGE_SCOPE,
          status: "ACTIVE",
          // Bootstrap tidak punya aktor manusia lain; target menjadi aktornya
          // sendiri agar FK grantedById tetap terisi dan jejaknya jelas.
          grantedById: target.id,
          reasonCode
        },
        select: { id: true, userId: true, scope: true, status: true }
      });

      await service.auditForBootstrap(
        reasonCode === "BREAK_GLASS_RECOVERY"
          ? SCOPE_GOVERNANCE_ACTIONS.breakGlassCompleted
          : SCOPE_GOVERNANCE_ACTIONS.bootstrapCompleted,
        {
          actorId: target.id,
          targetUserId: target.id,
          grantId: grant.id,
          scope: MANAGE_SCOPE,
          reasonCode,
          outcome: "ALLOWED",
          newStatus: "ACTIVE"
        },
        tx
      );

      return grant;
    });

    console.log("BOOTSTRAP: SUCCESS");
    console.log(`  userId    : ${result.userId}`);
    console.log(`  grantId   : ${result.id}`);
    console.log(`  scope     : ${result.scope}`);
    console.log(`  reasonCode: ${reasonCode}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // Hanya pesan yang dicetak. Tidak ada stack trace, connection string, atau
  // parameter query yang dapat memuat data sensitif.
  console.error(
    `BOOTSTRAP: FAILURE — ${error instanceof Error ? error.message : "kesalahan tidak dikenal"}`
  );
  process.exitCode = 1;
});
