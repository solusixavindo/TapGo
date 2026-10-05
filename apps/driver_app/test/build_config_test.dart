import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// 6 Okt 2026: AAB driver +11 memuat pustaka TensorFlow Lite x86_64 yang tidak
/// selaras 16 KB, padahal Play mensyaratkan dukungan 16 KB untuk target
/// Android 15+. x86_64 dikeluarkan dari build; ABI yang dipakai ponsel driver
/// (arm64-v8a dan armeabi-v7a) tetap.
void main() {
  final gradle = File('android/app/build.gradle.kts').readAsStringSync();
  final gate = File('../../scripts/release-gate-driver-app.sh').readAsStringSync();

  test('abiFilters hanya arm64-v8a dan armeabi-v7a, tanpa x86_64', () {
    final match = RegExp(r'abiFilters\s*\+=\s*listOf\(([^)]*)\)').firstMatch(gradle);
    expect(match, isNotNull, reason: 'ndk { abiFilters } hilang dari build.gradle.kts');
    final abis = match!.group(1)!;
    expect(abis, contains('"arm64-v8a"'));
    expect(abis, contains('"armeabi-v7a"'));
    expect(abis, isNot(contains('x86')));
  });

  test('gerbang rilis memeriksa keselarasan 16 KB dan melarang x86_64', () {
    expect(gate, contains('check-native-alignment.sh'));
    expect(gate, contains('--forbid-abi x86_64'));
  });
}
