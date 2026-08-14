part of '../../../main.dart';

abstract class DriverLocationPort {
  Future<bool> get isAvailable;
  Future<void> sendCurrentLocation();
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
}
