part of '../../../main.dart';

abstract class DriverRepository {
  Future<DriverSession?> restoreSession();
  Future<DriverSession> login(
      {required String phone, required String password});
  Future<void> logout();
  Future<DriverAvailability> setAvailability(DriverAvailability availability);
  Future<List<DriverRide>> offers();
  Future<DriverRide?> currentRide();
  Future<DriverRide> accept(String reference);
  Future<void> reject(String reference);
  Future<DriverRide> pickup(String reference);
  Future<DriverRide> arrived(String reference);
  Future<DriverRide> start(String reference);
  Future<DriverRide> complete(String reference);
  Future<DriverRide> cancel(String reference, String reason);
}
