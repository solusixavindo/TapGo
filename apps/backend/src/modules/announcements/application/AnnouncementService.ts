import { PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { ANNOUNCEMENT_PROBLEM_MESSAGE, validateAnnouncementContent } from "./announcementContent.js";

/** Batas penerbitan per akun per jam: mencegah banjir pengumuman (mis. dari akun yang dibobol). */
export const ANNOUNCEMENTS_PER_HOUR = 10;
/** Jumlah pengumuman aktif terbanyak yang dikirim ke aplikasi sekali buka. */
const USER_LIST_LIMIT = 50;
/** Tahap 1: hanya aplikasi user. Kolom audience disiapkan agar driver menyusul tanpa mengubah tabel. */
export type AnnouncementAudience = "USERS" | "DRIVERS" | "ALL";
export type AnnouncementStatus = "ACTIVE" | "EXPIRED" | "ARCHIVED";

type PageInput = { page: number; pageSize: number };

export class AnnouncementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Terbitkan. Isi tidak dapat diubah sesudahnya; koreksi = arsipkan lalu terbitkan yang baru. */
  async publish(input: { actorId: string; title: string; body: string; audience: AnnouncementAudience; expiresAt?: Date | null }) {
    const content = validateAnnouncementContent({ title: input.title, body: input.body });
    if (!content.ok) {
      throw new AppError(
        ANNOUNCEMENT_PROBLEM_MESSAGE[content.problem],
        StatusCodes.UNPROCESSABLE_ENTITY,
        `ANNOUNCEMENT_${content.problem}`
      );
    }
    const now = this.now();
    if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) {
      throw new AppError("Tanggal berakhir harus di masa depan.", StatusCodes.UNPROCESSABLE_ENTITY, "ANNOUNCEMENT_EXPIRY_IN_PAST");
    }

    return this.prisma.$transaction(async (tx) => {
      const recent = await tx.announcement.count({
        where: { createdBy: input.actorId, publishedAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } }
      });
      if (recent >= ANNOUNCEMENTS_PER_HOUR) {
        throw new AppError(
          `Terlalu banyak pengumuman dalam satu jam (maksimal ${ANNOUNCEMENTS_PER_HOUR}). Coba lagi nanti.`,
          StatusCodes.TOO_MANY_REQUESTS,
          "ANNOUNCEMENT_RATE_LIMIT"
        );
      }
      const row = await tx.announcement.create({
        data: {
          title: content.title,
          body: content.body,
          audience: input.audience,
          createdBy: input.actorId,
          publishedAt: now,
          expiresAt: input.expiresAt ?? null
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "ANNOUNCEMENT_PUBLISHED",
          entityType: "announcement",
          entityId: row.id,
          metadata: { title: row.title, audience: row.audience, expiresAt: row.expiresAt?.toISOString() ?? null, bodyLength: row.body.length }
        }
      });
      return this.toAdminView(row, null, now);
    });
  }

  async archive(input: { actorId: string; id: string }) {
    const now = this.now();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.announcement.findUnique({ where: { id: input.id } });
      if (!row) throw new AppError("Pengumuman tidak ditemukan.", StatusCodes.NOT_FOUND, "ANNOUNCEMENT_NOT_FOUND");
      if (row.archivedAt) {
        throw new AppError("Pengumuman ini sudah diarsipkan.", StatusCodes.CONFLICT, "ANNOUNCEMENT_ALREADY_ARCHIVED");
      }
      const updated = await tx.announcement.update({ where: { id: row.id }, data: { archivedAt: now, archivedBy: input.actorId } });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "ANNOUNCEMENT_ARCHIVED",
          entityType: "announcement",
          entityId: row.id,
          metadata: { title: row.title }
        }
      });
      return this.toAdminView(updated, null, now);
    });
  }

  /** Daftar untuk konsol VIP: semua status, terbaru di atas. */
  async adminList(input: PageInput & { status?: "ACTIVE" | "ARCHIVED" | "ALL" }) {
    const now = this.now();
    const status = input.status ?? "ALL";
    const where =
      status === "ARCHIVED"
        ? { archivedAt: { not: null } }
        : status === "ACTIVE"
          ? { archivedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
          : {};
    const [total, rows] = await Promise.all([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize
      })
    ]);
    const names = await this.nameMap(rows.flatMap((row) => [row.createdBy, row.archivedBy].filter((id): id is string => Boolean(id))));
    return {
      items: rows.map((row) => this.toAdminView(row, names, now)),
      pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) }
    };
  }

  /** Untuk aplikasi user: yang aktif saja, ditandai sudah/belum dibaca menurut waktu buka terakhir. */
  async listForUser(userId: string) {
    const now = this.now();
    const [rows, seen] = await Promise.all([
      this.prisma.announcement.findMany({
        where: this.activeForUserWhere(now),
        orderBy: { publishedAt: "desc" },
        take: USER_LIST_LIMIT
      }),
      this.prisma.announcementSeen.findUnique({ where: { userId } })
    ]);
    const seenAt = seen?.seenAt ?? null;
    const items = rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      publishedAt: row.publishedAt.toISOString(),
      unread: seenAt === null || row.publishedAt.getTime() > seenAt.getTime()
    }));
    return { items, unreadCount: items.filter((item) => item.unread).length };
  }

  async unreadCount(userId: string) {
    const now = this.now();
    const seen = await this.prisma.announcementSeen.findUnique({ where: { userId } });
    const where = this.activeForUserWhere(now);
    const count = await this.prisma.announcement.count({
      where: seen ? { ...where, publishedAt: { gt: seen.seenAt } } : where
    });
    return { unreadCount: count };
  }

  /** Dipanggil saat layar pengumuman dibuka. Tidak pernah mundur: waktu hanya bergerak maju. */
  async markSeen(userId: string) {
    const now = this.now();
    await this.prisma.announcementSeen.upsert({
      where: { userId },
      create: { userId, seenAt: now },
      update: { seenAt: now }
    });
  }

  private activeForUserWhere(now: Date) {
    return {
      audience: { in: ["USERS", "ALL"] },
      archivedAt: null,
      publishedAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    };
  }

  private async nameMap(ids: string[]) {
    if (ids.length === 0) return new Map<string, string>();
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }

  private toAdminView(
    row: {
      id: string;
      title: string;
      body: string;
      audience: string;
      createdBy: string;
      publishedAt: Date;
      expiresAt: Date | null;
      archivedAt: Date | null;
      archivedBy: string | null;
    },
    names: Map<string, string> | null,
    now: Date
  ) {
    const status: AnnouncementStatus = row.archivedAt
      ? "ARCHIVED"
      : row.expiresAt && row.expiresAt.getTime() <= now.getTime()
        ? "EXPIRED"
        : "ACTIVE";
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      audience: row.audience,
      status,
      publishedAt: row.publishedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdByName: names?.get(row.createdBy) ?? null,
      archivedByName: row.archivedBy ? (names?.get(row.archivedBy) ?? null) : null
    };
  }
}
