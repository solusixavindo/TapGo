import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Ganti tema (terang <-> gelap) tidak boleh memunculkan galat tampilan pada
/// layar mana pun. Pada 2.0.4+31 pengguna melihat "Terjadi gangguan tampilan"
/// saat beralih dari gelap ke terang.
final _mode = StateProvider<ThemeMode>((ref) => ThemeMode.light);

Future<List<String>> switchThemes(
  WidgetTester tester, {
  required String tab,
  required List<ThemeMode> sequence,
}) async {
  tapGoDisablePersistenceForTests = true;
  tapGoDashboardVisualFixtureEnabledForTests = true;
  addTearDown(() {
    tapGoDashboardVisualFixtureEnabledForTests = false;
    tapGoDisablePersistenceForTests = false;
  });
  final errors = <String>[];
  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    errors.add(details.exceptionAsString().split('\n').first);
  };
  addTearDown(() => FlutterError.onError = previous);
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);

  final container = ProviderContainer();
  addTearDown(container.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: Consumer(
        builder: (context, ref, _) => MaterialApp(
          theme: tapGoReadableTheme(),
          darkTheme: tapGoReadableTheme(brightness: Brightness.dark),
          themeMode: ref.watch(_mode),
          home: const TapGoDashboard(),
        ),
      ),
    ),
  );
  for (var i = 0; i < 15; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  if (tab != 'Beranda') {
    await tester.tap(find.text(tab).last);
    for (var i = 0; i < 15; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }
  for (final mode in sequence) {
    container.read(_mode.notifier).state = mode;
    for (var i = 0; i < 12; i++) {
      await tester.pump(const Duration(milliseconds: 60));
    }
  }
  return errors;
}

void main() {
  tinyWidthTests();
  for (final tab in ['Beranda', 'Aktivitas', 'Chat', 'Akun']) {
    testWidgets('ganti tema terang/gelap di tab $tab tanpa galat', (tester) async {
      final errors = await switchThemes(
        tester,
        tab: tab,
        sequence: [
          ThemeMode.dark,
          ThemeMode.light,
          ThemeMode.dark,
          ThemeMode.light,
        ],
      );
      expect(errors, isEmpty);
    });
  }

  testWidgets('ganti tema lewat layar Tampilan (alur pengguna) tanpa galat',
      (tester) async {
    tapGoDisablePersistenceForTests = true;
    tapGoDashboardVisualFixtureEnabledForTests = true;
    addTearDown(() {
      tapGoDashboardVisualFixtureEnabledForTests = false;
      tapGoDisablePersistenceForTests = false;
    });
    final errors = <String>[];
    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      errors.add(details.exceptionAsString().split('\n').first);
    };
    addTearDown(() => FlutterError.onError = previous);
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        child: Consumer(
          builder: (context, ref, _) => MaterialApp(
            theme: tapGoReadableTheme(),
            darkTheme: tapGoReadableTheme(brightness: Brightness.dark),
            themeMode: ref.watch(tapGoThemePreferenceProvider).themeMode,
            home: const TapGoDashboard(),
          ),
        ),
      ),
    );
    Future<void> settle([int frames = 15]) async {
      for (var i = 0; i < frames; i++) {
        await tester.pump(const Duration(milliseconds: 80));
      }
    }

    await settle(20);
    await tester.tap(find.text('Akun').last);
    await settle();
    await tester.tap(find.text('Tampilan').first);
    await settle();
    for (final option in [
      'theme_option_dark',
      'theme_option_light',
      'theme_option_dark',
      'theme_option_system',
      'theme_option_light',
    ]) {
      await tester.tap(find.byKey(ValueKey(option)));
      await settle();
    }
    expect(errors, isEmpty);
  });
}

/// Regresi 2.0.4+31/2.0.5+32: grid layanan menghitung lebar sel negatif saat
/// mendapat lebar sangat kecil/nol, sehingga membangun SizedBox berlebar
/// negatif dan memicu "Terjadi gangguan tampilan".
void tinyWidthTests() {
  for (final width in [0.0, 12.0, 30.0, 36.0]) {
    testWidgets('grid layanan aman pada lebar $width', (tester) async {
      tapGoDisablePersistenceForTests = true;
      tapGoDashboardVisualFixtureEnabledForTests = true;
      addTearDown(() {
        tapGoDashboardVisualFixtureEnabledForTests = false;
        tapGoDisablePersistenceForTests = false;
      });
      final errors = <String>[];
      final previous = FlutterError.onError;
      FlutterError.onError = (details) {
        errors.add(details.exceptionAsString().split('\n').first);
      };
      addTearDown(() => FlutterError.onError = previous);
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: Align(
              alignment: Alignment.topLeft,
              child: SizedBox(width: width, child: const TapGoDashboard()),
            ),
          ),
        ),
      );
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(errors.where((e) => e.contains('negative')), isEmpty);
    });
  }
}
