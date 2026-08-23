import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { TokenChannel } from "../../../core/security/tokenService.js";
import { AuthService } from "../application/AuthService.js";

export class AuthController {
  /**
   * `channel` adalah kanal yang distempel ke token yang diterbitkan controller
   * ini (K1c). Router app memakai "APP", router web memakai "WEB". Kanal
   * ditentukan server saat konstruksi — bukan dari header yang dapat dipalsukan.
   */
  constructor(
    private readonly authService: AuthService,
    private readonly channel?: TokenChannel
  ) {}

  register = async (req: Request, res: Response) => {
    const result = await this.authService.register({
      ...req.body,
      context: this.getContext(req)
    });

    res.status(StatusCodes.CREATED).json({ success: true, data: result });
  };

  login = async (req: Request, res: Response) => {
    const result = await this.authService.login({
      ...req.body,
      context: this.getContext(req)
    });

    res.json({ success: true, data: result });
  };

  refresh = async (req: Request, res: Response) => {
    const result = await this.authService.refresh(req.body.refreshToken, this.getContext(req));
    res.json({ success: true, data: result });
  };

  logout = async (req: Request, res: Response) => {
    await this.authService.logout(req.auth!.sessionId);
    res.status(StatusCodes.NO_CONTENT).send();
  };

  changePassword = async (req: Request, res: Response) => {
    await this.authService.changePassword({
      userId: req.auth!.userId,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword
    });
    // 204: tidak ada badan respons. Token pemanggil sudah mati saat ini juga,
    // jadi tidak ada data yang pantas dikembalikan.
    res.status(StatusCodes.NO_CONTENT).send();
  };

  me = async (req: Request, res: Response) => {
    const user = await this.authService.me(req.auth!.userId);
    res.json({ success: true, data: user });
  };

	  private getContext(req: Request) {
	    const headerDeviceId = req.headers["x-tapgo-device-id"];
	    const headerDeviceFingerprint = req.headers["x-tapgo-device-fingerprint"];
	    return {
	      ...(typeof req.headers["user-agent"] === "string" ? { userAgent: req.headers["user-agent"] } : {}),
	      ...(typeof req.ip === "string" ? { ipAddress: req.ip } : {}),
	      ...(typeof headerDeviceId === "string" ? { deviceIdentifier: headerDeviceId } : {}),
	      ...(typeof headerDeviceFingerprint === "string" ? { deviceIdentifier: headerDeviceFingerprint } : {}),
              ...(this.channel !== undefined ? { channel: this.channel } : {})
	    };
	  }
	}
