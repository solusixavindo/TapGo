import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AuthService } from "../application/AuthService.js";

export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
	      ...(typeof headerDeviceFingerprint === "string" ? { deviceIdentifier: headerDeviceFingerprint } : {})
	    };
	  }
	}
