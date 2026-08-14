import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import {
  DriverDocumentService,
  DriverDocumentType,
  isDriverDocumentType
} from "../application/DriverDocumentService.js";

export class DriverDocumentController {
  constructor(private readonly documentService: DriverDocumentService) {}

  /**
   * Jenis dokumen selalu dinormalkan dan diperiksa terhadap daftar yang
   * diizinkan. Meneruskan nilai dari URL apa adanya akan menyimpan jenis
   * dokumen karangan ke kolom teks, dan laporan admin tidak lagi dapat
   * dipercaya.
   */
  private requireType(raw: unknown): DriverDocumentType {
    const value = String(raw ?? "").toUpperCase();
    if (!isDriverDocumentType(value)) {
      throw new AppError(
        "Jenis dokumen tidak dikenal.",
        StatusCodes.BAD_REQUEST,
        "DRIVER_DOCUMENT_TYPE_UNKNOWN"
      );
    }
    return value;
  }

  upload = async (req: Request, res: Response) => {
    // express.raw() hanya mengisi body sebagai Buffer untuk content-type gambar
    // yang diizinkan. Content-type lain sampai ke sini sebagai bukan-Buffer, dan
    // ditolak di bawah sebelum menyentuh service.
    if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
      throw new AppError(
        "Dokumen harus dikirim sebagai berkas gambar JPG atau PNG.",
        StatusCodes.UNSUPPORTED_MEDIA_TYPE,
        "DRIVER_DOCUMENT_TYPE_INVALID"
      );
    }

    const result = await this.documentService.upload({
      // userId diambil dari token, TIDAK PERNAH dari parameter permintaan.
      userId: req.auth!.userId,
      type: this.requireType(req.params.type),
      bytes: req.body
    });

    res.status(StatusCodes.CREATED).json({ success: true, data: result });
  };

  myDocuments = async (req: Request, res: Response) => {
    const result = await this.documentService.listOwn({
      userId: req.auth!.userId
    });
    res.json({ success: true, data: result });
  };

  adminDocuments = async (req: Request, res: Response) => {
    const result = await this.documentService.list({
      driverId: String(req.params.driverId)
    });
    res.json({ success: true, data: result });
  };

  /**
   * Antrian mitra yang punya dokumen. Halaman dibatasi 100 baris supaya satu
   * permintaan tidak pernah menarik seluruh tabel.
   */
  adminQueue = async (req: Request, res: Response) => {
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20) || 20));
    const result = await this.documentService.queueForAdmin({ page, pageSize });
    res.json({ success: true, data: result });
  };

  adminDocumentFile = async (req: Request, res: Response) => {
    const document = await this.documentService.readForAdmin({
      driverId: String(req.params.driverId),
      type: this.requireType(req.params.type),
      adminId: req.auth!.userId
    });

    // Dokumen identitas tidak boleh singgah di cache mana pun, termasuk cache
    // browser admin. Inline supaya admin dapat langsung mencetaknya.
    res.setHeader("cache-control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("pragma", "no-cache");
    res.setHeader("content-type", document.contentType);
    res.setHeader("content-disposition", "inline");
    res.setHeader("x-content-type-options", "nosniff");
    if (document.checksum) {
      res.setHeader("x-tapgo-document-checksum", document.checksum);
    }
    res.send(document.bytes);
  };
}
