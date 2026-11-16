import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tapgo_driver_app/main.dart';

import 'widget_test.dart'
    show
        FakeDriverRepository,
        RecordingLocationPort,
        demoOffer,
        demoRide,
        demoSession,
        pumpDriver,
        pumpDriverOrders,
        tapReachable;

class _ThrowingLocationPort extends RecordingLocationPort {
  _ThrowingLocationPort() : super(available: true);

  @override
  Future<DriverLocationAvailability> checkAvailability() async =>
      throw StateError('plugin lokasi rusak');
}

/// Audit driver_app 17 Nov 2026 (temuan 3 dan 4): tombol tidak boleh berhenti tanpa kabar bila jawaban server tak
/// terbaca (galat selain DriverApiException), dan tautan luar yang gagal dibuka harus diberi tahu.
void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  tearDown(() {
    driverLaunchUrlForTests =
        (uri) => throw StateError('seam uji harus diganti oleh tes');
  });

  final unconfirmed = find.textContaining('belum dapat dipastikan');

  group('galat tak terduga: tombol memberi kabar, bukan diam', () {
    testWidgets('Tolak tawaran', (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        availability: DriverAvailability.online,
        offerItems: [demoOffer],
      )..rejectError = StateError('jawaban server tak terbaca');
      await pumpDriverOrders(tester, repo);
      await tapReachable(
          tester, find.byKey(const ValueKey('offer-RIDE-DEMO-001')));
      await tester.pumpAndSettle();
      await tapReachable(
          tester, find.byKey(const ValueKey('reject-offer-button')));
      await tester.pumpAndSettle();
      expect(repo.rejectCalls, 1);
      expect(unconfirmed, findsWidgets);
      expect(find.textContaining('StateError'), findsNothing);
      expect(find.textContaining('jawaban server tak terbaca'), findsNothing);
    });

    testWidgets('Lanjut perjalanan (selesai): pesan tampil, status tidak berubah',
        (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.inTrip),
        availability: DriverAvailability.busy,
      )..advanceError = StateError('jawaban server tak terbaca');
      await pumpDriverOrders(tester, repo);
      await tapReachable(
          tester, find.byKey(const ValueKey('trip-primary-action')));
      await tester.pumpAndSettle();
      expect(repo.completeCalls, 1);
      expect(unconfirmed, findsWidgets);
      expect(find.textContaining('StateError'), findsNothing);
      // Tombol kembali aktif (isBusy dilepas) sehingga driver dapat mencoba lagi.
      repo.advanceError = null;
      await tapReachable(
          tester, find.byKey(const ValueKey('trip-primary-action')));
      await tester.pumpAndSettle();
      expect(repo.completeCalls, 2);
    });

    testWidgets('Batalkan perjalanan', (tester) async {
      final repo = FakeDriverRepository(
        session: demoSession,
        current: demoRide(RideStatus.driverToPickup),
        availability: DriverAvailability.busy,
      )..cancelError = StateError('jawaban server tak terbaca');
      await pumpDriverOrders(tester, repo);
      await tapReachable(
          tester, find.byKey(const ValueKey('trip-cancel-action')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('cancel-reason-OTHER')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('cancel-confirm')));
      await tester.pumpAndSettle();
      expect(repo.cancelCalls, 1);
      expect(unconfirmed, findsWidgets);
      expect(find.textContaining('StateError'), findsNothing);
    });

    testWidgets('Online: galat tak terduga sebelum permintaan (plugin lokasi)', (tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo, locationPort: _ThrowingLocationPort());
      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      await tester.pumpAndSettle();
      expect(repo.availabilityRequests, isEmpty); // tidak jadi Online
      expect(unconfirmed, findsWidgets);
      expect(find.textContaining('plugin lokasi rusak'), findsNothing);
    });

    testWidgets('Online/Offline (atur ketersediaan)', (tester) async {
      final repo = FakeDriverRepository(session: demoSession)
        ..availabilityError = StateError('jawaban server tak terbaca');
      await pumpDriver(tester, repo,
          locationPort: RecordingLocationPort(available: true));
      await tester.tap(find.byKey(const ValueKey('availability-toggle')));
      await tester.pumpAndSettle();
      expect(repo.availabilityRequests, [DriverAvailability.online]);
      expect(unconfirmed, findsWidgets);
      expect(find.textContaining('StateError'), findsNothing);
    });
  });

  group('tautan luar', () {
    Future<void> openPrivacy(WidgetTester tester) async {
      final repo = FakeDriverRepository(session: demoSession);
      await pumpDriver(tester, repo);
      await tester.tap(find.byIcon(Icons.person_rounded));
      await tester.pumpAndSettle();
      final privacy = find.byKey(const ValueKey('support-privacy-policy'));
      await tester.scrollUntilVisible(privacy, 300,
          scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();
      await tester.tap(privacy);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
    }

    testWidgets('gagal dibuka (false): SnackBar memberi tahu', (tester) async {
      Uri? opened;
      driverLaunchUrlForTests = (uri) async {
        opened = uri;
        return false;
      };
      await openPrivacy(tester);
      expect(opened.toString(), 'https://tapgolion.id/privacy-policy');
      expect(find.textContaining('Tidak dapat membuka tautan'), findsOneWidget);
    });

    testWidgets('galat platform (melempar): SnackBar memberi tahu, tidak ada galat lolos',
        (tester) async {
      driverLaunchUrlForTests = (uri) async => throw StateError('tak ada peramban');
      await openPrivacy(tester);
      expect(find.textContaining('Tidak dapat membuka tautan'), findsOneWidget);
      expect(find.textContaining('tak ada peramban'), findsNothing);
    });

    testWidgets('berhasil dibuka: tidak ada pesan', (tester) async {
      driverLaunchUrlForTests = (uri) async => true;
      await openPrivacy(tester);
      expect(find.textContaining('Tidak dapat membuka tautan'), findsNothing);
    });
  });

  group('penjaga sumber', () {
    test('Socket.IO tidak dipakai lagi (soket tidak ikut pinning TLS dan server mematikan realtime)', () {
      expect(File('pubspec.yaml').readAsStringSync(),
          isNot(contains('socket_io_client')));
      final offenders = <String>[];
      for (final entity in Directory('lib').listSync(recursive: true)) {
        if (entity is File && entity.path.endsWith('.dart')) {
          final text = entity.readAsStringSync();
          if (text.contains('socket_io_client') || text.contains('io_client.')) {
            offenders.add(entity.path);
          }
        }
      }
      expect(offenders, isEmpty);
    });

    test('hanya satu pemanggil launchUrl (pembuka tautan yang menangani kegagalan)', () {
      final callers = <String>[];
      for (final entity in Directory('lib').listSync(recursive: true)) {
        if (entity is File && entity.path.endsWith('.dart')) {
          if (entity.readAsStringSync().contains('launchUrl(')) {
            callers.add(entity.path);
          }
        }
      }
      expect(callers, ['lib/features/driver/presentation/driver_screens.dart']);
    });

    test('jendela peluncuran Android biru tua, bukan putih (terang, gelap, Android 12+)', () {
      const res = 'android/app/src/main/res';
      for (final path in ['$res/drawable/launch_background.xml', '$res/drawable-v21/launch_background.xml']) {
        final xml = File(path).readAsStringSync();
        expect(xml, contains('tapgo_launch_start'), reason: path);
        expect(xml, contains('tapgo_launch_end'), reason: path);
        expect(xml, isNot(contains('@android:color/white')), reason: path);
        expect(xml, isNot(contains('?android:colorBackground')), reason: path);
      }
      final colors = File('$res/values/ic_launcher_background.xml').readAsStringSync();
      expect(colors, contains('name="tapgo_launch_start">#061A2F'));
      expect(colors, contains('name="tapgo_launch_end">#0877E8'));
      for (final path in ['$res/values-v31/styles.xml', '$res/values-night-v31/styles.xml']) {
        final xml = File(path).readAsStringSync();
        expect(xml, contains('windowSplashScreenBackground'), reason: path);
        expect(xml, contains('@color/tapgo_launch_start'), reason: path);
      }
    });
  });
}
