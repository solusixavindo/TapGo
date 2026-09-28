part of '../../../main.dart';

/// Alasan lokasi tidak tersedia, cukup rinci untuk memandu driver
/// memperbaikinya sendiri — bukan cuma "tidak tersedia" tanpa penjelasan.
/// [available] TIDAK berarti fix GPS sudah didapat, hanya berarti layanan
/// menyala dan izin diberikan sehingga PERCOBAAN mengambil fix boleh jalan.
enum DriverLocationAvailability {
  available,

  /// GPS/Location Services perangkat sendiri sedang mati.
  serviceDisabled,

  /// Izin belum diberikan; masih boleh diminta lagi (dialog sistem akan tampil).
  permissionDenied,

  /// Ditolak permanen (Android menolak menampilkan dialog lagi setelah
  /// penolakan sebelumnya) — satu-satunya jalan keluar adalah Pengaturan HP.
  permissionDeniedForever;

  bool get isAvailable => this == DriverLocationAvailability.available;
}

abstract class DriverLocationPort {
  Future<bool> get isAvailable;

  /// Sama seperti [isAvailable] tapi membedakan ALASAN kegagalan, supaya
  /// pemanggil (checkAndGoOnline) bisa menampilkan pesan yang benar-benar
  /// bisa ditindaklanjuti driver, bukan pesan generik.
  Future<DriverLocationAvailability> checkAvailability();

  Future<void> sendCurrentLocation();

  /// Aliran posisi live untuk marker peta di Beranda. Implementasi tanpa GPS
  /// asli (mis. [NoDriverLocationPort] — dipakai di mode demo dan widget
  /// test) mengembalikan stream yang tidak pernah emit, bukan posisi palsu.
  Stream<(double lat, double lng)> get positionStream;

  /// Menjaga proses tetap hidup selama driver ONLINE / punya perjalanan
  /// (foreground service dengan notifikasi permanen), agar lokasi tetap
  /// terkirim saat layar mati atau aplikasi ditinggalkan. Aman dipanggil
  /// berulang.
  Future<void> startTracking();
  Future<void> stopTracking();
}

class NoDriverLocationPort implements DriverLocationPort {
  @override
  Future<bool> get isAvailable async => false;

  @override
  Future<DriverLocationAvailability> checkAvailability() async =>
      DriverLocationAvailability.permissionDenied;

  @override
  Future<void> sendCurrentLocation() async {
    throw const DriverApiException(
      code: 'LOCATION_PROVIDER_UNAVAILABLE',
      message: 'Lokasi belum tersedia pada versi ini.',
    );
  }

  @override
  Stream<(double lat, double lng)> get positionStream => const Stream.empty();

  @override
  Future<void> startTracking() async {}

  @override
  Future<void> stopTracking() async {}
}

/// GPS asli lewat package geolocator. Hanya mengurus perangkat + izin lokasi
/// — pengiriman HTTP-nya didelegasikan ke [DriverRepository.sendLocation],
/// supaya port ini tidak perlu tahu apa pun soal token/base URL backend.
class GeolocatorDriverLocationPort implements DriverLocationPort {
  GeolocatorDriverLocationPort(this._repository);

  final DriverRepository _repository;
  StreamSubscription<Position>? _trackingSubscription;
  Position? _lastTracked;

  @override
  Future<void> startTracking() async {
    if (_trackingSubscription != null) return;
    if (!await isAvailable) return;
    _trackingSubscription = Geolocator.getPositionStream(
      locationSettings: AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 5,
        intervalDuration: const Duration(seconds: 5),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'TapGo Driver aktif',
          notificationText:
              'Lokasi dibagikan agar Anda menerima pesanan terdekat. Ketuk untuk membuka.',
          notificationChannelName: 'Status online driver',
          enableWakeLock: true,
        ),
      ),
    ).listen(
      (position) => _lastTracked = position,
      onError: (_) {},
    );
  }

  @override
  Future<void> stopTracking() async {
    final subscription = _trackingSubscription;
    _trackingSubscription = null;
    _lastTracked = null;
    await subscription?.cancel();
  }

  @override
  Future<bool> get isAvailable async => (await checkAvailability()).isAvailable;

  @override
  Future<DriverLocationAvailability> checkAvailability() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return DriverLocationAvailability.serviceDisabled;
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.always ||
        permission == LocationPermission.whileInUse) {
      return DriverLocationAvailability.available;
    }
    if (permission == LocationPermission.deniedForever) {
      return DriverLocationAvailability.permissionDeniedForever;
    }
    return DriverLocationAvailability.permissionDenied;
  }

  @override
  Future<void> sendCurrentLocation() async {
    final cached = _lastTracked;
    final position = cached != null &&
            DateTime.now().difference(cached.timestamp).inSeconds < 15
        ? cached
        : await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 10),
            ),
          );
    await _repository.sendLocation(
      lat: position.latitude,
      lng: position.longitude,
      // Server menolak akurasi > 500m (RIDE_LOCATION_INACCURATE) — bulatkan
      // ke atas supaya pembulatan tidak pernah membuat titik kasar terlihat
      // lebih akurat dari yang sebenarnya.
      accuracyMeters: position.accuracy.ceil(),
      capturedAt: DateTime.now(),
    );
  }

  @override
  Stream<(double lat, double lng)> get positionStream =>
      Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 10,
        ),
      ).map((position) => (position.latitude, position.longitude));
}
