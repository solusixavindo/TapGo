import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// 6 Okt 2026: "stasiun" di Titik jemput tidak memunculkan saran. Akar masalah
/// (diuji langsung): Nominatim tidak mendukung ketik-sambil-mencari ("sta",
/// "stasi", "stasiun ser" = 0 hasil) dan lemah untuk kata kategori. Photon
/// (awalan kata + bias lokasi) menjadi sumber utama, berpusat di posisi HP.

const near = RideLocation(
    id: 'gps', label: 'HP', address: 'Posisi HP', lat: -6.12, lng: 106.15);

Map<String, Object?> feature(
  String name,
  double lat,
  double lng, {
  String country = 'ID',
  String? street,
  String? district,
  String? city,
}) =>
    {
      'type': 'Feature',
      'geometry': {'type': 'Point', 'coordinates': [lng, lat]},
      'properties': {
        'name': name,
        'countrycode': country,
        if (street != null) 'street': street,
        if (district != null) 'district': district,
        if (city != null) 'city': city,
        'state': 'Banten',
      },
    };

class FakeHttpAdapter implements HttpClientAdapter {
  FakeHttpAdapter({this.photon, this.nominatim, this.photonStatus = 200});

  final List<Map<String, Object?>> Function(Map<String, dynamic> q)? photon;
  final List<Map<String, String>> Function(Map<String, dynamic> q)? nominatim;
  final int photonStatus;
  final photonRequests = <Map<String, dynamic>>[];
  final nominatimRequests = <Map<String, dynamic>>[];
  final userAgents = <String?>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<List<int>>? requestStream,
      Future<void>? cancelFuture) async {
    if (options.uri.host.contains('photon')) {
      photonRequests.add(Map<String, dynamic>.of(options.queryParameters));
      userAgents.add(options.headers['User-Agent']?.toString());
      if (photonStatus != 200) {
        return ResponseBody.fromString('{}', photonStatus, headers: {
          Headers.contentTypeHeader: ['application/json'],
        });
      }
      final features = photon?.call(options.queryParameters) ?? const [];
      return ResponseBody.fromString(
        jsonEncode({'type': 'FeatureCollection', 'features': features}),
        200,
        headers: {Headers.contentTypeHeader: ['application/json']},
      );
    }
    nominatimRequests.add(Map<String, dynamic>.of(options.queryParameters));
    return ResponseBody.fromString(
      jsonEncode(nominatim?.call(options.queryParameters) ?? const []),
      200,
      headers: {Headers.contentTypeHeader: ['application/json']},
    );
  }

  @override
  void close({bool force = false}) {}
}

OsmLocationPort portWith(FakeHttpAdapter adapter) => OsmLocationPort(
      http: Dio()..httpClientAdapter = adapter,
      requestGap: Duration.zero,
      photonGap: Duration.zero,
    );

void main() {
  group('Photon: sumber utama saran', () {
    test('parameter: teks, posisi HP, bbox Indonesia, bias lokasi, User-Agent', () async {
      final adapter = FakeHttpAdapter(photon: (_) => [feature('Stasiun Serang', -6.1138, 106.1517)]);
      await portWith(adapter).searchAddress('stasiun', near: near);
      expect(adapter.photonRequests, hasLength(1));
      final q = adapter.photonRequests.single;
      expect(q['q'], 'stasiun');
      expect(q['lat'], near.lat);
      expect(q['lon'], near.lng);
      expect(q['bbox'], '95.0,-11.0,141.1,6.1');
      expect(q['limit'], 15);
      expect(q['location_bias_scale'], greaterThan(0));
      expect(adapter.userAgents.single, contains('TapGo'));
      expect(adapter.nominatimRequests, isEmpty);
    });

    test('kata belum lengkap (2-3 huruf) sudah dicari; 1 huruf tidak', () async {
      final adapter = FakeHttpAdapter(photon: (_) => [feature('Stasiun Serang', -6.1138, 106.1517)]);
      final port = portWith(adapter);
      expect(await port.searchAddress('s', near: near), isEmpty);
      expect(adapter.photonRequests, isEmpty);
      expect(await port.searchAddress('st', near: near), isNotEmpty);
      expect(await port.searchAddress('sta', near: near), isNotEmpty);
      expect(adapter.photonRequests.map((q) => q['q']), ['st', 'sta']);
    });

    test('hanya Indonesia, tanpa duplikat, diurutkan dari yang terdekat, maksimal 8', () async {
      final adapter = FakeHttpAdapter(photon: (_) => [
            feature('Jauh', -6.50, 106.80, district: 'Bogor'),
            feature('Luar Negeri', -6.121, 106.151, country: 'MY'),
            feature('Dekat', -6.121, 106.151, district: 'Cipocok'),
            feature('Dekat', -6.121, 106.151, district: 'Cipocok'), // duplikat koordinat
            for (var i = 0; i < 12; i++) feature('Tempat $i', -6.13 - i * 0.01, 106.15),
            {'geometry': {'coordinates': [106.1, -6.1]}, 'properties': {}}, // tanpa nama
          ]);
      final results = await portWith(adapter).searchAddress('tempat', near: near);
      expect(results.first.label, startsWith('Dekat'));
      expect(results.where((r) => r.label.startsWith('Dekat')), hasLength(1));
      expect(results.any((r) => r.label.startsWith('Luar Negeri')), isFalse);
      expect(results.length, lessThanOrEqualTo(8));
      final distances = [
        for (final r in results) tapGoHaversineMeters(near.lat, near.lng, r.lat, r.lng)
      ];
      expect(distances, [...distances]..sort());
    });

    test('label memuat wilayah, alamat tersusun bertingkat tanpa pengulangan', () async {
      final adapter = FakeHttpAdapter(photon: (_) => [
            feature('Alfamart', -6.121, 106.151,
                street: 'Jalan Jagarayu', district: 'Cipocok Jaya', city: 'Serang'),
          ]);
      final r = (await portWith(adapter).searchAddress('alfamart', near: near)).single;
      expect(r.label, 'Alfamart, Cipocok Jaya');
      expect(r.address, 'Alfamart, Jalan Jagarayu, Cipocok Jaya, Serang, Banten');
    });

    test('Photon gagal (HTTP 500): cadangan Nominatim dipakai', () async {
      final adapter = FakeHttpAdapter(
        photonStatus: 500,
        nominatim: (_) => [
          {'lat': '-6.1138', 'lon': '106.1517', 'display_name': 'Stasiun Serang, Jalan Saleh Baimin'},
        ],
      );
      final results = await portWith(adapter).searchAddress('stasiun', near: near);
      expect(adapter.photonRequests, hasLength(1));
      expect(adapter.nominatimRequests, isNotEmpty);
      expect(results.single.label, contains('Stasiun Serang'));
    });

    test('Photon kosong: cadangan Nominatim dicoba', () async {
      final adapter = FakeHttpAdapter(photon: (_) => const [], nominatim: (_) => const []);
      expect(await portWith(adapter).searchAddress('xyzxyz', near: near), isEmpty);
      expect(adapter.nominatimRequests, isNotEmpty);
    });

    test('tanpa posisi acuan Photon tidak dipakai (hasil tidak dapat diurutkan menurut jarak)', () async {
      final adapter = FakeHttpAdapter(
        photon: (_) => [feature('Stasiun Serang', -6.1138, 106.1517)],
        nominatim: (_) => const [],
      );
      await portWith(adapter).searchAddress('stasiun');
      expect(adapter.photonRequests, isEmpty);
    });

    test('jeda minimal antar permintaan Photon', () async {
      final times = <DateTime>[];
      final adapter = FakeHttpAdapter(photon: (_) {
        times.add(DateTime.now());
        return [feature('A', -6.121, 106.151)];
      });
      final port = OsmLocationPort(
        http: Dio()..httpClientAdapter = adapter,
        photonGap: const Duration(milliseconds: 300),
      );
      await port.searchAddress('sta', near: near);
      await port.searchAddress('stas', near: near);
      expect(times[1].difference(times[0]).inMilliseconds, greaterThanOrEqualTo(290));
    });
  });

  group('lembar pemilih', () {
    void muteTileErrors() {
      final previous = FlutterError.onError;
      FlutterError.onError = (details) {
        if (details.library == 'image resource service') return;
        previous?.call(details);
      };
      addTearDown(() => FlutterError.onError = previous);
    }

    void tall(WidgetTester tester) {
      tester.view.physicalSize = const Size(1080, 2800);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
    }

    setUp(tapGoResetPickerLocationCacheForTests);

    Future<void> type(WidgetTester tester, String text) async {
      await tester.enterText(find.byType(TextField).first, text);
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pump();
    }

    testWidgets('saran muncul sejak 2 huruf', (tester) async {
      muteTileErrors();
      tall(tester);
      final port = _SlowPort(last: near)
        ..answer = (q) async => [
              const RideAddressCandidate(label: 'Stasiun Serang', address: 'Stasiun Serang', lat: -6.1138, lng: 106.1517),
            ];
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(body: RideLocationPickerSheet(port: port, title: 'Titik jemput'))));
      await type(tester, 'st');
      expect(port.queries, ['st']);
      expect(find.text('Stasiun Serang'), findsWidgets);
    });

    testWidgets('jawaban usang diabaikan: hasil ketikan terbaru yang tampil', (tester) async {
      muteTileErrors();
      tall(tester);
      final slow = Completer<List<RideAddressCandidate>>();
      final port = _SlowPort(last: near)
        ..answer = (q) {
          if (q == 'st') return slow.future;
          return Future.value([
            const RideAddressCandidate(label: 'Stasiun Serang', address: 'Stasiun Serang', lat: -6.1138, lng: 106.1517),
          ]);
        };
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(body: RideLocationPickerSheet(port: port, title: 'Titik jemput'))));
      await type(tester, 'st');
      await type(tester, 'sta');
      expect(find.text('Stasiun Serang'), findsWidgets);
      // Jawaban "st" yang lambat tiba terakhir: tidak boleh menimpa hasil "sta".
      slow.complete([
        const RideAddressCandidate(label: 'Stadion Usang', address: 'Stadion Usang', lat: -6.2, lng: 106.2),
      ]);
      await tester.pump();
      await tester.pump();
      expect(find.text('Stadion Usang'), findsNothing);
      expect(find.text('Stasiun Serang'), findsWidgets);
    });

    testWidgets('posisi HP belum ada: pesan jelas, lalu pencarian diulang otomatis begitu GPS siap',
        (tester) async {
      muteTileErrors();
      tall(tester);
      final gps = Completer<RideLocation?>();
      final port = _SlowPort(last: null, current: gps.future)
        ..answer = (q) async => [
              const RideAddressCandidate(label: 'Stasiun Serang', address: 'Stasiun Serang', lat: -6.1138, lng: 106.1517),
            ];
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(body: RideLocationPickerSheet(port: port, title: 'Titik jemput'))));
      await type(tester, 'stasiun');
      expect(find.textContaining('Mencari lokasi perangkat'), findsOneWidget);
      expect(port.queries, isEmpty);

      gps.complete(near);
      await tester.pump();
      await tester.pump();
      await tester.pump();
      expect(port.queries, ['stasiun']);
      expect(port.nears.single!.lat, near.lat);
      expect(find.text('Stasiun Serang'), findsWidgets);
      expect(find.textContaining('Mencari lokasi perangkat'), findsNothing);
    });

    testWidgets('pembukaan berikutnya langsung memakai posisi terakhir tanpa menunggu GPS', (tester) async {
      muteTileErrors();
      tall(tester);
      final first = _SlowPort(last: near)..answer = (q) async => const [];
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(body: RideLocationPickerSheet(port: first, title: 'Titik jemput'))));
      await type(tester, 'st');
      expect(first.lastKnownCalls, greaterThanOrEqualTo(1));

      // Lembar baru: port kedua tidak punya posisi sama sekali, tetapi cache ada.
      final second = _SlowPort(last: null)..answer = (q) async => const [];
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(body: RideLocationPickerSheet(key: UniqueKey(), port: second, title: 'Tujuan'))));
      await type(tester, 'st');
      expect(second.queries, ['st']);
      expect(second.nears.single!.lat, near.lat);
    });
  });
}

class _SlowPort implements LocationSelectionPort {
  _SlowPort({this.last, this.current});

  final RideLocation? last;
  final Future<RideLocation?>? current;
  final queries = <String>[];
  final nears = <RideLocation?>[];
  int lastKnownCalls = 0;
  Future<List<RideAddressCandidate>> Function(String q) answer =
      (q) async => const [];

  @override
  RideLocationProviderStatus get status => RideLocationProviderStatus.ready;
  @override
  Future<List<RideAddressCandidate>> searchAddress(String query, {RideLocation? near}) {
    queries.add(query);
    nears.add(near);
    return answer(query);
  }

  @override
  Future<String?> reverseAddress(double lat, double lng) async => 'Alamat uji';
  @override
  Future<RideLocation?> currentLocation() => current ?? Future.value(null);
  @override
  Future<RideLocation?> lastKnownLocation() async {
    lastKnownCalls += 1;
    return last;
  }
}
