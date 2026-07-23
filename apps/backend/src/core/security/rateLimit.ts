import rateLimit from "express-rate-limit";
import { normalizePhoneNumber } from "./phone.js";

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMITED",
    message: "Too many authentication attempts. Please try again later."
  }
});

export const registerPhoneRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
    return phone ? `register-phone:${normalizePhoneNumber(phone)}` : `register-ip:${req.ip ?? "unknown"}`;
  },
  message: {
    success: false,
    code: "REGISTER_PHONE_RATE_LIMITED",
    message: "Terlalu banyak percobaan registrasi untuk nomor ini. Silakan coba lagi nanti."
  }
});

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

export const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMITED",
    message: "Too many admin requests. Please try again later."
  }
});

export const paymentRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "RATE_LIMITED",
    message: "Too many payment requests. Please try again later."
  }
});

export const supportRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: "SUPPORT_RATE_LIMITED",
    message: "Terlalu banyak permintaan bantuan. Silakan coba lagi nanti."
  }
});
