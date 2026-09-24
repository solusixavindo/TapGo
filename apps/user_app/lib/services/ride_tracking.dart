part of '../main.dart';

/// Posisi driver terkini untuk penumpang, sebagaimana dilaporkan server.
///
/// Server hanya mengirim ini selama driver terlibat pada perjalanan pemilik
/// akun (lihat GET /rides/:reference/driver-location); selain itu `available`
/// bernilai false dan tidak ada koordinat.
class RideDriverFix {
  const RideDriverFix({
    required this.lat,
    required this.lng,
    required this.stale,
    required this.ageSeconds,
    required this.toDropoff,
    required this.distanceMeters,
    required this.etaSeconds,
    this.routePolyline,
  });

  final double lat;
  final double lng;

  /// Titik lebih tua dari batas segar: ditampilkan redup, bukan sebagai "langsung".
  final bool stale;
  final int ageSeconds;

  /// true bila driver sedang menuju tujuan (perjalanan berlangsung); false bila
  /// menuju titik jemput.
  final bool toDropoff;
  final int distanceMeters;
  final int etaSeconds;
  final String? routePolyline;

  LatLng get point => LatLng(lat, lng);

  /// Null bila server menyatakan tidak tersedia atau isinya tidak masuk akal.
  static RideDriverFix? tryFromJson(Object? json) {
    if (json is! Map || json['available'] != true) {
      return null;
    }
    final lat = json['lat'];
    final lng = json['lng'];
    if (lat is! num || lng is! num) {
      return null;
    }
    final latValue = lat.toDouble();
    final lngValue = lng.toDouble();
    if (latValue.isNaN ||
        lngValue.isNaN ||
        latValue.abs() > 90 ||
        lngValue.abs() > 180) {
      return null;
    }
    int nonNegative(Object? value) =>
        value is num && value.isFinite && value >= 0 ? value.round() : 0;
    final polyline = json['routePolyline'];
    return RideDriverFix(
      lat: latValue,
      lng: lngValue,
      stale: json['stale'] == true,
      ageSeconds: nonNegative(json['ageSeconds']),
      toDropoff: json['target'] == 'DROPOFF',
      distanceMeters: nonNegative(json['distanceMeters']),
      etaSeconds: nonNegative(json['etaSeconds']),
      routePolyline:
          polyline is String && polyline.isNotEmpty ? polyline : null,
    );
  }
}

/// "sekitar 4 menit" / "kurang dari 1 menit".
String tapGoRideEtaLabel(int etaSeconds) {
  if (etaSeconds < 60) {
    return 'kurang dari 1 menit';
  }
  final minutes = (etaSeconds / 60).round();
  if (minutes >= 90) {
    return 'lebih dari 1,5 jam';
  }
  return 'sekitar $minutes menit';
}

/// "350 m" / "1,2 km".
String tapGoRideDistanceLabel(int meters) {
  if (meters < 1000) {
    return '${(meters / 10).round() * 10} m';
  }
  return '${(meters / 1000).toStringAsFixed(1).replaceAll('.', ',')} km';
}

/// Poller posisi driver. Jarak antar permintaan 5 detik; saat server menolak
/// atau jaringan gagal, jeda digandakan (maksimal 20 detik) lalu kembali normal
/// begitu berhasil, supaya tidak menghujani server ketika terbatasi laju.
class RideDriverTracker {
  RideDriverTracker({
    required this.reference,
    required this.onFix,
    this.interval = const Duration(seconds: 5),
    this.maxBackoff = const Duration(seconds: 20),
    Future<Map<String, dynamic>> Function(String reference)? fetch,
  }) : _fetch = fetch ?? ((ref) => _apiClient.rideDriverLocation(ref));

  final String reference;

  /// null = posisi tidak tersedia saat ini.
  final void Function(RideDriverFix? fix) onFix;
  final Duration interval;
  final Duration maxBackoff;
  final Future<Map<String, dynamic>> Function(String reference) _fetch;

  Timer? _timer;
  bool _disposed = false;
  bool _inFlight = false;
  Duration _current = Duration.zero;
  int _requestCount = 0;

  int get requestCount => _requestCount;
  bool get isRunning => _timer != null;

  void start() {
    if (_disposed || _timer != null) {
      return;
    }
    _current = interval;
    unawaited(_tick());
    _schedule();
  }

  void _schedule() {
    _timer?.cancel();
    _timer = Timer(_current, () {
      unawaited(_tick().whenComplete(() {
        if (!_disposed && _timer != null) {
          _schedule();
        }
      }));
    });
  }

  /// Berhenti sementara (app di latar belakang atau tahap perjalanan berubah).
  void pause() {
    _timer?.cancel();
    _timer = null;
  }

  void dispose() {
    _disposed = true;
    pause();
  }

  Future<void> _tick() async {
    if (_disposed || _inFlight) {
      return;
    }
    _inFlight = true;
    try {
      _requestCount += 1;
      final data = await _fetch(reference);
      if (_disposed) {
        return;
      }
      _current = interval;
      onFix(RideDriverFix.tryFromJson(data));
    } catch (_) {
      // Posisi hanya pelengkap: kegagalan tidak mengganggu layar status.
      // Status perjalanan sendiri dijaga poller lain (401/sesi ditangani di sana).
      final doubled = _current * 2;
      _current = doubled > maxBackoff ? maxBackoff : doubled;
    } finally {
      _inFlight = false;
    }
  }
}
