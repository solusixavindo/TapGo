import { z } from "zod";

const coordinate = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(3).max(255),
});

const serviceType = z.enum(["MOTORCYCLE", "CAR"]);

/** Allowlist alasan pembatalan (tidak menerima teks bebas sebagai kode). */
const cancellationReason = z.enum([
  "WAIT_TOO_LONG",
  "DRIVER_NOT_MOVING",
  "CHANGE_OF_PLAN",
  "WRONG_PICKUP",
  "FOUND_OTHER_TRANSPORT",
  "PASSENGER_UNREACHABLE",
  "VEHICLE_PROBLEM",
  "SYSTEM_TIMEOUT",
  "OTHER",
]);

const publicReference = z
  .string()
  .trim()
  .regex(/^RID-[A-Z2-9]{10}$/, "Referensi perjalanan tidak valid");

export const createQuoteSchema = z.object({
  body: z.object({
    serviceType,
    pickup: coordinate,
    dropoff: coordinate,
  }),
});

export const createOrderSchema = z.object({
  body: z.object({
    quoteId: z.string().uuid(),
    // DIGITAL sengaja diterima skema agar ditolak fail-closed di service
    // dengan kode error yang jelas, bukan 400 generik.
    paymentMethod: z.enum(["CASH", "DIGITAL"]).default("CASH"),
  }),
});

export const rideReferenceSchema = z.object({
  params: z.object({ reference: publicReference }),
});

export const cancelRideSchema = z.object({
  params: z.object({ reference: publicReference }),
  body: z.object({
    reason: cancellationReason,
    note: z.string().trim().max(500).optional(),
  }),
});

export const driverAvailabilitySchema = z.object({
  body: z.object({
    availability: z.enum(["OFFLINE", "ONLINE", "BUSY"]),
  }),
});

export const driverLocationSchema = z.object({
  body: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyMeters: z.number().int().min(0).max(500),
    capturedAt: z.coerce.date(),
    sequence: z.number().int().min(1).optional(),
  }),
});

export const listRidesSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
});
