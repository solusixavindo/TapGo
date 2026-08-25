import { PrismaClient } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { env } from "../../../config/env.js";
import { AppError } from "../../../core/errors/AppError.js";
import {
  decryptDocument,
  encryptDocument
} from "../../../core/security/documentCipher.js";

/**
 * Dokumen identitas dan kendaraan mitra driver.
 *
 * Keputusan Owner: kebijakan 24 jam yang berlaku untuk dokumen membership
 * diberlakukan juga di sini. Berkas disimpan di database aplikasi paling lama
 * 24 jam; dalam rentang itu admin mencetaknya menjadi berkas administrasi, lalu
 * isinya dihapus. Barisnya sendiri tetap ada karena status dan jejak waktunya
 * masih dibutuhkan untuk audit.
 *
 * Empat hal yang dijaga di sini:
 * - Isi berkas tidak pernah tersimpan mentah, dan kuncinya diturunkan pada
 *   domain "driver" — berbeda dari domain membership, sehingga kebocoran satu
 *   domain tidak membuka domain lain.
 * - Isi yang sudah lewat masa simpan tidak pernah disajikan, walau penyapunya
 *   belum sempat berjalan. Yang menentukan adalah waktu, bukan pekerjaan latar.
 * - Driver hanya dapat menyentuh dokumennya sendiri, dan admin pun tidak
 *   mengunggah atas namanya: dokumen identitas harus datang dari orangnya.
 * - Setiap kali admin membuka isi dokumen, kejadian itu dicatat.
 */

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/**
 * Jenis dokumen yang diterima.
 *
 * Kolomnya bertipe teks, bukan enum database, sehingga daftar inilah satu-satunya
 * penjaga. Nilai di luar daftar ditolak, bukan disimpan apa adanya — tanpa ini
 * satu salah ketik akan melahirkan jenis dokumen baru secara diam-diam dan
 * membuat laporan admin tidak lagi dapat dipercaya.
 */
export const DRIVER_DOCUMENT_TYPES = ["KTP", "SIM", "STNK", "SELFIE"] as const;
export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

export function isDriverDocumentType(value: string): value is DriverDocumentType {
  return (DRIVER_DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Content-type dari klien hanyalah keterangan yang dikirim klien. Yang
 * menentukan adalah beberapa byte pertama berkas, sehingga berkas apa pun yang
 * menyamar sebagai gambar akan tertolak.
 */
const IMAGE_SIGNATURES: Array<{ contentType: string; magic: number[] }> = [
  { contentType: "image/png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { contentType: "image/jpeg", magic: [0xff, 0xd8, 0xff] }
];

export class DriverDocumentService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Menemukan profil driver milik pengguna yang sedang masuk, dan MEMBUATNYA
   * bila belum ada.
   *
   * Keputusan Owner (D1): pengajuan mitra bersifat mandiri — orang biasa
   * mengunggah dokumennya DULU, dan baris Driver dibuat sebagai pradataur
   * (kycStatus NOT_SUBMITTED, status OFFLINE). Profil operasional
   * (RideDriverProfile) baru lahir saat pengajuan disetujui admin.
   *
   * Driver dicari lewat userId, TIDAK PERNAH lewat driverId dari permintaan.
   * Menerima driverId dari klien berarti mempersilakan siapa pun mengunggah
   * dokumen atas nama driver lain hanya dengan menebak satu id.
   */
  private async ensureOwnDriver(userId: string) {
    return this.prisma.driver.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: { id: true, kycStatus: true }
    });
  }

  async upload(input: {
    userId: string;
    type: DriverDocumentType;
    bytes: Buffer;
  }) {
    const detected = this.detectImageType(input.bytes);
    if (!detected) {
      throw new AppError(
        "Dokumen harus berupa gambar JPG atau PNG.",
        StatusCodes.UNSUPPORTED_MEDIA_TYPE,
        "DRIVER_DOCUMENT_TYPE_INVALID"
      );
    }
    if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new AppError(
        "Ukuran dokumen maksimal 5 MB.",
        StatusCodes.REQUEST_TOO_LONG,
        "DRIVER_DOCUMENT_TOO_LARGE"
      );
    }

    const driver = await this.ensureOwnDriver(input.userId);

    // Setelah KYC disetujui, berkas tidak boleh diganti lagi. Membiarkannya
    // terbuka berarti dokumen yang sudah diperiksa dapat ditukar diam-diam
    // setelah persetujuan keluar.
    if (driver.kycStatus === "APPROVED") {
      throw new AppError(
        "Verifikasi mitra sudah disetujui; dokumen tidak dapat diubah lagi.",
        StatusCodes.CONFLICT,
        "DRIVER_KYC_ALREADY_APPROVED"
      );
    }

    const encrypted = encryptDocument(input.bytes, "driver");
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + env.DRIVER_DOCUMENT_RETENTION_HOURS * 60 * 60 * 1000
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
      status: "PENDING" as const,
      reviewedBy: null,
      reviewedAt: null
    };

    const document = await this.prisma.driverDocument.upsert({
      where: { driverId_type: { driverId: driver.id, type: input.type } },
      update: stored,
      create: { driverId: driver.id, type: input.type, ...stored },
      select: {
        id: true,
        type: true,
        status: true,
        sizeBytes: true,
        checksum: true,
        expiresAt: true
      }
    });

    // Pengajuan yang pernah ditolak kembali menunggu pemeriksaan begitu berkas
    // barunya masuk. Tanpa ini, driver mengunggah perbaikan lalu status akunnya
    // tetap tertulis DITOLAK dan tidak pernah masuk antrean admin lagi.
    if (driver.kycStatus === "NOT_SUBMITTED" || driver.kycStatus === "REJECTED") {
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: { kycStatus: "PENDING" }
      });
    }

    return document;
  }

  /** Ringkasan untuk driver dan admin. Tidak pernah memuat isi berkas. */
  async list(input: { driverId: string }) {
    const documents = await this.prisma.driverDocument.findMany({
      where: { driverId: input.driverId },
      orderBy: { type: "asc" },
      select: {
        id: true,
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

  /** Daftar dokumen milik pengguna yang sedang masuk. */
  async listOwn(input: { userId: string }) {
    const driver = await this.ensureOwnDriver(input.userId);
    return this.list({ driverId: driver.id });
  }

  /**
   * Antrian dokumen mitra untuk admin.
   *
   * Jembatan yang sebelumnya tidak ada: endpoint dokumen menuntut driverId,
   * sedangkan antrian peninjauan pengajuan sengaja tidak membawa identitas
   * maupun driverId. Tanpa ini admin tidak punya jalan sampai ke berkas yang
   * harus dicetak.
   *
   * Yang dibawa hanya metadata dan identitas secukupnya untuk mencocokkan
   * hasil cetak dengan pemiliknya. Isi berkas TIDAK PERNAH ikut — satu-satunya
   * jalan keluarnya tetap readForAdmin, dan hanya di sanalah pembukaan dokumen
   * dicatat.
   */
  async queueForAdmin(input: { page: number; pageSize: number }) {
    // Hanya driver yang benar-benar punya dokumen. Baris tanpa dokumen berarti
    // tidak ada pekerjaan, dan hanya membuat antrian sulit dibaca.
    const where = { documents: { some: {} } };

    const [total, drivers] = await Promise.all([
      this.prisma.driver.count({ where }),
      this.prisma.driver.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          kycStatus: true,
          vehicleType: true,
          vehiclePlate: true,
          user: { select: { fullName: true, phone: true } },
          documents: {
            orderBy: { type: "asc" },
            select: {
              type: true,
              status: true,
              contentType: true,
              sizeBytes: true,
              uploadedAt: true,
              expiresAt: true,
              purgedAt: true
            }
          }
        }
      })
    ]);

    const now = new Date();
    const items = drivers.map((driver) => ({
      driverId: driver.id,
      fullName: driver.user.fullName,
      phone: driver.user.phone,
      kycStatus: driver.kycStatus,
      vehicleType: driver.vehicleType,
      vehiclePlate: driver.vehiclePlate,
      documents: driver.documents.map(({ purgedAt, ...document }) => ({
        ...document,
        // Sama seperti list(): waktu yang menentukan, bukan kolom purgedAt.
        available: this.isReadable(document.expiresAt, purgedAt, now)
      }))
    }));

    return {
      items,
      total,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.max(1, Math.ceil(total / input.pageSize))
    };
  }

  /**
   * Isi berkas untuk dicetak admin. Satu-satunya jalan keluar isi dokumen dari
   * database, dan karena itu satu-satunya tempat yang perlu mencatat siapa yang
   * pernah melihat KTP seseorang.
   */
  async readForAdmin(input: {
    driverId: string;
    type: DriverDocumentType;
    adminId: string;
  }) {
    const document = await this.prisma.driverDocument.findUnique({
      where: { driverId_type: { driverId: input.driverId, type: input.type } }
    });

    if (!document) {
      throw new AppError(
        "Dokumen tidak ditemukan.",
        StatusCodes.NOT_FOUND,
        "DRIVER_DOCUMENT_NOT_FOUND"
      );
    }

    if (!this.isReadable(document.expiresAt, document.purgedAt, new Date())) {
      // 410, bukan 404: dokumennya pernah ada dan sengaja dihapus. Admin perlu
      // tahu bedanya antara belum diunggah dan sudah lewat masa simpan.
      throw new AppError(
        "Masa simpan dokumen sudah berakhir.",
        StatusCodes.GONE,
        "DRIVER_DOCUMENT_EXPIRED"
      );
    }

    if (!document.cipherText || !document.cipherIv || !document.cipherTag) {
      throw new AppError(
        "Dokumen belum diunggah.",
        StatusCodes.NOT_FOUND,
        "DRIVER_DOCUMENT_NOT_FOUND"
      );
    }

    const bytes = decryptDocument(
      {
        cipherText: document.cipherText,
        cipherIv: document.cipherIv,
        cipherTag: document.cipherTag,
        keyVersion: document.keyVersion
      },
      "driver"
    );

    // Dicatat SETELAH dekripsi berhasil: percobaan yang gagal tidak menghasilkan
    // pembacaan, dan mencatatnya sebagai "dilihat" akan menyesatkan audit.
    await this.prisma.auditLog.create({
      data: {
        actorId: input.adminId,
        action: "DRIVER_DOCUMENT_VIEWED",
        entityType: "DRIVER_DOCUMENT",
        entityId: document.id,
        metadata: {
          driverId: input.driverId,
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
   *
   * PENGECUALIAN (keputusan Owner D1): dokumen milik pengemudi yang masih
   * memiliki pengajuan mitra TERBUKA (DRAFT/SUBMITTED/UNDER_REVIEW) tidak
   * disapu — menghapus bukti sebelum review selesai membuat admin memutuskan
   * tanpa berkas. Begitu pengajuan mencapai status terminal (APPROVED/
   * REJECTED/WITHDRAWN), retensi normal kembali berlaku pada penyapuan
   * berikutnya.
   */
  async purgeExpired(now = new Date()) {
    const result = await this.prisma.driverDocument.updateMany({
      where: {
        expiresAt: { lte: now },
        purgedAt: null,
        cipherText: { not: null },
        driver: {
          user: {
            rideDriverApplications: {
              none: {
                status: { in: ["DRAFT", "SUBMITTED", "UNDER_REVIEW"] }
              }
            }
          }
        }
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
