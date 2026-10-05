import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// 6 Okt 2026: penilaian setelah perjalanan selesai. Gaya aplikasi ojek: begitu
/// perjalanan selesai penumpang langsung dibawa ke HALAMAN penilaian penuh
/// (bukan kartu di bawah layar status). Bila server belum dapat menerima
/// (route belum ada / jaringan), penilaian disimpan di perangkat dan dikirim
/// ulang otomatis; penumpang tidak melihat galat merah.

const _ref = 'RID-A2B3C4D5E6';

Map<String, dynamic> orderJson({
  String status = 'COMPLETED',
  Map<String, dynamic>? rating,
  DateTime? completedAt,
  bool withRatingKey = false,
}) =>
    {
      'reference': _ref,
      'serviceType': 'MOTORCYCLE',
      'status': status,
      'isFinal': status == 'COMPLETED' || status.startsWith('CANCELLED'),
      'pickupAddress': 'Jl. Melati 1, Serang',
      'dropoffAddress': 'Stasiun Serang',
      'pickup': {'lat': -6.11, 'lng': 106.15},
      'dropoff': {'lat': -6.12, 'lng': 106.16},
      'distanceMeters': 4200,
      'durationSeconds': 900,
      'fare': {'totalFare': 18500, 'currency': 'IDR'},
      'payment': {'method': 'CASH', 'state': 'PAID'},
      'cancellation': null,
      'timeline': {
        'completedAt': (completedAt ?? DateTime.now().subtract(const Duration(minutes: 5)))
            .toUtc()
            .toIso8601String(),
      },
      'driver': {'displayName': 'Budi'},
      'vehicle': {
        'serviceType': 'MOTORCYCLE',
        'model': 'Vario 160',
        'color': 'Hitam',
        'maskedPlate': 'B 12•• XYZ',
      },
      'createdAt': '2026-10-06T10:05:00Z',
      if (withRatingKey || rating != null) 'rating': rating,
    };

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

DioException networkError() => DioException(
      requestOptions: RequestOptions(path: '/rides/$_ref/rating'),
      type: DioExceptionType.connectionError,
    );

void tall(WidgetTester tester) {
  tester.view.physicalSize = const Size(1080, 2800);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

/// Memberi frame untuk: pembaruan state -> callback pasca-frame -> push route.
Future<void> settleRoute(WidgetTester tester) async {
  await tester.pump(const Duration(milliseconds: 100));
  await tester.pump(const Duration(milliseconds: 100));
  await tester.pump(const Duration(milliseconds: 600));
}

Future<void> tapKey(WidgetTester tester, String key) async {
  final finder = find.byKey(ValueKey(key));
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
}

typedef Call = ({String reference, int stars, String? note});

Widget host(Widget home) => ProviderScope(child: MaterialApp(home: home));

/// Membuka RideRatingScreen dari sebuah tombol supaya hasil pop dapat ditangkap.
class _Launcher extends StatefulWidget {
  const _Launcher({required this.request});
  final RideRatingRequest request;
  @override
  State<_Launcher> createState() => _LauncherState();
}

class _LauncherState extends State<_Launcher> {
  Object? result = 'belum';
  @override
  Widget build(BuildContext context) => Scaffold(
        body: Column(children: [
          TextButton(
            key: const ValueKey('launch'),
            onPressed: () async {
              final value = await Navigator.of(context).push<RideRatingView>(
                MaterialPageRoute(
                  builder: (_) => RideRatingScreen(
                    order: RideOrderView.fromJson(orderJson()),
                    request: widget.request,
                  ),
                ),
              );
              setState(() => result = value);
            },
            child: const Text('buka'),
          ),
          Text(
            result is RideRatingView
                ? 'hasil:${(result as RideRatingView).stars}:${(result as RideRatingView).pending}'
                : result == null
                    ? 'hasil:null'
                    : 'hasil:belum',
            key: const ValueKey('result'),
          ),
        ]),
      );
}

void main() {
  setUp(() async {
    tapGoDisablePersistenceForTests = true;
    await TapGoPendingRatingsProbe.clear();
    tapGoResetPushUiForTests();
  });
  tearDown(() {
    tapGoDisablePersistenceForTests = false;
  });

  group('halaman penilaian', () {
    testWidgets('ringkasan perjalanan, driver, lima bintang; Kirim nonaktif sampai ada bintang',
        (tester) async {
      tall(tester);
      await tester.pumpWidget(host(RideRatingScreen(
        order: RideOrderView.fromJson(orderJson()),
        request: ({required reference, required stars, note}) async => {'stars': stars},
      )));
      expect(find.text('Perjalanan selesai'), findsOneWidget);
      expect(find.text('Rp18.500'), findsOneWidget);
      expect(find.text('Budi'), findsOneWidget);
      expect(find.text('Bagaimana perjalananmu?'), findsOneWidget);
      for (var s = 1; s <= 5; s++) {
        expect(find.byKey(ValueKey('rating-star-$s')), findsOneWidget);
      }
      expect(find.byKey(const ValueKey('rating-skip')), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const ValueKey('rating-submit'))).onPressed, isNull);
      // Tanpa bintang tidak ada tag.
      expect(find.byType(FilterChip), findsNothing);
    });

    testWidgets('4-5 bintang menampilkan tag positif; 1-3 bintang tag keluhan; ganti kelompok mengosongkan pilihan',
        (tester) async {
      tall(tester);
      await tester.pumpWidget(host(RideRatingScreen(
        order: RideOrderView.fromJson(orderJson()),
        request: ({required reference, required stars, note}) async => {'stars': stars},
      )));
      await tapKey(tester, 'rating-star-5');
      await tester.pump();
      expect(find.text('Luar biasa!'), findsOneWidget);
      expect(find.byKey(const ValueKey('rating-tag-Ramah')), findsOneWidget);
      await tapKey(tester, 'rating-tag-Ramah');
      await tester.pump();
      expect(tester.widget<FilterChip>(find.byKey(const ValueKey('rating-tag-Ramah'))).selected, isTrue);

      await tapKey(tester, 'rating-star-2');
      await tester.pump();
      expect(find.byKey(const ValueKey('rating-tag-Terlambat')), findsOneWidget);
      expect(find.byKey(const ValueKey('rating-tag-Ramah')), findsNothing);
      expect(find.text('Kurang'), findsOneWidget);
    });

    testWidgets('Kirim: bintang + tag + catatan dikirim sebagai satu catatan; hasil dikembalikan',
        (tester) async {
      tall(tester);
      final calls = <Call>[];
      await tester.pumpWidget(host(_Launcher(
        request: ({required reference, required stars, note}) async {
          calls.add((reference: reference, stars: stars, note: note));
          return {'stars': stars, 'note': note};
        },
      )));
      await tester.tap(find.byKey(const ValueKey('launch')));
      await tester.pumpAndSettle();
      await tapKey(tester, 'rating-star-5');
      await tester.pump();
      await tapKey(tester, 'rating-tag-Ramah');
      await tapKey(tester, 'rating-tag-Tepat waktu');
      await tester.enterText(find.byKey(const ValueKey('rating-note')), 'Mantap');
      await tester.pump();
      await tapKey(tester, 'rating-submit');
      await tester.pumpAndSettle();
      expect(calls, hasLength(1));
      expect(calls.single.reference, _ref);
      expect(calls.single.stars, 5);
      expect(calls.single.note, 'Ramah, Tepat waktu - Mantap');
      expect(find.text('hasil:5:false'), findsOneWidget);
      expect(await TapGoPendingRatingsProbe.load(), isEmpty);
    });

    testWidgets('Lewati menutup halaman tanpa mengirim apa pun', (tester) async {
      tall(tester);
      var calls = 0;
      await tester.pumpWidget(host(_Launcher(
        request: ({required reference, required stars, note}) async {
          calls += 1;
          return {};
        },
      )));
      await tester.tap(find.byKey(const ValueKey('launch')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('rating-skip')));
      await tester.pumpAndSettle();
      expect(calls, 0);
      expect(find.text('hasil:null'), findsOneWidget);
    });

    testWidgets('kirim ganda cepat hanya satu permintaan (single-flight)', (tester) async {
      tall(tester);
      var calls = 0;
      final gate = Completer<Map<String, dynamic>>();
      await tester.pumpWidget(host(_Launcher(
        request: ({required reference, required stars, note}) {
          calls += 1;
          return gate.future;
        },
      )));
      await tester.tap(find.byKey(const ValueKey('launch')));
      await tester.pumpAndSettle();
      await tapKey(tester, 'rating-star-4');
      await tester.pump();
      await tapKey(tester, 'rating-submit');
      await tester.pump();
      await tapKey(tester, 'rating-submit');
      await tester.pump();
      expect(calls, 1);
      gate.complete({'stars': 4});
      await tester.pumpAndSettle();
      expect(calls, 1);
    });

    for (final entry in {
      'route penilaian belum ada di server (ROUTE_NOT_FOUND)': apiError('ROUTE_NOT_FOUND', status: 404),
      'jaringan putus': networkError(),
      'server 503': apiError('SERVICE_UNAVAILABLE', status: 503),
    }.entries) {
      testWidgets('${entry.key}: tanpa galat merah, disimpan di perangkat, hasil menunggu dikirim',
          (tester) async {
        tall(tester);
        await tester.pumpWidget(host(_Launcher(
          request: ({required reference, required stars, note}) async => throw entry.value,
        )));
        await tester.tap(find.byKey(const ValueKey('launch')));
        await tester.pumpAndSettle();
        await tapKey(tester, 'rating-star-4');
        await tester.pump();
        await tapKey(tester, 'rating-submit');
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('rating-error')), findsNothing);
        expect(find.text('hasil:4:true'), findsOneWidget);
        final queued = await TapGoPendingRatingsProbe.load();
        expect(queued, hasLength(1));
        expect(queued.single.reference, _ref);
        expect(queued.single.stars, 4);
      });
    }

    testWidgets('permintaan tidak sah (400): galat tampil, tidak masuk antrean, halaman tetap', (tester) async {
      tall(tester);
      await tester.pumpWidget(host(_Launcher(
        request: ({required reference, required stars, note}) async =>
            throw apiError('VALIDATION_ERROR', status: 400),
      )));
      await tester.tap(find.byKey(const ValueKey('launch')));
      await tester.pumpAndSettle();
      await tapKey(tester, 'rating-star-3');
      await tester.pump();
      await tapKey(tester, 'rating-submit');
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('rating-error')), findsOneWidget);
      expect(await TapGoPendingRatingsProbe.load(), isEmpty);
      expect(find.byType(RideRatingScreen), findsOneWidget);
    });
  });

  group('layar status: halaman penilaian otomatis saat selesai', () {
    Widget status({
      required RideDetailRequest detail,
      RideRatingRequest? request,
      Duration poll = const Duration(seconds: 4),
    }) =>
        host(RideStatusScreen(
          reference: _ref,
          pollInterval: poll,
          detailRequest: detail,
          ratingRequest: request ??
              ({required reference, required stars, note}) async => {'stars': stars, 'note': note},
        ));

    testWidgets('IN_TRIP lalu COMPLETED saat layar terbuka: halaman penilaian terbuka sendiri', (tester) async {
      tall(tester);
      var calls = 0;
      await tester.pumpWidget(status(detail: (_) async {
        calls += 1;
        return orderJson(status: calls >= 2 ? 'COMPLETED' : 'IN_TRIP');
      }));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.byType(RideRatingScreen), findsNothing);

      await tester.pump(const Duration(seconds: 4));
      await settleRoute(tester);
      expect(find.byType(RideRatingScreen), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('Lewati kembali ke layar status dengan kartu "Beri penilaian"; tidak dibuka paksa lagi', (tester) async {
      tall(tester);
      var calls = 0;
      await tester.pumpWidget(status(detail: (_) async {
        calls += 1;
        return orderJson(status: calls >= 2 ? 'COMPLETED' : 'IN_TRIP');
      }));
      await tester.pump(const Duration(seconds: 4));
      await settleRoute(tester);
      await tester.tap(find.byKey(const ValueKey('rating-skip')));
      await tester.pumpAndSettle();
      expect(find.byType(RideRatingScreen), findsNothing);
      expect(find.byKey(const ValueKey('rating-prompt')), findsOneWidget);
      expect(find.text('Kembali ke Dashboard'), findsOneWidget);

      // Kartu membuka halaman yang sama.
      await tapKey(tester, 'rating-open');
      await tester.pumpAndSettle();
      expect(find.byType(RideRatingScreen), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('selesai ≤ 2 jam lalu dan belum dinilai: terbuka otomatis saat layar dibuka', (tester) async {
      tall(tester);
      await tester.pumpWidget(status(detail: (_) async => orderJson(withRatingKey: true)));
      await tester.pump();
      await settleRoute(tester);
      expect(find.byType(RideRatingScreen), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('perjalanan lama (3 hari) dibuka dari riwayat: tidak dibuka paksa, hanya kartu ajakan', (tester) async {
      tall(tester);
      await tester.pumpWidget(status(
        detail: (_) async => orderJson(
          completedAt: DateTime.now().subtract(const Duration(days: 3)),
          withRatingKey: true,
        ),
      ));
      await tester.pump();
      await settleRoute(tester);
      expect(find.byType(RideRatingScreen), findsNothing);
      expect(find.byKey(const ValueKey('rating-prompt')), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('sudah dinilai: bintang tampil, halaman tidak dibuka', (tester) async {
      tall(tester);
      await tester.pumpWidget(status(
        detail: (_) async => orderJson(rating: {'stars': 5, 'note': 'Mantap'}),
      ));
      await tester.pump();
      await settleRoute(tester);
      expect(find.byType(RideRatingScreen), findsNothing);
      expect(find.byKey(const ValueKey('rating-given')), findsOneWidget);
      expect(find.byIcon(Icons.star_rounded), findsNWidgets(5));
      expect(find.text('Mantap'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('kirim berhasil dari halaman: layar status menampilkan bintang yang diberikan', (tester) async {
      tall(tester);
      await tester.pumpWidget(status(detail: (_) async => orderJson(withRatingKey: true)));
      await tester.pump();
      await settleRoute(tester);
      await tapKey(tester, 'rating-star-4');
      await tester.pump();
      await tapKey(tester, 'rating-submit');
      await tester.pumpAndSettle();
      expect(find.byType(RideRatingScreen), findsNothing);
      expect(find.byKey(const ValueKey('rating-given')), findsOneWidget);
      expect(find.byIcon(Icons.star_rounded), findsNWidgets(4));
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('server belum punya route: terima kasih + kartu "akan dikirim otomatis", tanpa galat merah', (tester) async {
      tall(tester);
      await tester.pumpWidget(status(
        detail: (_) async => orderJson(withRatingKey: true),
        request: ({required reference, required stars, note}) async =>
            throw apiError('ROUTE_NOT_FOUND', status: 404),
      ));
      await tester.pump();
      await settleRoute(tester);
      await tapKey(tester, 'rating-star-5');
      await tester.pump();
      await tapKey(tester, 'rating-submit');
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('rating-pending')), findsOneWidget);
      expect(find.byKey(const ValueKey('rating-pending-note')), findsOneWidget);
      expect(find.textContaining('belum tersedia'), findsNothing);
      expect(find.byKey(const ValueKey('rating-error')), findsNothing);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('penilaian menunggu dari sesi sebelumnya langsung tampil dan tidak membuka halaman lagi', (tester) async {
      tall(tester);
      await TapGoPendingRatingsProbe.enqueue(
          const TapGoPendingRating(reference: _ref, stars: 3, note: 'Cukup'));
      await tester.pumpWidget(status(detail: (_) async => orderJson(withRatingKey: true)));
      await tester.pump();
      await settleRoute(tester);
      expect(find.byType(RideRatingScreen), findsNothing);
      expect(find.byKey(const ValueKey('rating-pending')), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    for (final st in ['SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'IN_TRIP']) {
      testWidgets('status $st: tanpa halaman/kartu penilaian dan tanpa bintang', (tester) async {
        tall(tester);
        await tester.pumpWidget(status(detail: (_) async => orderJson(status: st)));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 600));
        expect(find.byType(RideRatingScreen), findsNothing);
        expect(find.byKey(const ValueKey('rating-prompt')), findsNothing);
        expect(find.byIcon(Icons.star_rounded), findsNothing);
        expect(find.textContaining('rating'), findsNothing);
        await tester.pumpWidget(const SizedBox());
      });
    }
  });

  group('antrean penilaian: kirim ulang otomatis', () {
    Future<void> queue() => TapGoPendingRatingsProbe.enqueue(
        const TapGoPendingRating(reference: _ref, stars: 5, note: 'Bagus'));

    test('terkirim: dihapus dari antrean', () async {
      await queue();
      final sent = <Call>[];
      final done = await tapGoFlushPendingRatings(
        request: ({required reference, required stars, note}) async {
          sent.add((reference: reference, stars: stars, note: note));
          return {'stars': stars};
        },
      );
      expect(done, 1);
      expect(sent.single.stars, 5);
      expect(sent.single.note, 'Bagus');
      expect(await TapGoPendingRatingsProbe.load(), isEmpty);
    });

    test('route belum ada: tetap di antrean (coba lagi nanti)', () async {
      await queue();
      final done = await tapGoFlushPendingRatings(
        request: ({required reference, required stars, note}) async =>
            throw apiError('ROUTE_NOT_FOUND', status: 404),
      );
      expect(done, 0);
      expect(await TapGoPendingRatingsProbe.load(), hasLength(1));
    });

    test('jaringan putus atau sesi berakhir: tetap di antrean', () async {
      await queue();
      expect(
          await tapGoFlushPendingRatings(
              request: ({required reference, required stars, note}) async => throw networkError()),
          0);
      expect(await TapGoPendingRatingsProbe.load(), hasLength(1));
      expect(
          await tapGoFlushPendingRatings(
              request: ({required reference, required stars, note}) async =>
                  throw apiError('UNAUTHORIZED', status: 401)),
          0);
      expect(await TapGoPendingRatingsProbe.load(), hasLength(1));
    });

    test('sudah dinilai (409) atau permintaan tidak sah (400/403/404 order): dibuang dari antrean', () async {
      for (final error in [
        apiError('RIDE_RATING_ALREADY_SUBMITTED'),
        apiError('VALIDATION_ERROR', status: 400),
        apiError('RIDE_ORDER_NOT_FOUND', status: 404),
        apiError('RIDE_NOT_COMPLETED'),
      ]) {
        await queue();
        final done = await tapGoFlushPendingRatings(
          request: ({required reference, required stars, note}) async => throw error,
        );
        expect(done, 1, reason: '$error');
        expect(await TapGoPendingRatingsProbe.load(), isEmpty);
      }
    });

    test('satu penilaian per perjalanan: yang baru menggantikan; antrean dibersihkan saat keluar akun', () async {
      await queue();
      await TapGoPendingRatingsProbe.enqueue(
          const TapGoPendingRating(reference: _ref, stars: 2));
      final items = await TapGoPendingRatingsProbe.load();
      expect(items, hasLength(1));
      expect(items.single.stars, 2);
      await TapGoPendingRatingsProbe.clear();
      expect(await TapGoPendingRatingsProbe.load(), isEmpty);
    });

    test('klasifikasi kegagalan', () {
      expect(tapGoRatingFailureOf(apiError('ROUTE_NOT_FOUND', status: 404)), TapGoRatingFailure.retryLater);
      expect(tapGoRatingFailureOf(networkError()), TapGoRatingFailure.retryLater);
      expect(tapGoRatingFailureOf(apiError('X', status: 503)), TapGoRatingFailure.retryLater);
      expect(tapGoRatingFailureOf(apiError('X', status: 429)), TapGoRatingFailure.retryLater);
      expect(tapGoRatingFailureOf(apiError('RIDE_RATING_ALREADY_SUBMITTED')), TapGoRatingFailure.alreadyDone);
      expect(tapGoRatingFailureOf(apiError('X', status: 400)), TapGoRatingFailure.drop);
      expect(tapGoRatingFailureOf(apiError('RIDE_ORDER_NOT_FOUND', status: 404)), TapGoRatingFailure.drop);
      expect(tapGoRatingFailureOf(StateError('aneh')), TapGoRatingFailure.retryLater);
    });

    test('data antrean rusak diabaikan', () {
      expect(TapGoPendingRating.tryFromJson({'reference': '../x', 'stars': 5}), isNull);
      expect(TapGoPendingRating.tryFromJson({'reference': _ref, 'stars': 6}), isNull);
      expect(TapGoPendingRating.tryFromJson({'reference': _ref, 'stars': 3.5}), isNull);
      expect(TapGoPendingRating.tryFromJson('bukan map'), isNull);
      expect(TapGoPendingRating.tryFromJson({'reference': _ref, 'stars': 4})!.note, isNull);
    });
  });

  group('tag dan catatan', () {
    test('tag positif untuk 4-5, keluhan untuk 1-3, kosong tanpa bintang', () {
      expect(tapGoRatingTags(5), contains('Ramah'));
      expect(tapGoRatingTags(4), contains('Tepat waktu'));
      expect(tapGoRatingTags(3), contains('Terlambat'));
      expect(tapGoRatingTags(1), contains('Kurang ramah'));
      expect(tapGoRatingTags(0), isEmpty);
    });

    test('catatan gabungan maksimal 280 karakter dan null bila kosong', () {
      expect(tapGoComposeRatingNote(const [], '  '), isNull);
      expect(tapGoComposeRatingNote(const ['Ramah'], ''), 'Ramah');
      expect(tapGoComposeRatingNote(const ['Ramah', 'Tepat waktu'], 'Mantap'), 'Ramah, Tepat waktu - Mantap');
      expect(tapGoComposeRatingNote(const ['Ramah'], 'x' * 500)!.length, 280);
    });
  });
}
