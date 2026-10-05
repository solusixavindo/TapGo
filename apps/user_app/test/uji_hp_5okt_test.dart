import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Temuan uji HP 5 Okt 2026 (user_app +36): bunyi notifikasi, popup chat,
/// sinyal penolakan, pencarian terdekat, tempat cepat yang bisa dihapus, dan
/// penilaian setelah perjalanan selesai.

const _ref = 'RID-A2B3C4D5E6';

Map<String, dynamic> orderJson({
  String status = 'COMPLETED',
  String reference = _ref,
  int? rejections,
  Map<String, dynamic>? rating,
  bool withRatingKey = false,
  String dropoff = 'Stasiun Serang, Serang',
  bool withDriver = true,
}) =>
    {
      'reference': reference,
      'serviceType': 'MOTORCYCLE',
      'status': status,
      'isFinal': status == 'COMPLETED' || status.startsWith('CANCELLED'),
      'pickupAddress': 'Jl. Melati 1, Serang',
      'dropoffAddress': dropoff,
      'pickup': {'lat': -6.11, 'lng': 106.15},
      'dropoff': {'lat': -6.12, 'lng': 106.16},
      'distanceMeters': 4200,
      'durationSeconds': 900,
      'fare': {'totalFare': 18500, 'currency': 'IDR'},
      'payment': {'method': 'CASH', 'state': 'PAID'},
      'cancellation': null,
      'driver': withDriver ? {'displayName': 'Budi'} : null,
      'vehicle': withDriver
          ? {
              'serviceType': 'MOTORCYCLE',
              'model': 'Vario 160',
              'color': 'Hitam',
              'maskedPlate': 'B 12•• XYZ',
            }
          : null,
      'createdAt': '2026-10-05T10:05:00Z',
      if (rejections != null) 'searchRejectionCount': rejections,
      if (withRatingKey || rating != null) 'rating': rating,
    };

Future<void> tapKey(WidgetTester tester, String key) async {
  final finder = find.byKey(ValueKey(key));
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
}

void tall(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2800);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

Widget appWith(Widget child) => ProviderScope(
      child: MaterialApp(
        navigatorKey: tapGoNavigatorKeyForTests,
        scaffoldMessengerKey: tapGoScaffoldMessengerKeyForTests,
        home: child,
      ),
    );

class _FakePlatform implements TapGoPushPlatform {
  final foreground = StreamController<TapGoPushMessage>.broadcast();
  final alerts = <TapGoPushMessage>[];

  @override
  Future<String?> obtainToken() async => 'tok';
  @override
  Stream<String> get tokenRefreshes => const Stream.empty();
  @override
  Stream<TapGoPushMessage> get foregroundMessages => foreground.stream;
  @override
  Stream<TapGoPushMessage> get openedMessages => const Stream.empty();
  @override
  Future<TapGoPushMessage?> initialMessage() async => null;
  @override
  Future<void> deleteToken() async {}
  @override
  Future<void> showForegroundAlert(TapGoPushMessage message) async =>
      alerts.add(message);
}

const _chatPush = TapGoPushMessage(
  title: 'Pesan baru dari driver',
  body: 'Ketuk untuk membaca.',
  data: {'type': 'chat_message', 'rideReference': _ref},
);

DioException apiError(String code, {int status = 409}) {
  final request = RequestOptions(path: '/rides/$_ref/rating');
  return DioException(
    requestOptions: request,
    type: DioExceptionType.badResponse,
    response: Response<Map<String, dynamic>>(
      requestOptions: request,
      statusCode: status,
      data: {'success': false, 'code': code},
    ),
  );
}

// ---------------------------------------------------------------------------
// Pencarian Nominatim: fake Dio
// ---------------------------------------------------------------------------

class _NominatimAdapter implements HttpClientAdapter {
  _NominatimAdapter(this.respond);

  /// (indeks permintaan, parameter) -> baris hasil.
  final List<Map<String, String>> Function(int index, Map<String, dynamic> q)
      respond;
  final requests = <Map<String, dynamic>>[];
  final times = <DateTime>[];
  final userAgents = <String?>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(Map<String, dynamic>.of(options.queryParameters));
    times.add(DateTime.now());
    userAgents.add(options.headers['User-Agent']?.toString());
    final rows = respond(requests.length - 1, options.queryParameters);
    return ResponseBody.fromString(
      jsonEncode(rows),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Map<String, String> row(double lat, double lng, String name) => {
      'lat': '$lat',
      'lon': '$lng',
      'display_name': '$name, Kota Uji, Indonesia',
    };

/// Lebar kotak (lng) dan pusatnya dari parameter `viewbox` (left,top,right,bottom).
({double widthLng, double heightLat, double centerLat, double centerLng}) box(
    Map<String, dynamic> q) {
  final parts = '${q['viewbox']}'.split(',').map(double.parse).toList();
  return (
    widthLng: parts[2] - parts[0],
    heightLat: parts[1] - parts[3],
    centerLat: (parts[1] + parts[3]) / 2,
    centerLng: (parts[0] + parts[2]) / 2,
  );
}

class _FakePort implements LocationSelectionPort {
  _FakePort({this.last, this.current});

  RideLocation? last;
  RideLocation? current;
  final searches = <({String query, RideLocation? near})>[];
  List<RideAddressCandidate> results = const [];

  @override
  RideLocationProviderStatus get status => RideLocationProviderStatus.ready;
  @override
  Future<List<RideAddressCandidate>> searchAddress(String query,
      {RideLocation? near}) async {
    searches.add((query: query, near: near));
    return results;
  }

  @override
  Future<String?> reverseAddress(double lat, double lng) async => 'Alamat uji';
  @override
  Future<RideLocation?> currentLocation() async => current;
  @override
  Future<RideLocation?> lastKnownLocation() async => last;
}

void main() {
  setUp(() async {
    tapGoDisablePersistenceForTests = true;
    await tapGoResetSavedPlacesForTests();
    tapGoResetPushUiForTests();
    tapGoRecentHistoryLoaderForTests = null;
  });
  tearDown(() {
    tapGoDisablePersistenceForTests = false;
    tapGoRecentHistoryLoaderForTests = null;
    tapGoResetPushUiForTests();
  });

  // =========================================================================
  group('1. bunyi notifikasi saat aplikasi terbuka', () {
    test('push latar depan juga dibunyikan lewat notifikasi sistem', () async {
      final platform = _FakePlatform();
      final shown = <TapGoPushMessage>[];
      final controller = TapGoPushController(
        platform: platform,
        register: (_) async {},
        unregister: (_) async {},
        onForeground: shown.add,
        onOpened: (_) {},
      );
      await controller.start();
      platform.foreground.add(const TapGoPushMessage(
        title: 'Driver ditemukan',
        body: 'Driver menuju titik jemput.',
        data: {'type': 'ride_status', 'rideReference': _ref},
      ));
      await Future<void>.delayed(Duration.zero);
      expect(shown, hasLength(1));
      expect(platform.alerts, hasLength(1));
      expect(platform.alerts.single.title, 'Driver ditemukan');
      await controller.stop();
    });

    test('bunyi otomatis push: chat TIDAK termasuk (satu pintu lewat peringatan chat); jenis lain ya',
        () async {
      expect(tapGoShouldAlertForeground(_chatPush), isFalse);
      expect(
          tapGoShouldAlertForeground(const TapGoPushMessage(
            title: 't',
            body: 'b',
            data: {'type': 'ride_status', 'rideReference': _ref},
          )),
          isTrue);
    });

    test('controller memakai shouldAlert: chat yang layarnya terbuka senyap',
        () async {
      final platform = _FakePlatform();
      tapGoOpenChatReference = _ref;
      final controller = TapGoPushController(
        platform: platform,
        register: (_) async {},
        unregister: (_) async {},
        onForeground: (_) {},
        onOpened: (_) {},
        shouldAlert: tapGoShouldAlertForeground,
      );
      await controller.start();
      platform.foreground.add(_chatPush);
      await Future<void>.delayed(Duration.zero);
      expect(platform.alerts, isEmpty);
      await controller.stop();
    });
  });

  // =========================================================================
  group('2. popup saat pesan chat masuk', () {
    testWidgets(
        'layar chat tidak terbuka: popup muncul, tanpa isi pesan, dengan tombol Buka chat',
        (tester) async {
      await tester.pumpWidget(appWith(const Scaffold(body: Text('beranda'))));
      tapGoShowForegroundPushForTests(_chatPush);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
      expect(find.text('Pesan baru dari driver'), findsOneWidget);
      expect(find.byKey(const ValueKey('chat-popup-open')), findsOneWidget);
      expect(find.text('Buka chat'), findsOneWidget);
      // Popup bukan SnackBar.
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('Buka chat membuka layar chat perjalanan itu', (tester) async {
      await tester.pumpWidget(appWith(const Scaffold(body: Text('beranda'))));
      tapGoShowForegroundPushForTests(_chatPush);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('chat-popup-open')));
      await tester.pumpAndSettle();
      expect(find.byType(RideChatScreen), findsOneWidget);
      expect(tapGoOpenChatReference, _ref);
    });

    testWidgets('Nanti menutup popup tanpa membuka chat', (tester) async {
      await tester.pumpWidget(appWith(const Scaffold(body: Text('beranda'))));
      tapGoShowForegroundPushForTests(_chatPush);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('chat-popup-later')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('chat-popup')), findsNothing);
      expect(find.byType(RideChatScreen), findsNothing);
    });

    testWidgets('layar chat perjalanan itu sedang terbuka: tidak ada popup',
        (tester) async {
      await tester.pumpWidget(appWith(const RideChatScreen(rideReference: _ref)));
      await tester.pump();
      expect(tapGoOpenChatReference, _ref);

      tapGoShowForegroundPushForTests(_chatPush);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('chat-popup')), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.byType(SnackBar), findsNothing);

      // Setelah layar ditutup, popup berlaku lagi.
      await tester.pumpWidget(appWith(const Scaffold(body: Text('beranda'))));
      await tester.pump();
      expect(tapGoOpenChatReference, isNull);
      tapGoShowForegroundPushForTests(_chatPush);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
    });

    testWidgets('pesan beruntun untuk perjalanan yang sama tidak menumpuk popup',
        (tester) async {
      await tester.pumpWidget(appWith(const Scaffold(body: Text('beranda'))));
      tapGoShowForegroundPushForTests(_chatPush);
      tapGoShowForegroundPushForTests(_chatPush);
      tapGoShowForegroundPushForTests(_chatPush);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('chat-popup')), findsOneWidget);
    });

    testWidgets(
        'ketukan notifikasi "pencarian dilanjutkan" mencatat referensi dan membuka layar status',
        (tester) async {
      await tester.pumpWidget(appWith(const Scaffold(body: Text('beranda'))));
      tapGoOpenFromPushForTests(const TapGoPushMessage(
        title: 'Masih mencari driver',
        body: 'x',
        data: {'type': 'ride_search_continues', 'rideReference': _ref},
      ));
      expect(tapGoSearchContinuesRefs.value, contains(_ref));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.byType(RideStatusScreen), findsOneWidget);
      // Hentikan polling layar status sebelum tes selesai.
      await tester.pumpWidget(const SizedBox());
    });
  });

  // =========================================================================
  group('4. layar penumpang saat driver menolak', () {
    Widget status({required int rejections, String st = 'SEARCHING_DRIVER'}) =>
        appWith(RideStatusScreen(
          reference: _ref,
          autoStart: false,
          initialOrder: RideOrderView.fromJson(
              orderJson(status: st, rejections: rejections, withDriver: false)),
        ));

    testWidgets('hitungan 0: tidak ada pemberitahuan', (tester) async {
      tall(tester);
      await tester.pumpWidget(status(rejections: 0));
      await tester.pump();
      expect(find.byKey(const ValueKey('search-continues-notice')),
          findsNothing);
    });

    testWidgets(
        'hitungan 1: pemberitahuan jelas di kartu mencari; status tetap Mencari driver',
        (tester) async {
      tall(tester);
      await tester.pumpWidget(status(rejections: 1));
      await tester.pump();
      expect(find.byKey(const ValueKey('search-continues-notice')),
          findsOneWidget);
      expect(
          find.text('Seorang driver tidak mengambil pesanan. Pencarian dilanjutkan.'),
          findsOneWidget);
      expect(find.text('Mencari driver'), findsOneWidget);
      expect(find.textContaining('Dibatalkan'), findsNothing);
    });

    testWidgets('hitungan 3: menyebut jumlah, tanpa identitas driver',
        (tester) async {
      tall(tester);
      await tester.pumpWidget(status(rejections: 3));
      await tester.pump();
      expect(find.text('3 driver tidak mengambil pesanan. Pencarian dilanjutkan.'),
          findsOneWidget);
    });

    testWidgets('polling: hitungan naik dari 0 ke 1 memunculkan pemberitahuan tanpa push',
        (tester) async {
      tall(tester);
      var calls = 0;
      await tester.pumpWidget(appWith(RideStatusScreen(
        reference: _ref,
        pollInterval: const Duration(seconds: 4),
        detailRequest: (_) async {
          calls += 1;
          return orderJson(
              status: 'SEARCHING_DRIVER',
              rejections: calls >= 2 ? 1 : 0,
              withDriver: false);
        },
      )));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.byKey(const ValueKey('search-continues-notice')),
          findsNothing);

      await tester.pump(const Duration(seconds: 4));
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.byKey(const ValueKey('search-continues-notice')),
          findsOneWidget);
      expect(find.text('Mencari driver'), findsOneWidget);
      // Hentikan polling sebelum tes selesai.
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('push di depan mengisi catatan yang sama (cadangan saat hitungan belum naik)',
        (tester) async {
      tall(tester);
      await tester.pumpWidget(status(rejections: 0));
      await tester.pump();
      tapGoShowForegroundPushForTests(const TapGoPushMessage(
        title: 'Masih mencari driver',
        body: 'x',
        data: {'type': 'ride_search_continues', 'rideReference': _ref},
      ));
      await tester.pump();
      expect(find.byKey(const ValueKey('search-continues-notice')),
          findsOneWidget);
    });

    test('hitungan dari server diurai; server lama tanpa field = 0', () {
      expect(
          RideOrderView.fromJson(orderJson(rejections: 2)).searchRejectionCount,
          2);
      expect(RideOrderView.fromJson(orderJson()).searchRejectionCount, 0);
    });
  });

  // =========================================================================
  group('7. penilaian setelah perjalanan selesai', () {
    Widget completed({
      RideRatingRequest? request,
      Map<String, dynamic>? rating,
      String st = 'COMPLETED',
      RideDetailRequest? detail,
    }) =>
        appWith(RideStatusScreen(
          reference: _ref,
          autoStart: false,
          ratingRequest: request,
          detailRequest: detail,
          initialOrder: RideOrderView.fromJson(
              orderJson(status: st, rating: rating, withRatingKey: true)),
        ));

    testWidgets('selesai: bintang 1-5, catatan opsional, kirim; tombol nonaktif tanpa bintang',
        (tester) async {
      tall(tester);
      await tester.pumpWidget(completed(request: ({
        required String reference,
        required int stars,
        String? note,
      }) async =>
          {'stars': stars, 'note': note}));
      await tester.pump();

      expect(find.byKey(const ValueKey('rating-form')), findsOneWidget);
      for (var star = 1; star <= 5; star++) {
        expect(find.byKey(ValueKey('rating-star-$star')), findsOneWidget);
      }
      expect(find.byKey(const ValueKey('rating-note')), findsOneWidget);
      final submit = tester
          .widget<FilledButton>(find.byKey(const ValueKey('rating-submit')));
      expect(submit.onPressed, isNull);
      // "Kembali ke Dashboard" tetap ada, di bawah langkah penilaian.
      expect(find.text('Kembali ke Dashboard'), findsOneWidget);
    });

    testWidgets('memilih 4 bintang + catatan lalu kirim: request benar, lalu tampil bintang tersimpan',
        (tester) async {
      tall(tester);
      final calls = <({String reference, int stars, String? note})>[];
      await tester.pumpWidget(completed(request: ({
        required String reference,
        required int stars,
        String? note,
      }) async {
        calls.add((reference: reference, stars: stars, note: note));
        return {'stars': stars, 'note': note?.trim()};
      }));
      await tester.pump();

      await tapKey(tester, 'rating-star-4');
      await tester.pump();
      await tester.enterText(
          find.byKey(const ValueKey('rating-note')), 'Ramah dan tepat waktu');
      await tapKey(tester, 'rating-submit');
      await tester.pumpAndSettle();

      expect(calls, hasLength(1));
      expect(calls.single.reference, _ref);
      expect(calls.single.stars, 4);
      expect(calls.single.note, 'Ramah dan tepat waktu');
      expect(find.byKey(const ValueKey('rating-form')), findsNothing);
      expect(find.byKey(const ValueKey('rating-given')), findsOneWidget);
      expect(find.text('Ramah dan tepat waktu'), findsOneWidget);
      expect(find.byIcon(Icons.star_rounded), findsNWidgets(4));
    });

    testWidgets('sudah dinilai dari server: hanya bintang yang tampil, tanpa formulir',
        (tester) async {
      tall(tester);
      await tester.pumpWidget(
          completed(rating: {'stars': 5, 'note': 'Mantap'}));
      await tester.pump();
      expect(find.byKey(const ValueKey('rating-given')), findsOneWidget);
      expect(find.byKey(const ValueKey('rating-form')), findsNothing);
      expect(find.byKey(const ValueKey('rating-submit')), findsNothing);
      expect(find.byIcon(Icons.star_rounded), findsNWidgets(5));
    });

    testWidgets('kirim ganda cepat hanya mengirim satu permintaan (single-flight)',
        (tester) async {
      tall(tester);
      var calls = 0;
      final gate = Completer<Map<String, dynamic>>();
      await tester.pumpWidget(completed(request: ({
        required String reference,
        required int stars,
        String? note,
      }) {
        calls += 1;
        return gate.future;
      }));
      await tester.pump();
      await tapKey(tester, 'rating-star-5');
      await tester.pump();
      await tapKey(tester, 'rating-submit');
      await tester.pump();
      await tapKey(tester, 'rating-submit');
      await tester.pump();
      expect(calls, 1);
      gate.complete({'stars': 5});
      await tester.pumpAndSettle();
      expect(calls, 1);
    });

    testWidgets('gagal (rute belum ada di server): pesan jelas, formulir tetap dan bisa dicoba lagi',
        (tester) async {
      tall(tester);
      await tester.pumpWidget(completed(request: ({
        required String reference,
        required int stars,
        String? note,
      }) async =>
          throw apiError('ROUTE_NOT_FOUND', status: 404)));
      await tester.pump();
      await tapKey(tester, 'rating-star-3');
      await tester.pump();
      await tapKey(tester, 'rating-submit');
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('rating-error')), findsOneWidget);
      expect(find.textContaining('belum tersedia'), findsOneWidget);
      expect(find.byKey(const ValueKey('rating-form')), findsOneWidget);
      final submit = tester
          .widget<FilledButton>(find.byKey(const ValueKey('rating-submit')));
      expect(submit.onPressed, isNotNull);
    });

    testWidgets('server menjawab sudah dinilai (409): layar menampilkan bintang yang tersimpan',
        (tester) async {
      tall(tester);
      await tester.pumpWidget(completed(
        request: ({
          required String reference,
          required int stars,
          String? note,
        }) async =>
            throw apiError('RIDE_RATING_ALREADY_SUBMITTED'),
        detail: (_) async => orderJson(rating: {'stars': 2, 'note': null}),
      ));
      await tester.pump();
      await tapKey(tester, 'rating-star-5');
      await tester.pump();
      await tapKey(tester, 'rating-submit');
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('rating-given')), findsOneWidget);
      expect(find.byIcon(Icons.star_rounded), findsNWidgets(2));
    });

    testWidgets('catatan dibatasi 280 karakter', (tester) async {
      tall(tester);
      await tester.pumpWidget(completed());
      await tester.pump();
      await tester.enterText(
          find.byKey(const ValueKey('rating-note')), 'x' * 400);
      await tester.pump();
      final field = tester.widget<TextField>(find.byKey(const ValueKey('rating-note')));
      expect(field.controller!.text.length, 280);
    });

    for (final st in ['SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'IN_TRIP']) {
      testWidgets('status $st: tidak ada langkah penilaian dan tidak ada bintang di kartu driver',
          (tester) async {
        tall(tester);
        await tester.pumpWidget(completed(st: st));
        await tester.pump();
        expect(find.byKey(const ValueKey('rating-form')), findsNothing);
        expect(find.byKey(const ValueKey('rating-given')), findsNothing);
        expect(find.byIcon(Icons.star_rounded), findsNothing);
        expect(find.byIcon(Icons.star_outline_rounded), findsNothing);
        expect(find.textContaining('rating'), findsNothing);
      });
    }

    test('penilaian dari server diurai; nilai di luar 1..5 ditolak', () {
      expect(RideRatingView.fromJson({'stars': 4, 'note': 'ok'})!.stars, 4);
      expect(RideRatingView.fromJson({'stars': 0}), isNull);
      expect(RideRatingView.fromJson({'stars': 6}), isNull);
      expect(RideRatingView.fromJson({'stars': 3.5}), isNull);
      expect(RideRatingView.fromJson(null), isNull);
    });
  });

  // =========================================================================
  group('5. pencarian alamat terdekat', () {
    // Peta di lembar pemilih memuat ubin OSM lewat jaringan; lingkungan uji
    // menolaknya (HTTP 400). Itu bukan yang diuji di sini. Dipasang DI DALAM
    // tes karena binding menimpa FlutterError.onError saat tes dimulai.
    void muteTileErrors() {
      final previous = FlutterError.onError;
      FlutterError.onError = (details) {
        if (details.library == 'image resource service') return;
        previous?.call(details);
      };
      addTearDown(() => FlutterError.onError = previous);
    }

    const near = RideLocation(
        id: 'gps', label: 'HP', address: 'Posisi HP', lat: -6.2, lng: 106.8);

    OsmLocationPort portWith(_NominatimAdapter adapter,
        {Duration gap = Duration.zero}) {
      final dio = Dio()..httpClientAdapter = adapter;
      return OsmLocationPort(http: dio, requestGap: gap);
    }

    test('haversine: 1 derajat lintang ≈ 111,2 km', () {
      final d = tapGoHaversineMeters(0, 0, 1, 0);
      expect(d, closeTo(111195, 300));
      expect(tapGoHaversineMeters(-6.2, 106.8, -6.2, 106.8), 0);
    });

    test('kotak pertama ketat (~3 km), terbatas, dan hasil diurutkan dari yang terdekat',
        () async {
      // Sengaja dikembalikan Nominatim dengan urutan "kepentingan" acak.
      final adapter = _NominatimAdapter((i, q) => [
            row(-6.2200, 106.8, 'Jauh'),
            row(-6.2010, 106.8, 'Terdekat'),
            row(-6.2100, 106.8, 'Tengah'),
            row(-6.2050, 106.8, 'Dekat'),
          ]);
      final results =
          await portWith(adapter).searchAddress('alfamart', near: near);

      expect(adapter.requests, hasLength(1));
      final q = adapter.requests.single;
      expect(q['bounded'], 1);
      expect(q['countrycodes'], 'id');
      expect(q['q'], 'alfamart');
      final b = box(q);
      // ±3 km: tinggi ≈ 6 km ≈ 0,054 derajat.
      expect(b.heightLat, closeTo(6 / 111.32, 0.003));
      expect(b.widthLng, greaterThan(0.04));
      expect(b.widthLng, lessThan(0.07));
      expect(adapter.userAgents.single, contains('TapGo'));
      expect(results.map((r) => r.label.split(',').first),
          ['Terdekat', 'Dekat', 'Tengah', 'Jauh']);
    });

    test('pusat kotak selalu posisi HP, bukan Jakarta (uji di Medan)', () async {
      const medan = RideLocation(
          id: 'g', label: 'HP', address: 'Medan', lat: 3.5952, lng: 98.6722);
      final adapter = _NominatimAdapter((i, q) => []);
      await portWith(adapter).searchAddress('alfamart', near: medan);
      expect(adapter.requests, hasLength(3));
      for (final q in adapter.requests) {
        final b = box(q);
        expect(b.centerLat, closeTo(3.5952, 1e-6));
        expect(b.centerLng, closeTo(98.6722, 1e-6));
        // Bukan Jakarta.
        expect((b.centerLat - -6.1754).abs(), greaterThan(5));
      }
    });

    test('hasil terlalu sedikit: dilebarkan bertahap 3 km → 15 km → kotak terluas',
        () async {
      final adapter = _NominatimAdapter((i, q) => const []);
      await portWith(adapter).searchAddress('alfamart', near: near);
      expect(adapter.requests, hasLength(3));
      final heights = adapter.requests.map((q) => box(q).heightLat).toList();
      expect(heights[0], lessThan(heights[1]));
      expect(heights[1], lessThan(heights[2]));
      expect(heights[1], closeTo(30 / 111.32, 0.01)); // ±15 km
      expect(heights[2], closeTo(0.7, 1e-6)); // ±0,35 derajat
      for (final q in adapter.requests) {
        expect(q['countrycodes'], 'id');
        expect(q['bounded'], 1);
      }
    });

    test('tahap berikutnya digabung tanpa duplikat, lalu berhenti begitu cukup',
        () async {
      final adapter = _NominatimAdapter((i, q) {
        if (i == 0) return [row(-6.2010, 106.8, 'A')];
        return [
          row(-6.2010, 106.8, 'A'), // duplikat tahap 1
          row(-6.2600, 106.8, 'B'),
          row(-6.2300, 106.8, 'C'),
        ];
      });
      final results =
          await portWith(adapter).searchAddress('alfamart', near: near);
      expect(adapter.requests, hasLength(2));
      expect(results.map((r) => r.label.split(',').first), ['A', 'C', 'B']);
    });

    test('jeda minimal 1,1 detik antar permintaan Nominatim', () async {
      final adapter = _NominatimAdapter((i, q) => const []);
      final port = OsmLocationPort(
        http: Dio()..httpClientAdapter = adapter,
      );
      await port.searchAddress('alfamart', near: near);
      expect(adapter.times, hasLength(3));
      for (var i = 1; i < adapter.times.length; i++) {
        expect(
            adapter.times[i].difference(adapter.times[i - 1]).inMilliseconds,
            greaterThanOrEqualTo(1090));
      }
    });

    test('tanpa posisi acuan: satu permintaan tanpa kotak (perilaku lama)', () async {
      final adapter = _NominatimAdapter((i, q) => const []);
      await portWith(adapter).searchAddress('monas');
      expect(adapter.requests, hasLength(1));
      expect(adapter.requests.single.containsKey('viewbox'), isFalse);
    });

    testWidgets('layar pemilih: tanpa posisi HP tidak mencari dan memberi tahu',
        (tester) async {
      tall(tester);
      muteTileErrors();
      final port = _FakePort();
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: RideLocationPickerSheet(
            port: port,
            title: 'Titik jemput',
          ),
        ),
      ));
      await tester.enterText(find.byType(TextField).first, 'alfamart');
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pump();
      expect(port.searches, isEmpty);
      expect(find.textContaining('Lokasi perangkat belum tersedia'),
          findsOneWidget);
    });

    testWidgets(
        'layar pemilih: pusat cari = posisi HP (bukan Jakarta, bukan titik jemput) untuk jemput dan tujuan',
        (tester) async {
      tall(tester);
      muteTileErrors();
      const pickup = RideLocation(
          id: 'p', label: 'Jemput', address: 'Titik jemput', lat: -7.0, lng: 110.4);
      for (final title in ['Titik jemput', 'Tujuan']) {
        final port = _FakePort(last: near)
          ..results = const [
            RideAddressCandidate(
                label: 'Alfamart Terdekat',
                address: 'Alfamart Terdekat, Kota Uji',
                lat: -6.201,
                lng: 106.8),
          ];
        await tester.pumpWidget(MaterialApp(
          home: Scaffold(
            body: RideLocationPickerSheet(
              key: UniqueKey(),
              port: port,
              title: title,
              near: title == 'Tujuan' ? pickup : null,
            ),
          ),
        ));
        await tester.enterText(find.byType(TextField).first, 'alfamart');
        await tester.pump(const Duration(milliseconds: 600));
        await tester.pump();
        expect(port.searches, hasLength(1), reason: title);
        expect(port.searches.single.near!.lat, near.lat, reason: title);
        expect(port.searches.single.near!.lng, near.lng, reason: title);
        expect(find.text('Alfamart Terdekat'), findsOneWidget, reason: title);
      }
    });

    testWidgets('posisi terakhir kosong: dipakai pembacaan saat ini', (tester) async {
      tall(tester);
      muteTileErrors();
      final port = _FakePort(current: near);
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: RideLocationPickerSheet(port: port, title: 'Tujuan'),
        ),
      ));
      await tester.enterText(find.byType(TextField).first, 'alfamart');
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pump();
      expect(port.searches.single.near!.lat, near.lat);
    });
  });

  // =========================================================================
  group('6. tempat cepat bisa dihapus', () {
    Widget booking() => const ProviderScope(
          child: MaterialApp(
            home: RideBookingScreen(
              initialService: RideServiceKind.motorcycle,
              initialDropoff: RideLocation(
                id: 'x',
                label: 'Stasiun',
                address: 'Stasiun Serang, Serang',
                lat: -6.12,
                lng: 106.16,
              ),
              locationPort: DemoLocationPort(),
            ),
          ),
        );

    Future<void> saveAs(WidgetTester tester, String label) async {
      await tester.ensureVisible(find.text('Simpan sebagai $label'));
      await tester.tap(find.text('Simpan sebagai $label'));
      await tester.pumpAndSettle();
    }

    testWidgets('tekan lama Rumah: Batal tidak menghapus; Hapus menghapus dari daftar dan penyimpanan',
        (tester) async {
      tall(tester);
      await tester.pumpWidget(booking());
      await tester.pumpAndSettle();
      await saveAs(tester, 'Rumah');
      expect(find.byKey(const ValueKey('quick-place-home')), findsOneWidget);

      await tester.longPress(find.byKey(const ValueKey('quick-place-home')));
      await tester.pumpAndSettle();
      expect(find.text('Hapus Rumah?'), findsOneWidget);
      await tester.tap(find.text('Batal'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('quick-place-home')), findsOneWidget);
      expect((await TapGoSavedPlacesProbe.load()), hasLength(1));

      await tester.longPress(find.byKey(const ValueKey('quick-place-home')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('quick-place-confirm')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('quick-place-home')), findsNothing);
      expect(await TapGoSavedPlacesProbe.load(), isEmpty);
    });

    testWidgets('menghapus Kantor tidak menyentuh Rumah', (tester) async {
      tall(tester);
      await tester.pumpWidget(booking());
      await tester.pumpAndSettle();
      await saveAs(tester, 'Rumah');
      await saveAs(tester, 'Kantor');
      expect(find.byKey(const ValueKey('quick-place-work')), findsOneWidget);

      await tester.longPress(find.byKey(const ValueKey('quick-place-work')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('quick-place-confirm')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('quick-place-work')), findsNothing);
      expect(find.byKey(const ValueKey('quick-place-home')), findsOneWidget);
      final stored = await TapGoSavedPlacesProbe.load();
      expect(stored.single.slot, 'home');
    });

    testWidgets('ketuk biasa tetap memilih tujuan (tidak menghapus)', (tester) async {
      tall(tester);
      await tester.pumpWidget(booking());
      await tester.pumpAndSettle();
      await saveAs(tester, 'Rumah');
      await tester.tap(find.byKey(const ValueKey('quick-place-home')));
      await tester.pumpAndSettle();
      expect(find.text('Hapus Rumah?'), findsNothing);
      expect(await TapGoSavedPlacesProbe.load(), hasLength(1));
    });

    testWidgets('tekan lama chip riwayat menyembunyikannya (catatan lokal); order tidak dihapus dan yang lama mengisi kekosongan',
        (tester) async {
      tall(tester);
      var historyCalls = 0;
      tapGoRecentHistoryLoaderForTests = () async {
        historyCalls += 1;
        return [
          orderJson(dropoff: 'A, Kota'),
          orderJson(dropoff: 'B, Kota'),
          orderJson(dropoff: 'C, Kota'),
          orderJson(dropoff: 'D, Kota'),
        ];
      };
      await tester.pumpWidget(booking());
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('quick-place-recent-0')), findsOneWidget);
      expect(find.widgetWithText(ActionChip, 'A'), findsOneWidget);
      expect(find.widgetWithText(ActionChip, 'B'), findsOneWidget);
      expect(find.widgetWithText(ActionChip, 'C'), findsOneWidget);
      expect(find.widgetWithText(ActionChip, 'D'), findsNothing);

      await tester.longPress(find.byKey(const ValueKey('quick-place-recent-1')));
      await tester.pumpAndSettle();
      expect(find.text('Sembunyikan dari Tempat cepat?'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('quick-place-confirm')));
      await tester.pumpAndSettle();

      expect(find.widgetWithText(ActionChip, 'B'), findsNothing);
      expect(find.widgetWithText(ActionChip, 'D'), findsOneWidget);
      expect(await TapGoSavedPlacesProbe.loadHidden(), contains('b, kota'));
      // Hanya catatan lokal: tidak ada panggilan hapus; riwayat hanya DIBACA.
      expect(historyCalls, greaterThanOrEqualTo(2));
    });

    testWidgets('batal menyembunyikan riwayat: chip tetap', (tester) async {
      tall(tester);
      tapGoRecentHistoryLoaderForTests =
          () async => [orderJson(dropoff: 'A, Kota')];
      await tester.pumpWidget(booking());
      await tester.pumpAndSettle();
      await tester.longPress(find.byKey(const ValueKey('quick-place-recent-0')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Batal'));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(ActionChip, 'A'), findsOneWidget);
      expect(await TapGoSavedPlacesProbe.loadHidden(), isEmpty);
    });

    test('tujuan terakhir mengabaikan alamat yang disembunyikan sebelum batas tiga', () {
      final orders = [
        orderJson(dropoff: 'A, Kota'),
        orderJson(dropoff: 'B, Kota'),
        orderJson(dropoff: 'C, Kota'),
        orderJson(dropoff: 'D, Kota'),
      ].map(RideOrderView.fromJson).toList();
      final recent =
          tapGoRecentPlacesFrom(orders, hiddenAddresses: {'a, kota', 'c, kota'});
      expect(recent.map((p) => p.label), ['B', 'D']);
    });
  });
}
