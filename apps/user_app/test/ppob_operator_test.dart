import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/features/ppob/domain/ppob_operator.dart';

void main() {
  test('prefiks dikenali per operator (sama dengan tabel backend)', () {
    const cases = {
      '081112345678': 'telkomsel',
      '082312345678': 'telkomsel',
      '085212345678': 'telkomsel',
      '081412345678': 'indosat',
      '085612345678': 'indosat',
      '081712345678': 'xl',
      '087812345678': 'xl',
      '083812345678': 'axis',
      '089512345678': 'tri',
      '089912345678': 'tri',
      '088112345678': 'smartfren',
      '088912345678': 'smartfren',
    };
    cases.forEach((number, operator) {
      expect(detectPpobOperator(number), operator, reason: number);
    });
  });

  test('format +62/62, spasi, dan strip dinormalkan', () {
    expect(normalizePpobMsisdn('+62 812-3456-7890'), '081234567890');
    expect(normalizePpobMsisdn('6281712345678'), '081712345678');
    expect(detectPpobOperator('+6281712345678'), 'xl');
  });

  test('prefiks tak dikenal atau terlalu pendek menghasilkan null', () {
    expect(detectPpobOperator('080012345678'), isNull);
    expect(detectPpobOperator('081'), isNull);
    expect(detectPpobOperator(''), isNull);
  });

  test('daftar operator diurutkan dan berlabel', () {
    expect(ppobOperatorList(['xl', 'telkomsel', 'axis', 'tri']),
        'Axis, Telkomsel, Tri, XL');
  });
}
