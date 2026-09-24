import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:tapgo_user_app/main.dart';

/// Menu Akun (dengan tile Ubah Password) tidak boleh overflow pada layar kecil,
/// teks diperbesar, maupun tema gelap, dan semua tile tetap terbaca.
Future<Set<String>> renderAccount(
  WidgetTester tester, {
  required double width,
  required double height,
  double textScale = 1.0,
  Brightness brightness = Brightness.light,
}) async {
  tapGoDisablePersistenceForTests = true;
  tapGoDashboardVisualFixtureEnabledForTests = true;
  addTearDown(() {
    tapGoDashboardVisualFixtureEnabledForTests = false;
    tapGoDisablePersistenceForTests = false;
  });
  final overflows = <String>{};
  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    final message = details.exception.toString().split('\n').first;
    if (message.contains('overflowed')) {
      overflows.add(message);
    } else {
      previous?.call(details);
    }
  };
  addTearDown(() => FlutterError.onError = previous);
  tester.view.physicalSize = Size(width * 3, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        theme: tapGoReadableTheme(brightness: brightness),
        home: MediaQuery(
          data: MediaQueryData(
            size: Size(width, height),
            textScaler: TextScaler.linear(textScale),
          ),
          child: const TapGoDashboard(),
        ),
      ),
    ),
  );
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  await tester.tap(find.text('Akun').last);
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  return overflows;
}

void main() {
  for (final config in const <(String, double, double, double, Brightness)>[
    ('320x640', 320, 640, 1.0, Brightness.light),
    ('360x800', 360, 800, 1.0, Brightness.light),
    ('320x640 teks 1.8', 320, 640, 1.8, Brightness.light),
    ('360x800 tema gelap', 360, 800, 1.0, Brightness.dark),
  ]) {
    testWidgets('menu Akun bersih: ${config.$1}', (tester) async {
      final overflows = await renderAccount(
        tester,
        width: config.$2,
        height: config.$3,
        textScale: config.$4,
        brightness: config.$5,
      );
      expect(overflows, isEmpty);
      for (final label in const [
        'Kartu Anggota',
        'Profil',
        'Ubah Password',
        'Tiket Bantuan'
      ]) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
    });
  }

  testWidgets('menu Akun menampilkan versi aplikasi', (tester) async {
    PackageInfo.setMockInitialValues(
      appName: 'TapGo',
      packageName: 'com.xavindo.tapgo',
      version: '2.0.1',
      buildNumber: '28',
      buildSignature: '',
    );
    await renderAccount(tester, width: 360, height: 800);
    await tester.ensureVisible(find.textContaining('TapGo versi'));
    expect(find.text('TapGo versi 2.0.1 (28)'), findsOneWidget);
  });
}
