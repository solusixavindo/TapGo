import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

import 'ppob_visual_evidence_test.dart' show loadRealFonts;

/// Bukti visual pemilih lokasi: titik biru posisi pengguna + lingkar akurasi,
/// pin jemput hijau di tengah, tombol lokasi saya, dan atribusi di balik "i".
/// TIDAK berjalan pada `flutter test` biasa:
///
///   flutter test test/map_visual_evidence_test.dart \
///     --dart-define=TAPGO_MAP_VISUAL=true --update-goldens
const bool _enabled = bool.fromEnvironment('TAPGO_MAP_VISUAL');

class _LivePort extends DemoLocationPort implements LiveLocationSource {
  @override
  Stream<RideLocationFix> watchPosition() => Stream.value(
        const RideLocationFix(lat: -6.1754, lng: 106.8272, accuracyMeters: 38),
      );
}

void main() {
  testWidgets('pemilih lokasi jemput dengan titik biru pengguna', (tester) async {
    expect(await loadRealFonts(), isTrue);
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: tapGoReadableTheme(),
        home: Scaffold(
          body: RideLocationPickerSheet(
            port: _LivePort(),
            title: 'Titik jemput',
            initial: const RideLocation(
              id: 'x',
              label: 'Jl. Mandor Naiman no. 78',
              address: 'Jl. Mandor Naiman No.78, Pasir Jambu, Sukaraja',
              lat: -6.1754,
              lng: 106.8272,
            ),
          ),
        ),
      ),
    );
    for (var i = 0; i < 15; i++) {
      await tester.pump(const Duration(milliseconds: 80));
    }
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('../../../docs/release-2/visual-review/r2.11-map/01_picker_user_dot.png'),
    );
  }, skip: !_enabled);
}
