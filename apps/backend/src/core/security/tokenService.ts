import jwt, { SignOptions } from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { env } from "../../config/env.js";

export type JwtRole = UserRole;

export type AccessTokenPayload = {
  sub: string;
  role: JwtRole;
  sessionId: string;
};

type JwtExpiresIn = NonNullable<SignOptions["expiresIn"]>;

function sign(payload: AccessTokenPayload, secret: string, options: SignOptions) {
  return jwt.sign(payload, secret, {
    issuer: "tapgo-api",
    audience: "tapgo-apps",
    ...options
  });
}

function expiresIn(value: string): JwtExpiresIn {
  return value as JwtExpiresIn;
}

export function signAccessToken(payload: AccessTokenPayload) {
  return sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: expiresIn(env.JWT_ACCESS_TTL) });
}

export function signRefreshToken(payload: AccessTokenPayload) {
  return sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: expiresIn(`${env.JWT_REFRESH_TTL_DAYS}d`) });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: "tapgo-api",
    audience: "tapgo-apps"
  }) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: "tapgo-api",
    audience: "tapgo-apps"
  }) as AccessTokenPayload;
}
