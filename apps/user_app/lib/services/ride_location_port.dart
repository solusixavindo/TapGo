part of '../main.dart';

/// Batas provider-netral untuk pemilihan lokasi Ojek Online.
///
/// Provider Maps belum diputuskan Owner, jadi tidak ada SDK, API key, maupun
/// panggilan jaringan geocoding di sini. Yang ada hanyalah kontrak: apa pun
/// provider yang dipilih nanti, ia mengimplementasikan port ini.
///
/// Perilaku default — termasuk pada release build — adalah FAIL CLOSED:
/// pemesanan tidak dapat dilanjutkan tanpa provider, dan tidak ada koordinat
/// palsu yang dibuat agar alurnya "kelihatan jalan".

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

enum RideLocationProviderStatus {
  /// Provider siap dan lokasi dapat dipilih.
  ready,

  /// Tidak ada provider yang terpasang. Default produksi.
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

/// Kontrak pemilihan lokasi.
abstract class LocationSelectionPort {
  RideLocationProviderStatus get status;

  /// Pilihan yang tersedia. Kosong ketika provider tidak tersedia.
  List<RideLocation> availableLocations();
}

/// Adapter default untuk produksi: tidak menyediakan lokasi apa pun.
///
/// Inilah yang terpasang bila tidak ada yang menggantinya, sehingga jalur
/// gagal adalah jalur bawaan — bukan sesuatu yang harus diingat untuk dipasang.
class UnavailableLocationPort implements LocationSelectionPort {
  const UnavailableLocationPort();

  @override
  RideLocationProviderStatus get status =>
      RideLocationProviderStatus.unavailable;

  @override
  List<RideLocation> availableLocations() => const [];
}

/// Adapter demo dengan tiga lokasi sintetis.
///
/// Koordinatnya sengaja dibulatkan dan tidak menunjuk alamat nyata siapa pun.
/// Nama titiknya pun eksplisit menyebut DEMO agar tidak pernah tertukar dengan
/// data produksi bila kebetulan terlihat di tangkapan layar.
class DemoLocationPort implements LocationSelectionPort {
  const DemoLocationPort();

  static const List<RideLocation> _locations = [
    RideLocation(
      id: 'LOKASI_DEMO_A',
      label: 'LOKASI_DEMO_A',
      address: 'LOKASI_DEMO_A — Titik Uji Utara',
      lat: -6.20,
      lng: 106.81,
    ),
    RideLocation(
      id: 'LOKASI_DEMO_B',
      label: 'LOKASI_DEMO_B',
      address: 'LOKASI_DEMO_B — Titik Uji Tengah',
      lat: -6.21,
      lng: 106.82,
    ),
    RideLocation(
      id: 'LOKASI_DEMO_C',
      label: 'LOKASI_DEMO_C',
      address: 'LOKASI_DEMO_C — Titik Uji Selatan',
      lat: -6.22,
      lng: 106.83,
    ),
  ];

  @override
  RideLocationProviderStatus get status => RideLocationProviderStatus.ready;

  @override
  List<RideLocation> availableLocations() => _locations;
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
  return const UnavailableLocationPort();
}
