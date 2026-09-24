import 'package:flutter_test/flutter_test.dart';
import 'package:tapgo_user_app/main.dart';

/// Pengguna versi 2.0.1+28 memperbarui aplikasi TANPA login ulang: sesi yang
/// tersimpan di HP (ditulis oleh +28, memuat bidang yang kini sudah dihapus)
/// harus tetap terbaca utuh, dan sesi baru tidak lagi menyimpan bidang lama,
/// termasuk lokasi foto KTP/selfie.
const session28 = <String, dynamic>{
  'userId': 'user-1',
  'email': 'uji@example.test',
  'role': 'USER',
  'accessToken': 'access-token-28',
  'refreshToken': 'refresh-token-28',
  'isDemoMode': false,
  'selfieImagePath': '/data/user/0/com.xavindo.tapgo/cache/selfie.jpg',
  'ktpImagePath': '/data/user/0/com.xavindo.tapgo/cache/ktp.jpg',
  'lastInvoiceNumber': 'INV-1',
  'membershipJoinedAt': '2026-07-20',
  'userName': 'Pengguna Uji',
  'phone': '081234567890',
  'activePackageName': 'Basic',
  'walletBalance': 125000,
  'ppobBalance': 5000,
  'referralCode': 'TAPGO123',
  'directSponsor': 3,
  'downline': 8,
  'activeLevel': 2,
  'todayBonus': 1000,
  'transactions': [
    {'title': 'Bonus', 'description': 'x', 'amount': 1000, 'status': 'Sukses'},
  ],
};

void main() {
  test('sesi tersimpan dari +28 terbaca utuh (tidak dipaksa login ulang)', () {
    final session = tapGoSessionFromJsonForTests(Map.of(session28));
    expect(session.accessToken, 'access-token-28');
    expect(session.refreshToken, 'refresh-token-28');
    expect(session.isDemoMode, isFalse);
    expect(session.userName, 'Pengguna Uji');
    expect(session.phone, '081234567890');
    expect(session.activePackageName, 'Basic');
    expect(session.walletBalance, 125000);
    expect(session.ppobBalance, 5000);
    expect(session.referralCode, 'TAPGO123');
    expect(session.lastInvoiceNumber, 'INV-1');
  });

  test('sesi yang ditulis ulang tidak lagi memuat KTP/selfie/referral/komisi',
      () {
    final rewritten = tapGoSessionToJsonForTests(
        tapGoSessionFromJsonForTests(Map.of(session28)));
    for (final removed in const [
      'selfieImagePath',
      'ktpImagePath',
      'directSponsor',
      'downline',
      'activeLevel',
      'todayBonus',
      'transactions',
    ]) {
      expect(rewritten.containsKey(removed), isFalse, reason: removed);
    }
    expect(rewritten['accessToken'], 'access-token-28');
  });
}
