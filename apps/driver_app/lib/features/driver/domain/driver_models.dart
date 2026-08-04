part of '../../../main.dart';

enum DriverScenario {
  login,
  profileRequired,
  pending,
  suspended,
  rejected,
  accountInactive,
  homeOffline,
  homeOnline,
  offerEmpty,
  offerAvailable,
  toPickup,
  arrived,
  inTrip,
  completed,
  cancelled,
  networkError,
  sessionExpired,
}

enum DriverWorkspaceStatus {
  loading,
  unauthenticated,
  profileRequired,
  pending,
  suspended,
  rejected,
  accountInactive,
  active,
  sessionExpired,
  networkError,
}

enum RideStatus {
  searchingDriver,
  driverAssigned,
  driverToPickup,
  driverArrived,
  inTrip,
  completed,
  cancelledByPassenger,
  cancelledByDriver,
  cancelledBySystem,
  expired,
  noDriver,
  paymentFailed,
  unknown,
}

enum DriverAvailability { offline, online, busy }

class DriverState {
  const DriverState({
    required this.status,
    required this.availability,
    required this.offers,
    this.session,
    this.activeRide,
    this.selectedOffer,
    this.message,
    this.isBusy = false,
    this.isPolling = false,
    this.demoScenario = DriverScenario.login,
  });

  factory DriverState.initial(DriverScenario scenario) => DriverState(
        status: DriverWorkspaceStatus.loading,
        availability: DriverAvailability.offline,
        offers: const [],
        demoScenario: scenario,
      );

  final DriverWorkspaceStatus status;
  final DriverAvailability availability;
  final List<DriverRide> offers;
  final DriverSession? session;
  final DriverRide? activeRide;
  final DriverRide? selectedOffer;
  final String? message;
  final bool isBusy;
  final bool isPolling;
  final DriverScenario demoScenario;

  bool get isAuthenticated => session != null;
  bool get isActive => status == DriverWorkspaceStatus.active;
  bool get hasTerminalRide => activeRide?.isTerminal ?? false;

  DriverState copyWith({
    DriverWorkspaceStatus? status,
    DriverAvailability? availability,
    List<DriverRide>? offers,
    DriverSession? session,
    bool clearSession = false,
    DriverRide? activeRide,
    bool clearActiveRide = false,
    DriverRide? selectedOffer,
    bool clearSelectedOffer = false,
    String? message,
    bool clearMessage = false,
    bool? isBusy,
    bool? isPolling,
    DriverScenario? demoScenario,
  }) {
    return DriverState(
      status: status ?? this.status,
      availability: availability ?? this.availability,
      offers: offers ?? this.offers,
      session: clearSession ? null : session ?? this.session,
      activeRide: clearActiveRide ? null : activeRide ?? this.activeRide,
      selectedOffer:
          clearSelectedOffer ? null : selectedOffer ?? this.selectedOffer,
      message: clearMessage ? null : message ?? this.message,
      isBusy: isBusy ?? this.isBusy,
      isPolling: isPolling ?? this.isPolling,
      demoScenario: demoScenario ?? this.demoScenario,
    );
  }
}

class DriverSession {
  const DriverSession({
    required this.accessToken,
    required this.refreshToken,
    required this.driverName,
  });
  final String accessToken;
  final String refreshToken;
  final String driverName;
}

class DriverRide {
  const DriverRide({
    required this.reference,
    required this.serviceType,
    required this.status,
    required this.pickupAddress,
    required this.dropoffAddress,
    this.distanceMeters,
    this.durationSeconds,
    this.totalFare,
    this.currency = 'IDR',
    this.updatedAt,
  });

  factory DriverRide.fromJson(Map<String, dynamic> json) {
    final pickup = json['pickup'];
    final dropoff = json['dropoff'];
    final fare = json['fare'];
    return DriverRide(
      reference: '${json['reference'] ?? json['publicReference'] ?? ''}',
      serviceType: '${json['serviceType'] ?? 'MOTORCYCLE'}',
      status: _rideStatus('${json['status'] ?? ''}'),
      pickupAddress: _addressOf(pickup, json['pickupAddress']),
      dropoffAddress: _addressOf(dropoff, json['dropoffAddress']),
      distanceMeters: _intOf(json['distanceMeters'] ?? json['distance']),
      durationSeconds: _intOf(json['durationSeconds'] ?? json['duration']),
      totalFare:
          _intOf(json['totalFare'] ?? (fare is Map ? fare['totalFare'] : null)),
      currency:
          '${(fare is Map ? fare['currency'] : null) ?? json['currency'] ?? 'IDR'}',
      updatedAt: DateTime.tryParse('${json['updatedAt'] ?? ''}'),
    );
  }

  final String reference;
  final String serviceType;
  final RideStatus status;
  final String pickupAddress;
  final String dropoffAddress;
  final int? distanceMeters;
  final int? durationSeconds;
  final int? totalFare;
  final String currency;
  final DateTime? updatedAt;

  bool get isTerminal => {
        RideStatus.completed,
        RideStatus.cancelledByDriver,
        RideStatus.cancelledByPassenger,
        RideStatus.cancelledBySystem,
        RideStatus.expired,
        RideStatus.noDriver,
        RideStatus.paymentFailed,
      }.contains(status);
}

RideStatus _rideStatus(String value) {
  switch (value) {
    case 'SEARCHING_DRIVER':
      return RideStatus.searchingDriver;
    case 'DRIVER_ASSIGNED':
      return RideStatus.driverAssigned;
    case 'DRIVER_TO_PICKUP':
      return RideStatus.driverToPickup;
    case 'DRIVER_ARRIVED':
      return RideStatus.driverArrived;
    case 'IN_TRIP':
      return RideStatus.inTrip;
    case 'COMPLETED':
      return RideStatus.completed;
    case 'CANCELLED_BY_PASSENGER':
      return RideStatus.cancelledByPassenger;
    case 'CANCELLED_BY_DRIVER':
      return RideStatus.cancelledByDriver;
    case 'CANCELLED_BY_SYSTEM':
      return RideStatus.cancelledBySystem;
    case 'EXPIRED':
      return RideStatus.expired;
    case 'NO_DRIVER':
      return RideStatus.noDriver;
    case 'PAYMENT_FAILED':
      return RideStatus.paymentFailed;
    default:
      return RideStatus.unknown;
  }
}

String _addressOf(Object? nested, Object? fallback) {
  if (nested is Map && nested['address'] != null) return '${nested['address']}';
  return '${fallback ?? 'Lokasi belum tersedia'}';
}

int? _intOf(Object? value) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse('$value');
}
