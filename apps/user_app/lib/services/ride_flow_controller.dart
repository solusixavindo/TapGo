part of '../main.dart';

/// Model, pemetaan status, dan controller untuk alur Ojek Online penumpang.
///
/// Status server adalah SATU-SATUNYA sumber kebenaran. Tidak ada state bisnis
/// yang hanya hidup di client, dan `isFinal` dari backend yang menghentikan
/// polling — bukan daftar status yang disalin ke sini dan bisa basi.

/// Jenis layanan sesuai enum backend `RideServiceType`.
enum RideServiceKind { motorcycle, car }

extension RideServiceKindX on RideServiceKind {
  /// Identifier yang dikirim ke API. Harus sama persis dengan enum backend.
  String get apiValue =>
      this == RideServiceKind.motorcycle ? 'MOTORCYCLE' : 'CAR';

  String get displayName =>
      this == RideServiceKind.motorcycle ? 'Motor' : 'Mobil';

  IconData get icon => this == RideServiceKind.motorcycle
      ? Icons.two_wheeler_rounded
      : Icons.local_taxi_rounded;
}

/// Kelompok tampilan untuk sebuah status server.
///
/// Sengaja BUKAN salinan enum backend: hanya pengelompokan presentasi. Status
/// yang tidak dikenal jatuh ke [unknown] dan diperlakukan fail-closed.
enum RideUiPhase {
  created,
  searching,
  assigned,
  arrived,
  inTrip,
  completed,
  cancelled,
  unknown
}

/// Alasan pembatalan yang boleh dipakai penumpang.
///
/// Identifier di kiri WAJIB sama dengan allowlist backend
/// `RideCancellationReason`; label Indonesia hanya untuk tampilan. Daftar ini
/// tidak boleh ditambah tanpa perubahan backend lebih dulu.
const Map<String, String> tapGoRideCancellationReasons = {
  'WAIT_TOO_LONG': 'Menunggu terlalu lama',
  'DRIVER_NOT_MOVING': 'Driver tidak bergerak',
  'CHANGE_OF_PLAN': 'Rencana berubah',
  'WRONG_PICKUP': 'Titik jemput salah',
  'FOUND_OTHER_TRANSPORT': 'Sudah dapat transportasi lain',
  'OTHER': 'Alasan lain',
};

/// Batas panjang catatan pembatalan, mengikuti validator backend.
const int tapGoRideCancellationNoteMaxLength = 500;

/// Status yang berarti perjalanan masih berjalan dan wajib dipulihkan.
///
/// Daftar ini dipakai bersama `isFinal` dari server, bukan menggantinya: sebuah
/// perjalanan hanya dianggap aktif bila server belum menyatakannya final DAN
/// statusnya ada di sini. Dua syarat itu membuat status baru maupun status
/// terminal tidak pernah salah dipulihkan sebagai perjalanan berjalan.
const Set<String> tapGoRideActiveStatuses = {
  'CREATED',
  'SEARCHING_DRIVER',
  'DRIVER_ASSIGNED',
  'DRIVER_TO_PICKUP',
  'DRIVER_ARRIVED',
  'IN_TRIP',
};

/// Format Rupiah dari integer rupiah penuh yang dikirim backend.
///
/// Backend mengirim bilangan bulat, bukan desimal, sehingga tidak ada
/// pembulatan di sisi client yang dapat berbeda dari tarif otoritatif.
String tapGoFormatRideRupiah(int amount) {
  final digits = amount.abs().toString();
  final buffer = StringBuffer();
  for (var index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 == 0) {
      buffer.write('.');
    }
    buffer.write(digits[index]);
  }
  return '${amount < 0 ? '-' : ''}Rp $buffer';
}

String tapGoFormatRideDuration(int seconds) {
  if (seconds < 60) {
    return '$seconds detik';
  }
  final minutes = (seconds / 60).round();
  if (minutes < 60) {
    return '$minutes menit';
  }
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  return rest == 0 ? '$hours jam' : '$hours jam $rest menit';
}

String tapGoFormatRideDistance(int meters) {
  if (meters < 1000) {
    return '$meters m';
  }
  return '${(meters / 1000).toStringAsFixed(1).replaceAll('.', ',')} km';
}

/// Estimasi tarif dari `POST /api/v1/rides/quotes`.
class RideQuoteView {
  const RideQuoteView({
    required this.quoteId,
    required this.serviceType,
    required this.distanceMeters,
    required this.durationSeconds,
    required this.etaSeconds,
    required this.baseFare,
    required this.distanceFare,
    required this.serviceFee,
    required this.subtotalFare,
    required this.totalFare,
    required this.expiresAt,
  });

  final String quoteId;
  final String serviceType;
  final int distanceMeters;
  final int durationSeconds;
  final int etaSeconds;
  final int baseFare;
  final int distanceFare;
  final int serviceFee;
  final int subtotalFare;
  final int totalFare;
  final DateTime? expiresAt;

  bool get isExpired {
    final deadline = expiresAt;
    if (deadline == null) {
      return false;
    }
    return DateTime.now().toUtc().isAfter(deadline.toUtc());
  }

  static int _int(dynamic value) =>
      value is int ? value : int.tryParse('${value ?? ''}') ?? 0;

  static RideQuoteView fromJson(Map<String, dynamic> json) {
    final fare = (json['fare'] as Map<String, dynamic>?) ?? const {};
    return RideQuoteView(
      quoteId: '${json['quoteId'] ?? ''}',
      serviceType: '${json['serviceType'] ?? ''}',
      distanceMeters: _int(json['distanceMeters']),
      durationSeconds: _int(json['durationSeconds']),
      etaSeconds: _int(json['etaSeconds']),
      baseFare: _int(fare['baseFare']),
      distanceFare: _int(fare['distanceFare']),
      serviceFee: _int(fare['serviceFee']),
      subtotalFare: _int(fare['subtotalFare']),
      totalFare: _int(fare['totalFare']),
      expiresAt: DateTime.tryParse('${json['expiresAt'] ?? ''}'),
    );
  }
}

/// Driver sesuai kontrak frozen Stage R2.4A. Hanya nama depan.
class RideDriverView {
  const RideDriverView({required this.displayName});

  final String displayName;

  static RideDriverView? fromJson(dynamic json) {
    if (json is! Map<String, dynamic>) {
      return null;
    }
    final name = '${json['displayName'] ?? ''}'.trim();
    if (name.isEmpty) {
      return null;
    }
    return RideDriverView(displayName: name);
  }
}

/// Kendaraan sesuai kontrak frozen Stage R2.4A.
///
/// `maskedPlate` diterima apa adanya dari server. Client TIDAK pernah
/// melakukan masking sendiri: seluruh keputusan privasi berada di backend.
class RideVehicleView {
  const RideVehicleView({
    required this.serviceType,
    required this.maskedPlate,
    this.model,
    this.color,
  });

  final String serviceType;
  final String maskedPlate;
  final String? model;
  final String? color;

  static RideVehicleView? fromJson(dynamic json) {
    if (json is! Map<String, dynamic>) {
      return null;
    }
    final plate = '${json['maskedPlate'] ?? ''}'.trim();
    if (plate.isEmpty) {
      return null;
    }
    final model = '${json['model'] ?? ''}'.trim();
    final color = '${json['color'] ?? ''}'.trim();
    return RideVehicleView(
      serviceType: '${json['serviceType'] ?? ''}',
      maskedPlate: plate,
      model: model.isEmpty ? null : model,
      color: color.isEmpty ? null : color,
    );
  }
}

/// Satu perjalanan sebagaimana dilaporkan server.
class RideOrderView {
  const RideOrderView({
    required this.reference,
    required this.serviceType,
    required this.status,
    required this.isFinal,
    required this.pickupAddress,
    required this.dropoffAddress,
    required this.distanceMeters,
    required this.durationSeconds,
    required this.totalFare,
    required this.cancellationReason,
    required this.cancellationFee,
    required this.driver,
    required this.vehicle,
    required this.createdAt,
  });

  final String reference;
  final String serviceType;
  final String status;

  /// Berasal dari server. Inilah penentu berhenti polling.
  final bool isFinal;

  final String pickupAddress;
  final String dropoffAddress;
  final int distanceMeters;
  final int durationSeconds;
  final int totalFare;
  final String? cancellationReason;
  final int? cancellationFee;
  final RideDriverView? driver;
  final RideVehicleView? vehicle;
  final DateTime? createdAt;

  /// Pemetaan status server ke fase tampilan.
  ///
  /// Status yang tidak dikenal menjadi [RideUiPhase.unknown] — TIDAK dianggap
  /// sukses dan tidak diperlakukan sebagai fase mana pun.
  RideUiPhase get phase {
    switch (status) {
      case 'CREATED':
        return RideUiPhase.created;
      case 'SEARCHING_DRIVER':
        return RideUiPhase.searching;
      case 'DRIVER_ASSIGNED':
        return RideUiPhase.assigned;
      case 'DRIVER_TO_PICKUP':
        return RideUiPhase.assigned;
      case 'DRIVER_ARRIVED':
        return RideUiPhase.arrived;
      case 'IN_TRIP':
        return RideUiPhase.inTrip;
      case 'COMPLETED':
        return RideUiPhase.completed;
      case 'CANCELLED_BY_PASSENGER':
      case 'CANCELLED_BY_DRIVER':
      case 'CANCELLED_BY_SYSTEM':
      case 'NO_DRIVER':
      case 'EXPIRED':
      case 'PAYMENT_FAILED':
        return RideUiPhase.cancelled;
      default:
        return RideUiPhase.unknown;
    }
  }

  /// Judul yang aman untuk setiap status, termasuk yang tidak dikenal.
  String get statusTitle {
    switch (status) {
      case 'CREATED':
        return 'Pesanan dibuat';
      case 'SEARCHING_DRIVER':
        return 'Mencari driver';
      case 'DRIVER_ASSIGNED':
        return 'Driver menerima pesanan';
      case 'DRIVER_TO_PICKUP':
        return 'Driver menuju titik jemput';
      case 'DRIVER_ARRIVED':
        return 'Driver sudah tiba';
      case 'IN_TRIP':
        return 'Perjalanan berlangsung';
      case 'COMPLETED':
        return 'Perjalanan selesai';
      case 'CANCELLED_BY_PASSENGER':
        return 'Dibatalkan olehmu';
      case 'CANCELLED_BY_DRIVER':
        return 'Dibatalkan driver';
      case 'CANCELLED_BY_SYSTEM':
        return 'Dibatalkan sistem';
      case 'NO_DRIVER':
        return 'Belum ada driver tersedia';
      case 'EXPIRED':
        return 'Pesanan kedaluwarsa';
      case 'PAYMENT_FAILED':
        return 'Pembayaran belum selesai';
      default:
        // Fail closed: status baru dari server tidak pernah diklaim sukses.
        return 'Status perjalanan belum dapat ditampilkan';
    }
  }

  /// Apakah perjalanan ini wajib dipulihkan saat pengguna membuka Ojek Online.
  ///
  /// Fail closed dua kali: server harus belum menyatakannya final, dan
  /// statusnya harus dikenal sebagai status berjalan. Status yang tidak dikenal
  /// tidak pernah dianggap aktif.
  bool get isRestorableActive =>
      !isFinal && tapGoRideActiveStatuses.contains(status);

  /// Pembatalan hanya ditawarkan pada fase yang backend memang mengizinkan.
  ///
  /// Cermin dari `RIDE_TRANSITIONS`: sah sampai DRIVER_ARRIVED, tidak lagi
  /// sejak IN_TRIP. Server tetap penjaga akhir; ini hanya mencegah tombol yang
  /// pasti gagal muncul.
  bool get canCancel {
    if (isFinal) {
      return false;
    }
    switch (status) {
      case 'CREATED':
      case 'SEARCHING_DRIVER':
      case 'DRIVER_ASSIGNED':
      case 'DRIVER_TO_PICKUP':
      case 'DRIVER_ARRIVED':
        return true;
      default:
        return false;
    }
  }

  static int _int(dynamic value) =>
      value is int ? value : int.tryParse('${value ?? ''}') ?? 0;

  static RideOrderView fromJson(Map<String, dynamic> json) {
    final fare = (json['fare'] as Map<String, dynamic>?) ?? const {};
    final cancellation = json['cancellation'] as Map<String, dynamic>?;
    return RideOrderView(
      reference: '${json['reference'] ?? ''}',
      serviceType: '${json['serviceType'] ?? ''}',
      status: '${json['status'] ?? ''}',
      isFinal: json['isFinal'] == true,
      pickupAddress: '${json['pickupAddress'] ?? ''}',
      dropoffAddress: '${json['dropoffAddress'] ?? ''}',
      distanceMeters: _int(json['distanceMeters']),
      durationSeconds: _int(json['durationSeconds']),
      totalFare: _int(fare['totalFare']),
      cancellationReason:
          cancellation == null ? null : '${cancellation['reason'] ?? ''}',
      cancellationFee: cancellation == null ? null : _int(cancellation['fee']),
      driver: RideDriverView.fromJson(json['driver']),
      vehicle: RideVehicleView.fromJson(json['vehicle']),
      createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}'),
    );
  }
}

/// Memetakan kegagalan menjadi kalimat Indonesia yang ramah.
///
/// Tidak pernah menampilkan exception mentah. Kode yang tidak dikenal jatuh ke
/// pesan umum, bukan ke `error.toString()`.
String tapGoRideErrorMessage(Object error) {
  if (error is DioException) {
    final data = _authResponseDataMap(error.response?.data);
    final code = data?['code']?.toString();
    switch (code) {
      case 'RIDE_QUOTE_EXPIRED':
        return 'Estimasi sudah kedaluwarsa. Silakan cek harga lagi.';
      case 'RIDE_QUOTE_ALREADY_USED':
        return 'Estimasi ini sudah dipakai. Silakan cek harga lagi.';
      case 'RIDE_QUOTE_NOT_FOUND':
      case 'RIDE_QUOTE_FORBIDDEN':
        return 'Estimasi tidak dapat digunakan. Silakan cek harga lagi.';
      case 'RIDE_ACTIVE_ORDER_EXISTS':
        return 'Masih ada perjalanan yang berjalan. Selesaikan dulu ya.';
      case 'RIDE_ORDER_NOT_FOUND':
        return 'Perjalanan tidak ditemukan.';
      case 'RIDE_STATUS_CONFLICT':
      case 'RIDE_ALREADY_FINAL':
        return 'Status perjalanan sudah berubah. Muat ulang halaman ini.';
      case 'RIDE_COORDINATE_INVALID':
        return 'Lokasi yang dipilih belum valid.';
      case 'RIDE_DIGITAL_PAYMENT_NOT_CONFIGURED':
        return 'Pembayaran digital belum tersedia. Gunakan tunai.';
      case 'RATE_LIMITED':
        return 'Terlalu banyak permintaan. Coba lagi beberapa saat lagi.';
    }
    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout) {
      return 'Koneksi ke server TapGo terputus. Silakan coba lagi.';
    }
  }
  return 'Perjalanan belum dapat diproses. Silakan coba lagi.';
}

/// Apakah kegagalan ini berarti sesi tidak lagi sah.
bool tapGoRideIsSessionExpired(Object error) {
  if (error is! DioException) {
    return false;
  }
  final status = error.response?.statusCode;
  if (status != 401) {
    return false;
  }
  final code = _authResponseDataMap(error.response?.data)?['code']?.toString();
  // Termasuk pencabutan sesi berversi dari Stage R2.1A.
  return code == null ||
      code == 'AUTH_SESSION_REVOKED' ||
      code == 'AUTH_TOKEN_EXPIRED' ||
      code == 'AUTH_TOKEN_INVALID' ||
      code == 'AUTH_TOKEN_MISSING' ||
      code == 'SESSION_INVALID';
}

// --- Seam pemanggilan API -----------------------------------------------------
// Layar memanggil API melalui typedef ini, bukan langsung ke _apiClient, supaya
// perilakunya dapat diuji tanpa jaringan. Nilai defaultnya tetap _apiClient,
// jadi jalur produksi tidak berubah dan tidak ada mode test di runtime.

typedef RideQuoteRequest = Future<Map<String, dynamic>> Function({
  required String serviceType,
  required Map<String, dynamic> pickup,
  required Map<String, dynamic> dropoff,
});

typedef RideOrderRequest = Future<Map<String, dynamic>> Function({
  required String quoteId,
  String? idempotencyKey,
});

typedef RideDetailRequest = Future<Map<String, dynamic>> Function(
  String reference,
);

typedef RideHistoryRequest = Future<List<Map<String, dynamic>>> Function();

typedef RideCancelRequest = Future<Map<String, dynamic>> Function({
  required String reference,
  required String reasonCode,
  String? note,
});

/// Pilihan pembatalan yang dikembalikan lembar alasan.
class RideCancellationChoice {
  const RideCancellationChoice({required this.reasonCode, this.note});

  final String reasonCode;
  final String? note;
}

/// Controller polling status satu perjalanan.
///
/// Dipisahkan dari widget supaya tidak ada panggilan HTTP di dalam `build`, dan
/// supaya perilaku siklus hidupnya dapat diuji tanpa merender apa pun.
class RideStatusPoller {
  RideStatusPoller({
    required this.reference,
    required this.onUpdate,
    required this.onError,
    this.interval = const Duration(seconds: 4),
    Future<Map<String, dynamic>> Function(String reference)? fetch,
  }) : _fetch = fetch ?? ((ref) => _apiClient.rideDetail(ref));

  final String reference;
  final void Function(RideOrderView order) onUpdate;
  final void Function(Object error) onError;
  final Duration interval;
  final Future<Map<String, dynamic>> Function(String reference) _fetch;

  Timer? _timer;
  bool _disposed = false;

  /// Penjaga tumpang-tindih. Satu permintaan berjalan pada satu waktu; tick
  /// yang datang saat permintaan masih jalan dilewati, bukan ditumpuk.
  bool _inFlight = false;

  /// Berhenti permanen setelah status final terlihat.
  bool _stopped = false;

  int _requestCount = 0;

  /// Jumlah permintaan yang benar-benar dikirim. Dipakai test.
  int get requestCount => _requestCount;
  bool get isRunning => _timer != null && !_stopped;
  bool get isStopped => _stopped;

  void start() {
    if (_disposed || _stopped || _timer != null) {
      return;
    }
    // Sekali langsung, lalu berkala — supaya layar tidak menunggu satu interval
    // penuh sebelum menampilkan apa pun.
    unawaited(_tick());
    _timer = Timer.periodic(interval, (_) => unawaited(_tick()));
  }

  /// Menghentikan timer tanpa menandai selesai. Dipakai saat app background.
  void pause() {
    _timer?.cancel();
    _timer = null;
  }

  /// Memuat ulang dari server. Dipakai saat app resume — state lokal tidak
  /// pernah menjadi sumber kebenaran.
  Future<void> refreshNow() => _tick();

  void stop() {
    _stopped = true;
    pause();
  }

  void dispose() {
    _disposed = true;
    stop();
  }

  Future<void> _tick() async {
    if (_disposed || _stopped || _inFlight) {
      return;
    }
    _inFlight = true;
    try {
      _requestCount += 1;
      final data = await _fetch(reference);
      if (_disposed) {
        return;
      }
      final order = RideOrderView.fromJson(data);
      onUpdate(order);
      // Server yang memutuskan kapan berhenti.
      if (order.isFinal) {
        stop();
      }
    } catch (error) {
      if (!_disposed) {
        onError(error);
        // Sesi tidak sah tidak boleh dipolling terus-menerus.
        if (tapGoRideIsSessionExpired(error)) {
          stop();
        }
      }
    } finally {
      _inFlight = false;
    }
  }
}
