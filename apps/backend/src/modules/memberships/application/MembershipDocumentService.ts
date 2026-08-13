import { MembershipDocumentType, PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import { decryptDocument, encryptDocument } from "../../../core/security/documentCipher.js";

/**
 * Dokumen identitas untuk verifikasi keanggotaan (Stage R2.6 jalur A).
 *
 * Keputusan Owner: berkas disimpan di database aplikasi maksimal 24 jam. Dalam
 * rentang itu admin mencetaknya menjadi berkas administrasi, setelah itu isinya
 * dihapus. Barisnya sendiri tetap ada karena status dan jejak waktunya masih
 * dibutuhkan untuk audit.
 *
 * Tiga hal yang dijaga di sini:
 * - Isi berkas tidak pernah tersimpan mentah; lihat core/security/documentCipher.ts.
 * - Isi yang sudah lewat masa simpan tidak pernah disajikan, walau penyapunya
 *   belum sempat berjalan. Waktu yang menentukan, bukan pekerjaan latar.
 * - Unggahan ditolak setelah pengajuan selesai, supaya order yang sudah aktif
 *   atau sudah dibatalkan tidak bisa disisipi dokumen baru.
 */

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/**
 * Content-type dari klien hanyalah keterangan yang dikirim klien. Yang
 * menentukan adalah beberapa byte pertama berkas, sehingga berkas apa pun yang
 * menyamar sebagai gambar akan tertolak.
 */
const IMAGE_SIGNATURES: Array<{ contentType: string; magic: number[] }> = [
  { contentType: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { contentType: "image/jpeg", magic: [0xff, 0xd8, 0xff] }
];

export class MembershipDocumentService {
  constructor(private readonly prisma: PrismaClient) {}

  async upload(input: {
    userId: string;
    orderId: string;
    type: MembershipDocumentType;
    contentType: string;
    bytes: Buffer;
  }) {
    const detected = this.detectImageType(input.bytes);
    if (!detected) {
      throw new AppError(
        "Dokumen harus berupa gambar JPG atau PNG.",
        StatusCodes.UNSUPPORTED_MEDIA_TYPE,
        "MEMBERSHIP_DOCUMENT_TYPE_INVALID"
      );
    }
    if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new AppError(
        "Ukuran dokumen maksimal 5 MB.",
        StatusCodes.REQUEST_TOO_LONG,
        "MEMBERSHIP_DOCUMENT_TOO_LARGE"
      );
    }

    const order = await this.prisma.membershipOrder.findUnique({
      where: { id: input.orderId },
      select: { id: true, userId: true, status: true, userMembership: { select: { id: true } } }
    });

    if (!order) {
      throw new AppError("Membership order not found", StatusCodes.NOT_FOUND, "MEMBERSHIP_ORDER_NOT_FOUND");
    }
    // Pemilik order saja. Admin pun tidak mengunggah atas nama pemohon —
    // dokumen identitas harus datang dari orangnya sendiri.
    if (order.userId !== input.userId) {
      throw new AppError(
        "You are not allowed to upload documents for this order",
        StatusCodes.FORBIDDEN,
        "MEMBERSHIP_ORDER_FORBIDDEN"
      );
    }
    if (order.userMembership) {
      throw new AppError(
        "Membership order has already been activated",
        StatusCodes.CONFLICT,
        "MEMBERSHIP_ALREADY_ACTIVATED"
      );
    }
    if (order.status !== "PENDING" && order.status !== "PAID") {
      throw new AppError(
        "Membership order no longer accepts documents",
        StatusCodes.CONFLICT,
        "MEMBERSHIP_ORDER_CLOSED"
      );
    }

    const encrypted = encryptDocument(input.bytes);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + env.MEMBERSHIP_DOCUMENT_RETENTION_HOURS * 60 * 60 * 1000
    );

    const stored = {
      cipherText: encrypted.cipherText,
      cipherIv: encrypted.cipherIv,
      cipherTag: encrypted.cipherTag,
      keyVersion: encrypted.keyVersion,
      checksum: encrypted.checksum,
      contentType: detected,
      sizeBytes: input.bytes.byteLength,
      uploadedAt: now,
      expiresAt,
      purgedAt: null,
      // Unggah ulang mengembalikan dokumen ke antrean pemeriksaan.
      status: "PENDING" as const
    };

    const document = await this.prisma.membershipDocument.upsert({
      where: { orderId_type: { orderId: order.id, type: input.type } },
      update: stored,
      create: { orderId: order.id, userId: order.userId, type: input.type, ...stored },
      select: { id: true, type: true, sizeBytes: true, checksum: true, expiresAt: true }
    });

    return document;
  }

  /** Memastikan order memang milik pemanggil sebelum ringkasannya dibuka. */
  async assertOwnedOrder(input: { userId: string; orderId: string }) {
    const order = await this.prisma.membershipOrder.findUnique({
      where: { id: input.orderId },
      select: { id: true, userId: true }
    });

    if (!order) {
      throw new AppError("Membership order not found", StatusCodes.NOT_FOUND, "MEMBERSHIP_ORDER_NOT_FOUND");
    }
    if (order.userId !== input.userId) {
      throw new AppError(
        "You are not allowed to view this membership order",
        StatusCodes.FORBIDDEN,
        "MEMBERSHIP_ORDER_FORBIDDEN"
      );
    }

    return order;
  }

  /** Ringkasan untuk pemohon dan admin. Tidak pernah memuat isi berkas. */
  async list(input: { orderId: string }) {
    const documents = await this.prisma.membershipDocument.findMany({
      where: { orderId: input.orderId },
      orderBy: { type: "asc" },
      select: {
        type: true,
        status: true,
        contentType: true,
        sizeBytes: true,
        checksum: true,
        uploadedAt: true,
        expiresAt: true,
        purgedAt: true
      }
    });

    const now = new Date();
    return documents.map((document) => ({
      ...document,
      // Dihitung dari waktu, bukan dari kolom purgedAt, supaya jawabannya benar
      // walau penyapu berkala sedang tertunda.
      available: this.isReadable(document.expiresAt, document.purgedAt, now)
    }));
  }

  /**
   * Isi berkas untuk dicetak admin. Satu-satunya jalan keluar isi dokumen dari
   * database, dan karena itu satu-satunya tempat yang perlu mencatat siapa
   * yang pernah melihat KTP seseorang.
   */
  async readForAdmin(input: {
    orderId: string;
    type: MembershipDocumentType;
    adminId: string;
  }) {
    const document = await this.prisma.membershipDocument.findUnique({
      where: { orderId_type: { orderId: input.orderId, type: input.type } }
    });

    if (!document) {
      throw new AppError(
        "Dokumen tidak ditemukan.",
        StatusCodes.NOT_FOUND,
        "MEMBERSHIP_DOCUMENT_NOT_FOUND"
      );
    }

    if (!this.isReadable(document.expiresAt, document.purgedAt, new Date())) {
      // 410, bukan 404: dokumennya pernah ada dan sengaja dihapus. Admin perlu
      // tahu bedanya antara belum diunggah dan sudah lewat masa simpan.
      throw new AppError(
        "Masa simpan dokumen sudah berakhir.",
        StatusCodes.GONE,
        "MEMBERSHIP_DOCUMENT_EXPIRED"
      );
    }

    if (!document.cipherText || !document.cipherIv || !document.cipherTag) {
      throw new AppError(
        "Dokumen belum diunggah.",
        StatusCodes.NOT_FOUND,
        "MEMBERSHIP_DOCUMENT_NOT_FOUND"
      );
    }

    const bytes = decryptDocument({
      cipherText: document.cipherText,
      cipherIv: document.cipherIv,
      cipherTag: document.cipherTag,
      keyVersion: document.keyVersion
    });

    // Dicatat SETELAH dekripsi berhasil: percobaan yang gagal tidak menghasilkan
    // pembacaan, dan mencatatnya sebagai "dilihat" akan menyesatkan audit.
    // Ditulis di luar transaksi apa pun karena pembacaan memang tidak punya
    // transaksi — kegagalan menulis jejak tidak boleh menghalangi admin
    // mencetak, jadi kesalahannya dibiarkan naik apa adanya.
    await this.prisma.auditLog.create({
      data: {
        actorId: input.adminId,
        action: "MEMBERSHIP_DOCUMENT_VIEWED",
        entityType: "MEMBERSHIP_DOCUMENT",
        entityId: document.id,
        metadata: {
          orderId: input.orderId,
          targetUserId: document.userId,
          documentType: input.type,
          checksum: document.checksum
        }
      }
    });

    return {
      contentType: document.contentType ?? "application/octet-stream",
      checksum: document.checksum,
      bytes
    };
  }

  /**
   * Menghapus isi dokumen yang sudah lewat masa simpan.
   *
   * Barisnya tidak dihapus: status, checksum, dan jejak waktunya masih
   * dibutuhkan untuk audit — termasuk untuk membuktikan bahwa dokumen memang
   * pernah ada dan sudah dimusnahkan tepat waktu.
   */
  async purgeExpired(now = new Date()) {
    const result = await this.prisma.membershipDocument.updateMany({
      where: {
        expiresAt: { lte: now },
        purgedAt: null,
        cipherText: { not: null }
      },
      data: {
        cipherText: null,
        cipherIv: null,
        cipherTag: null,
        keyVersion: null,
        purgedAt: now
      }
    });

    return result.count;
  }

  private isReadable(expiresAt: Date | null, purgedAt: Date | null, now: Date) {
    if (purgedAt) return false;
    if (!expiresAt) return false;
    return expiresAt.getTime() > now.getTime();
  }

  private detectImageType(bytes: Buffer): string | null {
    for (const signature of IMAGE_SIGNATURES) {
      if (bytes.byteLength < signature.magic.length) continue;
      if (signature.magic.every((byte, index) => bytes[index] === byte)) {
        return signature.contentType;
      }
    }
    return null;
  }
}
