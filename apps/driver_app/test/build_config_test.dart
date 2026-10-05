import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// 6 Okt 2026: AAB driver +11 memuat pustaka TensorFlow Lite x86_64 yang tidak
/// selaras 16 KB, padahal Play mensyaratkan dukungan 16 KB untuk target
/// Android 15+. x86_64 dikeluarkan saat pengemasan; ABI yang dipakai ponsel driver
/// (arm64-v8a dan armeabi-v7a) tetap.
void main() {
  final gradle = File('android/app/build.gradle.kts').readAsStringSync();
  final gate = File('../../scripts/release-gate-driver-app.sh').readAsStringSync();

  test('pustaka x86_64 dikeluarkan saat pengemasan (abiFilters saja tidak berpengaruh)', () {
    expect(gradle, contains('excludes += "lib/x86_64/**"'));
    // arm64-v8a dan armeabi-v7a tidak boleh ikut dikecualikan.
    expect(gradle, isNot(contains('lib/arm64-v8a')));
    expect(gradle, isNot(contains('lib/armeabi-v7a')));
  });

  test('gerbang rilis memeriksa keselarasan 16 KB dan melarang x86_64', () {
    expect(gate, contains('check-native-alignment.sh'));
    expect(gate, contains('--forbid-abi x86_64'));
  });
}
