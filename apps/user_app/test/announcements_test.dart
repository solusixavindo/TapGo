import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/demo/client_flow_models.dart';
import 'package:tapgo_user_app/main.dart';

import 'support/fake_api.dart';

/// Pengumuman pemilik di ikon bel (permintaan Owner 15 Nov 2026): daftar di layar, titik merah di bel,
/// penandaan "sudah dibuka", dan teks polos tanpa tautan yang dapat diketuk.
Map<String, dynamic> row({
  String id = 'a1',
  String title = 'Jadwal perawatan',
  String body = 'Layanan top up berhenti sebentar malam ini pukul 23.00 WIB.',
  bool unread = true,
  String publishedAt = '2026-11-15T14:25:00.000Z',
}) =>
    {
      'id': id,
      'title': title,
      'body': body,
      'unread': unread,
      'publishedAt': publishedAt,
    };

Map<String, dynamic> feed(List<Map<String, dynamic>> items, {int? unread}) => {
      'items': items,
      'unreadCount': unread ?? items.where((i) => i['unread'] == true).length,
    };

bool hasRecognizer(InlineSpan span) {
  if (span is TextSpan) {
    if (span.recognizer != null) return true;
    return (span.children ?? const []).any(hasRecognizer);
  }
  return false;
}

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() {
    tapGoAnnouncementsLoaderForTests = null;
    tapGoSetHttpAdapterForTests(null);
    tapGoDisablePersistenceForTests = false;
  });

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 15; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> pumpScreen(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          tapGoSessionProviderForTest.overrideWith(
            (ref) => DemoClientSession.initial().copyWith(
              accessToken: 'token-uji',
              isDemoMode: false,
            ),
          ),
        ],
        child: MaterialApp(
          theme: tapGoReadableTheme(),
          home: const AnnouncementsScreen(),
        ),
      ),
    );
    await settle(tester);
  }

  group('model', () {
    test('item cacat dilewati, yang benar tetap terbaca', () {
      final parsed = TapGoAnnouncementFeed.parse({
        'items': [
          row(id: 'ok'),
          {'id': '', 'title': 'x', 'body': 'y'},
          {'id': 'tanpa-judul', 'title': '  ', 'body': 'isi'},
          {'id': 'tanpa-isi', 'title': 'judul', 'body': ''},
          'bukan-peta',
          null,
        ],
        'unreadCount': 1,
      });
      expect(parsed.items.map((i) => i.id), ['ok']);
      expect(parsed.unreadCount, 1);
    });

    test('jawaban kosong atau rusak tidak melempar', () {
      expect(TapGoAnnouncementFeed.parse({}).items, isEmpty);
      expect(TapGoAnnouncementFeed.parse({'items': 'rusak'}).items, isEmpty);
      expect(TapGoAnnouncementFeed.parse({'unreadCount': -4}).unreadCount, 0);
    });

    test('jumlah belum dibaca dihitung dari item bila server tidak mengirimnya',
        () {
      final parsed = TapGoAnnouncementFeed.parse({
        'items': [row(id: 'a'), row(id: 'b', unread: false)],
      });
      expect(parsed.unreadCount, 1);
    });

    test('label tanggal berbahasa Indonesia', () {
      expect(tapGoAnnouncementDateLabel(DateTime(2026, 11, 15, 21, 5)),
          '15 Nov 2026, 21.05');
      expect(tapGoAnnouncementDateLabel(DateTime(2026, 5, 1, 9, 30)),
          '1 Mei 2026, 09.30');
      expect(tapGoAnnouncementDateLabel(null), '');
    });
  });

  group('layar pengumuman', () {
    testWidgets('menampilkan daftar; "Baru" hanya pada yang belum dibaca',
        (tester) async {
      tapGoAnnouncementsLoaderForTests = () async => feed([
            row(id: 'baru', title: 'Pengumuman baru'),
            row(id: 'lama', title: 'Pengumuman lama', unread: false),
          ]);
      tapGoSetHttpAdapterForTests(FakeApi({
        'POST /announcements/seen': (_) => FakeReply(204, {}),
      }));
      await pumpScreen(tester);

      expect(find.text('Pengumuman baru'), findsOneWidget);
      expect(find.text('Pengumuman lama'), findsOneWidget);
      expect(
          find.byKey(const ValueKey('announcement_new_baru')), findsOneWidget);
      expect(find.byKey(const ValueKey('announcement_new_lama')), findsNothing);
      expect(find.text('Baru'), findsOneWidget);
    });

    testWidgets('membuka layar menandai sudah dibuka tepat satu kali',
        (tester) async {
      tapGoAnnouncementsLoaderForTests = () async => feed([row()]);
      final api = FakeApi({
        'POST /announcements/seen': (_) => FakeReply(204, {}),
      });
      tapGoSetHttpAdapterForTests(api);
      await pumpScreen(tester);

      expect(api.callsTo('POST /announcements/seen').length, 1);
      // Penanda di layar tetap tampil selama layar terbuka.
      expect(find.text('Baru'), findsOneWidget);
    });

    testWidgets('tanpa yang belum dibaca tidak ada panggilan penandaan',
        (tester) async {
      tapGoAnnouncementsLoaderForTests = () async => feed([row(unread: false)]);
      final api = FakeApi({});
      tapGoSetHttpAdapterForTests(api);
      await pumpScreen(tester);

      expect(api.callsTo('POST /announcements/seen'), isEmpty);
      expect(find.text('Baru'), findsNothing);
    });

    testWidgets('gagal menandai tidak merusak layar', (tester) async {
      tapGoAnnouncementsLoaderForTests = () async => feed([row()]);
      tapGoSetHttpAdapterForTests(FakeApi({
        'POST /announcements/seen': (_) => FakeReply.error(500, 'SERVER_ERROR'),
      }));
      await pumpScreen(tester);

      expect(find.text('Jadwal perawatan'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('kosong: pesan ramah, bukan layar hampa', (tester) async {
      tapGoAnnouncementsLoaderForTests = () async => feed([]);
      tapGoSetHttpAdapterForTests(FakeApi({}));
      await pumpScreen(tester);

      expect(find.byKey(const ValueKey('announcements_empty')), findsOneWidget);
      expect(find.text('Belum ada pengumuman'), findsOneWidget);
    });

    testWidgets('gagal dimuat: tampil pesan dan tombol coba lagi berfungsi',
        (tester) async {
      var attempts = 0;
      tapGoAnnouncementsLoaderForTests = () async {
        attempts += 1;
        if (attempts == 1) throw StateError('jaringan putus');
        return feed([row(title: 'Berhasil dimuat', unread: false)]);
      };
      tapGoSetHttpAdapterForTests(FakeApi({}));
      await pumpScreen(tester);

      expect(find.text('Pengumuman belum dapat dimuat'), findsOneWidget);
      expect(find.text('Berhasil dimuat'), findsNothing);

      await tester.tap(find.text('Muat Ulang'));
      await settle(tester);
      expect(find.text('Berhasil dimuat'), findsOneWidget);
      expect(attempts, 2);
    });

    testWidgets(
        'isi selalu teks polos: tidak ada SelectableText atau tautan yang dapat diketuk, '
        'walau isi memuat alamat', (tester) async {
      tapGoAnnouncementsLoaderForTests = () async => feed([
            row(
              body:
                  'Buka https://contoh.test/promo atau www.contoh.test sekarang',
              unread: false,
            ),
          ]);
      tapGoSetHttpAdapterForTests(FakeApi({}));
      await pumpScreen(tester);

      expect(find.textContaining('https://contoh.test/promo'), findsOneWidget);
      expect(find.byType(SelectableText), findsNothing);
      final list = find.byKey(const ValueKey('announcements_list'));
      for (final rich in tester.widgetList<RichText>(
          find.descendant(of: list, matching: find.byType(RichText)))) {
        expect(hasRecognizer(rich.text), isFalse,
            reason: 'teks pengumuman tidak boleh dapat diketuk');
      }
      expect(find.descendant(of: list, matching: find.byType(InkWell)),
          findsNothing);
    });

    testWidgets('judul dan isi panjang tidak meluap (tanpa galat tata letak)',
        (tester) async {
      tapGoAnnouncementsLoaderForTests = () async => feed([
            row(
              title: 'J' * 80,
              body: List.filled(40, 'Kalimat pengumuman yang cukup panjang.')
                  .join(' '),
              unread: false,
            ),
          ]);
      tapGoSetHttpAdapterForTests(FakeApi({}));
      await pumpScreen(tester);
      expect(tester.takeException(), isNull);
    });
  });

  group('ikon bel di beranda', () {
    Future<void> pumpDashboard(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: tapGoReadableTheme(brightness: Brightness.light),
            home: const TapGoDashboard(),
          ),
        ),
      );
      await settle(tester);
      tester.takeException();
    }

    testWidgets('ada yang belum dibaca: titik merah dan keterangan jumlah',
        (tester) async {
      tapGoAnnouncementsLoaderForTests =
          () async => feed([row(id: 'a'), row(id: 'b')]);
      tapGoSetHttpAdapterForTests(FakeApi({}));
      await pumpDashboard(tester);

      expect(find.byKey(const ValueKey('bell_unread_dot')), findsOneWidget);
      expect(find.byTooltip('Pengumuman, 2 baru'), findsOneWidget);
    });

    testWidgets('semua sudah dibaca: tanpa titik merah', (tester) async {
      tapGoAnnouncementsLoaderForTests = () async => feed([row(unread: false)]);
      tapGoSetHttpAdapterForTests(FakeApi({}));
      await pumpDashboard(tester);

      expect(find.byKey(const ValueKey('bell_unread_dot')), findsNothing);
      expect(find.byTooltip('Pengumuman'), findsOneWidget);
    });

    testWidgets('pengumuman gagal dimuat: bel tetap normal, tanpa galat',
        (tester) async {
      tapGoAnnouncementsLoaderForTests = () async => throw StateError('mati');
      tapGoSetHttpAdapterForTests(FakeApi({}));
      await pumpDashboard(tester);

      expect(find.byKey(const ValueKey('bell_button')), findsOneWidget);
      expect(find.byKey(const ValueKey('bell_unread_dot')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets(
        'mengetuk bel membuka layar pengumuman, bukan pesan "belum dapat dibuka"',
        (tester) async {
      tapGoAnnouncementsLoaderForTests = () async => feed([row()]);
      tapGoSetHttpAdapterForTests(FakeApi({
        'POST /announcements/seen': (_) => FakeReply(204, {}),
      }));
      await pumpDashboard(tester);

      await tester.tap(find.byKey(const ValueKey('bell_button')));
      await settle(tester);

      expect(find.text('Kabar terbaru dari TapGo'), findsOneWidget);
      expect(find.text('Jadwal perawatan'), findsOneWidget);
      expect(find.text('Notifikasi belum dapat dibuka saat ini'), findsNothing);
    });
  });
}
