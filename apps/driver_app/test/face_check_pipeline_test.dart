// Verifikasi wajah harian — bukti bahwa ATURAN KEPUTUSAN pipeline benar,
// tanpa kamera/perangkat fisik.
//
// Yang TIDAK bisa dibuktikan di sini, dan kenapa: FaceDetector.processImage()
// (google_mlkit_face_detection) berjalan lewat MethodChannel yang hanya
// terdaftar di Android/iOS — bahkan tidak ada implementasi web sama sekali
// (dicek langsung di pubspec.yaml paket itu: hanya android/ios terdaftar di
// bawah `platforms:`). Machine ini tidak punya Xcode lengkap (iOS Simulator
// tidak bisa dipakai) dan browser tidak didukung plugin ini sama sekali, jadi
// pemanggilan plugin itu sendiri genuinely tidak bisa diuji di sini — hanya
// bisa dibuktikan di device Android/iOS fisik.
//
// Yang BISA dan DIBUKTIKAN di sini: seluruh ATURAN yang menentukan lolos/
// tidaknya sebuah hasil deteksi (evaluateLiveness) dan perhitungan kemiripan
// (cosineSimilarity) — keduanya murni Dart, diekstrak khusus supaya
// testable tanpa plugin. Objek Face konstruktornya publik (bukan hanya
// dibuat dari hasil plugin), jadi bisa disintesis langsung di sini.
import 'package:flutter/material.dart' show Rect;
import 'package:flutter_test/flutter_test.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:tapgo_driver_app/main.dart';

Face _face({
  double? leftEyeOpen = 1.0,
  double? rightEyeOpen = 1.0,
  double? headEulerAngleY = 0,
}) {
  return Face(
    boundingBox: const Rect.fromLTWH(0, 0, 200, 200),
    landmarks: const {},
    contours: const {},
    leftEyeOpenProbability: leftEyeOpen,
    rightEyeOpenProbability: rightEyeOpen,
    headEulerAngleY: headEulerAngleY,
  );
}

void main() {
  group('FaceCheckPipeline.evaluateLiveness — aturan keputusan liveness', () {
    test('tanpa wajah terdeteksi -> gagal dengan alasan jelas', () {
      final result = FaceCheckPipeline.evaluateLiveness(const []);
      expect(result.passed, isFalse);
      expect(result.reason, contains('tidak terdeteksi'));
    });

    test('lebih dari satu wajah dalam bingkai -> gagal', () {
      final result = FaceCheckPipeline.evaluateLiveness([_face(), _face()]);
      expect(result.passed, isFalse);
      expect(result.reason, contains('lebih dari satu wajah'));
    });

    test('mata kiri tertutup -> gagal', () {
      final result = FaceCheckPipeline.evaluateLiveness([_face(leftEyeOpen: 0.1)]);
      expect(result.passed, isFalse);
      expect(result.reason, contains('mata terbuka'));
    });

    test('mata kanan tertutup -> gagal', () {
      final result = FaceCheckPipeline.evaluateLiveness([_face(rightEyeOpen: 0.1)]);
      expect(result.passed, isFalse);
      expect(result.reason, contains('mata terbuka'));
    });

    test('probabilitas mata tepat di ambang batas (0.4) -> masih lolos', () {
      final result = FaceCheckPipeline.evaluateLiveness(
        [_face(leftEyeOpen: 0.4, rightEyeOpen: 0.4)],
      );
      expect(result.passed, isTrue);
    });

    test('kepala menoleh berlebihan (>25 derajat) -> gagal', () {
      final result = FaceCheckPipeline.evaluateLiveness([_face(headEulerAngleY: 40)]);
      expect(result.passed, isFalse);
      expect(result.reason, contains('lurus ke kamera'));
    });

    test('menoleh ke arah berlawanan (-40 derajat) juga gagal — memakai nilai absolut', () {
      final result = FaceCheckPipeline.evaluateLiveness([_face(headEulerAngleY: -40)]);
      expect(result.passed, isFalse);
    });

    test('satu wajah, mata terbuka, menghadap lurus -> LOLOS', () {
      final result = FaceCheckPipeline.evaluateLiveness([_face()]);
      expect(result.passed, isTrue);
      expect(result.reason, isNull);
    });

    test('probabilitas mata null (tidak terhitung) diperlakukan sebagai terbuka, bukan ditolak', () {
      final result = FaceCheckPipeline.evaluateLiveness(
        [_face(leftEyeOpen: null, rightEyeOpen: null)],
      );
      expect(result.passed, isTrue);
    });
  });

  group('FaceCheckPipeline.cosineSimilarity — murni matematika', () {
    test('vektor identik -> kemiripan 1.0', () {
      expect(FaceCheckPipeline.cosineSimilarity([1, 2, 3], [1, 2, 3]), closeTo(1.0, 1e-9));
    });

    test('vektor berlawanan arah -> kemiripan -1.0', () {
      expect(FaceCheckPipeline.cosineSimilarity([1, 0], [-1, 0]), closeTo(-1.0, 1e-9));
    });

    test('vektor tegak lurus -> kemiripan 0', () {
      expect(FaceCheckPipeline.cosineSimilarity([1, 0], [0, 1]), closeTo(0.0, 1e-9));
    });

    test('vektor kosong atau panjang beda -> 0, bukan error', () {
      expect(FaceCheckPipeline.cosineSimilarity([], []), 0);
      expect(FaceCheckPipeline.cosineSimilarity([1, 2], [1, 2, 3]), 0);
    });
  });

  group('FaceCheckPipeline.matchSimilarity — fail-closed sampai model dibundel', () {
    test('SELALU melempar FaceCheckModelUnavailableException, bukan angka palsu', () async {
      // Ini bukti bahwa pipeline JUJUR ketika belum siap: tidak pernah
      // mengembalikan skor kemiripan tanpa model sungguhan.
      await expectLater(
        FaceCheckPipeline().matchSimilarity(
          imagePath: '/tmp/tidak-relevan.jpg',
          referenceEmbedding: const [0.1, 0.2, 0.3],
        ),
        throwsA(isA<FaceCheckModelUnavailableException>()),
      );
    });
  });
}
