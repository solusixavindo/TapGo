import {
  Prisma,
  PrismaClient,
  RideActorRole,
  RideCancellationReason,
  RideDriverAvailability,
  RideDriverStatus,
  RideOrderStatus,
  RideServiceType,
  RideVehicleVerificationStatus,
} from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { AppError } from "../../../core/errors/AppError.js";
import {
  calculateFare,
  quoteExpiryFrom,
} from "../domain/fareCalculator.js";
import {
  DistancePort,
  GeoPoint,
  MatchingPort,
  isLocationFresh,
  isValidCoordinate,
  LOCATION_MAX_ACCURACY_METERS,
} from "../domain/ridePorts.js";
import {
  AdminCorrectableStatus,
  assertTransition,
  canAdminCorrect,
  isTerminalStatus,
  passengerCancellationHasFee,
  RIDE_DRIVER_ENGAGED_STATUSES,
} from "../domain/rideStateMachine.js";

const CANCELLATION_POLICY_VERSION = "RIDE_CANCEL_POLICY_V1";
const CANCELLATION_FEE = 2_000; // integer rupiah

/**
 * Layanan domain Ride (authoritative server-side).
 *
 * Jaminan keamanan:
 * - tarif, jarak, dan status TIDAK pernah dipercaya dari client;
 * - kepemilikan (ownership) diverifikasi pada setiap operasi;
 * - penetapan driver bersifat atomic (conditional update);
 * - operasi mutasi mendukung idempotency key;
 * - setiap transisi material menulis RideEvent (audit immutable);
 * - koordinat presisi tidak pernah dimasukkan ke log atau pesan error.
 */
export class RideService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly distance: DistancePort,
    private readonly matching: MatchingPort,
  ) {}

  // -------------------------------------------------------------------------
  // Quote
  // -------------------------------------------------------------------------

  async createQuote(input: {
    userId: string;
    serviceType: RideServiceType;
    pickup: GeoPoint & { address: string };
    dropoff: GeoPoint & { address: string };
    idempotencyKey?: string;
  }) {
    this.assertCoordinates(input.pickup, input.dropoff);

    if (input.idempotencyKey) {
      const existing = await this.findIdempotent(
        "RIDE_QUOTE",
        input.userId,
        input.idempotencyKey,
      );
      if (existing?.resourceId) {
        const quote = await this.prisma.rideQuote.findUnique({
          where: { id: existing.resourceId },
        });
        if (quote) return this.toQuoteView(quote);
      }
    }

    // Jarak berasal dari server, bukan dari client.
    const estimate = await this.distance.estimate({
      pickup: input.pickup,
      dropoff: input.dropoff,
      serviceType: input.serviceType,
    });

    const fare = calculateFare({
      serviceType: input.serviceType,
      distanceMeters: estimate.distanceMeters,
    });

    const now = new Date();
    const quote = await this.prisma.rideQuote.create({
      data: {
        userId: input.userId,
        serviceType: input.serviceType,
        pickupLat: new Prisma.Decimal(input.pickup.lat),
        pickupLng: new Prisma.Decimal(input.pickup.lng),
        pickupAddress: input.pickup.address,
        dropoffLat: new Prisma.Decimal(input.dropoff.lat),
        dropoffLng: new Prisma.Decimal(input.dropoff.lng),
        dropoffAddress: input.dropoff.address,
        distanceMeters: estimate.distanceMeters,
        durationSeconds: estimate.durationSeconds,
        etaSeconds: estimate.etaSeconds,
        baseFare: fare.baseFare,
        distanceFare: fare.distanceFare,
        serviceFee: fare.serviceFee,
        subtotalFare: fare.subtotalFare,
        totalFare: fare.totalFare,
        fareRuleVersion: fare.fareRuleVersion,
        roundingRule: fare.roundingRule,
        distanceSource: estimate.source,
        expiresAt: quoteExpiryFrom(now),
      },
    });

    if (input.idempotencyKey) {
      await this.recordIdempotent(
        "RIDE_QUOTE",
        input.userId,
        input.idempotencyKey,
        quote.id,
      );
    }

    return this.toQuoteView(quote);
  }

  // -------------------------------------------------------------------------
  // Order (penumpang)
  // -------------------------------------------------------------------------

  async createOrder(input: {
    userId: string;
    quoteId: string;
    paymentMethod: "CASH" | "DIGITAL";
    idempotencyKey?: string;
  }) {
    // Pembayaran digital fail-closed pada Stage 5.2.
    if (input.paymentMethod === "DIGITAL") {
      throw new AppError(
        "Pembayaran digital belum tersedia untuk perjalanan",
        StatusCodes.FORBIDDEN,
        "RIDE_DIGITAL_PAYMENT_NOT_CONFIGURED",
      );
    }

    if (input.idempotencyKey) {
      const existing = await this.findIdempotent(
        "RIDE_ORDER",
        input.userId,
        input.idempotencyKey,
      );
      if (existing?.resourceId) {
        const order = await this.prisma.rideOrder.findUnique({
          where: { id: existing.resourceId },
        });
        if (order) return this.toOrderView(order);
      }
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const quote = await tx.rideQuote.findUnique({
        where: { id: input.quoteId },
      });
      if (!quote) {
        throw new AppError(
          "Estimasi perjalanan tidak ditemukan",
          StatusCodes.NOT_FOUND,
          "RIDE_QUOTE_NOT_FOUND",
        );
      }
      // Ownership: quote hanya boleh dipakai pemiliknya.
      if (quote.userId !== input.userId) {
        throw new AppError(
          "Estimasi perjalanan tidak dapat digunakan",
          StatusCodes.FORBIDDEN,
          "RIDE_QUOTE_FORBIDDEN",
        );
      }
      if (quote.expiresAt.getTime() <= Date.now()) {
        throw new AppError(
          "Estimasi perjalanan sudah kedaluwarsa",
          StatusCodes.CONFLICT,
          "RIDE_QUOTE_EXPIRED",
        );
      }

      // Satu penumpang hanya boleh memiliki satu perjalanan aktif.
      const activeOrder = await tx.rideOrder.findFirst({
        where: {
          passengerId: input.userId,
          status: {
            in: [
              "CREATED",
              "SEARCHING_DRIVER",
              "DRIVER_ASSIGNED",
              "DRIVER_TO_PICKUP",
              "DRIVER_ARRIVED",
              "IN_TRIP",
            ],
          },
        },
        select: { id: true },
      });
      if (activeOrder) {
        throw new AppError(
          "Anda masih memiliki perjalanan yang berjalan",
          StatusCodes.CONFLICT,
          "RIDE_ACTIVE_ORDER_EXISTS",
        );
      }

      let created;
      try {
        created = await tx.rideOrder.create({
          data: {
            publicReference: generatePublicReference(),
            passengerId: input.userId,
            quoteId: quote.id,
            serviceType: quote.serviceType,
            status: "SEARCHING_DRIVER",
            pickupLat: quote.pickupLat,
            pickupLng: quote.pickupLng,
            pickupAddress: quote.pickupAddress,
            dropoffLat: quote.dropoffLat,
            dropoffLng: quote.dropoffLng,
            dropoffAddress: quote.dropoffAddress,
            distanceMeters: quote.distanceMeters,
            durationSeconds: quote.durationSeconds,
            baseFare: quote.baseFare,
            distanceFare: quote.distanceFare,
            serviceFee: quote.serviceFee,
            subtotalFare: quote.subtotalFare,
            totalFare: quote.totalFare,
            fareRuleVersion: quote.fareRuleVersion,
            paymentMethod: "CASH",
            paymentState: "CASH_EXPECTED",
          },
        });
      } catch (error) {
        // quoteId unique -> quote tidak dapat dipakai dua kali.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new AppError(
            "Estimasi perjalanan sudah digunakan",
            StatusCodes.CONFLICT,
            "RIDE_QUOTE_ALREADY_USED",
          );
        }
        throw error;
      }

      await this.writeEvent(tx, {
        rideOrderId: created.id,
        type: "ORDER_CREATED",
        actorUserId: input.userId,
        actorRole: "PASSENGER",
        newStatus: created.status,
        metadata: { serviceType: created.serviceType },
      });
      await this.writeEvent(tx, {
        rideOrderId: created.id,
        type: "MATCHING_STARTED",
        actorRole: "SYSTEM",
        previousStatus: "CREATED",
        newStatus: "SEARCHING_DRIVER",
      });

      return created;
    });

    if (input.idempotencyKey) {
      await this.recordIdempotent(
        "RIDE_ORDER",
        input.userId,
        input.idempotencyKey,
        order.id,
      );
    }

    return this.toOrderView(order);
  }

  async listPassengerOrders(userId: string, limit = 20) {
    const orders = await this.prisma.rideOrder.findMany({
      where: { passengerId: userId },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 50)),
    });
    return orders.map((o) => this.toOrderView(o));
  }

  async getOrderForPassenger(userId: string, publicReference: string) {
    const order = await this.prisma.rideOrder.findUnique({
      where: { publicReference },
    });
    if (!order || order.passengerId !== userId) {
      // Tidak membocorkan keberadaan resource milik orang lain.
      throw new AppError(
        "Perjalanan tidak ditemukan",
        StatusCodes.NOT_FOUND,
        "RIDE_ORDER_NOT_FOUND",
      );
    }
    return this.toOrderView(order);
  }

  async cancelByPassenger(input: {
    userId: string;
    publicReference: string;
    reason: RideCancellationReason;
    note?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.rideOrder.findUnique({
        where: { publicReference: input.publicReference },
      });
      if (!order || order.passengerId !== input.userId) {
        throw new AppError(
          "Perjalanan tidak ditemukan",
          StatusCodes.NOT_FOUND,
          "RIDE_ORDER_NOT_FOUND",
        );
      }

      assertTransition(order.status, "CANCELLED_BY_PASSENGER", "PASSENGER");

      const fee = passengerCancellationHasFee(order.status)
        ? CANCELLATION_FEE
        : 0;

      const updated = await tx.rideOrder.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED_BY_PASSENGER",
          cancelledByUserId: input.userId,
          cancelledByRole: "PASSENGER",
          cancellationReason: input.reason,
          ...(input.note !== undefined ? { cancellationNote: input.note } : {}),
          cancellationFee: fee,
          cancellationPolicy: CANCELLATION_POLICY_VERSION,
          cancelledAt: new Date(),
        },
      });

      await this.releaseDriver(tx, order.driverProfileId);
      await this.writeEvent(tx, {
        rideOrderId: order.id,
        type: "CANCELLED",
        actorUserId: input.userId,
        actorRole: "PASSENGER",
        previousStatus: order.status,
        newStatus: updated.status,
        metadata: { reason: input.reason, fee, policy: CANCELLATION_POLICY_VERSION },
      });

      return this.toOrderView(updated);
    });
  }

  // -------------------------------------------------------------------------
  // Driver
  // -------------------------------------------------------------------------

  async setAvailability(input: {
    userId: string;
    availability: RideDriverAvailability;
  }) {
    const profile = await this.requireDriverProfile(input.userId);
    if (profile.status !== "ACTIVE") {
      throw new AppError(
        "Akun driver belum aktif",
        StatusCodes.FORBIDDEN,
        "RIDE_DRIVER_NOT_ACTIVE",
      );
    }
    const updated = await this.prisma.rideDriverProfile.update({
      where: { id: profile.id },
      data: { availability: input.availability, lastSeenAt: new Date() },
      select: { id: true, availability: true, status: true },
    });
    return updated;
  }

  /** Tawaran yang layak untuk driver (hanya order yang masih mencari driver). */
  async listOffersForDriver(userId: string, limit = 10) {
    const profile = await this.requireDriverProfile(userId);
    // Kapabilitas (User.status + profile.status) sudah ditegakkan
    // requireDriverProfile dan melempar 403 bila tidak terpenuhi. Yang tersisa
    // di sini murni soal ketersediaan: driver ACTIVE yang sedang OFFLINE/BUSY
    // tidak menerima tawaran, dan itu bukan kondisi error.
    if (profile.availability !== "ONLINE") {
      return [];
    }

    const vehicleTypes = await this.prisma.rideVehicle.findMany({
      where: {
        driverProfileId: profile.id,
        isActive: true,
        verificationStatus: "VERIFIED",
      },
      select: { type: true },
    });
    if (vehicleTypes.length === 0) return [];

    const orders = await this.prisma.rideOrder.findMany({
      where: {
        status: "SEARCHING_DRIVER",
        driverProfileId: null,
        serviceType: { in: vehicleTypes.map((v) => v.type) },
      },
      orderBy: { createdAt: "asc" },
      take: Math.max(1, Math.min(limit, 20)),
    });

    return orders.map((o) => this.toOfferView(o));
  }

  /**
   * Penerimaan order oleh driver — ATOMIC.
   *
   * Memakai conditional updateMany (status masih SEARCHING_DRIVER dan
   * driverProfileId masih NULL). Hanya satu driver yang dapat menang;
   * driver lain menerima RIDE_ALREADY_TAKEN.
   */
  async acceptOrder(input: { userId: string; publicReference: string }) {
    const profile = await this.requireDriverProfile(input.userId);
    if (profile.status !== "ACTIVE") {
      throw new AppError(
        "Akun driver belum aktif",
        StatusCodes.FORBIDDEN,
        "RIDE_DRIVER_NOT_ACTIVE",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.rideOrder.findUnique({
        where: { publicReference: input.publicReference },
      });
      if (!order) {
        throw new AppError(
          "Perjalanan tidak ditemukan",
          StatusCodes.NOT_FOUND,
          "RIDE_ORDER_NOT_FOUND",
        );
      }

      // Idempoten: driver yang sama menerima ulang order miliknya.
      if (order.driverProfileId === profile.id) {
        return this.toOrderView(order);
      }

      const vehicle = await tx.rideVehicle.findFirst({
        where: {
          driverProfileId: profile.id,
          type: order.serviceType,
          isActive: true,
          verificationStatus: "VERIFIED",
        },
        select: { id: true },
      });
      if (!vehicle) {
        throw new AppError(
          "Kendaraan Anda tidak sesuai untuk perjalanan ini",
          StatusCodes.FORBIDDEN,
          "RIDE_VEHICLE_NOT_ELIGIBLE",
        );
      }

      // ---- Klaim atomic: hanya satu driver yang lolos ----
      const claim = await tx.rideOrder.updateMany({
        where: {
          id: order.id,
          status: "SEARCHING_DRIVER",
          driverProfileId: null,
        },
        data: {
          driverProfileId: profile.id,
          vehicleId: vehicle.id,
          status: "DRIVER_ASSIGNED",
          assignedAt: new Date(),
        },
      });
      if (claim.count !== 1) {
        throw new AppError(
          "Perjalanan sudah diambil driver lain",
          StatusCodes.CONFLICT,
          "RIDE_ALREADY_TAKEN",
        );
      }
      // ----------------------------------------------------

      await tx.rideDriverProfile.update({
        where: { id: profile.id },
        data: { availability: "BUSY" },
      });

      await this.writeEvent(tx, {
        rideOrderId: order.id,
        type: "DRIVER_ASSIGNED",
        actorUserId: input.userId,
        actorRole: "DRIVER",
        previousStatus: "SEARCHING_DRIVER",
        newStatus: "DRIVER_ASSIGNED",
      });

      const updated = await tx.rideOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      return this.toOrderView(updated);
    });
  }

  async rejectOffer(input: { userId: string; publicReference: string }) {
    const profile = await this.requireDriverProfile(input.userId);
    const order = await this.prisma.rideOrder.findUnique({
      where: { publicReference: input.publicReference },
      select: { id: true, driverProfileId: true },
    });
    if (!order) {
      throw new AppError(
        "Perjalanan tidak ditemukan",
        StatusCodes.NOT_FOUND,
        "RIDE_ORDER_NOT_FOUND",
      );
    }
    // Menolak tawaran tidak mengubah status order (order tetap dicari driver lain).
    await this.writeEvent(this.prisma, {
      rideOrderId: order.id,
      type: "DRIVER_REJECTED_OFFER",
      actorUserId: input.userId,
      actorRole: "DRIVER",
      metadata: { driverProfileId: profile.id },
      eventKeySuffix: profile.id,
    });
    return { rejected: true };
  }

  /** Transisi status oleh driver yang ditugaskan. */
  async advanceByDriver(input: {
    userId: string;
    publicReference: string;
    next: Extract<
      RideOrderStatus,
      "DRIVER_TO_PICKUP" | "DRIVER_ARRIVED" | "IN_TRIP" | "COMPLETED"
    >;
  }) {
    const profile = await this.requireDriverProfile(input.userId);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.rideOrder.findUnique({
        where: { publicReference: input.publicReference },
      });
      if (!order) {
        throw new AppError(
          "Perjalanan tidak ditemukan",
          StatusCodes.NOT_FOUND,
          "RIDE_ORDER_NOT_FOUND",
        );
      }
      // Ownership driver.
      if (order.driverProfileId !== profile.id) {
        throw new AppError(
          "Anda bukan driver perjalanan ini",
          StatusCodes.FORBIDDEN,
          "RIDE_DRIVER_FORBIDDEN",
        );
      }

      // Idempoten: permintaan berulang pada status yang sama.
      if (order.status === input.next) {
        return this.toOrderView(order);
      }

      assertTransition(order.status, input.next, "DRIVER");

      const now = new Date();
      const data: Prisma.RideOrderUpdateInput = { status: input.next };
      if (input.next === "DRIVER_ARRIVED") data.arrivedAt = now;
      if (input.next === "IN_TRIP") data.startedAt = now;
      if (input.next === "COMPLETED") {
        data.completedAt = now;
        // Tunai: TIDAK membuat saldo digital apa pun. Hanya menandai bahwa
        // pembayaran tunai diharapkan/dilaporkan; rekonsiliasi di luar scope.
        data.paymentState = "CASH_REPORTED";
      }

      // Conditional update: memastikan status tidak berubah oleh proses lain.
      const applied = await tx.rideOrder.updateMany({
        where: { id: order.id, status: order.status },
        data: data as Prisma.RideOrderUpdateManyMutationInput,
      });
      if (applied.count !== 1) {
        throw new AppError(
          "Status perjalanan berubah, silakan muat ulang",
          StatusCodes.CONFLICT,
          "RIDE_STATUS_CONFLICT",
        );
      }

      if (input.next === "COMPLETED") {
        await this.releaseDriver(tx, profile.id);
      }

      await this.writeEvent(tx, {
        rideOrderId: order.id,
        type: input.next === "COMPLETED" ? "CASH_REPORTED" : "STATUS_CHANGED",
        actorUserId: input.userId,
        actorRole: "DRIVER",
        previousStatus: order.status,
        newStatus: input.next,
      });

      const updated = await tx.rideOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      return this.toOrderView(updated);
    });
  }

  async cancelByDriver(input: {
    userId: string;
    publicReference: string;
    reason: RideCancellationReason;
    note?: string;
  }) {
    const profile = await this.requireDriverProfile(input.userId);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.rideOrder.findUnique({
        where: { publicReference: input.publicReference },
      });
      if (!order) {
        throw new AppError(
          "Perjalanan tidak ditemukan",
          StatusCodes.NOT_FOUND,
          "RIDE_ORDER_NOT_FOUND",
        );
      }
      if (order.driverProfileId !== profile.id) {
        throw new AppError(
          "Anda bukan driver perjalanan ini",
          StatusCodes.FORBIDDEN,
          "RIDE_DRIVER_FORBIDDEN",
        );
      }

      assertTransition(order.status, "CANCELLED_BY_DRIVER", "DRIVER");

      const updated = await tx.rideOrder.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED_BY_DRIVER",
          cancelledByUserId: input.userId,
          cancelledByRole: "DRIVER",
          cancellationReason: input.reason,
          ...(input.note !== undefined ? { cancellationNote: input.note } : {}),
          cancellationFee: 0,
          cancellationPolicy: CANCELLATION_POLICY_VERSION,
          cancelledAt: new Date(),
        },
      });

      await this.releaseDriver(tx, profile.id);
      await this.writeEvent(tx, {
        rideOrderId: order.id,
        type: "CANCELLED",
        actorUserId: input.userId,
        actorRole: "DRIVER",
        previousStatus: order.status,
        newStatus: updated.status,
        metadata: { reason: input.reason },
      });

      return this.toOrderView(updated);
    });
  }

  /** Menyimpan lokasi driver; menolak data basi/tidak valid/mundur. */
  async recordDriverLocation(input: {
    userId: string;
    lat: number;
    lng: number;
    accuracyMeters: number;
    capturedAt: Date;
    sequence?: number;
  }) {
    const profile = await this.requireDriverProfile(input.userId);
    const point = { lat: input.lat, lng: input.lng };

    if (!isValidCoordinate(point)) {
      throw new AppError(
        "Koordinat tidak valid",
        StatusCodes.BAD_REQUEST,
        "RIDE_LOCATION_INVALID",
      );
    }
    if (
      !Number.isFinite(input.accuracyMeters) ||
      input.accuracyMeters < 0 ||
      input.accuracyMeters > LOCATION_MAX_ACCURACY_METERS
    ) {
      throw new AppError(
        "Akurasi lokasi tidak memadai",
        StatusCodes.BAD_REQUEST,
        "RIDE_LOCATION_INACCURATE",
      );
    }
    if (!isLocationFresh(input.capturedAt, new Date())) {
      throw new AppError(
        "Data lokasi sudah kedaluwarsa",
        StatusCodes.CONFLICT,
        "RIDE_LOCATION_STALE",
      );
    }

    const last = await this.prisma.rideDriverLocation.findFirst({
      where: { driverProfileId: profile.id },
      orderBy: { capturedAt: "desc" },
      select: { sequence: true, capturedAt: true },
    });

    const sequence = input.sequence ?? (last?.sequence ?? 0) + 1;
    if (last && sequence <= last.sequence) {
      throw new AppError(
        "Urutan data lokasi tidak valid",
        StatusCodes.CONFLICT,
        "RIDE_LOCATION_OUT_OF_ORDER",
      );
    }

    const activeOrder = await this.prisma.rideOrder.findFirst({
      where: {
        driverProfileId: profile.id,
        status: { in: ["DRIVER_ASSIGNED", "DRIVER_TO_PICKUP", "DRIVER_ARRIVED", "IN_TRIP"] },
      },
      select: { id: true },
    });

    await this.prisma.rideDriverLocation.create({
      data: {
        driverProfileId: profile.id,
        ...(activeOrder ? { rideOrderId: activeOrder.id } : {}),
        lat: new Prisma.Decimal(input.lat),
        lng: new Prisma.Decimal(input.lng),
        accuracyMeters: Math.trunc(input.accuracyMeters),
        sequence,
        capturedAt: input.capturedAt,
      },
    });

    // Respons sengaja tidak mengembalikan koordinat.
    return { accepted: true, sequence };
  }

  // -------------------------------------------------------------------------
  // Admin / Moderasi
  // -------------------------------------------------------------------------

  async listAdminOrders(input: {
    status?: RideOrderStatus;
    serviceType?: RideServiceType;
    limit?: number;
  }) {
    const orders = await this.prisma.rideOrder.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.serviceType ? { serviceType: input.serviceType } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(input.limit ?? 50, 100)),
      include: {
        passenger: { select: { id: true, fullName: true, phone: true } },
        driverProfile: {
          include: {
            user: { select: { id: true, fullName: true, phone: true } },
          },
        },
        vehicle: {
          select: {
            id: true,
            type: true,
            plateNumberMasked: true,
            verificationStatus: true,
            isActive: true,
          },
        },
      },
    });
    return orders.map((order) => this.toAdminOrderView(order));
  }

  async getAdminOrder(publicReference: string) {
    const order = await this.prisma.rideOrder.findUnique({
      where: { publicReference },
      include: {
        passenger: { select: { id: true, fullName: true, phone: true } },
        driverProfile: {
          include: {
            user: { select: { id: true, fullName: true, phone: true } },
          },
        },
        vehicle: {
          select: {
            id: true,
            type: true,
            plateNumberMasked: true,
            verificationStatus: true,
            isActive: true,
          },
        },
        events: {
          orderBy: { createdAt: "asc" },
          select: {
            type: true,
            actorRole: true,
            previousStatus: true,
            newStatus: true,
            metadata: true,
            createdAt: true,
          },
        },
      },
    });
    if (!order) {
      throw new AppError(
        "Perjalanan tidak ditemukan",
        StatusCodes.NOT_FOUND,
        "RIDE_ORDER_NOT_FOUND",
      );
    }
    return {
      ...this.toAdminOrderView(order),
      events: order.events,
    };
  }

  async correctStatusByAdmin(input: {
    adminUserId: string;
    publicReference: string;
    status: AdminCorrectableStatus;
    reason: string;
    note?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.rideOrder.findUnique({
        where: { publicReference: input.publicReference },
      });
      if (!order) {
        throw new AppError(
          "Perjalanan tidak ditemukan",
          StatusCodes.NOT_FOUND,
          "RIDE_ORDER_NOT_FOUND",
        );
      }
      if (order.status === input.status) {
        return this.toOrderView(order);
      }
      if (isTerminalStatus(order.status)) {
        throw new AppError(
          "Perjalanan sudah berakhir dan tidak dapat diubah",
          StatusCodes.CONFLICT,
          "RIDE_ALREADY_FINAL",
        );
      }
      // Koreksi harus sah secara semantik: NO_DRIVER/EXPIRED tidak mungkin
      // terjadi bila driver sudah ditugaskan atau perjalanan sudah berjalan.
      if (!canAdminCorrect(order.status, input.status)) {
        throw new AppError(
          "Koreksi status tidak sesuai dengan kondisi perjalanan",
          StatusCodes.CONFLICT,
          "RIDE_ADMIN_CORRECTION_NOT_APPLICABLE",
        );
      }

      const now = new Date();
      const data: Prisma.RideOrderUpdateManyMutationInput = {
          status: input.status,
          ...(input.status === "CANCELLED_BY_SYSTEM"
            ? {
                cancelledByUserId: input.adminUserId,
                cancelledByRole: "ADMIN",
                cancellationReason: "OTHER",
                cancellationNote: input.note ?? input.reason,
                cancellationFee: 0,
                cancellationPolicy: CANCELLATION_POLICY_VERSION,
                cancelledAt: now,
              }
            : {}),
      };

      const applied = await tx.rideOrder.updateMany({
        where: { id: order.id, status: order.status },
        data,
      });
      if (applied.count !== 1) {
        const current = await tx.rideOrder.findUniqueOrThrow({
          where: { id: order.id },
        });
        if (current.status === input.status) {
          return this.toOrderView(current);
        }
        throw new AppError(
          "Status perjalanan berubah, silakan muat ulang",
          StatusCodes.CONFLICT,
          "RIDE_STATUS_CONFLICT",
        );
      }

      const updated = await tx.rideOrder.findUniqueOrThrow({
        where: { id: order.id },
      });

      await this.releaseDriver(tx, order.driverProfileId);
      await this.writeEvent(tx, {
        rideOrderId: order.id,
        type: input.status === "CANCELLED_BY_SYSTEM" ? "CANCELLED" : "STATUS_CHANGED",
        actorUserId: input.adminUserId,
        actorRole: "ADMIN",
        previousStatus: order.status,
        newStatus: updated.status,
        metadata: {
          correction: true,
          reason: input.reason,
          ...(input.note ? { note: input.note } : {}),
        },
        eventKeySuffix: `admin:${input.status}`,
      });

      return this.toOrderView(updated);
    });
  }

  async listAdminDrivers(input: {
    status?: RideDriverStatus;
    limit?: number;
  }) {
    const drivers = await this.prisma.rideDriverProfile.findMany({
      where: input.status ? { status: input.status } : {},
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(input.limit ?? 50, 100)),
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        vehicles: {
          select: {
            id: true,
            type: true,
            plateNumberMasked: true,
            verificationStatus: true,
            isActive: true,
          },
        },
      },
    });
    return drivers.map((driver) => this.toAdminDriverView(driver));
  }

  async updateDriverStatusByAdmin(input: {
    adminUserId: string;
    driverProfileId: string;
    status: RideDriverStatus;
    reason: string;
  }) {
    // Satu transaksi: guard + conditional update + audit. Bila audit gagal,
    // perubahan status ikut di-rollback.
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.rideDriverProfile.findUnique({
        where: { id: input.driverProfileId },
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
          vehicles: {
            select: {
              id: true,
              type: true,
              plateNumberMasked: true,
              verificationStatus: true,
              isActive: true,
            },
          },
        },
      });
      if (!profile) {
        throw new AppError(
          "Profil driver tidak ditemukan",
          StatusCodes.NOT_FOUND,
          "RIDE_DRIVER_PROFILE_NOT_FOUND",
        );
      }
      assertDriverModerationTransition(profile.status, input.status);
      if (profile.status === input.status) {
        return this.toAdminDriverView(profile);
      }

      // Jangan membuat ride menjadi yatim: driver yang sedang terikat
      // perjalanan tidak boleh langsung dinonaktifkan.
      if (input.status !== "ACTIVE") {
        const engaged = await tx.rideOrder.findFirst({
          where: {
            driverProfileId: profile.id,
            status: { in: [...RIDE_DRIVER_ENGAGED_STATUSES] },
          },
          select: { id: true },
        });
        if (engaged) {
          throw new AppError(
            "Driver masih memiliki perjalanan aktif",
            StatusCodes.CONFLICT,
            "RIDE_DRIVER_HAS_ACTIVE_RIDE",
          );
        }
      }

      // Conditional update: hanya satu aksi konkuren yang boleh menang.
      const applied = await tx.rideDriverProfile.updateMany({
        where: { id: profile.id, status: profile.status },
        data: {
          status: input.status,
          availability: input.status === "ACTIVE" ? profile.availability : "OFFLINE",
        },
      });
      if (applied.count !== 1) {
        throw new AppError(
          "Status driver berubah, silakan muat ulang",
          StatusCodes.CONFLICT,
          "RIDE_DRIVER_STATUS_CONFLICT",
        );
      }

      await this.writeModerationAudit(tx, {
        adminUserId: input.adminUserId,
        action: "RIDE_DRIVER_STATUS_CHANGED",
        entityType: "RIDE_DRIVER_PROFILE",
        entityId: profile.id,
        previousStatus: profile.status,
        newStatus: input.status,
        reason: input.reason,
      });

      const updated = await tx.rideDriverProfile.findUniqueOrThrow({
        where: { id: profile.id },
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
          vehicles: {
            select: {
              id: true,
              type: true,
              plateNumberMasked: true,
              verificationStatus: true,
              isActive: true,
            },
          },
        },
      });
      return this.toAdminDriverView(updated);
    });
  }

  async updateVehicleVerificationByAdmin(input: {
    adminUserId: string;
    vehicleId: string;
    verificationStatus: RideVehicleVerificationStatus;
    isActive?: boolean;
    reason: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const vehicle = await tx.rideVehicle.findUnique({
        where: { id: input.vehicleId },
        select: {
          id: true,
          type: true,
          plateNumberMasked: true,
          verificationStatus: true,
          isActive: true,
          driverProfileId: true,
        },
      });
      if (!vehicle) {
        throw new AppError(
          "Kendaraan tidak ditemukan",
          StatusCodes.NOT_FOUND,
          "RIDE_VEHICLE_NOT_FOUND",
        );
      }
      assertVehicleModerationTransition(
        vehicle.verificationStatus,
        input.verificationStatus,
      );
      if (
        vehicle.verificationStatus === input.verificationStatus &&
        (input.isActive === undefined || vehicle.isActive === input.isActive)
      ) {
        return vehicle;
      }

      // Kendaraan yang sedang dipakai perjalanan aktif tidak boleh dicabut
      // kelayakannya, agar perjalanan berjalan tidak rusak.
      const losesEligibility =
        input.verificationStatus !== "VERIFIED" || input.isActive === false;
      if (losesEligibility) {
        const engaged = await tx.rideOrder.findFirst({
          where: {
            vehicleId: vehicle.id,
            status: { in: [...RIDE_DRIVER_ENGAGED_STATUSES] },
          },
          select: { id: true },
        });
        if (engaged) {
          throw new AppError(
            "Kendaraan masih dipakai perjalanan aktif",
            StatusCodes.CONFLICT,
            "RIDE_VEHICLE_HAS_ACTIVE_RIDE",
          );
        }
      }

      // Conditional update berdasarkan kondisi yang diharapkan.
      const applied = await tx.rideVehicle.updateMany({
        where: {
          id: vehicle.id,
          verificationStatus: vehicle.verificationStatus,
          isActive: vehicle.isActive,
        },
        data: {
          verificationStatus: input.verificationStatus,
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      if (applied.count !== 1) {
        throw new AppError(
          "Status kendaraan berubah, silakan muat ulang",
          StatusCodes.CONFLICT,
          "RIDE_VEHICLE_STATUS_CONFLICT",
        );
      }

      const updated = await tx.rideVehicle.findUniqueOrThrow({
        where: { id: vehicle.id },
        select: {
          id: true,
          type: true,
          plateNumberMasked: true,
          verificationStatus: true,
          isActive: true,
          driverProfileId: true,
        },
      });

      await this.writeModerationAudit(tx, {
        adminUserId: input.adminUserId,
        action: "RIDE_VEHICLE_VERIFICATION_CHANGED",
        entityType: "RIDE_VEHICLE",
        entityId: vehicle.id,
        previousStatus: vehicle.verificationStatus,
        newStatus: input.verificationStatus,
        reason: input.reason,
        metadata: {
          driverProfileId: vehicle.driverProfileId,
          isActive: updated.isActive,
        },
      });

      return updated;
    });
  }

  /** Detail satu profil driver (query langsung, tidak bergantung limit daftar). */
  async getAdminDriver(driverProfileId: string) {
    const driver = await this.prisma.rideDriverProfile.findUnique({
      where: { id: driverProfileId },
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        vehicles: {
          select: {
            id: true,
            type: true,
            plateNumberMasked: true,
            verificationStatus: true,
            isActive: true,
          },
        },
      },
    });
    if (!driver) {
      throw new AppError(
        "Profil driver tidak ditemukan",
        StatusCodes.NOT_FOUND,
        "RIDE_DRIVER_PROFILE_NOT_FOUND",
      );
    }
    return this.toAdminDriverView(driver);
  }

  /** Detail satu kendaraan (query langsung, tanpa memindai daftar driver). */
  async getAdminVehicle(vehicleId: string) {
    const vehicle = await this.prisma.rideVehicle.findUnique({
      where: { id: vehicleId },
      select: {
        id: true,
        type: true,
        plateNumberMasked: true,
        verificationStatus: true,
        isActive: true,
        driverProfileId: true,
      },
    });
    if (!vehicle) {
      throw new AppError(
        "Kendaraan tidak ditemukan",
        StatusCodes.NOT_FOUND,
        "RIDE_VEHICLE_NOT_FOUND",
      );
    }
    return vehicle;
  }

  // -------------------------------------------------------------------------
  // Helper
  // -------------------------------------------------------------------------

  private assertCoordinates(pickup: GeoPoint, dropoff: GeoPoint) {
    if (!isValidCoordinate(pickup) || !isValidCoordinate(dropoff)) {
      throw new AppError(
        "Koordinat tidak valid",
        StatusCodes.BAD_REQUEST,
        "RIDE_COORDINATE_INVALID",
      );
    }
  }

  /**
   * Defense-in-depth kapabilitas driver pada application layer.
   *
   * Seluruh operasi driver (availability, offers, accept, reject, advance,
   * cancel, location) melewati method ini, sehingga pemeriksaan di sini
   * berlaku walau guard HTTP dilewati, dipanggil dari jalur lain, atau salah
   * dipasang di masa depan. Sumber kebenarannya adalah DATABASE, bukan klaim
   * role pada token — suspend/reject karena itu berlaku seketika.
   */
  private async requireDriverProfile(userId: string) {
    const profile = await this.prisma.rideDriverProfile.findUnique({
      where: { userId },
      include: { user: { select: { status: true } } },
    });
    if (!profile) {
      throw new AppError(
        "Profil driver tidak ditemukan",
        StatusCodes.FORBIDDEN,
        "RIDE_DRIVER_PROFILE_REQUIRED",
      );
    }
    if (profile.user.status !== "ACTIVE") {
      throw new AppError(
        "Akun Anda tidak aktif",
        StatusCodes.FORBIDDEN,
        "RIDE_DRIVER_ACCOUNT_INACTIVE",
      );
    }
    if (profile.status !== "ACTIVE") {
      throw new AppError(
        "Akun driver belum aktif",
        StatusCodes.FORBIDDEN,
        "RIDE_DRIVER_NOT_ACTIVE",
      );
    }
    return profile;
  }

  private async releaseDriver(
    tx: Prisma.TransactionClient | PrismaClient,
    driverProfileId: string | null,
  ) {
    if (!driverProfileId) return;
    await tx.rideDriverProfile.updateMany({
      where: { id: driverProfileId, availability: "BUSY" },
      data: { availability: "ONLINE" },
    });
  }

  private async writeEvent(
    tx: Prisma.TransactionClient | PrismaClient,
    input: {
      rideOrderId: string;
      type: Parameters<PrismaClient["rideEvent"]["create"]>[0]["data"]["type"];
      actorUserId?: string;
      actorRole: RideActorRole;
      previousStatus?: RideOrderStatus;
      newStatus?: RideOrderStatus;
      metadata?: Record<string, unknown>;
      eventKeySuffix?: string;
    },
  ) {
    const key = [
      input.rideOrderId,
      input.type,
      input.newStatus ?? "NA",
      input.eventKeySuffix ?? "",
    ].join(":");

    try {
      await tx.rideEvent.create({
        data: {
          rideOrderId: input.rideOrderId,
          type: input.type,
          ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
          actorRole: input.actorRole,
          ...(input.previousStatus ? { previousStatus: input.previousStatus } : {}),
          ...(input.newStatus ? { newStatus: input.newStatus } : {}),
          // Metadata sudah disanitasi oleh pemanggil (tanpa koordinat/PII).
          ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
          eventKey: key,
        },
      });
    } catch (error) {
      // Event duplikat diabaikan agar operasi tetap idempoten.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return;
      }
      throw error;
    }
  }

  /**
   * Audit moderasi driver/kendaraan.
   *
   * Ditulis ke `AuditLog` global karena moderasi driver/kendaraan BUKAN
   * peristiwa milik satu ride tertentu. Dengan begitu setiap tindakan selalu
   * tercatat (termasuk untuk driver yang belum pernah punya ride) dan tindakan
   * berulang tidak saling menimpa. Metadata hanya berisi nilai status dan
   * alasan yang sudah dibatasi panjangnya — tanpa koordinat, nomor telepon,
   * atau hash internal.
   */
  private async writeModerationAudit(
    tx: Prisma.TransactionClient | PrismaClient,
    input: {
      adminUserId: string;
      action: string;
      entityType: string;
      entityId: string;
      previousStatus: string;
      newStatus: string;
      reason: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    await tx.auditLog.create({
      data: {
        actorId: input.adminUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: {
          moderation: true,
          previousStatus: input.previousStatus,
          newStatus: input.newStatus,
          reason: input.reason,
          ...input.metadata,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async findIdempotent(scope: string, userId: string, key: string) {
    return this.prisma.rideIdempotencyRecord.findUnique({
      where: {
        scope_userId_idempotencyKey: { scope, userId, idempotencyKey: key },
      },
    });
  }

  private async recordIdempotent(
    scope: string,
    userId: string,
    key: string,
    resourceId: string,
  ) {
    try {
      await this.prisma.rideIdempotencyRecord.create({
        data: {
          scope,
          userId,
          idempotencyKey: key,
          requestHash: createHash("sha256").update(`${scope}:${resourceId}`).digest("hex"),
          resourceId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return;
      }
      throw error;
    }
  }

  /** Tampilan quote untuk client (tanpa data internal). */
  private toQuoteView(quote: {
    id: string;
    serviceType: RideServiceType;
    distanceMeters: number;
    durationSeconds: number;
    etaSeconds: number;
    baseFare: number;
    distanceFare: number;
    serviceFee: number;
    subtotalFare: number;
    totalFare: number;
    fareRuleVersion: string;
    roundingRule: string;
    distanceSource: string;
    quoteVersion: number;
    expiresAt: Date;
  }) {
    return {
      quoteId: quote.id,
      serviceType: quote.serviceType,
      distanceMeters: quote.distanceMeters,
      durationSeconds: quote.durationSeconds,
      etaSeconds: quote.etaSeconds,
      fare: {
        baseFare: quote.baseFare,
        distanceFare: quote.distanceFare,
        serviceFee: quote.serviceFee,
        subtotalFare: quote.subtotalFare,
        totalFare: quote.totalFare,
        currency: "IDR",
      },
      fareRuleVersion: quote.fareRuleVersion,
      roundingRule: quote.roundingRule,
      distanceSource: quote.distanceSource,
      quoteVersion: quote.quoteVersion,
      expiresAt: quote.expiresAt,
    };
  }

  /** Tampilan order untuk client — memakai publicReference, bukan UUID. */
  private toOrderView(order: {
    publicReference: string;
    serviceType: RideServiceType;
    status: RideOrderStatus;
    pickupAddress: string;
    dropoffAddress: string;
    distanceMeters: number;
    durationSeconds: number;
    baseFare: number;
    distanceFare: number;
    serviceFee: number;
    subtotalFare: number;
    totalFare: number;
    paymentMethod: string;
    paymentState: string;
    cancellationReason: RideCancellationReason | null;
    cancellationFee: number | null;
    assignedAt: Date | null;
    arrivedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    cancelledAt: Date | null;
    createdAt: Date;
  }) {
    return {
      reference: order.publicReference,
      serviceType: order.serviceType,
      status: order.status,
      isFinal: isTerminalStatus(order.status),
      pickupAddress: order.pickupAddress,
      dropoffAddress: order.dropoffAddress,
      distanceMeters: order.distanceMeters,
      durationSeconds: order.durationSeconds,
      fare: {
        baseFare: order.baseFare,
        distanceFare: order.distanceFare,
        serviceFee: order.serviceFee,
        subtotalFare: order.subtotalFare,
        totalFare: order.totalFare,
        currency: "IDR",
      },
      payment: {
        method: order.paymentMethod,
        state: order.paymentState,
      },
      cancellation: order.cancelledAt
        ? {
            reason: order.cancellationReason,
            fee: order.cancellationFee ?? 0,
            at: order.cancelledAt,
          }
        : null,
      timeline: {
        assignedAt: order.assignedAt,
        arrivedAt: order.arrivedAt,
        startedAt: order.startedAt,
        completedAt: order.completedAt,
      },
      createdAt: order.createdAt,
    };
  }

  /** Tawaran untuk driver — tidak membocorkan identitas penumpang. */
  private toOfferView(order: {
    publicReference: string;
    serviceType: RideServiceType;
    pickupAddress: string;
    dropoffAddress: string;
    distanceMeters: number;
    durationSeconds: number;
    totalFare: number;
    createdAt: Date;
  }) {
    return {
      reference: order.publicReference,
      serviceType: order.serviceType,
      pickupAddress: order.pickupAddress,
      dropoffAddress: order.dropoffAddress,
      distanceMeters: order.distanceMeters,
      durationSeconds: order.durationSeconds,
      totalFare: order.totalFare,
      currency: "IDR",
      createdAt: order.createdAt,
    };
  }

  private toAdminOrderView(order: {
    publicReference: string;
    serviceType: RideServiceType;
    status: RideOrderStatus;
    pickupAddress: string;
    dropoffAddress: string;
    distanceMeters: number;
    durationSeconds: number;
    totalFare: number;
    paymentMethod: string;
    paymentState: string;
    createdAt: Date;
    updatedAt: Date;
    passenger: { id: string; fullName: string | null; phone: string | null };
    driverProfile: ({
      id: string;
      status: RideDriverStatus;
      availability: RideDriverAvailability;
      user: { id: string; fullName: string | null; phone: string | null };
    } & Record<string, unknown>) | null;
    vehicle: {
      id: string;
      type: RideServiceType;
      plateNumberMasked: string;
      verificationStatus: RideVehicleVerificationStatus;
      isActive: boolean;
    } | null;
  }) {
    return {
      reference: order.publicReference,
      serviceType: order.serviceType,
      status: order.status,
      isFinal: isTerminalStatus(order.status),
      pickupAddress: order.pickupAddress,
      dropoffAddress: order.dropoffAddress,
      distanceMeters: order.distanceMeters,
      durationSeconds: order.durationSeconds,
      totalFare: order.totalFare,
      currency: "IDR",
      payment: {
        method: order.paymentMethod,
        state: order.paymentState,
      },
      passenger: {
        name: order.passenger.fullName,
        phoneMasked: maskPhone(order.passenger.phone),
      },
      driver: order.driverProfile
        ? {
            profileId: order.driverProfile.id,
            name: order.driverProfile.user.fullName,
            phoneMasked: maskPhone(order.driverProfile.user.phone),
            status: order.driverProfile.status,
            availability: order.driverProfile.availability,
          }
        : null,
      vehicle: order.vehicle,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private toAdminDriverView(driver: {
    id: string;
    status: RideDriverStatus;
    availability: RideDriverAvailability;
    ratingAverage: Prisma.Decimal;
    ratingCount: number;
    lastSeenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    user: { id: string; fullName: string | null; phone: string | null };
    vehicles: Array<{
      id: string;
      type: RideServiceType;
      plateNumberMasked: string;
      verificationStatus: RideVehicleVerificationStatus;
      isActive: boolean;
    }>;
  }) {
    return {
      // Moderasi memakai profileId sebagai identitas domain. userId internal
      // sengaja TIDAK diekspos (minimisasi data); tidak ada kontrak klien yang
      // membutuhkannya.
      profileId: driver.id,
      name: driver.user.fullName,
      phoneMasked: maskPhone(driver.user.phone),
      status: driver.status,
      availability: driver.availability,
      ratingAverage: driver.ratingAverage.toFixed(2),
      ratingCount: driver.ratingCount,
      lastSeenAt: driver.lastSeenAt,
      vehicles: driver.vehicles,
      createdAt: driver.createdAt,
      updatedAt: driver.updatedAt,
    };
  }
}

/** Referensi publik acak (bukan UUID internal, tidak dapat ditebak berurutan). */
export function generatePublicReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let suffix = "";
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `RID-${suffix}`;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 6) return "***";
  return `${digits.slice(0, 4)}••••${digits.slice(-3)}`;
}

function assertDriverModerationTransition(
  current: RideDriverStatus,
  next: RideDriverStatus,
) {
  if (current === next) return;
  const allowed: Record<RideDriverStatus, RideDriverStatus[]> = {
    PENDING: ["ACTIVE", "SUSPENDED", "REJECTED"],
    ACTIVE: ["SUSPENDED", "REJECTED"],
    SUSPENDED: ["ACTIVE", "REJECTED"],
    REJECTED: [],
  };
  if (!allowed[current].includes(next)) {
    throw new AppError(
      "Transisi status driver tidak diizinkan",
      StatusCodes.CONFLICT,
      "RIDE_DRIVER_STATUS_TRANSITION_INVALID",
    );
  }
}

function assertVehicleModerationTransition(
  current: RideVehicleVerificationStatus,
  next: RideVehicleVerificationStatus,
) {
  if (current === next) return;
  const allowed: Record<
    RideVehicleVerificationStatus,
    RideVehicleVerificationStatus[]
  > = {
    PENDING: ["VERIFIED", "REJECTED"],
    VERIFIED: ["PENDING", "REJECTED"],
    REJECTED: ["PENDING"],
  };
  if (!allowed[current].includes(next)) {
    throw new AppError(
      "Transisi verifikasi kendaraan tidak diizinkan",
      StatusCodes.CONFLICT,
      "RIDE_VEHICLE_STATUS_TRANSITION_INVALID",
    );
  }
}
