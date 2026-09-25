import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

class _FakePlatform implements TapGoPushPlatform {
  _FakePlatform({this.token = 'fcm-token-1', this.initial});

  final String? token;
  final TapGoPushMessage? initial;
  final refreshes = StreamController<String>.broadcast();
  final foreground = StreamController<TapGoPushMessage>.broadcast();
  final opened = StreamController<TapGoPushMessage>.broadcast();
  bool deleted = false;

  @override
  Future<String?> obtainToken() async => token;
  @override
  Stream<String> get tokenRefreshes => refreshes.stream;
  @override
  Stream<TapGoPushMessage> get foregroundMessages => foreground.stream;
  @override
  Stream<TapGoPushMessage> get openedMessages => opened.stream;
  @override
  Future<TapGoPushMessage?> initialMessage() async => initial;
  @override
  Future<void> deleteToken() async => deleted = true;
}

void main() {
  group('tapGoRideReferenceFromPush', () {
    test('menerima referensi perjalanan yang sah', () {
      expect(tapGoRideReferenceFromPush({'rideReference': 'RID-A2B3C4D5E6'}),
          'RID-A2B3C4D5E6');
    });

    test('menolak nilai kosong, hilang, atau berbentuk lain', () {
      expect(tapGoRideReferenceFromPush({}), isNull);
      expect(tapGoRideReferenceFromPush({'rideReference': ''}), isNull);
      expect(tapGoRideReferenceFromPush({'rideReference': '../admin'}), isNull);
      expect(tapGoRideReferenceFromPush({'rideReference': 'rid-a2b3c4d5e6'}),
          isNull);
      expect(
          tapGoRideReferenceFromPush({'rideReference': 'RID-A2B3C4D5E6\nX'}),
          isNull);
    });
  });

  group('TapGoPushController', () {
    late _FakePlatform platform;
    late List<String> registered;
    late List<String> unregistered;
    late List<TapGoPushMessage> shownForeground;
    late List<TapGoPushMessage> openedMessages;

    TapGoPushController build({bool registerFails = false}) {
      registered = [];
      unregistered = [];
      shownForeground = [];
      openedMessages = [];
      return TapGoPushController(
        platform: platform,
        register: (token) async {
          if (registerFails) throw StateError('offline');
          registered.add(token);
        },
        unregister: (token) async => unregistered.add(token),
        onForeground: shownForeground.add,
        onOpened: openedMessages.add,
      );
    }

    test('start mendaftarkan token dan idempoten', () async {
      platform = _FakePlatform();
      final controller = build();
      await controller.start();
      await controller.start();
      expect(registered, ['fcm-token-1']);
    });

    test('token yang diperbarui plugin didaftarkan lagi', () async {
      platform = _FakePlatform();
      final controller = build();
      await controller.start();
      platform.refreshes.add('fcm-token-2');
      await Future<void>.delayed(Duration.zero);
      expect(registered, ['fcm-token-1', 'fcm-token-2']);
    });

    test('tanpa izin (token null) tidak mendaftar apa pun dan tidak melempar',
        () async {
      platform = _FakePlatform(token: null);
      final controller = build();
      await controller.start();
      expect(registered, isEmpty);
    });

    test('kegagalan daftar (offline) tidak melempar dan tidak dicabut nanti',
        () async {
      platform = _FakePlatform();
      final controller = build(registerFails: true);
      await controller.start();
      await controller.stop();
      expect(unregistered, isEmpty);
      expect(platform.deleted, isTrue);
    });

    test('stop mencabut token terdaftar dan berhenti mendengar', () async {
      platform = _FakePlatform();
      final controller = build();
      await controller.start();
      await controller.stop();
      expect(unregistered, ['fcm-token-1']);
      expect(platform.deleted, isTrue);
      platform.foreground
          .add(const TapGoPushMessage(title: 'a', body: 'b'));
      await Future<void>.delayed(Duration.zero);
      expect(shownForeground, isEmpty);
    });

    test('pesan latar depan dan ketukan diteruskan; ketukan awal diproses',
        () async {
      platform = _FakePlatform(
        initial: const TapGoPushMessage(
          title: 'Awal',
          body: '',
          data: {'rideReference': 'RID-A2B3C4D5E6'},
        ),
      );
      final controller = build();
      await controller.start();
      expect(openedMessages.single.title, 'Awal');
      platform.foreground
          .add(const TapGoPushMessage(title: 'Depan', body: 'x'));
      platform.opened.add(const TapGoPushMessage(title: 'Ketuk', body: ''));
      await Future<void>.delayed(Duration.zero);
      expect(shownForeground.single.title, 'Depan');
      expect(openedMessages.map((m) => m.title), ['Awal', 'Ketuk']);
    });
  });
}
