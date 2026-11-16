import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Dua catatan Owner untuk user_app (16 Nov 2026):
///  1. Layar putih dengan lingkaran berputar sebelum splash saat pembukaan pertama. Akar masalah: layar pertama adalah
///     Scaffold putih + CircularProgressIndicator selama penyimpanan aman dibaca (dan jendela peluncuran Android putih),
///     sedangkan splash bermerek baru tampil sesudahnya.
///  2. Pengumuman "selamat datang" untuk pengguna yang baru memasang aplikasi.
class MemoryWelcomeStorage implements TapGoWelcomeStorage {
  MemoryWelcomeStorage({this.state, this.installedAt});

  String? state;
  int? installedAt;
  int writes = 0;

  @override
  Future<String?> readState() async => state;

  @override
  Future<int?> readInstalledAtMillis() async => installedAt;

  @override
  Future<void> writeState(String value, {int? installedAtMillis}) async {
    writes += 1;
    state = value;
    if (installedAtMillis != null) installedAt = installedAtMillis;
  }
}

Map<String, dynamic> serverRow({
  String id = 's1',
  String title = 'Jadwal perawatan',
  bool unread = true,
  String publishedAt = '2026-11-15T14:25:00.000Z',
}) =>
    {
      'id': id,
      'title': title,
      'body': 'Layanan top up berhenti sebentar malam ini.',
      'unread': unread,
      'publishedAt': publishedAt,
    };

Map<String, dynamic> serverFeed(List<Map<String, dynamic>> items) => {
      'items': items,
      'unreadCount': items.where((i) => i['unread'] == true).length,
    };

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoSetHttpAdapterForTests(null);
    tapGoClockForTests = DateTime.now;
    tapGoStartupWorkForTests = null;
    tapGoAnnouncementsLoaderForTests = null;
    tapGoWelcomeStorageForTests = null;
    tapGoDisablePersistenceForTests = false;
  });

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 15; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  group('layar pertama: splash bermerek, bukan halaman putih berputar', () {
    Future<void> pumpApp(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const ProviderScope(child: TapGoUserApp()));
    }

    testWidgets(
        'selama pekerjaan awal belum selesai: frame pertama adalah splash TapGo, tanpa lingkaran berputar di atas putih',
        (tester) async {
      tapGoStartupWorkForTests = Completer<void>().future; // tidak pernah selesai
      await pumpApp(tester);
      await tester.pump();

      expect(find.byKey(const ValueKey('brand_launch_view')), findsOneWidget);
      expect(find.text('TapGo Lion'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing,
          reason: 'dulu: Scaffold putih dengan CircularProgressIndicator');
      // Latarnya gradasi biru tua TapGo, bukan putih.
      final decorated = tester.widget<Container>(
        find.descendant(
          of: find.byKey(const ValueKey('brand_launch_view')),
          matching: find.byType(Container),
        ).first,
      );
      final gradient = (decorated.decoration! as BoxDecoration).gradient!
          as LinearGradient;
      expect(gradient.colors.first, const Color(0xFF061A32));
      expect(gradient.colors.last, const Color(0xFF0569E8));
    });

    testWidgets('pekerjaan awal lambat: cincin kecil muncul hanya setelah 5 detik', (tester) async {
      var now = DateTime(2026, 11, 16, 10);
      tapGoClockForTests = () => now;
      tapGoStartupWorkForTests = Completer<void>().future;
      await pumpApp(tester);
      await tester.pump();
      expect(find.byKey(const ValueKey('brand_launch_slow_loader')), findsNothing);

      now = now.add(const Duration(seconds: 4));
      await tester.pump(const Duration(seconds: 4));
      expect(find.byKey(const ValueKey('brand_launch_slow_loader')), findsNothing);

      now = now.add(const Duration(milliseconds: 1100));
      await tester.pump(const Duration(milliseconds: 1100));
      expect(find.byKey(const ValueKey('brand_launch_slow_loader')), findsOneWidget);
    });

    testWidgets(
        'waktu menunggu penyimpanan tidak ditambahkan lagi di depan splash: masuk ke layar login pada 2,4 dtk sejak layar pertama',
        (tester) async {
      var now = DateTime(2026, 11, 16, 10);
      tapGoClockForTests = () => now;
      final startup = Completer<void>();
      tapGoStartupWorkForTests = startup.future;
      await pumpApp(tester);
      await tester.pump();

      // 0,6 dtk menunggu penyimpanan, lalu selesai.
      now = now.add(const Duration(milliseconds: 600));
      await tester.pump(const Duration(milliseconds: 600));
      startup.complete();
      await tester.pump();
      await tester.pump();
      expect(find.byType(AuthScreen), findsNothing);
      expect(find.byKey(const ValueKey('brand_launch_view')), findsOneWidget);

      // Total 2,3 dtk sejak layar pertama: masih splash.
      now = now.add(const Duration(milliseconds: 1700));
      await tester.pump(const Duration(milliseconds: 1700));
      expect(find.byType(AuthScreen), findsNothing);

      // Total 2,4 dtk: layar login (dulu baru pada 0,6 + 2,4 = 3,0 dtk).
      now = now.add(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump();
      expect(find.byType(AuthScreen), findsOneWidget);
    });

    testWidgets('pekerjaan awal gagal tidak membuat aplikasi tersangkut (selesai dengan galat tetap lanjut)', (tester) async {
      tapGoStartupWorkForTests = Future<void>.error(StateError('Keystore gagal')).catchError((_) {});
      await pumpApp(tester);
      await settle(tester);
      await tester.pump(const Duration(seconds: 3));
      expect(find.byType(AuthScreen), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('peralihan mulus: splash yang menyusul terlihat sudah "tenang" (skala 1) bila jam animasi sudah lewat', (tester) async {
      var now = DateTime(2026, 11, 16, 10);
      tapGoClockForTests = () => now;
      final launchedAt = now;
      now = now.add(const Duration(seconds: 3));
      await tester.pumpWidget(MaterialApp(home: SplashGate(launchedAt: launchedAt)));
      // Frame pertama splash yang menyusul (sebelum peralihan ke layar login).
      final scale = tester
          .widget<ScaleTransition>(
            find.descendant(
              of: find.byKey(const ValueKey('brand_launch_view')),
              // Hanya ScaleTransition milik logo splash (membungkus kolom logo); Scaffold punya yang lain.
              matching: find.byWidgetPredicate((w) => w is ScaleTransition && w.child is Column),
            ),
          )
          .scale
          .value;
      expect(scale, 1.0, reason: 'tanpa lompatan animasi masuk saat menggantikan layar pertama');
      // Waktu tahan sudah habis (jam sudah lewat 2,4 dtk): peralihan ke layar login terjadi segera, tanpa timer tersisa.
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();
      expect(find.byType(AuthScreen), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    });

    testWidgets('SplashGate tanpa launchedAt tetap berperilaku lama: penuh 2,4 dtk lalu layar login', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: SplashGate()));
      await tester.pump(const Duration(milliseconds: 2300));
      expect(find.byType(AuthScreen), findsNothing);
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump();
      expect(find.byType(AuthScreen), findsOneWidget);
    });
  });

  group('ucapan selamat datang untuk instalasi baru', () {
    test('instalasi BARU (belum ada penanda reset) dicatat sebagai pending, lengkap dengan waktu pasang', () async {
      final storage = MemoryWelcomeStorage();
      final now = DateTime(2026, 11, 16, 9, 30);
      await tapGoRecordInstallKind(storage, hadPreviousInstall: false, now: now);
      expect(storage.state, 'pending');
      expect(storage.installedAt, now.millisecondsSinceEpoch);
    });

    test('pengguna LAMA yang hanya memperbarui aplikasi dicatat none: tidak ikut menerima ucapan', () async {
      final storage = MemoryWelcomeStorage();
      await tapGoRecordInstallKind(storage, hadPreviousInstall: true);
      expect(storage.state, 'none');
    });

    test('dicatat sekali saja: pembukaan berikutnya tidak menimpa (pending tetap pending, none tetap none)', () async {
      final fresh = MemoryWelcomeStorage();
      await tapGoRecordInstallKind(fresh, hadPreviousInstall: false);
      await tapGoRecordInstallKind(fresh, hadPreviousInstall: true); // pembukaan kedua: penanda reset sudah ada
      expect(fresh.state, 'pending');
      expect(fresh.writes, 1);

      final upgraded = MemoryWelcomeStorage();
      await tapGoRecordInstallKind(upgraded, hadPreviousInstall: true);
      await tapGoRecordInstallKind(upgraded, hadPreviousInstall: false);
      expect(upgraded.state, 'none');
    });

    test('teks ucapan: singkat, ramah, tanpa tautan, alamat situs, atau surel (aturan yang sama dengan pengumuman server)', () {
      expect(kTapGoWelcomeTitle.length, lessThanOrEqualTo(80));
      expect(kTapGoWelcomeBody.length, lessThanOrEqualTo(1000));
      final text = '$kTapGoWelcomeTitle $kTapGoWelcomeBody';
      expect(text, isNot(matches(RegExp(r'https?:|www\.|@', caseSensitive: false))));
      expect(
        text,
        isNot(matches(RegExp(r'[a-z0-9-]+\.(com|id|net|org|co|io|me|ly|xyz)\b', caseSensitive: false))),
      );
      expect(kTapGoWelcomeBody, contains('\n\n'), reason: 'dipisah per paragraf');
      expect(kTapGoWelcomeTitle, contains('Selamat datang'));
    });

    testWidgets('daftar: ucapan baru berada PALING ATAS dan dihitung sebagai belum dibaca', (tester) async {
      tapGoWelcomeStorageForTests = MemoryWelcomeStorage(state: 'pending', installedAt: DateTime(2026, 11, 16).millisecondsSinceEpoch);
      tapGoAnnouncementsLoaderForTests = () async => serverFeed([serverRow()]);
      tapGoSetHttpAdapterForTests(FakeApi({}));
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final feed = await _loadFeed(container);
      expect(feed.items.first.isWelcome, isTrue);
      expect(feed.items.first.unread, isTrue);
      expect(feed.items.map((i) => i.title), [kTapGoWelcomeTitle, 'Jadwal perawatan']);
      expect(feed.unreadCount, 2);
    });

    testWidgets('instalasi baru tanpa pengumuman server: ucapan menjadi satu-satunya isi dan tetap tampil', (tester) async {
      tapGoWelcomeStorageForTests = MemoryWelcomeStorage(state: 'pending');
      tapGoAnnouncementsLoaderForTests = () async => serverFeed([]);
      final feed = await _loadFeed(ProviderContainer());
      expect(feed.items.single.isWelcome, isTrue);
      expect(feed.unreadCount, 1);
    });

    testWidgets('sudah dibaca: tetap ada di daftar menurut waktu (di bawah yang lebih baru, di atas yang lebih lama), tidak dihitung belum dibaca', (tester) async {
      tapGoWelcomeStorageForTests = MemoryWelcomeStorage(
        state: 'read',
        installedAt: DateTime.utc(2026, 11, 10).millisecondsSinceEpoch,
      );
      tapGoAnnouncementsLoaderForTests = () async => serverFeed([
            serverRow(id: 'baru', title: 'Baru', unread: false, publishedAt: '2026-11-15T10:00:00Z'),
            serverRow(id: 'lama', title: 'Lama', unread: false, publishedAt: '2026-11-01T10:00:00Z'),
          ]);
      final feed = await _loadFeed(ProviderContainer());
      expect(feed.items.map((i) => i.title), ['Baru', kTapGoWelcomeTitle, 'Lama']);
      expect(feed.unreadCount, 0);
    });

    testWidgets('pengguna lama (none) atau tanpa penyimpanan: TIDAK ada ucapan', (tester) async {
      tapGoAnnouncementsLoaderForTests = () async => serverFeed([serverRow()]);
      tapGoWelcomeStorageForTests = MemoryWelcomeStorage(state: 'none');
      expect((await _loadFeed(ProviderContainer())).items.map((i) => i.title), ['Jadwal perawatan']);
      tapGoWelcomeStorageForTests = MemoryWelcomeStorage(); // belum dicatat
      expect((await _loadFeed(ProviderContainer())).items.any((i) => i.isWelcome), isFalse);
      tapGoWelcomeStorageForTests = null; // uji tanpa persistensi
      expect((await _loadFeed(ProviderContainer())).items.any((i) => i.isWelcome), isFalse);
    });

    Future<void> pumpScreen(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            tapGoSessionProviderForTest.overrideWith(
              (ref) => DemoClientSession.initial().copyWith(accessToken: 'token-uji', isDemoMode: false),
            ),
          ],
          child: MaterialApp(theme: tapGoReadableTheme(), home: const AnnouncementsScreen()),
        ),
      );
      await settle(tester);
    }

    testWidgets('membuka layar pengumuman: ucapan tampil lengkap dengan "Baru", lalu ditandai sudah dibaca (hanya lokal)', (tester) async {
      final storage = MemoryWelcomeStorage(state: 'pending');
      tapGoWelcomeStorageForTests = storage;
      tapGoAnnouncementsLoaderForTests = () async => serverFeed([]);
      final api = FakeApi({});
      tapGoSetHttpAdapterForTests(api);
      await pumpScreen(tester);

      expect(find.text(kTapGoWelcomeTitle), findsOneWidget);
      expect(find.text(kTapGoWelcomeBody), findsOneWidget);
      expect(find.byKey(const ValueKey('announcement_new_$kTapGoWelcomeAnnouncementId')), findsOneWidget);
      expect(storage.state, 'read', reason: 'dibuka = dibaca');
      expect(api.callsTo('POST /announcements/seen'), isEmpty,
          reason: 'ucapan hanya lokal: server tidak perlu diberi tahu bila tidak ada pengumuman server yang belum dibaca');
    });

    testWidgets('ada pengumuman server DAN ucapan baru: keduanya ditandai, server dipanggil tepat sekali', (tester) async {
      final storage = MemoryWelcomeStorage(state: 'pending');
      tapGoWelcomeStorageForTests = storage;
      tapGoAnnouncementsLoaderForTests = () async => serverFeed([serverRow()]);
      final api = FakeApi({'POST /announcements/seen': (_) => FakeReply(204, {})});
      tapGoSetHttpAdapterForTests(api);
      await pumpScreen(tester);

      expect(find.text(kTapGoWelcomeTitle), findsOneWidget);
      expect(find.text('Jadwal perawatan'), findsOneWidget);
      expect(storage.state, 'read');
      expect(api.callsTo('POST /announcements/seen').length, 1);
    });

    testWidgets('ucapan yang sudah dibaca tidak ditandai lagi (tanpa tulis berulang)', (tester) async {
      final storage = MemoryWelcomeStorage(state: 'read', installedAt: DateTime(2026, 11, 10).millisecondsSinceEpoch);
      tapGoWelcomeStorageForTests = storage;
      tapGoAnnouncementsLoaderForTests = () async => serverFeed([serverRow(unread: false)]);
      tapGoSetHttpAdapterForTests(FakeApi({}));
      await pumpScreen(tester);
      expect(find.text(kTapGoWelcomeTitle), findsOneWidget);
      expect(find.byKey(const ValueKey('announcement_new_$kTapGoWelcomeAnnouncementId')), findsNothing);
      expect(storage.writes, 0);
    });

    testWidgets('titik merah di bel untuk instalasi baru walau belum ada pengumuman server, dan hilang setelah dibuka', (tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      tapGoWelcomeStorageForTests = MemoryWelcomeStorage(state: 'pending');
      tapGoAnnouncementsLoaderForTests = () async => serverFeed([]);
      tapGoSetHttpAdapterForTests(FakeApi({}));
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(theme: tapGoReadableTheme(brightness: Brightness.light), home: const TapGoDashboard()),
        ),
      );
      await settle(tester);
      tester.takeException();

      expect(find.byKey(const ValueKey('bell_unread_dot')), findsOneWidget);
      expect(find.byTooltip('Pengumuman, 1 baru'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('bell_button')));
      await settle(tester);
      expect(find.text(kTapGoWelcomeTitle), findsOneWidget);
    });
  });
}

Future<TapGoAnnouncementFeed> _loadFeed(ProviderContainer container) =>
    tapGoLoadAnnouncementsForTests();
