import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AccountRecoveryService } from "../application/AccountRecoveryService.js";

/**
 * Endpoint pemulihan akun dan verifikasi kontak.
 *
 * Tidak ada handler di sini yang mencatat identifier, kode, reset token,
 * maupun destination. Audit dilakukan lewat AuditLog dengan userId saja.
 */
export class RecoveryController {
  constructor(private readonly service: AccountRecoveryService) {}

  /**
   * Selalu 202 dengan pesan generik yang sama, apa pun hasilnya. Status dan
   * payload sengaja identik untuk akun yang ada maupun tidak ada.
   */
  requestRecovery = async (req: Request, res: Response) => {
    const result = await this.service.requestRecovery({
      identifier: req.body.identifier,
      context: {
        ...(typeof req.ip === "string" ? { ipAddress: req.ip } : {}),
        ...(typeof req.headers["user-agent"] === "string"
          ? { userAgent: req.headers["user-agent"] }
          : {})
      }
    });

    res.status(StatusCodes.ACCEPTED).json({ success: true, data: result });
  };

  verifyRecovery = async (req: Request, res: Response) => {
    const result = await this.service.verifyRecovery({
      identifier: req.body.identifier,
      code: req.body.code
    });

    res.json({ success: true, data: result });
  };

  /**
   * Tidak mengembalikan token sesi apa pun: setelah reset berhasil pengguna
   * wajib login ulang dengan password barunya.
   */
  resetPassword = async (req: Request, res: Response) => {
    await this.service.resetPassword({
      resetToken: req.body.resetToken,
      newPassword: req.body.newPassword
    });

    res.json({
      success: true,
      data: { message: "Password berhasil diperbarui. Silakan login kembali." }
    });
  };

  requestVerification = async (req: Request, res: Response) => {
    const result = await this.service.requestContactVerification({
      userId: req.auth!.userId,
      channel: req.body.channel
    });

    res.status(StatusCodes.ACCEPTED).json({ success: true, data: result });
  };

  confirmVerification = async (req: Request, res: Response) => {
    const result = await this.service.confirmContactVerification({
      userId: req.auth!.userId,
      channel: req.body.channel,
      code: req.body.code
    });

    res.json({ success: true, data: result });
  };

  verificationStatus = async (req: Request, res: Response) => {
    const result = await this.service.verificationStatus(req.auth!.userId);
    res.json({ success: true, data: result });
  };
}
