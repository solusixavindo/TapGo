part of '../../../main.dart';

abstract class DriverRepository {
  Future<DriverSession?> restoreSession();
  Future<DriverSession> login(
      {required String phone, required String password});

  /// Langkah 1 dari Daftar/Masuk dengan Google. [idToken] datang dari
  /// package google_sign_in di layar login. Hasilnya salah satu dari dua
  /// bentuk [GoogleAuthResult] — lihat dokumentasi kelasnya.
  Future<GoogleAuthResult> loginWithGoogle({required String idToken});

  /// Langkah 2, hanya dipanggil setelah langkah 1 mengembalikan
  /// needsPhone: true. [idToken] adalah token Google YANG SAMA dari langkah
  /// 1 — backend memverifikasinya ulang, jadi tidak boleh kedaluwarsa
  /// terlalu lama antara kedua panggilan.
  Future<DriverSession> completeGoogleRegistration({
    required String idToken,
    required String phone,
    String? fullName,
  });

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

  /// Riwayat seluruh perjalanan milik driver, terbaru dulu — termasuk yang
  /// sudah selesai/dibatalkan, berbeda dari [currentRide] yang hanya melihat
  /// status aktif.
  Future<List<DriverRide>> rideHistory({int limit = 20});

  /// Ringkasan pendapatan kotor dalam rentang bergulir ('today'/'week'/
  /// 'month').
  Future<DriverEarningsSummary> earningsSummary({String range = 'today'});

  /// Saldo TapGo dan riwayat isi saldo / potongan komisi driver.
  Future<DriverWalletSummary> walletSummary();

  /// Statistik objektif (acceptance/completion/cancellation rate) — bukan
  /// rating bintang, lihat catatan di [DriverPerformanceSummary].
  Future<DriverPerformanceSummary> performanceSummary();

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
    String? fullName,
    String? dateOfBirth,
    String? address,
    String? emergencyContactName,
    String? emergencyContactPhone,
    required bool declarationAccepted,
  });

  /// Menarik pengajuan yang masih terbuka.
  Future<DriverApplicationSnapshot> withdrawApplication();

  // --- Chat per-perjalanan (Stage R2.10) -------------------------------

  Future<List<Map<String, dynamic>>> chatMessages(String rideReference);
  Future<void> sendChatMessage(String rideReference, String message);
  Future<void> markChatRead(String rideReference);

  /// Mengirim satu titik lokasi driver ke backend (mengisi peta live di
  /// Beranda untuk penumpang/admin). Dipanggil oleh [DriverLocationPort],
  /// bukan langsung dari UI — port yang mengurus GPS/izin perangkat, repo
  /// ini hanya mengurus jalur HTTP-nya.
  /// Mendaftarkan / mencabut token push perangkat ini pada akun yang masuk.
  Future<void> registerPushToken(String token);
  Future<void> unregisterPushToken(String token);

  Future<void> sendLocation({
    required double lat,
    required double lng,
    required int accuracyMeters,
    required DateTime capturedAt,
  });

  // --- Verifikasi wajah harian sebelum online ---------------------------

  /// Status verifikasi wajah HARI INI (kalender WIB) untuk driver yang
  /// sedang masuk.
  Future<DriverFaceCheckSnapshot> faceCheckToday();

  /// Embedding wajah referensi (bukan foto) untuk dicocokkan secara lokal.
  Future<DriverFaceReferenceEmbedding> faceCheckReference();

  /// Mengirim HASIL yang sudah diputuskan di perangkat (skor kemiripan +
  /// status liveness) — server menegakkan ULANG ambang batas dan batas
  /// percobaan, tidak sekadar mempercayai klaim klien.
  Future<DriverFaceCheckSnapshot> submitFaceCheckAttempt({
    required double similarityScore,
    required bool livenessPassed,
    required String modelVersion,
  });
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
