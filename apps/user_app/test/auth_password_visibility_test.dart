import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Formulir Kendala 02/SPT-TAPGO/XAV/XI/2026 butir 3: pengguna dapat melihat password saat registrasi
/// supaya tidak salah mengetik. Kolom password dipakai bersama layar Masuk dan Register.
Future<void> openAuth(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(const ProviderScope(child: TapGoUserApp()));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 5200));
  await tester.pumpAndSettle();
}

bool passwordObscured(WidgetTester tester) {
  final field = find.byType(TextFormField).last;
  final editable = find.descendant(of: field, matching: find.byType(EditableText));
  return tester.widget<EditableText>(editable).obscureText;
}

void main() {
  setUp(() => tapGoDisablePersistenceForTests = true);
  tearDown(() => tapGoDisablePersistenceForTests = false);

  testWidgets('Register: password tersembunyi lalu bisa dilihat dan disembunyikan lagi',
      (tester) async {
    await openAuth(tester);
    await tester.tap(find.text('Register').first);
    await tester.pumpAndSettle();

    final toggle = find.byKey(const ValueKey('auth-password-visibility'));
    expect(toggle, findsOneWidget);
    await tester.enterText(find.byType(TextFormField).last, 'rahasia-uji-123');
    expect(passwordObscured(tester), isTrue, reason: 'bawaan tersembunyi');
    expect(find.byIcon(Icons.visibility_off_rounded), findsOneWidget);

    await tester.ensureVisible(toggle);
    await tester.tap(toggle);
    await tester.pump();
    expect(passwordObscured(tester), isFalse, reason: 'tampil setelah tombol mata');
    expect(find.byIcon(Icons.visibility_rounded), findsOneWidget);
    // Isi yang sudah diketik tidak hilang saat tombol ditekan.
    expect(find.text('rahasia-uji-123'), findsOneWidget);

    await tester.tap(toggle);
    await tester.pump();
    expect(passwordObscured(tester), isTrue, reason: 'tersembunyi lagi');
  });

  testWidgets('Masuk: kolom password yang sama juga punya tombol mata', (tester) async {
    await openAuth(tester);
    final toggle = find.byKey(const ValueKey('auth-password-visibility'));
    expect(toggle, findsOneWidget);
    expect(passwordObscured(tester), isTrue);
    await tester.ensureVisible(toggle);
    await tester.tap(toggle);
    await tester.pump();
    expect(passwordObscured(tester), isFalse);
  });
}
