import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/domain/ppob_models.dart';
import 'package:tapgo_user_app/features/ppob/presentation/widgets/ppob_shared.dart';
import 'package:tapgo_user_app/main.dart';

/// Laporan Owner 9 Okt 2026 (tapgo-user 2.0.5+43 di Play):
///  (1) pembeli token listrik tidak menerima nomor tokennya walau transaksi sukses di
///      Digiflazz — server menyimpan `sn` tetapi tidak mengirimnya, dan aplikasi tidak
///      punya kolom maupun tampilan untuk nomor itu;
///  (4) pendaftaran dengan nomor HP sembarangan — validator aplikasi hanya memeriksa
///      awalan dan minimal 10 digit.

PpobOrder _order({
  PpobOrderStatus status = PpobOrderStatus.success,
  String category = 'PLN_PREPAID',
  String? serial,
}) =>
    PpobOrder(
      id: 'PPB-1',
      status: status,
      sku: 'PLN_50K',
      productName: 'Token PLN Rp50.000',
      categoryCode: category,
      targetNumber: '12345678901',
      amount: 51500,
      benefitAmount: 51500,
      balanceAmount: 0,
      serialNumber: serial,
    );

Widget _host(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('serialNumber dari server', () {
    Map<String, dynamic> json(Object? serial) => {
          'id': 'PPB-1',
          'status': 'SUCCESS',
          'sku': 'PLN_50K',
          'productName': 'Token PLN Rp50.000',
          'categoryCode': 'PLN_PREPAID',
          'targetNumber': '12345678901',
          'amount': '51500.00',
          'benefitAmount': '51500.00',
          'balanceAmount': '0.00',
          'serialNumber': serial,
        };

    test('dibaca dari respons /orders dan dirapikan', () {
      final order = PpobOrder.fromJson(json('  1234-5678-9012-3456-7890/BUDI/R1/1300/36,8 '));
      expect(order.serialNumber, '1234-5678-9012-3456-7890/BUDI/R1/1300/36,8');
    });

    test('null, kosong, atau bukan teks menjadi null (tidak pernah "null" di layar)', () {
      expect(PpobOrder.fromJson(json(null)).serialNumber, isNull);
      expect(PpobOrder.fromJson(json('   ')).serialNumber, isNull);
      expect(PpobOrder.fromJson(json(12345)).serialNumber, isNull);
      final withoutKey = json(null)..remove('serialNumber');
      expect(PpobOrder.fromJson(withoutKey).serialNumber, isNull);
    });
  });

  group('pemrosesan nomor token', () {
    test('memisahkan nomor token dari keterangan setelah garis miring pertama', () {
      final parts = ppobSplitSerial('1234-5678-9012-3456-7890/BUDI SANTOSO/R1/1300/36,8');
      expect(parts.primary, '1234-5678-9012-3456-7890');
      expect(parts.detail, 'BUDI SANTOSO/R1/1300/36,8');
      expect(ppobSplitSerial('ABC123').detail, isNull);
      expect(ppobSplitSerial('ABC123').primary, 'ABC123');
      expect(ppobSplitSerial('/oops').primary, '/oops');
    });

    test('token 20 digit polos dikelompokkan empat-empat, bentuk lain tidak diubah', () {
      expect(ppobFormatToken('12345678901234567890'), '1234-5678-9012-3456-7890');
      expect(ppobFormatToken('1234-5678-9012-3456-7890'), '1234-5678-9012-3456-7890');
      expect(ppobFormatToken('SN-ABC-1'), 'SN-ABC-1');
      expect(ppobFormatToken('1234567890123456789'), '1234567890123456789');
    });

    test('label token listrik hanya untuk PLN prabayar', () {
      expect(ppobSerialLabel('PLN_PREPAID'), 'Nomor token listrik');
      expect(ppobSerialLabel('PULSA'), 'Nomor referensi');
      expect(ppobSerialLabel('BPJS'), 'Nomor referensi');
    });
  });

  group('tampilan nomor token', () {
    testWidgets('transaksi sukses menampilkan token besar, keterangan, dan tombol salin', (tester) async {
      await tester.pumpWidget(_host(PpobSerialNumberBlock(
        order: _order(serial: '12345678901234567890/BUDI/R1/1300/36,8'),
      )));
      expect(find.text('Nomor token listrik'), findsOneWidget);
      expect(find.text('1234-5678-9012-3456-7890'), findsOneWidget);
      expect(find.text('BUDI/R1/1300/36,8'), findsOneWidget);
      expect(find.byKey(const ValueKey('ppob-serial-copy')), findsOneWidget);
    });

    testWidgets('tombol salin menaruh HANYA nomor token di papan klip', (tester) async {
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = (call.arguments as Map)['text'] as String?;
        }
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));

      await tester.pumpWidget(_host(PpobSerialNumberBlock(
        order: _order(serial: '1234-5678-9012-3456-7890/BUDI/R1/1300/36,8'),
      )));
      await tester.tap(find.byKey(const ValueKey('ppob-serial-copy')));
      await tester.pump();
      expect(copied, '1234-5678-9012-3456-7890');
      expect(find.text('Nomor disalin'), findsOneWidget);
    });

    testWidgets('tidak tampil bila belum sukses, gagal, atau tanpa nomor', (tester) async {
      for (final order in [
        _order(status: PpobOrderStatus.processing, serial: '1234'),
        _order(status: PpobOrderStatus.pending, serial: '1234'),
        _order(status: PpobOrderStatus.refunded, serial: '1234'),
        _order(status: PpobOrderStatus.failed, serial: '1234'),
        _order(serial: null),
      ]) {
        await tester.pumpWidget(_host(PpobSerialNumberBlock(order: order)));
        expect(find.byKey(const ValueKey('ppob-serial-block')), findsNothing, reason: '${order.status}');
      }
    });

    testWidgets('bentuk ringkas di riwayat memuat label, token, dan tombol salin', (tester) async {
      await tester.pumpWidget(_host(PpobSerialNumberBlock(
        order: _order(serial: '12345678901234567890/BUDI/R1'),
        compact: true,
      )));
      expect(find.text('Nomor token listrik'), findsOneWidget);
      expect(find.text('1234-5678-9012-3456-7890'), findsOneWidget);
      expect(find.byKey(const ValueKey('ppob-serial-copy')), findsOneWidget);
    });
  });

  group('nomor HP pendaftaran', () {
    test('menerima nomor seluler Indonesia sungguhan dalam berbagai penulisan', () {
      for (final phone in [
        '081355503217', '+6281355503217', '6281355503217', '0813-5550-3217', '0813 5550 3217',
        '0811234098', '08211045672', '085712098374', '0895123450987', '087812345098',
        '0881098712345', '0831 9876 2310',
      ]) {
        expect(tapGoIsPlausibleRegistrationPhone(phone), isTrue, reason: phone);
        expect(tapGoRegistrationPhoneValidatorMessage(phone), isNull, reason: phone);
      }
    });

    test('menolak yang bukan seluler Indonesia, terlalu pendek/panjang, dan pola rekaan', () {
      for (final phone in [
        '0800123456789', '0801234567', '0211234567', '07123456789', '0812345', '081355503',
        '08135550321712', '081355503217123', '+14155550123', '081111111111', '082222222222',
        '0812345678901', '081234567890', '089876543210', '087777777788', '08550000000012',
      ]) {
        expect(tapGoIsPlausibleRegistrationPhone(phone), isFalse, reason: phone);
        expect(tapGoRegistrationPhoneValidatorMessage(phone), 'Nomor HP tidak valid', reason: phone);
      }
    });

    test('tidak menolak nomor sungguhan yang kebetulan memuat sedikit pengulangan atau urutan', () {
      for (final phone in ['081300055512', '081255512345', '0857 1234 9876', '081333344455', '082198765012']) {
        expect(tapGoIsPlausibleRegistrationPhone(phone), isTrue, reason: phone);
      }
    });

    test('kosong tetap "wajib diisi"; aturan login TIDAK diperketat (akun lama tetap bisa masuk)', () {
      expect(tapGoRegistrationPhoneValidatorMessage(''), 'Nomor HP wajib diisi');
      expect(tapGoPhoneValidatorMessage('081234567890'), isNull);
      expect(tapGoPhoneValidatorMessage('08500000001'), isNull);
    });
  });
}
