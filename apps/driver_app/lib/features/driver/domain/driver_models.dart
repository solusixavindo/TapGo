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

/// Status verifikasi wajah HARI INI (kalender WIB) — sekali per hari, bukan
/// per toggle online. Nilainya otoritatif dari server (DriverFaceCheckStatus
/// di backend), bukan disimpulkan lokal, supaya install ulang aplikasi tidak
/// bisa membuka blokir sendiri.
enum DriverFaceCheckStatus {
  pending,
  passed,
  blocked;

  static DriverFaceCheckStatus fromApi(String? value) => switch (value) {
        'PASSED' => DriverFaceCheckStatus.passed,
        'BLOCKED' => DriverFaceCheckStatus.blocked,
        _ => DriverFaceCheckStatus.pending,
      };
}

/// Ringkasan status verifikasi wajah hari ini + sisa percobaan.
class DriverFaceCheckSnapshot {
  const DriverFaceCheckSnapshot({
    required this.status,
    required this.attemptsRemaining,
  });

  final DriverFaceCheckStatus status;
  final int attemptsRemaining;

  factory DriverFaceCheckSnapshot.fromJson(Map<String, dynamic> json) {
    return DriverFaceCheckSnapshot(
      status: DriverFaceCheckStatus.fromApi(json['status'] as String?),
      attemptsRemaining: (json['attemptsRemaining'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Vektor embedding wajah referensi (BUKAN foto) milik driver, dipakai untuk
/// mencocokkan swafoto hari ini secara LOKAL di perangkat. minSimilarity
/// dikirim server supaya ambang batas dapat disetel ulang tanpa rilis app.
class DriverFaceReferenceEmbedding {
  const DriverFaceReferenceEmbedding({
    required this.embedding,
    required this.modelVersion,
    required this.minSimilarity,
  });

  final List<double> embedding;
  final String modelVersion;
  final double minSimilarity;

  factory DriverFaceReferenceEmbedding.fromJson(Map<String, dynamic> json) {
    final raw = json['embedding'];
    return DriverFaceReferenceEmbedding(
      embedding: raw is List
          ? raw.map((e) => (e as num).toDouble()).toList(growable: false)
          : const [],
      modelVersion: '${json['modelVersion'] ?? ''}',
      minSimilarity: (json['minSimilarity'] as num?)?.toDouble() ?? 0.75,
    );
  }
}

/// Jenis berkas yang diminta saat verifikasi mitra.
///
/// Nilainya harus persis sama dengan daftar tertutup di backend
/// (DRIVER_DOCUMENT_TYPES). Backend menolak jenis di luar daftar itu, jadi
/// perbedaan sekecil apa pun di sini akan terlihat sebagai kegagalan unggah,
/// bukan sebagai kesalahan diam-diam.
enum DriverDocumentKind { ktp, sim, stnk, selfie, skck }

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
      case DriverDocumentKind.skck:
        return 'SKCK';
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
      case DriverDocumentKind.skck:
        return 'SKCK yang masih berlaku, seluruh bagian masuk bingkai.';
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

/// Hasil langkah 1 Daftar/Masuk dengan Google.
///
/// Dua bentuk yang mungkin, dibedakan lewat [needsPhone]:
/// - Email Google sudah terdaftar -> [session] terisi, siap dipakai
///   langsung seperti hasil [DriverRepository.login] biasa.
/// - Email belum pernah terdaftar -> [session] null, UI wajib menampilkan
///   formulir nomor HP lalu memanggil
///   [DriverRepository.completeGoogleRegistration] dengan idToken yang sama.
class GoogleAuthResult {
  const GoogleAuthResult.session(this.session)
      : needsPhone = false,
        suggestedFullName = null;

  const GoogleAuthResult.needsPhone({this.suggestedFullName})
      : session = null,
        needsPhone = true;

  final DriverSession? session;
  final bool needsPhone;
  final String? suggestedFullName;
}

class DriverRide {
  const DriverRide({
    required this.reference,
    required this.serviceType,
    required this.status,
    required this.pickupAddress,
    required this.dropoffAddress,
    this.pickupNote,
    this.pickupLat,
    this.pickupLng,
    this.dropoffLat,
    this.dropoffLng,
    this.passengerName,
    this.distanceMeters,
    this.durationSeconds,
    this.totalFare,
    this.currency = 'IDR',
    this.updatedAt,
    this.paymentMethod = 'CASH',
  });

  factory DriverRide.fromJson(Map<String, dynamic> json) {
    final payment = json['payment'];
    final pickup = json['pickup'];
    final dropoff = json['dropoff'];
    final passenger = json['passenger'];
    final fare = json['fare'];
    return DriverRide(
      reference: '${json['reference'] ?? json['publicReference'] ?? ''}',
      serviceType: '${json['serviceType'] ?? 'MOTORCYCLE'}',
      status: _rideStatus('${json['status'] ?? ''}'),
      pickupAddress: _addressOf(pickup, json['pickupAddress']),
      dropoffAddress: _addressOf(dropoff, json['dropoffAddress']),
      pickupNote: json['pickupNote'] as String?,
      // Nullable: order lama (sebelum field ini dikirim server) atau status
      // yang belum boleh membuka lokasi tetap harus tampil tanpa peta,
      // bukan error — lihat fail-soft di ActiveRideCard.
      pickupLat: pickup is Map ? _doubleOf(pickup['lat']) : null,
      pickupLng: pickup is Map ? _doubleOf(pickup['lng']) : null,
      dropoffLat: dropoff is Map ? _doubleOf(dropoff['lat']) : null,
      dropoffLng: dropoff is Map ? _doubleOf(dropoff['lng']) : null,
      passengerName: passenger is Map ? passenger['displayName'] as String? : null,
      distanceMeters: _intOf(json['distanceMeters'] ?? json['distance']),
      durationSeconds: _intOf(json['durationSeconds'] ?? json['duration']),
      totalFare:
          _intOf(json['totalFare'] ?? (fare is Map ? fare['totalFare'] : null)),
      currency:
          '${(fare is Map ? fare['currency'] : null) ?? json['currency'] ?? 'IDR'}',
      updatedAt: DateTime.tryParse(
        '${json['updatedAt'] ?? json['createdAt'] ?? ''}',
      ),
      paymentMethod: payment is Map && payment['method'] == 'DIGITAL'
          ? 'DIGITAL'
          : 'CASH',
    );
  }

  /// 'DIGITAL' = penumpang sudah membayar lewat TapGoPay: driver TIDAK boleh
  /// menagih tunai. Nilai selain DIGITAL diperlakukan sebagai tunai.
  final String paymentMethod;
  bool get isPaidDigitally => paymentMethod == 'DIGITAL';

  final String reference;
  final String serviceType;
  final RideStatus status;
  final String pickupAddress;
  final String dropoffAddress;
  final String? pickupNote;
  final double? pickupLat;
  final double? pickupLng;
  final double? dropoffLat;
  final double? dropoffLng;
  final String? passengerName;
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

double? _doubleOf(Object? value) {
  if (value == null) return null;
  if (value is double) return value;
  if (value is num) return value.toDouble();
  return double.tryParse('$value');
}

/// Ringkasan pendapatan kotor dari GET /driver/earnings/summary. "Kotor"
/// karena backend belum memotong komisi apa pun dari nominal ini (lihat
/// catatan grossFare di RideService.earningsSummary) — jangan diberi label
/// "pendapatan bersih" di UI.
class DriverEarningsSummary {
  const DriverEarningsSummary({
    required this.range,
    required this.tripCount,
    required this.grossFare,
    required this.currency,
    required this.byDay,
  });

  factory DriverEarningsSummary.fromJson(Map<String, dynamic> json) {
    final rawByDay = json['byDay'];
    return DriverEarningsSummary(
      range: '${json['range'] ?? 'today'}',
      tripCount: _intOf(json['tripCount']) ?? 0,
      grossFare: _intOf(json['grossFare']) ?? 0,
      currency: '${json['currency'] ?? 'IDR'}',
      byDay: rawByDay is List
          ? rawByDay
              .whereType<Map>()
              .map((e) => DriverEarningsDay.fromJson(Map<String, dynamic>.from(e)))
              .toList()
          : const [],
    );
  }

  final String range;
  final int tripCount;
  final int grossFare;
  final String currency;
  final List<DriverEarningsDay> byDay;
}

class DriverEarningsDay {
  const DriverEarningsDay({
    required this.date,
    required this.tripCount,
    required this.grossFare,
  });

  factory DriverEarningsDay.fromJson(Map<String, dynamic> json) {
    return DriverEarningsDay(
      date: '${json['date'] ?? ''}',
      tripCount: _intOf(json['tripCount']) ?? 0,
      grossFare: _intOf(json['grossFare']) ?? 0,
    );
  }

  final String date;
  final int tripCount;
  final int grossFare;
}

/// Statistik objektif dari GET /driver/performance — TIDAK ada rating
/// bintang di sini (lihat catatan di RideService.performanceSummary).
/// Setiap rate bernilai null bila datanya belum ada, bukan 0 — pembeda
/// penting antara "belum ada tawaran sama sekali" dan "tidak pernah
/// menerima satu pun tawaran".
class DriverPerformanceSummary {
  const DriverPerformanceSummary({
    required this.totalTrips,
    this.acceptanceRate,
    this.completionRate,
    this.cancellationRate,
  });

  factory DriverPerformanceSummary.fromJson(Map<String, dynamic> json) {
    return DriverPerformanceSummary(
      totalTrips: _intOf(json['totalTrips']) ?? 0,
      acceptanceRate: _doubleOf(json['acceptanceRate']),
      completionRate: _doubleOf(json['completionRate']),
      cancellationRate: _doubleOf(json['cancellationRate']),
    );
  }

  final int totalTrips;
  final double? acceptanceRate;
  final double? completionRate;
  final double? cancellationRate;
}
