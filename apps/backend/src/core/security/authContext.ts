import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../errors/AppError.js";
import { JwtRole, verifyAccessToken } from "./tokenService.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: JwtRole;
        sessionId: string;
      };
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    throw new AppError("Missing bearer token", StatusCodes.UNAUTHORIZED, "AUTH_TOKEN_MISSING");
  }

  const payload = verifyAccessToken(token);
  req.auth = {
    userId: payload.sub,
    role: payload.role,
    sessionId: payload.sessionId
  };
  next();
}

export function requireRoles(...roles: JwtRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      throw new AppError("Authentication required", StatusCodes.UNAUTHORIZED, "AUTH_REQUIRED");
    }

    if (!roles.includes(req.auth.role)) {
      throw new AppError("Insufficient permissions", StatusCodes.FORBIDDEN, "FORBIDDEN");
    }

    next();
  };
}
