part of '../../../main.dart';

abstract class DriverLocationPort {
  Future<bool> get isAvailable;
  Future<void> sendCurrentLocation();

  /// Aliran posisi live untuk marker peta di Beranda. Implementasi tanpa GPS
  /// asli (mis. [NoDriverLocationPort] — dipakai di mode demo dan widget
  /// test) mengembalikan stream yang tidak pernah emit, bukan posisi palsu.
  Stream<(double lat, double lng)> get positionStream;
}

class NoDriverLocationPort implements DriverLocationPort {
  @override
  Future<bool> get isAvailable async => false;

  @override
  Future<void> sendCurrentLocation() async {
    throw const DriverApiException(
      code: 'LOCATION_PROVIDER_UNAVAILABLE',
      message: 'Lokasi belum tersedia pada versi ini.',
    );
  }

  @override
  Stream<(double lat, double lng)> get positionStream => const Stream.empty();
}

/// GPS asli lewat package geolocator. Hanya mengurus perangkat + izin lokasi
/// — pengiriman HTTP-nya didelegasikan ke [DriverRepository.sendLocation],
/// supaya port ini tidak perlu tahu apa pun soal token/base URL backend.
class GeolocatorDriverLocationPort implements DriverLocationPort {
  GeolocatorDriverLocationPort(this._repository);

  final DriverRepository _repository;

  @override
  Future<bool> get isAvailable async {
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    return permission == LocationPermission.always ||
        permission == LocationPermission.whileInUse;
  }

  @override
  Future<void> sendCurrentLocation() async {
    final position = await Geolocator.getCurrentPosition(
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
