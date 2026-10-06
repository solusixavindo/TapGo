import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';

/// 6 Okt 2026: logo ikon driver terlihat sangat kecil (gambar hanya 48% lebar
/// kanvas adaptif, bergaris halus, di atas latar emas). Sekarang lambang perisai
/// singa-T resmi diperbesar hingga hampir memenuhi area terlihat (72 dp dari 108)
/// di atas latar emas dengan lambang navy (dibedakan dari ikon penumpang). Tes ini menjaga ukurannya dan kelengkapan berkas.

const res = 'android/app/src/main/res';

Future<({int w, int h, double inkWidth, double inkHeight, ui.Image image})> inkOf(
    String path) async {
  final bytes = File(path).readAsBytesSync();
  final codec = await ui.instantiateImageCodec(bytes);
  final image = (await codec.getNextFrame()).image;
  final data = (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
  var minX = image.width, maxX = -1, minY = image.height, maxY = -1;
  for (var y = 0; y < image.height; y++) {
    for (var x = 0; x < image.width; x++) {
      final alpha = data.getUint8((y * image.width + x) * 4 + 3);
      if (alpha > 40) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return (
    w: image.width,
    h: image.height,
    inkWidth: (maxX - minX + 1) / image.width,
    inkHeight: (maxY - minY + 1) / image.height,
    image: image,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const adaptive = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432};
  const legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192};
  const status = {'mdpi': 24, 'hdpi': 36, 'xhdpi': 48, 'xxhdpi': 72, 'xxxhdpi': 96};

  test('foreground adaptif: lambang ≥ 55% lebar kanvas dan tidak melewati area terlihat (≤ 70%)', () async {
    for (final entry in adaptive.entries) {
      final ink = await inkOf('$res/mipmap-${entry.key}/ic_launcher_foreground.png');
      expect(ink.w, entry.value, reason: entry.key);
      expect(ink.h, entry.value, reason: entry.key);
      expect(ink.inkWidth, greaterThanOrEqualTo(0.55), reason: 'terlalu kecil di ${entry.key}');
      expect(ink.inkWidth, lessThanOrEqualTo(0.70), reason: 'melewati area terlihat di ${entry.key}');
      expect(ink.inkHeight, lessThanOrEqualTo(0.70), reason: entry.key);
    }
  });

  test('lapisan monokrom (ikon bertema) berukuran sama dan berisi lambang', () async {
    for (final entry in adaptive.entries) {
      final ink = await inkOf('$res/mipmap-${entry.key}/ic_launcher_monochrome.png');
      expect(ink.w, entry.value);
      expect(ink.inkWidth, greaterThanOrEqualTo(0.55));
    }
  });

  test('ikon legacy (Android 7) dan ikon kecil notifikasi lengkap di semua densitas', () async {
    for (final entry in legacy.entries) {
      final image = await inkOf('$res/mipmap-${entry.key}/ic_launcher.png');
      expect(image.w, entry.value, reason: 'legacy ${entry.key}');
    }
    for (final entry in status.entries) {
      final ink = await inkOf('$res/drawable-${entry.key}/ic_stat_tapgo.png');
      expect(ink.w, entry.value, reason: 'status ${entry.key}');
      expect(ink.inkWidth, greaterThanOrEqualTo(0.7), reason: 'ikon kecil terlalu kecil');
    }
  });

  test('XML adaptif: latar emas penuh, foreground, dan monokrom', () {
    final xml = File('$res/mipmap-anydpi-v26/ic_launcher.xml').readAsStringSync();
    expect(xml, contains('@color/ic_launcher_background'));
    expect(xml, contains('@mipmap/ic_launcher_foreground'));
    expect(xml, contains('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>'));
    final colors = File('$res/values/ic_launcher_background.xml').readAsStringSync();
    expect(colors, contains('<color name="ic_launcher_background">#FFC857</color>'));
  });

  test('manifest memakai ikon kecil dan warna aksen notifikasi; Dart memakai drawable yang sama', () {
    final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
    expect(manifest, contains('com.google.firebase.messaging.default_notification_icon'));
    expect(manifest, contains('@drawable/ic_stat_tapgo'));
    expect(manifest, contains('com.google.firebase.messaging.default_notification_color'));
    final push = File('lib/features/driver/push/driver_push.dart').readAsStringSync();
    expect(push, contains("const driverNotificationIcon = 'ic_stat_tapgo';"));
    expect(push, isNot(contains("'@mipmap/ic_launcher'")));
    expect(File('$res/raw/keep.xml').readAsStringSync(), contains('@drawable/ic_stat_tapgo'));
  });

  test('ikon Play Store 512: berukuran 512, penuh (tanpa transparansi pada versi flat), lambang besar', () async {
    final play = await inkOf('../../google-play-assets/driver/tapgo-driver-icon-512.png');
    expect(play.w, 512);
    expect(play.h, 512);
    final flat = File('../../google-play-assets/driver/tapgo-driver-icon-512-flat.png').readAsBytesSync();
    // Byte 25 kepala PNG: jenis warna (2 = RGB tanpa alpha, 6 = RGBA).
    expect(flat[25], 2);
    expect(flat.length, lessThan(1024 * 1024));
    // Latar emas, beda dari ikon penumpang (piksel pojok), lambang menempati ±68% lebar.
    final raw = (await play.image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
    expect([raw.getUint8(0), raw.getUint8(1), raw.getUint8(2)], [255, 200, 87]);
  });
}
