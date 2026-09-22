part of '../../../main.dart';

/// Hasil pemeriksaan liveness dasar (bukan pencocokan identitas) dari satu
/// foto: tepat satu wajah, mata terbuka, framing wajar. Dijalankan dengan
/// google_mlkit_face_detection — paket ini HANYA mendeteksi/mengklasifikasi
/// wajah, TIDAK melakukan pengenalan/pencocokan antar wajah.
class FaceCheckLivenessResult {
  const FaceCheckLivenessResult({required this.passed, this.reason});

  final bool passed;
  final String? reason;
}

/// Pipeline verifikasi wajah dua tahap, murni Dart + plugin — tidak
/// menyentuh Riverpod/UI, supaya dapat diuji dengan foto/embedding tiruan.
///
/// Tahap 1 (checkLiveness): google_mlkit_face_detection. NYATA dan
/// fungsional — paket sudah terpasang.
///
/// Tahap 2 (matchSimilarity): tflite_flutter menjalankan model embedding
/// wajah yang dibundel terpisah untuk pencocokan identitas terhadap
/// referensi KYC. BELUM diimplementasikan penuh: membutuhkan berkas model
/// (mis. MobileFaceNet) yang lisensinya sudah dipastikan boleh
/// diredistribusikan di app komersial closed-source — belum ada di repo ini,
/// dan tidak aman ditebak begitu saja. Dilempar dengan jelas
/// (FaceCheckModelUnavailableException), bukan pura-pura berhasil.
class FaceCheckModelUnavailableException implements Exception {
  const FaceCheckModelUnavailableException();

  @override
  String toString() =>
      'Model embedding wajah belum dibundel di aplikasi ini. '
      'Lihat FaceCheckPipeline.matchSimilarity().';
}

class FaceCheckPipeline {
  /// HARUS sama dengan DRIVER_FACE_EMBEDDING_MODEL_VERSION di backend
  /// (apps/backend/.../DriverFaceEmbeddingService.ts) — embedding dari model
  /// berbeda tidak sebanding secara matematis.
  static const modelVersion = 'mobilefacenet-v1';
  static const modelAsset = 'assets/ml/mobilefacenet.tflite';

  static const _minEyeOpenProbability = 0.4;
  static const _maxHeadYawDegrees = 25.0;

  /// Tahap 1: satu wajah, mata terbuka, menghadap kamera secara wajar.
  /// Heuristik anti "foto dari layar HP lain" yang sederhana (bukan
  /// liveness kelas produksi) — ukuran wajah relatif terhadap frame dicek
  /// oleh pemanggil lewat boundingBox bila diperlukan.
  ///
  /// Pemanggilan plugin (processImage) TIDAK bisa diuji tanpa kamera/device
  /// fisik — MethodChannel-nya hanya terdaftar di Android/iOS, bahkan tidak
  /// ada implementasi web sama sekali. Karena itu keputusan liveness sendiri
  /// dipisah ke [evaluateLiveness] (murni Dart, menerima daftar `Face`) supaya
  /// ATURANNYA bisa dibuktikan benar lewat unit test tanpa perangkat nyata,
  /// meski panggilan detector.processImage() di sini tetap tidak bisa.
  Future<FaceCheckLivenessResult> checkLiveness(String imagePath) async {
    final detector = FaceDetector(
      options: FaceDetectorOptions(enableClassification: true),
    );
    try {
      final faces = await detector.processImage(InputImage.fromFilePath(imagePath));
      return evaluateLiveness(faces);
    } finally {
      await detector.close();
    }
  }

  /// Aturan keputusan liveness murni — tanpa plugin, tanpa I/O. Diekstrak
  /// dari [checkLiveness] KHUSUS supaya dapat diuji dengan objek [Face]
  /// sintetis (konstruktornya publik) tanpa menyentuh kamera/ML Kit asli.
  static FaceCheckLivenessResult evaluateLiveness(List<Face> faces) {
    if (faces.isEmpty) {
      return const FaceCheckLivenessResult(
        passed: false,
        reason: 'Wajah tidak terdeteksi. Pastikan pencahayaan cukup dan coba lagi.',
      );
    }
    if (faces.length > 1) {
      return const FaceCheckLivenessResult(
        passed: false,
        reason: 'Terdeteksi lebih dari satu wajah dalam bingkai.',
      );
    }
    final face = faces.single;
    final leftOpen = face.leftEyeOpenProbability ?? 1.0;
    final rightOpen = face.rightEyeOpenProbability ?? 1.0;
    if (leftOpen < _minEyeOpenProbability || rightOpen < _minEyeOpenProbability) {
      return const FaceCheckLivenessResult(
        passed: false,
        reason: 'Pastikan kedua mata terbuka saat memotret.',
      );
    }
    final yaw = face.headEulerAngleY ?? 0;
    if (yaw.abs() > _maxHeadYawDegrees) {
      return const FaceCheckLivenessResult(
        passed: false,
        reason: 'Hadapkan wajah lurus ke kamera.',
      );
    }
    return const FaceCheckLivenessResult(passed: true);
  }

  /// Tahap 2: embedding foto hari ini dibandingkan dengan embedding
  /// referensi (cosine similarity). Melempar
  /// [FaceCheckModelUnavailableException] sampai berkas model TFLite
  /// dibundel — lihat catatan kelas di atas.
  Future<double> matchSimilarity({
    required String imagePath,
    required List<double> referenceEmbedding,
  }) async {
    final embedding = await _computeEmbedding(imagePath);
    return cosineSimilarity(embedding, referenceEmbedding);
  }

  Future<List<double>> _computeEmbedding(String imagePath) async {
    // Interpreter.fromAsset(modelAsset) sengaja tidak dipanggil di sini:
    // asetnya belum ada dan belum didaftarkan di pubspec.yaml. Mendaftarkan
    // path aset yang berkasnya tidak ada akan menggagalkan build SELURUH
    // aplikasi (bukan cuma fitur ini), jadi itu ditinggalkan sebagai
    // prasyarat eksplisit, bukan ditebak.
    throw const FaceCheckModelUnavailableException();
  }

  /// Murni matematika — diekspos static supaya bisa dibuktikan benar lewat
  /// unit test langsung (dipakai juga oleh [matchSimilarity]).
  static double cosineSimilarity(List<double> a, List<double> b) {
    if (a.isEmpty || b.isEmpty || a.length != b.length) return 0;
    double dot = 0, normA = 0, normB = 0;
    for (var i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA == 0 || normB == 0) return 0;
    return dot / (sqrt(normA) * sqrt(normB));
  }
}
