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

/// Jenis berkas yang diminta saat verifikasi mitra.
///
/// Nilainya harus persis sama dengan daftar tertutup di backend
/// (DRIVER_DOCUMENT_TYPES). Backend menolak jenis di luar daftar itu, jadi
/// perbedaan sekecil apa pun di sini akan terlihat sebagai kegagalan unggah,
/// bukan sebagai kesalahan diam-diam.
enum DriverDocumentKind { ktp, sim, stnk, selfie }

/// Status siklus pengajuan mitra (H1). Nilainya cermin langsung dari backend.
enum DriverApplicationStatus {
  draft,
  submitted,
  underReview,
  approved,
  rejected,
  withdrawn;

  static DriverApplicationStatus? fromApi(String? value) => switch (value) {
        'DRAFT' => DriverApplicationStatus.draft,
        'SUBMITTED' => DriverApplicationStatus.submitted,
        'UNDER_REVIEW' => DriverApplicationStatus.underReview,
        'APPROVED' => DriverApplicationStatus.approved,
        'REJECTED' => DriverApplicationStatus.rejected,
        'WITHDRAWN' => DriverApplicationStatus.withdrawn,
        _ => null,
      };

  bool get isOpen =>
      this == DriverApplicationStatus.draft ||
      this == DriverApplicationStatus.submitted ||
      this == DriverApplicationStatus.underReview;
}

/// Ringkasan pengajuan mitra milik driver yang sedang masuk.
class DriverApplicationInfo {
  const DriverApplicationInfo({
    required this.id,
    required this.cycleNumber,
    required this.status,
    this.decisionReasonCode,
  });

  final String id;
  final int cycleNumber;
  final DriverApplicationStatus status;
  final String? decisionReasonCode;

  static DriverApplicationInfo? fromJson(Map<String, dynamic> json) {
    final status = DriverApplicationStatus.fromApi(json['status'] as String?);
    final id = json['id'];
    if (status == null || id is! String) return null;
    return DriverApplicationInfo(
      id: id,
      cycleNumber: json['cycleNumber'] is int ? json['cycleNumber'] as int : 1,
      status: status,
      decisionReasonCode: json['decisionReasonCode'] as String?,
    );
  }
}

extension DriverDocumentKindX on DriverDocumentKind {
  /// Kode yang dikirim ke backend.
  String get api => name.toUpperCase();

  String get label {
    switch (this) {
      case DriverDocumentKind.ktp:
        return 'KTP';
      case DriverDocumentKind.sim:
        return 'SIM';
      case DriverDocumentKind.stnk:
        return 'STNK';
      case DriverDocumentKind.selfie:
        return 'Swafoto';
    }
  }

  String get hint {
    switch (this) {
      case DriverDocumentKind.ktp:
        return 'Foto KTP yang masih berlaku, seluruh bagian masuk bingkai.';
      case DriverDocumentKind.sim:
        return 'SIM sesuai jenis kendaraan yang Anda pakai.';
      case DriverDocumentKind.stnk:
        return 'STNK kendaraan, nomor polisi terbaca jelas.';
      case DriverDocumentKind.selfie:
        return 'Swafoto sambil memegang KTP, wajah terlihat jelas.';
    }
  }
}

enum DriverDocumentReview { pending, approved, rejected, notSubmitted }

/// Ringkasan satu dokumen. TIDAK PERNAH memuat isi berkasnya — isi dokumen
/// hanya keluar dari database lewat jalur admin, dan setiap pembukaannya
/// dicatat.
class DriverDocumentSummary {
  const DriverDocumentSummary({
    required this.kind,
    required this.review,
    required this.available,
    this.uploadedAt,
    this.expiresAt,
    this.sizeBytes,
  });

  final DriverDocumentKind kind;
  final DriverDocumentReview review;

  /// Isi berkas masih dapat dibuka admin. Dihitung backend dari waktu, bukan
  /// dari kolom purged — jawabannya tetap benar walau penyapu berkala tertunda.
  final bool available;
  final DateTime? uploadedAt;
  final DateTime? expiresAt;
  final int? sizeBytes;

  /// Sisa waktu sebelum isi berkas dihapus. Null bila memang tidak ada isinya.
  Duration? remaining(DateTime now) {
    final deadline = expiresAt;
    if (deadline == null || !available) return null;
    final left = deadline.difference(now);
    return left.isNegative ? Duration.zero : left;
  }

  static DriverDocumentSummary? fromJson(Map<String, dynamic> json) {
    final rawType = '${json['type'] ?? ''}'.toUpperCase();
    DriverDocumentKind? kind;
    for (final value in DriverDocumentKind.values) {
      if (value.api == rawType) {
        kind = value;
        break;
      }
    }
    // Jenis yang tidak dikenal DILEWATI, bukan dipaksa menjadi salah satu
    // nilai. Menebak di sini akan menampilkan dokumen dengan label yang keliru.
    if (kind == null) return null;

    return DriverDocumentSummary(
      kind: kind,
      review: _reviewFrom('${json['status'] ?? ''}'),
      available: json['available'] == true,
      uploadedAt: _dateFrom(json['uploadedAt']),
      expiresAt: _dateFrom(json['expiresAt']),
      sizeBytes: json['sizeBytes'] is num
          ? (json['sizeBytes'] as num).toInt()
          : null,
    );
  }
}

DriverDocumentReview _reviewFrom(String value) {
  switch (value.toUpperCase()) {
    case 'APPROVED':
      return DriverDocumentReview.approved;
    case 'REJECTED':
      return DriverDocumentReview.rejected;
    case 'PENDING':
      return DriverDocumentReview.pending;
    default:
      return DriverDocumentReview.notSubmitted;
  }
}

DateTime? _dateFrom(Object? value) {
  if (value == null) return null;
  return DateTime.tryParse('$value')?.toLocal();
}

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
    this.documents = const [],
    this.uploadingDocument,
    this.application,
    this.documentsComplete = false,
    this.vehiclePlateMasked,
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
  final List<DriverDocumentSummary> documents;

  /// Jenis dokumen yang sedang diunggah. Dipakai untuk menyalakan indikator
  /// HANYA pada kartu yang bersangkutan, bukan menguncikan seluruh layar.
  final DriverDocumentKind? uploadingDocument;

  /// Pengajuan mitra terbuka milik driver (null bila belum pernah mengajukan).
  final DriverApplicationInfo? application;

  /// Keempat dokumen wajib sudah terunggah menurut backend (K1-A).
  final bool documentsComplete;

  /// Plat kendaraan ter-mask yang tersimpan saat pengajuan, bila ada.
  final String? vehiclePlateMasked;

  DriverDocumentSummary? documentOf(DriverDocumentKind kind) {
    for (final item in documents) {
      if (item.kind == kind) return item;
    }
    return null;
  }

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
    List<DriverDocumentSummary>? documents,
    DriverDocumentKind? uploadingDocument,
    bool clearUploadingDocument = false,
    DriverApplicationInfo? application,
    bool clearApplication = false,
    bool? documentsComplete,
    String? vehiclePlateMasked,
    bool clearVehiclePlate = false,
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
      documents: documents ?? this.documents,
      uploadingDocument: clearUploadingDocument
          ? null
          : uploadingDocument ?? this.uploadingDocument,
      application: clearApplication ? null : application ?? this.application,
      documentsComplete: documentsComplete ?? this.documentsComplete,
      vehiclePlateMasked: clearVehiclePlate
          ? null
          : vehiclePlateMasked ?? this.vehiclePlateMasked,
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
