import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/application/ppob_order_watcher.dart';
import 'package:tapgo_user_app/features/ppob/domain/ppob_models.dart';

/// Kasus Juhri (9 Okt 2026): token PLN dibayar tetapi tertahan "Diproses" di server.
/// Layar hasil harus memperbarui diri sampai token datang, tanpa pembeli keluar-masuk.

PpobOrder _order(PpobOrderStatus status,
        {String? serial, String id = 'PPB-1'}) =>
    PpobOrder(
      id: id,
      status: status,
      sku: 'PLN_TOKEN_20',
      productName: 'Token PLN 20.000',
      categoryCode: 'PLN_PREPAID',
      targetNumber: '561100520563',
      amount: 20500,
      benefitAmount: 20500,
      balanceAmount: 0,
      serialNumber: serial,
    );

void main() {
  // testWidgets memberi jam palsu: pump(durasi) memajukan Timer tanpa menunggu sungguhan.
  testWidgets(
      'memantau order Diproses lalu menyerahkan hasil akhir berisi token dan berhenti',
      (tester) async {
    {
      final answers = <List<PpobOrder>>[
        [_order(PpobOrderStatus.processing)],
        [_order(PpobOrderStatus.processing)],
        [
          _order(PpobOrderStatus.success,
              serial: '1061-9332-9912-1453-6226/SAAMAH')
        ],
      ];
      var asked = 0;
      final updates = <PpobOrder>[];
      final watcher = PpobOrderWatcher(
        fetchOrders: () async =>
            answers[asked++ < answers.length ? asked - 1 : answers.length - 1],
        onUpdate: updates.add,
        interval: const Duration(seconds: 6),
      );

      watcher.watch(_order(PpobOrderStatus.processing));
      expect(watcher.isWatching, isTrue);

      await tester.pump(const Duration(seconds: 6));
      expect(updates, isEmpty); // belum berubah: tidak ada pembaruan palsu

      await tester.pump(const Duration(seconds: 6));
      await tester.pump(const Duration(seconds: 6));
      expect(updates, hasLength(1));
      expect(updates.single.status, PpobOrderStatus.success);
      expect(updates.single.serialNumber, '1061-9332-9912-1453-6226/SAAMAH');
      expect(watcher.isWatching, isFalse);

      final askedBefore = asked;
      await tester.pump(const Duration(minutes: 5));
      expect(asked, askedBefore, reason: 'setelah final tidak bertanya lagi');
    }
  });

  testWidgets('order yang sudah final tidak dipantau sama sekali',
      (tester) async {
    {
      var asked = 0;
      final watcher = PpobOrderWatcher(
        fetchOrders: () async {
          asked++;
          return [];
        },
        onUpdate: (_) {},
      );
      watcher.watch(_order(PpobOrderStatus.success, serial: 'X'));
      expect(watcher.isWatching, isFalse);
      await tester.pump(const Duration(minutes: 2));
      expect(asked, 0);
    }
  });

  testWidgets(
      'gagal jaringan tidak menghentikan pemantauan; berhenti setelah batas percobaan',
      (tester) async {
    {
      var asked = 0;
      final watcher = PpobOrderWatcher(
        fetchOrders: () async {
          asked++;
          throw Exception('offline');
        },
        onUpdate: (_) => fail('tidak boleh ada pembaruan'),
        interval: const Duration(seconds: 1),
        maxTicks: 5,
      );
      watcher.watch(_order(PpobOrderStatus.pending));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(seconds: 1));
      }
      expect(asked, 5);
      expect(watcher.isWatching, isFalse);
    }
  });

  testWidgets('order lain di daftar diabaikan; stop() menghentikan segera',
      (tester) async {
    {
      final updates = <PpobOrder>[];
      final watcher = PpobOrderWatcher(
        fetchOrders: () async =>
            [_order(PpobOrderStatus.success, serial: 'Z', id: 'PPB-LAIN')],
        onUpdate: updates.add,
        interval: const Duration(seconds: 1),
      );
      watcher.watch(_order(PpobOrderStatus.processing));
      for (var i = 0; i < 3; i++) {
        await tester.pump(const Duration(seconds: 1));
      }
      expect(updates, isEmpty);
      watcher.stop();
      expect(watcher.isWatching, isFalse);
    }
  });
}
