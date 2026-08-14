import { MembershipDocumentType } from "@prisma/client";
import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import { MembershipDocumentService } from "../application/MembershipDocumentService.js";

export class MembershipDocumentController {
  constructor(private readonly documentService: MembershipDocumentService) {}

  upload = async (req: Request, res: Response) => {
    // express.raw() hanya mengisi body sebagai Buffer untuk content-type gambar
    // yang diizinkan. Content-type lain sampai ke sini sebagai bukan-Buffer, dan
    // ditolak di bawah sebelum menyentuh service.
    if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
      throw new AppError(
        "Dokumen harus dikirim sebagai berkas gambar JPG atau PNG.",
        StatusCodes.UNSUPPORTED_MEDIA_TYPE,
        "MEMBERSHIP_DOCUMENT_TYPE_INVALID"
      );
    }

    const result = await this.documentService.upload({
      userId: req.auth!.userId,
      orderId: String(req.params.id),
      type: String(req.params.type).toUpperCase() as MembershipDocumentType,
      contentType: String(req.headers["content-type"] ?? ""),
      bytes: req.body
    });

    res.status(StatusCodes.CREATED).json({ success: true, data: result });
  };

  myDocuments = async (req: Request, res: Response) => {
    // Pemohon hanya boleh melihat ringkasan dokumen pengajuannya sendiri.
    const order = await this.documentService.assertOwnedOrder({
      userId: req.auth!.userId,
      orderId: String(req.params.id)
    });
    const result = await this.documentService.list({ orderId: order.id });
    res.json({ success: true, data: result });
  };

  adminDocuments = async (req: Request, res: Response) => {
    const result = await this.documentService.list({ orderId: String(req.params.id) });
    res.json({ success: true, data: result });
  };

  adminDocumentFile = async (req: Request, res: Response) => {
    const document = await this.documentService.readForAdmin({
      orderId: String(req.params.id),
      type: String(req.params.type).toUpperCase() as MembershipDocumentType,
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
