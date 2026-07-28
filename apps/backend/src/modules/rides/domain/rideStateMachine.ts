import { RideOrderStatus } from "@prisma/client";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";

/**
 * State machine ride yang authoritative di server.
 *
 * Prinsip:
 * - Client TIDAK pernah menentukan status; client hanya meminta aksi.
 * - Status terminal tidak dapat kembali menjadi status aktif.
 * - Transisi yang tidak sah menghasilkan domain error yang stabil.
 * - Domain pembayaran TERPISAH (RideOrder.paymentState), tidak dicampur di sini.
 */

export type RideActor = "PASSENGER" | "DRIVER" | "SYSTEM";

export const RIDE_TERMINAL_STATUSES: readonly RideOrderStatus[] = [
  "COMPLETED",
  "CANCELLED_BY_PASSENGER",
  "CANCELLED_BY_DRIVER",
  "CANCELLED_BY_SYSTEM",
  "NO_DRIVER",
  "EXPIRED",
  "PAYMENT_FAILED",
] as const;

export function isTerminalStatus(status: RideOrderStatus): boolean {
  return RIDE_TERMINAL_STATUSES.includes(status);
}

/**
 * Matriks transisi: status saat ini -> daftar transisi sah.
 * Setiap transisi mencantumkan aktor yang berhak melakukannya.
 */
export const RIDE_TRANSITIONS: Record<
  RideOrderStatus,
  ReadonlyArray<{ to: RideOrderStatus; actors: readonly RideActor[] }>
> = {
  CREATED: [
    { to: "SEARCHING_DRIVER", actors: ["SYSTEM"] },
    { to: "CANCELLED_BY_PASSENGER", actors: ["PASSENGER"] },
    { to: "CANCELLED_BY_SYSTEM", actors: ["SYSTEM"] },
    { to: "EXPIRED", actors: ["SYSTEM"] },
  ],
  SEARCHING_DRIVER: [
    { to: "DRIVER_ASSIGNED", actors: ["DRIVER", "SYSTEM"] },
    { to: "NO_DRIVER", actors: ["SYSTEM"] },
    { to: "CANCELLED_BY_PASSENGER", actors: ["PASSENGER"] },
    { to: "CANCELLED_BY_SYSTEM", actors: ["SYSTEM"] },
    { to: "EXPIRED", actors: ["SYSTEM"] },
  ],
  DRIVER_ASSIGNED: [
    { to: "DRIVER_TO_PICKUP", actors: ["DRIVER"] },
    { to: "CANCELLED_BY_PASSENGER", actors: ["PASSENGER"] },
    { to: "CANCELLED_BY_DRIVER", actors: ["DRIVER"] },
    { to: "CANCELLED_BY_SYSTEM", actors: ["SYSTEM"] },
  ],
  DRIVER_TO_PICKUP: [
    { to: "DRIVER_ARRIVED", actors: ["DRIVER"] },
    { to: "CANCELLED_BY_PASSENGER", actors: ["PASSENGER"] },
    { to: "CANCELLED_BY_DRIVER", actors: ["DRIVER"] },
    { to: "CANCELLED_BY_SYSTEM", actors: ["SYSTEM"] },
  ],
  DRIVER_ARRIVED: [
    { to: "IN_TRIP", actors: ["DRIVER"] },
    { to: "CANCELLED_BY_PASSENGER", actors: ["PASSENGER"] },
    { to: "CANCELLED_BY_DRIVER", actors: ["DRIVER"] },
    { to: "CANCELLED_BY_SYSTEM", actors: ["SYSTEM"] },
  ],
  IN_TRIP: [
    // Setelah perjalanan dimulai, pembatalan hanya oleh sistem (mis. insiden).
    { to: "COMPLETED", actors: ["DRIVER"] },
    { to: "CANCELLED_BY_SYSTEM", actors: ["SYSTEM"] },
  ],
  // Status terminal: tidak ada transisi keluar.
  COMPLETED: [],
  CANCELLED_BY_PASSENGER: [],
  CANCELLED_BY_DRIVER: [],
  CANCELLED_BY_SYSTEM: [],
  NO_DRIVER: [],
  EXPIRED: [],
  PAYMENT_FAILED: [],
};

export function canTransition(
  from: RideOrderStatus,
  to: RideOrderStatus,
  actor: RideActor,
): boolean {
  const allowed = RIDE_TRANSITIONS[from] ?? [];
  return allowed.some((t) => t.to === to && t.actors.includes(actor));
}

/**
 * Memvalidasi transisi. Melempar AppError yang stabil bila tidak sah,
 * tanpa membocorkan detail internal.
 */
export function assertTransition(
  from: RideOrderStatus,
  to: RideOrderStatus,
  actor: RideActor,
): void {
  if (from === to) {
    throw new AppError(
      "Perjalanan sudah berada pada status tersebut",
      StatusCodes.CONFLICT,
      "RIDE_STATUS_UNCHANGED",
    );
  }

  if (isTerminalStatus(from)) {
    throw new AppError(
      "Perjalanan sudah berakhir dan tidak dapat diubah",
      StatusCodes.CONFLICT,
      "RIDE_ALREADY_FINAL",
    );
  }

  if (!canTransition(from, to, actor)) {
    throw new AppError(
      "Perubahan status perjalanan tidak diizinkan",
      StatusCodes.CONFLICT,
      "RIDE_INVALID_TRANSITION",
    );
  }
}

/** Status yang masih dianggap aktif (menahan driver/penumpang). */
export function isActiveStatus(status: RideOrderStatus): boolean {
  return !isTerminalStatus(status);
}

/** Status di mana pembatalan oleh penumpang dikenakan biaya. */
export function passengerCancellationHasFee(status: RideOrderStatus): boolean {
  return (
    status === "DRIVER_ASSIGNED" ||
    status === "DRIVER_TO_PICKUP" ||
    status === "DRIVER_ARRIVED"
  );
}
