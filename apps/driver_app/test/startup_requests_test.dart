import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/main.dart';

/// Pembukaan aplikasi driver: pemeriksaan sesi sudah membaca perjalanan aktif, jadi pemuatan ruang kerja yang langsung
/// menyusul tidak boleh mengulang permintaan yang sama (sebelumnya dua putaran jaringan berurutan sebelum beranda tampil).
/// Pembacaan sesudahnya (polling, setelah terima/batal) tetap selalu ke server.
void main() {
  test('restoreSession membaca /driver/rides/current sekali; currentRide pertama memakai hasilnya, berikutnya ke server',
      () async {
    final paths = <String>[];
    final server = await HttpServer.bind('127.0.0.1', 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) {
      paths.add(request.uri.path);
      request.response
        ..statusCode = 200
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({
          'success': true,
          'data': {'isNull': true},
        }));
      request.response.close();
    });
    final store = MemorySessionStore();
    await store.save(const DriverSession(
      accessToken: 'access-uji',
      refreshToken: 'refresh-uji',
      driverName: 'Driver Uji',
    ));
    final repo = ApiDriverRepository(
      baseUrl: 'http://127.0.0.1:${server.port}/api/v1',
      storage: store,
      enforceTlsPinning: false,
    );

    final session = await repo.restoreSession();
    expect(session, isNotNull);
    expect(paths, ['/api/v1/driver/rides/current']);

    // refreshWorkspace pertama setelah restore: dilayani dari hasil pemeriksaan sesi, tanpa permintaan baru.
    expect(await repo.currentRide(), isNull);
    expect(paths.length, 1, reason: 'tidak boleh mengulang permintaan yang baru saja dibaca');

    // Pembacaan berikutnya (polling) selalu ke server.
    expect(await repo.currentRide(), isNull);
    expect(paths.length, 2);
    expect(await repo.currentRide(), isNull);
    expect(paths.length, 3);
  });
}
