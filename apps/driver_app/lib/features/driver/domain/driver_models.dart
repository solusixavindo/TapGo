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
  blocked,
  /// Fitur dimatikan di server (DRIVER_FACE_CHECK_ENABLED=false). Diperlakukan
  /// SAMA seperti [passed] oleh checkAndGoOnline: tidak perlu membuka kamera.
  disabled;

  static DriverFaceCheckStatus fromApi(String? value) => switch (value) {
        'PASSED' => DriverFaceCheckStatus.passed,
        'BLOCKED' => DriverFaceCheckStatus.blocked,
        'DISABLED' => DriverFaceCheckStatus.disabled,
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

/// Pengingat kelelahan (nudge, bukan pengunci) berbasis jam online tanpa
/// terputus. `thresholdMinutes` null berarti tidak ada kendaraan aktif yang
/// bisa dijadikan acuan ambang batas.
class DriverFatigueStatus {
  const DriverFatigueStatus({
    required this.continuousOnlineMinutes,
    required this.thresholdMinutes,
    required this.restRequired,
  });

  final int continuousOnlineMinutes;
  final int? thresholdMinutes;
  final bool restRequired;

  factory DriverFatigueStatus.fromJson(Map<String, dynamic> json) {
    return DriverFatigueStatus(
      continuousOnlineMinutes: (json['continuousOnlineMinutes'] as num?)?.toInt() ?? 0,
      thresholdMinutes: (json['thresholdMinutes'] as num?)?.toInt(),
      restRequired: json['restRequired'] == true,
    );
  }
}

/// Dipoll berkala SELAMA online — gabungan pengingat kelelahan dan kewajiban
/// verifikasi ulang wajah acak, supaya cukup satu permintaan jaringan baru.
class DriverSafetyStatus {
  const DriverSafetyStatus({required this.fatigue, required this.faceRecheckDue});

  final DriverFatigueStatus fatigue;
  final bool faceRecheckDue;

  factory DriverSafetyStatus.fromJson(Map<String, dynamic> json) {
    final fatigueJson = json['fatigue'];
    final faceRecheckJson = json['faceRecheck'];
    return DriverSafetyStatus(
      fatigue: fatigueJson is Map
          ? DriverFatigueStatus.fromJson(Map<String, dynamic>.from(fatigueJson))
          : const DriverFatigueStatus(continuousOnlineMinutes: 0, thresholdMinutes: null, restRequired: false),
      faceRecheckDue: faceRecheckJson is Map ? faceRecheckJson['due'] == true : false,
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
    this.locationIssue,
    this.fatigueWarning,
    this.faceRecheckDue = false,
    this.chatUnread = const {},
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

  /// Terisi HANYA saat percobaan Online terakhir gagal karena lokasi (lihat
  /// checkAndGoOnline) — Beranda memakainya untuk menawarkan tombol "Buka
  /// Pengaturan Lokasi" alih-alih pesan tanpa tindak lanjut.
  final DriverLocationAvailability? locationIssue;

  /// Terisi saat jam online tanpa terputus melewati ambang kelelahan (lihat
  /// DriverController._pollSafetyStatus) — non-blocking, murni pengingat.
  final DriverFatigueStatus? fatigueWarning;

  /// True bila server mewajibkan verifikasi wajah ULANG sebelum menerima
  /// pesanan lagi (lihat DriverController._pollSafetyStatus). Server SUDAH
  /// menegakkan ini secara otoritatif (listOffersForDriver/acceptOrder
  /// menolak selagi true) — field ini murni untuk menampilkan banner ajakan
  /// bertindak, bukan satu-satunya penjaga.
  final bool faceRecheckDue;

  /// Jumlah pesan chat penumpang yang belum dibaca per referensi perjalanan
  /// (dari kotak masuk chat). Menyalakan titik merah pada tombol chat dan tab.
  final Map<String, int> chatUnread;

  int get totalChatUnread => chatUnread.values.fold(0, (a, b) => a + b);

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
    DriverLocationAvailability? locationIssue,
    bool clearLocationIssue = false,
    DriverFatigueStatus? fatigueWarning,
    bool clearFatigueWarning = false,
    bool? faceRecheckDue,
    Map<String, int>? chatUnread,
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
      locationIssue: clearLocationIssue
          ? null
          : locationIssue ?? this.locationIssue,
      fatigueWarning: clearFatigueWarning
          ? null
          : fatigueWarning ?? this.fatigueWarning,
      faceRecheckDue: faceRecheckDue ?? this.faceRecheckDue,
      chatUnread: chatUnread ?? this.chatUnread,
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
    this.distanceToPickupMeters,
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
      distanceToPickupMeters: _intOf(json['distanceToPickupMeters']),
    );
  }

  /// Jarak dari posisi driver ke titik jemput, dihitung server saat tawaran
  /// dimuat (hanya ada pada daftar tawaran).
  final int? distanceToPickupMeters;

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
/// Satu baris riwayat saldo driver: isi saldo (TOPUP) atau potongan komisi
/// pesanan tunai (COMMISSION, amount negatif).
class DriverWalletEntry {
  const DriverWalletEntry({
    required this.id,
    required this.kind,
    required this.amount,
    this.createdAt,
    this.rideReference,
    this.fare,
    this.shortfall = 0,
  });

  factory DriverWalletEntry.fromJson(Map<String, dynamic> json) =>
      DriverWalletEntry(
        id: '${json['id'] ?? ''}',
        kind: json['kind'] == 'COMMISSION' ? 'COMMISSION' : 'TOPUP',
        amount: _intOf(json['amount']) ?? 0,
        createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}'),
        rideReference: json['rideReference'] as String?,
        fare: _intOf(json['fare']),
        shortfall: _intOf(json['shortfall']) ?? 0,
      );

  final String id;
  final String kind;
  final int amount;
  final DateTime? createdAt;
  final String? rideReference;
  final int? fare;
  final int shortfall;

  bool get isCommission => kind == 'COMMISSION';
}

const String _defaultTopUpUrl = 'https://tapgolion.id/topup';

/// Tautan isi saldo datang dari server lalu dibuka di aplikasi eksternal,
/// jadi hanya https ke tapgolion.id (atau subdomainnya) yang diterima; selain
/// itu jatuh ke tautan bawaan. Tanpa ini respons yang dimanipulasi dapat
/// mengarahkan driver ke situs lain atau skema berbahaya (intent://, dll).
String _trustedTopUpUrl(Object? raw) {
  final uri = Uri.tryParse('${raw ?? ''}'.trim());
  if (uri == null || uri.scheme != 'https' || uri.userInfo.isNotEmpty) {
    return _defaultTopUpUrl;
  }
  final host = uri.host.toLowerCase();
  if (host == 'tapgolion.id' || host.endsWith('.tapgolion.id')) {
    return uri.toString();
  }
  return _defaultTopUpUrl;
}

/// Saldo TapGo driver, aturan komisi, dan riwayatnya (GET /driver/wallet).
class DriverWalletSummary {
  const DriverWalletSummary({
    required this.balance,
    required this.commissionEnabled,
    required this.commissionPercent,
    required this.topUpUrl,
    required this.entries,
  });

  factory DriverWalletSummary.fromJson(Map<String, dynamic> json) {
    final raw = json['entries'];
    return DriverWalletSummary(
      balance: _intOf(json['balance']) ?? 0,
      commissionEnabled: json['commissionEnabled'] == true,
      commissionPercent: _intOf(json['commissionPercent']) ?? 8,
      topUpUrl: _trustedTopUpUrl(json['topUpUrl']),
      entries: raw is List
          ? raw
              .whereType<Map>()
              .map((e) => DriverWalletEntry.fromJson(Map<String, dynamic>.from(e)))
              .toList()
          : const [],
    );
  }

  final int balance;
  final bool commissionEnabled;
  final int commissionPercent;
  final String topUpUrl;
  final List<DriverWalletEntry> entries;
}

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
