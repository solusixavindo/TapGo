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

  /// Ringkasan dokumen milik driver yang sedang masuk.
  Future<List<DriverDocumentSummary>> documents();

  /// Mengunggah satu berkas dokumen.
  ///
  /// Byte dikirim mentah, bukan base64 di dalam JSON: base64 membengkakkan
  /// muatan sekitar sepertiga tanpa memberi keuntungan apa pun, dan backend
  /// memang menerima gambar mentah pada rute ini.
  Future<List<DriverDocumentSummary>> uploadDocument({
    required DriverDocumentKind kind,
    required Uint8List bytes,
    required String contentType,
  });

  /// Status pengajuan mitra milik driver yang sedang masuk (H1).
  Future<DriverApplicationSnapshot> myApplication();

  /// Mengirim pengajuan mitra baru. Backend menolak bila dokumen belum
  /// lengkap (K1-A) atau masih ada pengajuan terbuka.
  Future<DriverApplicationSnapshot> submitApplication({
    required String serviceType,
    required String plateNumber,
    String? brand,
    String? model,
    String? color,
  });

  /// Menarik pengajuan yang masih terbuka.
  Future<DriverApplicationSnapshot> withdrawApplication();
}

/// Potret status pengajuan: pengajuan terbuka (bila ada) + kelengkapan syarat.
class DriverApplicationSnapshot {
  const DriverApplicationSnapshot({
    required this.application,
    required this.documentsComplete,
    this.vehiclePlateMasked,
  });

  final DriverApplicationInfo? application;
  final bool documentsComplete;
  final String? vehiclePlateMasked;
}
