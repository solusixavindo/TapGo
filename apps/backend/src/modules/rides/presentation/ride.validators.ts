import { z } from "zod";

const coordinate = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(3).max(255),
});

const serviceType = z.enum(["MOTORCYCLE", "CAR"]);
const rideOrderStatus = z.enum([
  "CREATED",
  "SEARCHING_DRIVER",
  "DRIVER_ASSIGNED",
  "DRIVER_TO_PICKUP",
  "DRIVER_ARRIVED",
  "IN_TRIP",
  "COMPLETED",
  "CANCELLED_BY_PASSENGER",
  "CANCELLED_BY_DRIVER",
  "CANCELLED_BY_SYSTEM",
  "NO_DRIVER",
  "EXPIRED",
  "PAYMENT_FAILED",
]);
/**
 * Allowlist koreksi manual admin.
 *
 * `PAYMENT_FAILED` sengaja TIDAK disertakan: kegagalan pembayaran adalah urusan
 * domain pembayaran (`RideOrder.paymentState`), terpisah dari status ride.
 */
const adminTerminalRideStatus = z.enum([
  "CANCELLED_BY_SYSTEM",
  "NO_DRIVER",
  "EXPIRED",
]);
const driverStatus = z.enum(["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"]);
const vehicleVerificationStatus = z.enum(["PENDING", "VERIFIED", "REJECTED"]);

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

export const adminListRidesSchema = z.object({
  query: z.object({
    status: rideOrderStatus.optional(),
    serviceType: serviceType.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
});

export const adminCorrectRideStatusSchema = z.object({
  params: z.object({ reference: publicReference }),
  body: z.object({
    status: adminTerminalRideStatus,
    reason: z.string().trim().min(3).max(120),
    note: z.string().trim().max(500).optional(),
  }),
});

export const adminDriverProfileSchema = z.object({
  params: z.object({ driverProfileId: z.string().uuid() }),
});

export const adminListDriversSchema = z.object({
  query: z.object({
    status: driverStatus.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
});

export const adminDriverStatusSchema = z.object({
  params: z.object({ driverProfileId: z.string().uuid() }),
  body: z.object({
    status: driverStatus,
    reason: z.string().trim().min(3).max(120),
  }),
});

export const adminVehicleSchema = z.object({
  params: z.object({ vehicleId: z.string().uuid() }),
});

export const adminVehicleVerificationSchema = z.object({
  params: z.object({ vehicleId: z.string().uuid() }),
  body: z.object({
    verificationStatus: vehicleVerificationStatus,
    isActive: z.boolean().optional(),
    reason: z.string().trim().min(3).max(120),
  }),
});
