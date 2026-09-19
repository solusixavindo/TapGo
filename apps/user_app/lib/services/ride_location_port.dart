part of '../main.dart';

/// Batas provider-netral untuk pemilihan lokasi Ojek Online.
///
/// Provider yang terpasang adalah OpenStreetMap + Nominatim (gratis, tanpa API
/// key): pencarian alamat memakai Nominatim search, alamat dari titik peta
/// memakai Nominatim reverse, dan lokasi saat ini memakai geolocator. Kontrak
/// port tidak berubah — layar ride tidak tahu provider apa yang di belakangnya.

/// Flag compile-time. Demo hanya menyala bila disetel eksplisit saat build.
///
/// `String.fromEnvironment` dievaluasi saat kompilasi, sehingga release build
/// yang tidak menyertakan flag ini mustahil mengaktifkan demo — nilainya
/// bukan sesuatu yang dapat diubah saat runtime.
const String _tapGoRideDemoModeRaw = String.fromEnvironment(
  'TAPGO_RIDE_DEMO_MODE',
  defaultValue: 'false',
);

/// Demo aktif HANYA untuk string literal 'true'. Nilai lain apa pun — termasuk
/// 'TRUE', '1', dan 'yes' — sengaja dianggap tidak aktif agar tidak ada jalur
/// yang menyalakan demo karena kelalaian penulisan.
bool get tapGoRideDemoMode => _tapGoRideDemoModeRaw == 'true';

/// Label kejujuran. Wajib tampil pada setiap layar saat demo aktif.
const String tapGoRideDemoLabel = 'DEMO DATA';

/// Pesan tunggal ketika layanan lokasi belum tersedia.
const String tapGoRideLocationUnavailableMessage =
    'Layanan lokasi belum tersedia.';

/// Atribusi wajib OpenStreetMap, ditampilkan pada pojok peta.
const String tapGoOsmAttribution = '© OpenStreetMap contributors';

enum RideLocationProviderStatus {
  /// Provider siap dan lokasi dapat dipilih.
  ready,

  /// Tidak ada provider yang terpasang.
  unavailable,
}

/// Satu titik lokasi yang dapat dikirim ke backend.
///
/// Bentuknya sengaja sama dengan DTO `coordinate` backend — `{lat, lng,
/// address}` — supaya tidak ada penerjemahan tersembunyi di lapisan UI.
class RideLocation {
  const RideLocation({
    required this.id,
    required this.label,
    required this.address,
    required this.lat,
    required this.lng,
  });

  /// Pengenal internal untuk pilihan UI, bukan pengenal backend.
  final String id;

  /// Nama pendek untuk daftar pilihan.
  final String label;

  /// Alamat yang dikirim ke backend (3–255 karakter sesuai validator).
  final String address;

  final double lat;
  final double lng;

  Map<String, dynamic> toJson() => {
        'lat': lat,
        'lng': lng,
        'address': address,
      };
}

/// Hasil pencarian alamat Nominatim.
class RideAddressCandidate {
  const RideAddressCandidate({
    required this.label,
    required this.address,
    required this.lat,
    required this.lng,
  });

  final String label;
  final String address;
  final double lat;
  final double lng;

  RideLocation toRideLocation() => RideLocation(
        id: 'geo-$lat-$lng',
        label: label,
        address: address,
        lat: lat,
        lng: lng,
      );
}

/// Kontrak pemilihan lokasi.
abstract class LocationSelectionPort {
  RideLocationProviderStatus get status;

  /// Cari kandidat alamat dari teks bebas (mis. "Monas Jakarta").
  ///
  /// [near] membatasi hasil ke sekitar satu titik (mis. titik jemput yang
  /// sudah dipilih) supaya rekomendasi tidak melompat ke kota/provinsi lain
  /// yang kebetulan punya nama jalan sama.
  Future<List<RideAddressCandidate>> searchAddress(
    String query, {
    RideLocation? near,
  });

  /// Alamat terbaik untuk satu koordinat (reverse geocode).
  Future<String?> reverseAddress(double lat, double lng);

  /// Lokasi perangkat saat ini, atau null bila izin/gps tidak tersedia.
  Future<RideLocation?> currentLocation();

  /// Perkiraan lokasi CEPAT dari cache GPS terakhir (tanpa memicu prompt izin
  /// atau menunggu fix baru) — dipakai sebagai bias pencarian saat sheet
  /// pemilih lokasi baru dibuka dan belum ada titik acuan (mis. titik jemput
  /// belum dipilih). Null bila belum ada fix tersimpan atau izin belum ada;
  /// pemanggil harus tetap berjalan normal tanpa bias saat null.
  Future<RideLocation?> lastKnownLocation();
}

/// Label pendek dari hasil Nominatim: dua komponen pertama alamat.
String _shortLabel(String displayName) {
  final parts = displayName.split(',').map((p) => p.trim()).toList();
  return parts.take(2).join(', ');
}

/// Provider produksi: OpenStreetMap Nominatim + geolocator.
///
/// Kebijakan Nominatim mewajibkan User-Agent yang mengidentifikasi aplikasi
/// dan membatasi 1 permintaan/detik; klien di sini mematuhinya dengan antrean
/// sederhana (permintaan berturut dijeda) dan header yang jelas.
class OsmLocationPort implements LocationSelectionPort {
  OsmLocationPort({Dio? http}) : _http = http ?? Dio();

  static const _searchUrl = 'https://nominatim.openstreetmap.org/search';
  static const _reverseUrl = 'https://nominatim.openstreetmap.org/reverse';
  static const _userAgent = 'TapGo-Customer/2.0 (kontak: admin@tapgolion.id)';

  final Dio _http;
  DateTime _lastRequestAt = DateTime.fromMillisecondsSinceEpoch(0);

  Map<String, String> get _headers => const {'User-Agent': _userAgent};

  Future<void> _respectRateLimit() async {
    final elapsed = DateTime.now().difference(_lastRequestAt);
    if (elapsed < const Duration(milliseconds: 1100)) {
      await Future<void>.delayed(
          const Duration(milliseconds: 1100) - elapsed);
    }
    _lastRequestAt = DateTime.now();
  }

  @override
  RideLocationProviderStatus get status => RideLocationProviderStatus.ready;

  /// Setengah lebar/tinggi kotak pembatas pencarian (derajat) di sekitar
  /// [near] — kira-kira 35-40 km, cakupan wajar untuk "satu kota/kabupaten
  /// terdekat" tanpa melompat ke provinsi lain yang kebetulan sama nama
  /// jalannya.
  static const _nearBoxDegrees = 0.35;

  @override
  Future<List<RideAddressCandidate>> searchAddress(
    String query, {
    RideLocation? near,
  }) async {
    final trimmed = query.trim();
    if (trimmed.length < 3) return const [];
    try {
      await _respectRateLimit();
      final response = await _http.get<List<dynamic>>(
        _searchUrl,
        queryParameters: {
          'q': trimmed,
          'format': 'jsonv2',
          'limit': 6,
          'countrycodes': 'id',
          'accept-language': 'id',
          'addressdetails': 0,
          if (near != null) ...{
            'viewbox':
                '${near.lng - _nearBoxDegrees},${near.lat + _nearBoxDegrees},'
                '${near.lng + _nearBoxDegrees},${near.lat - _nearBoxDegrees}',
            'bounded': 1,
          },
        },
        options: Options(headers: _headers),
      );
      final rows = response.data ?? const [];
      return rows.whereType<Map<String, dynamic>>().map((row) {
        final display = '${row['display_name'] ?? ''}';
        return RideAddressCandidate(
          label: _shortLabel(display),
          address: display,
          lat: double.tryParse('${row['lat']}') ?? 0,
          lng: double.tryParse('${row['lon']}') ?? 0,
        );
      }).where((c) => c.address.isNotEmpty).toList();
    } on DioException {
      return const [];
    }
  }

  @override
  Future<String?> reverseAddress(double lat, double lng) async {
    try {
      await _respectRateLimit();
      final response = await _http.get<Map<String, dynamic>>(
        _reverseUrl,
        queryParameters: {
          'lat': lat,
          'lon': lng,
          'format': 'jsonv2',
          'accept-language': 'id',
        },
        options: Options(headers: _headers),
      );
      final display = response.data?['display_name'];
      return display is String && display.isNotEmpty ? display : null;
    } on DioException {
      return null;
    }
  }

  /// Toleransi kesalahan jarak yang diminta: hasil GPS harus berada dalam
  /// radius 50 meter dari titik sesungguhnya pengguna.
  static const _maxAcceptableAccuracyMeters = 50.0;

  @override
  Future<RideLocation?> currentLocation() async {
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return null;
      }
      // Sebelumnya cuma satu percobaan dengan accuracy .high — hasil pertama
      // GPS baru "settle" kadang masih di atas 50m. Dicoba sampai dua kali
      // dengan akurasi tertinggi yang tersedia, dan dipakai hasil terbaik
      // (bukan cuma percobaan terakhir) bila keduanya belum memenuhi 50m.
      Position? best;
      for (var attempt = 1; attempt <= 2; attempt++) {
        final position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.best,
            timeLimit: Duration(seconds: 12),
          ),
        );
        if (best == null || position.accuracy < best.accuracy) {
          best = position;
        }
        if (best.accuracy <= _maxAcceptableAccuracyMeters) {
          break;
        }
      }
      final position = best!;
      final address = await reverseAddress(position.latitude, position.longitude);
      return RideLocation(
        id: 'gps-${position.latitude}-${position.longitude}',
        label: 'Lokasi saya saat ini',
        address: address ??
            'Koordinat ${position.latitude.toStringAsFixed(5)}, '
                '${position.longitude.toStringAsFixed(5)}',
        lat: position.latitude,
        lng: position.longitude,
      );
    } catch (_) {
      return null;
    }
  }

  @override
  Future<RideLocation?> lastKnownLocation() async {
    try {
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        // Sengaja TIDAK meminta izin di sini — ini cuma bias pencarian,
        // bukan aksi yang pengguna minta secara sadar. Prompt izin harus
        // muncul saat pengguna menekan "Gunakan lokasi saya", bukan diam-diam
        // saat sheet pencarian baru dibuka.
        return null;
      }
      var position = await Geolocator.getLastKnownPosition();
      if (position == null) {
        // Belum ada fix GPS tersimpan sama sekali (mis. baru install, atau
        // izin baru diberikan dan belum pernah menekan "Gunakan lokasi
        // saya") — laporan Owner: pencarian Tujuan masih jauh dari lokasi
        // user karena bias-nya kosong tepat di kasus ini. Izin sudah pasti
        // ada di titik ini (dicek di atas), jadi minta satu fix cepat
        // langsung alih-alih diam-diam menyerah ke pencarian tanpa bias.
        try {
          position = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.medium,
              timeLimit: Duration(seconds: 5),
            ),
          );
        } catch (_) {
          return null;
        }
      }
      return RideLocation(
        id: 'gps-last-${position.latitude}-${position.longitude}',
        label: 'Perkiraan lokasi',
        address: 'Koordinat ${position.latitude.toStringAsFixed(5)}, '
            '${position.longitude.toStringAsFixed(5)}',
        lat: position.latitude,
        lng: position.longitude,
      );
    } catch (_) {
      return null;
    }
  }
}

/// Adapter demo dengan tiga lokasi sintetis.
///
/// Koordinatnya sengaja dibulatkan dan tidak menunjuk alamat nyata siapa pun.
/// Nama titiknya pun eksplisit menyebut DEMO agar tidak pernah tertukar dengan
/// data produksi bila kebetulan terlihat di tangkapan layar.
class DemoLocationPort implements LocationSelectionPort {
  const DemoLocationPort();

  static const List<RideAddressCandidate> _candidates = [
    RideAddressCandidate(
      label: 'LOKASI_DEMO_A',
      address: 'LOKASI_DEMO_A — Titik Uji Utara',
      lat: -6.20,
      lng: 106.81,
    ),
    RideAddressCandidate(
      label: 'LOKASI_DEMO_B',
      address: 'LOKASI_DEMO_B — Titik Uji Tengah',
      lat: -6.21,
      lng: 106.82,
    ),
    RideAddressCandidate(
      label: 'LOKASI_DEMO_C',
      address: 'LOKASI_DEMO_C — Titik Uji Selatan',
      lat: -6.22,
      lng: 106.83,
    ),
  ];

  @override
  RideLocationProviderStatus get status => RideLocationProviderStatus.ready;

  @override
  Future<List<RideAddressCandidate>> searchAddress(
    String query, {
    RideLocation? near,
  }) async {
    final trimmed = query.trim().toLowerCase();
    if (trimmed.isEmpty) return _candidates;
    return _candidates
        .where((c) => c.label.toLowerCase().contains(trimmed))
        .toList();
  }

  @override
  Future<String?> reverseAddress(double lat, double lng) async =>
      'LOKASI_DEMO — $lat,$lng';

  @override
  Future<RideLocation?> currentLocation() async => _candidates.first.toRideLocation();

  @override
  Future<RideLocation?> lastKnownLocation() async => null;
}

/// Port yang berlaku untuk aplikasi.
///
/// Pemilihannya terjadi pada satu tempat dan hanya bergantung pada flag
/// compile-time. Tidak ada percabangan berdasarkan sinyal runtime, package
/// name, maupun konfigurasi server.
LocationSelectionPort tapGoRideLocationPort() {
  if (tapGoRideDemoMode) {
    return const DemoLocationPort();
  }
  return OsmLocationPort();
}
