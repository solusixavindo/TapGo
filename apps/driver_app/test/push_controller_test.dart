import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_driver_app/main.dart';

/// Pendaftaran token tidak lagi ditunggu start() (menunggu pilihan bunyi terbaca),
/// jadi logout yang cepat harus tetap mencabut token: kalau tidak, push untuk akun
/// lama masih sampai ke HP ini.
class _Platform implements DriverPushPlatform {
  @override
  Future<String?> obtainToken() async => 'tok-abcdefghijklmnopqrstuvwxyz';
  @override
  Stream<String> get tokenRefreshes => const Stream.empty();
  @override
  Stream<DriverPushMessage> get foregroundMessages => const Stream.empty();
  @override
  Stream<DriverPushMessage> get openedMessages => const Stream.empty();
  @override
  Future<void> deleteToken() async {}
  @override
  Future<void> showForegroundAlert(DriverPushMessage message) async {}
}

void main() {
  test('logout saat pendaftaran token masih berjalan tetap mencabut token itu', () async {
    final registerGate = Completer<void>();
    final registered = <String>[];
    final unregistered = <String>[];
    final controller = DriverPushController(
      platform: _Platform(),
      register: (token) async {
        await registerGate.future; // pendaftaran lambat (menunggu pilihan bunyi)
        registered.add(token);
      },
      unregister: (token) async => unregistered.add(token),
      onMessage: (_, {required opened}) {},
    );
    await controller.start();
    expect(registered, isEmpty);
    await controller.stop();
    expect(unregistered, ['tok-abcdefghijklmnopqrstuvwxyz']);
    registerGate.complete();
  });

  test('pendaftaran ulang memakai token yang sama', () async {
    final registered = <String>[];
    final controller = DriverPushController(
      platform: _Platform(),
      register: (token) async => registered.add(token),
      unregister: (_) async {},
      onMessage: (_, {required opened}) {},
    );
    await controller.start();
    await Future<void>.delayed(Duration.zero);
    await controller.reregister();
    expect(registered, ['tok-abcdefghijklmnopqrstuvwxyz', 'tok-abcdefghijklmnopqrstuvwxyz']);
    await controller.stop();
  });
}
