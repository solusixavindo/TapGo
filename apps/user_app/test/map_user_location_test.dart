import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:tapgo_user_app/main.dart';

class _FakeLiveSource implements LiveLocationSource {
  final controller = StreamController<RideLocationFix>();
  @override
  Stream<RideLocationFix> watchPosition() => controller.stream;
}

Widget _mapWith(Object source) => MaterialApp(
      home: Scaffold(
        body: SizedBox(
          width: 360,
          height: 400,
          child: FlutterMap(
            options: const MapOptions(
              initialCenter: LatLng(-6.2, 106.8),
              initialZoom: 16,
            ),
            children: [
              TapGoUserLocationLayer(source: source),
              const Align(
                alignment: Alignment.bottomLeft,
                child: TapGoMapAttributionButton(),
              ),
            ],
          ),
        ),
      ),
    );

void main() {
  testWidgets('titik biru muncul setelah posisi diterima, bergerak saat posisi berubah',
      (tester) async {
    final source = _FakeLiveSource();
    addTearDown(source.controller.close);
    await tester.pumpWidget(_mapWith(source));

    // Sebelum ada posisi: tidak ada titik.
    expect(find.byKey(const ValueKey('tapgo-user-location')), findsNothing);

    source.controller.add(
      const RideLocationFix(lat: -6.2, lng: 106.8, accuracyMeters: 12),
    );
    await tester.pump();
    expect(find.byKey(const ValueKey('tapgo-user-location')), findsOneWidget);
    expect(find.byType(CircleLayer), findsOneWidget);
    expect(find.byType(MarkerLayer), findsOneWidget);

    source.controller.add(
      const RideLocationFix(lat: -6.2005, lng: 106.8003, accuracyMeters: 8),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    final circle = tester.widget<CircleLayer>(find.byType(CircleLayer)).circles.single;
    expect(circle.point.latitude, closeTo(-6.2005, 1e-9));
    expect(circle.radius, 8);
    expect(circle.useRadiusInMeter, isTrue);
  });

  testWidgets('sumber tanpa GPS (demo/izin ditolak): tidak menggambar apa pun',
      (tester) async {
    await tester.pumpWidget(_mapWith(Object()));
    await tester.pump();
    expect(find.byKey(const ValueKey('tapgo-user-location')), findsNothing);
  });

  testWidgets('lingkar akurasi dibatasi agar tidak menutup peta saat sinyal buruk',
      (tester) async {
    final source = _FakeLiveSource();
    addTearDown(source.controller.close);
    await tester.pumpWidget(_mapWith(source));
    source.controller.add(
      const RideLocationFix(lat: -6.2, lng: 106.8, accuracyMeters: 5000),
    );
    await tester.pump();
    final circle = tester.widget<CircleLayer>(find.byType(CircleLayer)).circles.single;
    expect(circle.radius, 250);
  });

  testWidgets('atribusi OSM tidak tampil permanen; tersedia lewat tombol info',
      (tester) async {
    await tester.pumpWidget(_mapWith(Object()));
    expect(find.textContaining('OpenStreetMap'), findsNothing);
    await tester.tap(find.byKey(const ValueKey('tapgo-map-attribution')));
    await tester.pumpAndSettle();
    expect(find.textContaining('OpenStreetMap contributors'), findsOneWidget);
    await tester.tap(find.text('Tutup'));
    await tester.pumpAndSettle();
    expect(find.textContaining('OpenStreetMap'), findsNothing);
  });
}
