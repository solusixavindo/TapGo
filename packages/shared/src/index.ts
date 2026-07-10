export const TAPGO_ROLES = ["USER", "DRIVER", "ADMIN", "SUPER_ADMIN"] as const;

export type TapGoRole = (typeof TAPGO_ROLES)[number];

export const RIDE_STATUSES = [
  "REQUESTED",
  "MATCHING",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED"
] as const;

export type RideStatus = (typeof RIDE_STATUSES)[number];
