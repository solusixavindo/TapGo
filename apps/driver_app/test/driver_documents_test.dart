import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/main.dart';

import 'widget_test.dart' show FakeDriverRepository;

/// Layar unggah dokumen verifikasi mitra.
///
/// Yang dijaga di sini, berurut dari yang paling berbahaya bila gagal:
/// 1. Jalur unggah TERBUKA saat pengajuan ditolak. Tanpa itu driver terjebak
///    tanpa cara memperbaiki berkasnya.
/// 2. Jalur unggah TERTUTUP saat akses dihentikan, supaya aplikasi tidak
///    menjanjikan sesuatu yang tidak akan terjadi.
/// 3. Kebijakan 24 jam disampaikan apa adanya kepada driver.
/// 4. Kode jenis dokumen sama persis dengan yang diterima backend.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  DriverSession session() => const DriverSession(
        accessToken: 'akses-uji',
        refreshToken: 'segar-uji',
        driverName: 'Driver Uji',
      );

  /// Menyiapkan repository yang memaksa satu status ruang kerja tertentu.
  ///
  /// Statusnya ditentukan KODE GALAT, bukan parameter scenario — scenario hanya
  /// berlaku untuk repository demo. Pemetaannya ada di _applyCapabilityError.
  FakeDriverRepository repoWithStatus(String code) =>
      FakeDriverRepository(session: session())
        ..currentError = DriverApiException(
          code: code,
          message: 'Status uji: $code',
          statusCode: 403,
        );

  Future<void> pump(
    WidgetTester tester,
    FakeDriverRepository repository, {
    DriverScenario scenario = DriverScenario.pending,
  }) async {
    await tester.binding.setSurfaceSize(const Size(390, 900));
    addTearDown(() async {
      await tester.binding.setSurfaceSize(null);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    });
    await tester.pumpWidget(
      buildTestableDriverApp(repository: repository, scenario: scenario),
    );
    await tester.pumpAndSettle();
  }

  group('Dokumen verifikasi mitra', () {
    testWidgets('kode jenis dokumen sama persis dengan daftar backend',
        (tester) async {
      // Backend menolak jenis di luar DRIVER_DOCUMENT_TYPES. Perbedaan satu
      // huruf di sini muncul sebagai kegagalan unggah yang membingungkan.
      expect(
        DriverDocumentKind.values.map((kind) => kind.api).toList(),
        <String>['KTP', 'SIM', 'STNK', 'SELFIE'],
      );
    });

    testWidgets('pengajuan yang ditolak tetap dapat mengunggah ulang',
        (tester) async {
      // RIDE_DRIVER_REJECTED, bukan NOT_ACTIVE: hanya kode inilah yang
      // menghasilkan status rejected.
      final repository = repoWithStatus('RIDE_DRIVER_REJECTED');
      await pump(tester, repository, scenario: DriverScenario.rejected);

      // Inilah pemeriksaan terpenting: driver yang ditolak WAJIB punya jalan
      // memperbaiki berkasnya.
      expect(find.byType(DriverDocumentsSection), findsOneWidget);
      for (final kind in DriverDocumentKind.values) {
        expect(
          find.byKey(ValueKey('document-upload-${kind.api}')),
          findsOneWidget,
          reason: 'tombol unggah ${kind.api} harus tersedia saat ditolak',
        );
      }
    });

    testWidgets('akses yang dihentikan TIDAK menampilkan jalur unggah',
        (tester) async {
      // RIDE_DRIVER_SUSPENDED, bukan ACCOUNT_INACTIVE: keduanya menghasilkan
      // status berbeda, dan yang diuji di sini adalah penghentian akses.
      final repository = repoWithStatus('RIDE_DRIVER_SUSPENDED');
      await pump(tester, repository, scenario: DriverScenario.suspended);

      // Mengunggah berkas tidak mengubah keputusan penghentian; menampilkan
      // tombolnya hanya menjanjikan sesuatu yang tidak terjadi.
      expect(find.byType(DriverDocumentsSection), findsNothing);
    });

    testWidgets('menyampaikan kebijakan 24 jam kepada driver', (tester) async {
      final repository = repoWithStatus('RIDE_DRIVER_NOT_ACTIVE');
      await pump(tester, repository);

      expect(
        find.textContaining('24 jam'),
        findsWidgets,
        reason: 'driver berhak tahu berkasnya dihapus otomatis',
      );
      expect(find.textContaining('dienkripsi'), findsWidgets);
    });

    testWidgets('memuat ringkasan dokumen saat layar dibuka', (tester) async {
      final now = DateTime.now();
      final repository = repoWithStatus('RIDE_DRIVER_NOT_ACTIVE')
        ..documentItems = [
          DriverDocumentSummary(
            kind: DriverDocumentKind.ktp,
            review: DriverDocumentReview.pending,
            available: true,
            uploadedAt: now,
            expiresAt: now.add(const Duration(hours: 6)),
            sizeBytes: 1024,
          ),
        ];
      await pump(tester, repository);

      expect(find.text('Diperiksa'), findsOneWidget);
      // Sisa waktu ditampilkan supaya driver tahu kapan berkasnya hilang.
      expect(find.textContaining('Dihapus otomatis dalam'), findsOneWidget);
      // Yang belum diunggah tetap tampil sebagai belum ada.
      expect(find.text('Belum ada'), findsNWidgets(3));
    });

    testWidgets('dokumen yang sudah lewat masa simpan dijelaskan apa adanya',
        (tester) async {
      final repository = repoWithStatus('RIDE_DRIVER_NOT_ACTIVE')
        ..documentItems = [
          DriverDocumentSummary(
            kind: DriverDocumentKind.ktp,
            review: DriverDocumentReview.pending,
            // available:false artinya isinya sudah dihapus server.
            available: false,
            uploadedAt: DateTime.now().subtract(const Duration(hours: 30)),
            expiresAt: DateTime.now().subtract(const Duration(hours: 6)),
          ),
        ];
      await pump(tester, repository);

      expect(find.textContaining('sudah dihapus sesuai kebijakan 24 jam'),
          findsOneWidget);
      // Hitungan mundur TIDAK boleh muncul untuk berkas yang sudah tiada.
      expect(find.textContaining('Dihapus otomatis dalam'), findsNothing);
    });

    testWidgets('kegagalan unggah ditampilkan tanpa membuang state',
        (tester) async {
      final repository = repoWithStatus('RIDE_DRIVER_NOT_ACTIVE')
        ..uploadError = const DriverApiException(
          code: 'DRIVER_DOCUMENT_TOO_LARGE',
          message: 'Ukuran foto melebihi 5 MB.',
          statusCode: 413,
        );
      await pump(tester, repository);

      // Unggahan dipanggil lewat controller supaya jalur galatnya teruji tanpa
      // bergantung pada plugin kamera yang tidak ada di lingkungan uji.
      final container = ProviderScope.containerOf(
        tester.element(find.byType(DriverDocumentsSection)),
      );
      await container
          .read(driverControllerProvider.notifier)
          .uploadDocument(
            kind: DriverDocumentKind.ktp,
            bytes: Uint8List.fromList(const [0x89, 0x50, 0x4e, 0x47]),
            contentType: 'image/png',
          );
      await tester.pumpAndSettle();

      expect(repository.uploadedKinds, isEmpty);
      expect(
        container.read(driverControllerProvider).message,
        contains('5 MB'),
      );
    });

    testWidgets('unggahan berhasil memperbarui daftar dari server',
        (tester) async {
      final repository = repoWithStatus('RIDE_DRIVER_NOT_ACTIVE');
      await pump(tester, repository);

      final container = ProviderScope.containerOf(
        tester.element(find.byType(DriverDocumentsSection)),
      );
      await container.read(driverControllerProvider.notifier).uploadDocument(
            kind: DriverDocumentKind.sim,
            bytes: Uint8List.fromList(const [0xff, 0xd8, 0xff, 0x00, 0x01]),
            contentType: 'image/jpeg',
          );
      await tester.pumpAndSettle();

      expect(repository.uploadedKinds, [DriverDocumentKind.sim]);
      expect(repository.uploadedSizes, [5]);
      final state = container.read(driverControllerProvider);
      expect(state.documentOf(DriverDocumentKind.sim), isNotNull);
      expect(state.documentOf(DriverDocumentKind.sim)!.review,
          DriverDocumentReview.pending);
      expect(state.uploadingDocument, isNull);
    });
  });
}
