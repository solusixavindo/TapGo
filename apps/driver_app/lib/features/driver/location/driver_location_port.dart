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

/// Satu titik GPS mentah, TANPA dikirim ke server — dipakai oleh pemanggil
/// yang butuh koordinat untuk endpoint SELAIN `/driver/location` (mis. SOS),
/// beda dari [DriverLocationPort.sendCurrentLocation] yang mengambil DAN
/// langsung mengirim dalam satu langkah.
class DriverLocationFix {
  const DriverLocationFix({
    required this.lat,
    required this.lng,
    required this.accuracyMeters,
  });

  final double lat;
  final double lng;
  final int accuracyMeters;
}

abstract class DriverLocationPort {
  Future<bool> get isAvailable;

  /// Sama seperti [isAvailable] tapi membedakan ALASAN kegagalan, supaya
  /// pemanggil (checkAndGoOnline) bisa menampilkan pesan yang benar-benar
  /// bisa ditindaklanjuti driver, bukan pesan generik.
  Future<DriverLocationAvailability> checkAvailability();

  Future<void> sendCurrentLocation();

  /// Ambil satu fix GPS untuk dikirim sendiri oleh pemanggil (mis. tombol
  /// SOS). Null berarti fix tidak bisa diperoleh (izin/GPS mati, atau
  /// timeout) — pemanggil bertanggung jawab menampilkan jalan keluar lain
  /// (mis. hubungi CS langsung), BUKAN mengirim koordinat kosong/palsu.
  Future<DriverLocationFix?> currentFix();

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

  /// Menaikkan/menurunkan kerapatan fix GPS. `true` saat driver menuju titik jemput atau menunggu penumpang: GPS
  /// dibaca tiap ~1 detik tanpa filter jarak agar penumpang melihat kendaraan bergerak. `false` (bawaan) saat
  /// hanya online atau di tengah perjalanan: hemat baterai. Aman dipanggil berulang dengan nilai yang sama.
  Future<void> setFastTracking(bool fast);
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
  Future<DriverLocationFix?> currentFix() async => null;

  @override
  Stream<(double lat, double lng)> get positionStream => const Stream.empty();

  @override
  Future<void> startTracking() async {}

  @override
  Future<void> stopTracking() async {}

  @override
  Future<void> setFastTracking(bool fast) async {}
}

/// GPS asli lewat package geolocator. Hanya mengurus perangkat + izin lokasi
/// — pengiriman HTTP-nya didelegasikan ke [DriverRepository.sendLocation],
/// supaya port ini tidak perlu tahu apa pun soal token/base URL backend.
class GeolocatorDriverLocationPort implements DriverLocationPort {
  GeolocatorDriverLocationPort(this._repository);

  final DriverRepository _repository;
  StreamSubscription<Position>? _trackingSubscription;
  Position? _lastTracked;
  bool _fast = false;

  /// Umur terbesar fix tersimpan yang masih dipakai ulang. Mode cepat mengirim tiap detik, jadi fix 3 detik
  /// sudah basi dan diganti pembacaan baru; mode hemat boleh sampai 15 detik.
  Duration get _maxFixAge => Duration(seconds: _fast ? 3 : 15);

  @override
  Future<void> startTracking() async {
    if (_trackingSubscription != null) return;
    if (!await isAvailable) return;
    _openStream();
  }

  void _openStream() {
    _trackingSubscription = Geolocator.getPositionStream(
      locationSettings: AndroidSettings(
        accuracy: LocationAccuracy.high,
        // Mode cepat: semua fix dilewatkan (tanpa filter jarak) tiap detik. Mode hemat: tiap 5 detik dan
        // hanya bila bergeser >= 5 m, seperti sebelumnya.
        distanceFilter: _fast ? 0 : 5,
        intervalDuration: Duration(seconds: _fast ? 1 : 5),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'TapGo Driver aktif',
          notificationText:
              'Lokasi dibagikan agar Anda menerima pesanan terdekat. Ketuk untuk membuka.',
          notificationChannelName: 'Status online driver',
          enableWakeLock: true,
          // Tidak dapat digeser: notifikasi ini bukti bagi driver bahwa lokasinya sedang dibagikan.
          setOngoing: true,
        ),
      ),
    ).listen(
      (position) => _lastTracked = position,
      onError: (_) {},
    );
  }

  @override
  Future<void> setFastTracking(bool fast) async {
    if (_fast == fast) return;
    _fast = fast;
    // Hanya membuka ulang aliran yang sedang berjalan; bila belum/tidak sedang melacak, nilai baru berlaku
    // pada startTracking berikutnya.
    final running = _trackingSubscription;
    if (running == null) return;
    _trackingSubscription = null;
    await running.cancel();
    _openStream();
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
    final position = await _getPosition();
    await _repository.sendLocation(
      lat: position.latitude,
      lng: position.longitude,
      // Server menolak akurasi > 500m (RIDE_LOCATION_INACCURATE) — bulatkan
      // ke atas supaya pembulatan tidak pernah membuat titik kasar terlihat
      // lebih akurat dari yang sebenarnya.
      accuracyMeters: position.accuracy.ceil(),
      // Waktu fix yang sebenarnya (bukan waktu kirim), supaya posisi yang agak lama tidak tampak segar di server.
      capturedAt: position.timestamp,
    );
  }

  @override
  Future<DriverLocationFix?> currentFix() async {
    try {
      final position = await _getPosition();
      return DriverLocationFix(
        lat: position.latitude,
        lng: position.longitude,
        accuracyMeters: position.accuracy.ceil(),
      );
    } catch (_) {
      return null;
    }
  }

  Future<Position> _getPosition() async {
    final cached = _lastTracked;
    if (cached != null &&
        DateTime.now().difference(cached.timestamp) < _maxFixAge) {
      return cached;
    }
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 10),
        ),
      );
    } catch (_) {
      // GPS dingin belum mengunci: posisi terakhir yang diketahui sistem (maks. 30 dtk, akurasi <= 500 m; server menganggap fix segar selama 60 dtk
      // server) lebih baik daripada tidak mengirim apa pun, supaya sistem pencocokan segera melihat driver.
      final known = await Geolocator.getLastKnownPosition();
      if (known != null &&
          DateTime.now().difference(known.timestamp) < const Duration(seconds: 30) &&
          known.accuracy <= 500) {
        return known;
      }
      rethrow;
    }
  }

  /// Posisi untuk marker peta. SENGAJA tidak memakai `Geolocator.getPositionStream`: plugin hanya punya satu saluran
  /// event, dan aliran yang dibuka lebih dulu (dulu: peta di Beranda, tanpa konfigurasi notifikasi) menentukan
  /// pengaturan seluruhnya. Akibatnya layanan latar depan dan notifikasi pelacakan driver tidak pernah dibuat.
  /// Di sini posisi diambil dari fix pelacakan bila segar, selain itu dibaca satu kali tiap beberapa detik.
  @override
  Stream<(double lat, double lng)> get positionStream {
    late final StreamController<(double, double)> controller;
    Timer? timer;
    var active = true;
    var inFlight = false;
    (double, double)? last;

    void emit((double, double) point) {
      if (!active || point == last) return;
      last = point;
      controller.add(point);
    }

    Future<void> tick() async {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        final tracked = _lastTracked;
        if (tracked != null &&
            DateTime.now().difference(tracked.timestamp) < const Duration(seconds: 10)) {
          emit((tracked.latitude, tracked.longitude));
          return;
        }
        // Marker tampil SEKETIKA dari posisi terakhir yang diketahui sistem (tanpa menunggu GPS mengunci;
        // GPS dingin bisa butuh puluhan detik), lalu dipertajam oleh fix presisi di bawah.
        if (last == null) {
          try {
            final known = await Geolocator.getLastKnownPosition();
            if (known != null) emit((known.latitude, known.longitude));
          } catch (_) {}
        }
        try {
          final position = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 6),
            ),
          );
          emit((position.latitude, position.longitude));
        } catch (_) {
          // GPS belum mengunci. Bila belum ada posisi sama sekali, coba sumber jaringan (cepat, kurang presisi).
          if (last == null) {
            try {
              final coarse = await Geolocator.getCurrentPosition(
                locationSettings: const LocationSettings(
                  accuracy: LocationAccuracy.low,
                  timeLimit: Duration(seconds: 4),
                ),
              );
              emit((coarse.latitude, coarse.longitude));
            } catch (_) {
              // Izin/GPS belum tersedia: coba lagi pada putaran berikutnya.
            }
          }
        }
      } finally {
        inFlight = false;
      }
    }

    controller = StreamController<(double, double)>(
      onListen: () {
        unawaited(tick());
        timer = Timer.periodic(const Duration(seconds: 3), (_) => unawaited(tick()));
      },
      onCancel: () {
        active = false;
        timer?.cancel();
      },
    );
    return controller.stream;
  }
}
