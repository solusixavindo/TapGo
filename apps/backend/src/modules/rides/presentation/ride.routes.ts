import { Router } from "express";
import { prisma } from "../../../config/prisma.js";
import { asyncHandler } from "../../../core/http/asyncHandler.js";
import { validateRequest } from "../../../core/http/validateRequest.js";
import { requireAuth, requireRoles } from "../../../core/security/authContext.js";
import {
  rideLocationRateLimiter,
  rideWriteRateLimiter,
} from "../../../core/security/rateLimit.js";
import { RideService } from "../application/RideService.js";
import { LocalDistanceAdapter } from "../infrastructure/LocalDistanceAdapter.js";
import { PrismaMatchingAdapter } from "../infrastructure/PrismaMatchingAdapter.js";
import {
  cancelRideSchema,
  createOrderSchema,
  createQuoteSchema,
  driverAvailabilitySchema,
  driverLocationSchema,
  listRidesSchema,
  rideReferenceSchema,
} from "./ride.validators.js";

export const rideRouter = Router();
export const driverRideRouter = Router();

const rideService = new RideService(
  prisma,
  new LocalDistanceAdapter(),
  new PrismaMatchingAdapter(prisma),
);

/** Ambil parameter referensi sebagai string tunggal (sudah divalidasi Zod). */
function referenceParam(value: unknown): string {
  return Array.isArray(value) ? String(value[0]) : String(value);
}

/** Header idempotency opsional untuk operasi mutasi bernilai. */
function idempotencyKeyOf(headerValue: unknown): string | undefined {
  if (typeof headerValue !== "string") return undefined;
  const trimmed = headerValue.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return undefined;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Penumpang — /api/v1/rides
// ---------------------------------------------------------------------------

rideRouter.use(requireAuth);

rideRouter.post(
  "/quotes",
  rideWriteRateLimiter,
  validateRequest(createQuoteSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.createQuote({
      userId: req.auth!.userId,
      serviceType: req.body.serviceType,
      pickup: req.body.pickup,
      dropoff: req.body.dropoff,
      ...(idempotencyKeyOf(req.headers["idempotency-key"])
        ? { idempotencyKey: idempotencyKeyOf(req.headers["idempotency-key"])! }
        : {}),
    });
    res.status(201).json({ success: true, data });
  }),
);

rideRouter.post(
  "/",
  rideWriteRateLimiter,
  validateRequest(createOrderSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.createOrder({
      userId: req.auth!.userId,
      quoteId: req.body.quoteId,
      paymentMethod: req.body.paymentMethod,
      ...(idempotencyKeyOf(req.headers["idempotency-key"])
        ? { idempotencyKey: idempotencyKeyOf(req.headers["idempotency-key"])! }
        : {}),
    });
    res.status(201).json({ success: true, data });
  }),
);

rideRouter.get(
  "/",
  validateRequest(listRidesSchema),
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const data = await rideService.listPassengerOrders(
      req.auth!.userId,
      limit,
    );
    res.json({ success: true, data });
  }),
);

rideRouter.get(
  "/:reference",
  validateRequest(rideReferenceSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.getOrderForPassenger(
      req.auth!.userId,
      referenceParam(req.params.reference),
    );
    res.json({ success: true, data });
  }),
);

rideRouter.post(
  "/:reference/cancel",
  rideWriteRateLimiter,
  validateRequest(cancelRideSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.cancelByPassenger({
      userId: req.auth!.userId,
      publicReference: referenceParam(req.params.reference),
      reason: req.body.reason,
      ...(req.body.note !== undefined ? { note: req.body.note } : {}),
    });
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Driver — /api/v1/driver
// ---------------------------------------------------------------------------

driverRideRouter.use(requireAuth, requireRoles("DRIVER", "ADMIN", "SUPER_ADMIN"));

driverRideRouter.post(
  "/availability",
  rideWriteRateLimiter,
  validateRequest(driverAvailabilitySchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.setAvailability({
      userId: req.auth!.userId,
      availability: req.body.availability,
    });
    res.json({ success: true, data });
  }),
);

driverRideRouter.get(
  "/rides/offers",
  asyncHandler(async (req, res) => {
    const data = await rideService.listOffersForDriver(req.auth!.userId);
    res.json({ success: true, data });
  }),
);

driverRideRouter.post(
  "/rides/:reference/accept",
  rideWriteRateLimiter,
  validateRequest(rideReferenceSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.acceptOrder({
      userId: req.auth!.userId,
      publicReference: referenceParam(req.params.reference),
    });
    res.json({ success: true, data });
  }),
);

driverRideRouter.post(
  "/rides/:reference/reject",
  rideWriteRateLimiter,
  validateRequest(rideReferenceSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.rejectOffer({
      userId: req.auth!.userId,
      publicReference: referenceParam(req.params.reference),
    });
    res.json({ success: true, data });
  }),
);

driverRideRouter.post(
  "/rides/:reference/pickup",
  rideWriteRateLimiter,
  validateRequest(rideReferenceSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.advanceByDriver({
      userId: req.auth!.userId,
      publicReference: referenceParam(req.params.reference),
      next: "DRIVER_TO_PICKUP",
    });
    res.json({ success: true, data });
  }),
);

driverRideRouter.post(
  "/rides/:reference/arrived",
  rideWriteRateLimiter,
  validateRequest(rideReferenceSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.advanceByDriver({
      userId: req.auth!.userId,
      publicReference: referenceParam(req.params.reference),
      next: "DRIVER_ARRIVED",
    });
    res.json({ success: true, data });
  }),
);

driverRideRouter.post(
  "/rides/:reference/start",
  rideWriteRateLimiter,
  validateRequest(rideReferenceSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.advanceByDriver({
      userId: req.auth!.userId,
      publicReference: referenceParam(req.params.reference),
      next: "IN_TRIP",
    });
    res.json({ success: true, data });
  }),
);

driverRideRouter.post(
  "/rides/:reference/complete",
  rideWriteRateLimiter,
  validateRequest(rideReferenceSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.advanceByDriver({
      userId: req.auth!.userId,
      publicReference: referenceParam(req.params.reference),
      next: "COMPLETED",
    });
    res.json({ success: true, data });
  }),
);

driverRideRouter.post(
  "/rides/:reference/cancel",
  rideWriteRateLimiter,
  validateRequest(cancelRideSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.cancelByDriver({
      userId: req.auth!.userId,
      publicReference: referenceParam(req.params.reference),
      reason: req.body.reason,
      ...(req.body.note !== undefined ? { note: req.body.note } : {}),
    });
    res.json({ success: true, data });
  }),
);

driverRideRouter.post(
  "/location",
  rideLocationRateLimiter,
  validateRequest(driverLocationSchema),
  asyncHandler(async (req, res) => {
    const data = await rideService.recordDriverLocation({
      userId: req.auth!.userId,
      lat: req.body.lat,
      lng: req.body.lng,
      accuracyMeters: req.body.accuracyMeters,
      capturedAt: req.body.capturedAt,
      ...(req.body.sequence !== undefined ? { sequence: req.body.sequence } : {}),
    });
    res.json({ success: true, data });
  }),
);
