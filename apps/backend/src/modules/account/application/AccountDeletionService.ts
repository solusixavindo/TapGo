import { Prisma, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { isAdminRole } from "../../../core/security/roleHierarchy.js";

/**
 * Pemrosesan permintaan hapus akun oleh Super Admin VIP.
 *
 * Isi halaman hapus-akun di tapgolion.id adalah janji ke pengguna dan ke Google Play: data pribadi (nama, nomor HP,
 * email, alamat, profil, dokumen identitas, foto, token notifikasi) dihapus; invoice, pembayaran, withdrawal, dan
 * buku besar saldo tetap disimpan karena kewajiban hukum, pajak, dan audit. Berkas ini menjalankan persis pembagian itu.
 *
 * Yang sengaja dijaga:
 * - Anonimisasi, bukan DELETE baris `users`: riwayat uang, referral, dan audit merujuk ke baris itu.
 * - Tidak pernah menghapus akun yang masih punya kewajiban terbuka (saldo, penarikan, pesanan berjalan). Halangannya
 *   dihitung ulang DI DALAM transaksi, bukan hanya di pratinjau.
 * - Akun admin tidak dapat dihapus lewat jalur ini.
 * - Tindakan tidak dapat dibatalkan; audit mencatat jumlah data yang dihapus, tidak pernah isinya.
 */

export const ACCOUNT_DELETION_BLOCKED = "ACCOUNT_DELETION_BLOCKED";

const ACTIVE_RIDE_STATUSES = [
  "CREATED",
  "SEARCHING_DRIVER",
  "DRIVER_ASSIGNED",
  "DRIVER_TO_PICKUP",
  "DRIVER_ARRIVED",
  "IN_TRIP"
] as const;

export type DeletionBlocker = { code: string; message: string };

export const DELETION_WILL_ERASE = [
  "Nama, nomor HP, email, password, dan rekening tersimpan",
  "Foto profil, kode identitas anggota, dan token notifikasi",
  "Dokumen identitas anggota dan dokumen driver (isi berkas dikosongkan)",
  "Data diri driver (tanggal lahir, alamat, kontak darurat, nomor SIM, plat)",
  "Referensi wajah driver, kode verifikasi, sesi masuk, dan tiket bantuan/pesan kontak"
];

export const DELETION_WILL_KEEP = [
  "Invoice dan pembayaran",
  "Riwayat withdrawal dan buku besar saldo",
  "Struktur referral dan jejak audit (tanpa data pribadi)"
];

export class AccountDeletionService {
  constructor(private readonly prisma: PrismaClient) {}

  private async loadRequest(client: Prisma.TransactionClient | PrismaClient, requestId: string) {
    const request = await client.accountDeletionRequest.findUnique({
      where: { id: requestId },
      include: { user: { select: { id: true, fullName: true, phone: true, email: true, role: true, status: true } } }
    });
    if (!request) {
      throw new AppError("Permintaan tidak ditemukan.", StatusCodes.NOT_FOUND, "DELETION_REQUEST_NOT_FOUND");
    }
    return request;
  }

  private async blockersFor(client: Prisma.TransactionClient | PrismaClient, request: { userId: string; user: { role: string; status: string } }) {
    const blockers: DeletionBlocker[] = [];
    const userId = request.userId;

    if (isAdminRole(request.user.role as never)) {
      blockers.push({ code: "ADMIN_ACCOUNT", message: "Akun admin tidak dapat dihapus lewat jalur ini." });
    }
    if (request.user.status === "DELETED") {
      blockers.push({ code: "ALREADY_DELETED", message: "Akun ini sudah dihapus." });
    }

    const wallet = await client.wallet.findUnique({ where: { userId } });
    if (wallet) {
      const remaining = [wallet.balance, wallet.cashBalance, wallet.ppobBalance].some((amount) => amount.gt(0));
      if (remaining) {
        blockers.push({
          code: "BALANCE_REMAINING",
          message: `Saldo masih ada (TapGo ${wallet.balance.toFixed(0)}, dapat ditarik ${wallet.cashBalance.toFixed(0)}, PPOB ${wallet.ppobBalance.toFixed(0)}). Minta anggota menarik atau memakainya dulu.`
        });
      }
    }

    const openWithdrawals = await client.withdrawal.count({ where: { userId, status: { in: ["PENDING", "APPROVED"] } } });
    if (openWithdrawals > 0) {
      blockers.push({ code: "WITHDRAWAL_OPEN", message: `${openWithdrawals} penarikan dana belum selesai.` });
    }

    const openOrders = await client.membershipOrder.count({
      where: {
        userId,
        OR: [{ status: "PENDING" }, { status: "PAID", documents: { some: { status: "PENDING" } } }]
      }
    });
    if (openOrders > 0) {
      blockers.push({ code: "MEMBERSHIP_ORDER_OPEN", message: `${openOrders} pesanan membership belum selesai (menunggu bayar atau verifikasi dokumen).` });
    }

    const openTopUps = await client.walletTopUpOrder.count({ where: { userId, status: "PENDING" } });
    if (openTopUps > 0) {
      blockers.push({ code: "TOPUP_OPEN", message: `${openTopUps} top up menunggu pembayaran.` });
    }

    const activeRides = await client.rideOrder.count({
      where: {
        status: { in: [...ACTIVE_RIDE_STATUSES] },
        OR: [{ passengerId: userId }, { driverProfile: { userId } }]
      }
    });
    if (activeRides > 0) {
      blockers.push({ code: "RIDE_ACTIVE", message: `${activeRides} perjalanan masih berjalan.` });
    }

    return blockers;
  }

  async preview(requestId: string) {
    const request = await this.loadRequest(this.prisma, requestId);
    const blockers = request.status === "PENDING" || request.status === "APPROVED"
      ? await this.blockersFor(this.prisma, request)
      : [{ code: "REQUEST_CLOSED", message: `Permintaan ini sudah ${request.status === "COMPLETED" ? "selesai" : "ditolak"}.` }];
    return {
      request: { id: request.id, status: request.status, reason: request.reason, createdAt: request.createdAt },
      user: request.user,
      blockers,
      canComplete: blockers.length === 0,
      willErase: DELETION_WILL_ERASE,
      willKeep: DELETION_WILL_KEEP
    };
  }

  async reject(input: { requestId: string; actorId: string; reason: string }) {
    return this.prisma.$transaction(async (tx) => {
      const request = await this.loadRequest(tx, input.requestId);
      const claim = await tx.accountDeletionRequest.updateMany({
        where: { id: request.id, status: { in: ["PENDING", "APPROVED"] } },
        data: { status: "REJECTED", reviewedBy: input.actorId, reviewedAt: new Date() }
      });
      if (claim.count !== 1) {
        throw new AppError("Permintaan sudah diproses.", StatusCodes.CONFLICT, "DELETION_REQUEST_CLOSED");
      }
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "ACCOUNT_DELETION_REJECTED",
          entityType: "ACCOUNT_DELETION_REQUEST",
          entityId: request.id,
          metadata: { userId: request.userId, reason: input.reason }
        }
      });
      return { id: request.id, status: "REJECTED" as const };
    });
  }

  async complete(input: { requestId: string; actorId: string }) {
    return this.prisma.$transaction(
      async (tx) => {
        const request = await this.loadRequest(tx, input.requestId);
        if (request.status !== "PENDING" && request.status !== "APPROVED") {
          throw new AppError("Permintaan sudah diproses.", StatusCodes.CONFLICT, "DELETION_REQUEST_CLOSED");
        }

        const blockers = await this.blockersFor(tx, request);
        if (blockers.length > 0) {
          throw new AppError(
            `Akun belum dapat dihapus: ${blockers.map((blocker) => blocker.message).join(" ")}`,
            StatusCodes.CONFLICT,
            ACCOUNT_DELETION_BLOCKED
          );
        }

        const claim = await tx.accountDeletionRequest.updateMany({
          where: { id: request.id, status: { in: ["PENDING", "APPROVED"] } },
          data: { status: "COMPLETED", reviewedBy: input.actorId, reviewedAt: new Date(), completedAt: new Date() }
        });
        if (claim.count !== 1) {
          throw new AppError("Permintaan sudah diproses.", StatusCodes.CONFLICT, "DELETION_REQUEST_CLOSED");
        }

        const userId = request.userId;
        const now = new Date();

        const erased = {
          sessions: (await tx.session.deleteMany({ where: { userId } })).count,
          pushTokens: (await tx.pushToken.deleteMany({ where: { userId } })).count,
          avatars: (await tx.userAvatar.deleteMany({ where: { userId } })).count,
          memberIdentities: (await tx.memberIdentity.deleteMany({ where: { userId } })).count,
          faceReferences: (await tx.driverFaceReference.deleteMany({ where: { userId } })).count,
          authChallenges: (await tx.authChallenge.deleteMany({ where: { userId } })).count,
          supportTickets: (await tx.supportTicket.deleteMany({ where: { userId } })).count,
          contactMessages: (await tx.contactMessage.deleteMany({ where: { userId } })).count,
          membershipDocuments: (
            await tx.membershipDocument.updateMany({
              where: { userId, purgedAt: null },
              data: {
                url: null,
                localPath: null,
                cipherText: null,
                cipherIv: null,
                cipherTag: null,
                keyVersion: null,
                purgedAt: now
              }
            })
          ).count,
          driverDocuments: (
            await tx.driverDocument.updateMany({
              where: { driver: { userId }, purgedAt: null },
              data: { url: null, cipherText: null, cipherIv: null, cipherTag: null, keyVersion: null, purgedAt: now }
            })
          ).count,
          driverProfiles: (
            await tx.driver.updateMany({
              where: { userId },
              data: {
                fullName: null,
                dateOfBirth: null,
                address: null,
                emergencyContactName: null,
                emergencyContactPhone: null,
                licenseNumber: null,
                vehiclePlate: null,
                currentLat: null,
                currentLng: null,
                status: "OFFLINE"
              }
            })
          ).count
        };

        await tx.user.update({
          where: { id: userId },
          data: {
            fullName: "Akun Dihapus",
            email: null,
            phone: `deleted-${userId.slice(0, 8)}`,
            passwordHash: null,
            avatarUrl: null,
            bankAccount: Prisma.DbNull,
            phoneVerifiedAt: null,
            emailVerifiedAt: null,
            status: "DELETED",
            authVersion: { increment: 1 },
            sessionsRevokedAt: now
          }
        });

        await tx.auditLog.create({
          data: {
            actorId: input.actorId,
            action: "ACCOUNT_DELETION_COMPLETED",
            entityType: "ACCOUNT_DELETION_REQUEST",
            entityId: request.id,
            metadata: { userId, erased }
          }
        });

        return { id: request.id, status: "COMPLETED" as const, erased };
      },
      { timeout: 30_000 }
    );
  }
}
