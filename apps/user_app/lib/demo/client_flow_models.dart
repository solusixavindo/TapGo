class DemoClientSession {
  const DemoClientSession({
    this.userId,
    this.email,
    this.role = 'USER',
    this.accessToken,
    this.refreshToken,
    this.isDemoMode = true,
    this.lastInvoiceNumber,
    this.membershipJoinedAt,
    required this.userName,
    required this.phone,
    required this.activePackageName,
    required this.walletBalance,
    required this.ppobBalance,
    required this.referralCode,
    this.earningsBalance = 0,
    this.lockedBonusBalance = 0,
    this.depositBalance = 0,
    this.lockPercent = 0,
  });

  factory DemoClientSession.initial() {
    return const DemoClientSession(
      userName: 'Member TapGo',
      phone: '',
      activePackageName: 'Basic',
      walletBalance: 0,
      ppobBalance: 0,
      referralCode: '-',
    );
  }

  final String? userId;
  final String? email;
  final String role;
  final String? accessToken;
  final String? refreshToken;
  final bool isDemoMode;
  final String? lastInvoiceNumber;
  final String? membershipJoinedAt;
  final String userName;
  final String phone;
  final String activePackageName;
  final int walletBalance;
  final int ppobBalance;
  final String referralCode;

  /// Rincian Saldo TapGo dari server (hanya tampilan): komisi dan bonus, bonus terkunci, deposit.
  /// [lockPercent] 0 = rincian belum berlaku (server lama atau fitur belum menyala): layar tidak menampilkannya.
  final int earningsBalance;
  final int lockedBonusBalance;
  final int depositBalance;
  final int lockPercent;

  bool get hasBalanceBreakdown => lockPercent > 0;

  /// Saldo yang dapat dipakai tetapi tidak terlacak kantongnya (transfer masuk, pengembalian dana).
  int get otherBalance {
    final other = walletBalance - earningsBalance - lockedBonusBalance - depositBalance;
    return other < 0 ? 0 : other;
  }

  bool get isMember => true;

  DemoClientSession copyWith({
    String? userId,
    String? email,
    String? role,
    String? accessToken,
    String? refreshToken,
    bool? isDemoMode,
    String? lastInvoiceNumber,
    String? membershipJoinedAt,
    String? userName,
    String? phone,
    String? activePackageName,
    int? walletBalance,
    int? ppobBalance,
    String? referralCode,
    int? earningsBalance,
    int? lockedBonusBalance,
    int? depositBalance,
    int? lockPercent,
  }) {
    return DemoClientSession(
      userId: userId ?? this.userId,
      email: email ?? this.email,
      role: role ?? this.role,
      accessToken: accessToken ?? this.accessToken,
      refreshToken: refreshToken ?? this.refreshToken,
      isDemoMode: isDemoMode ?? this.isDemoMode,
      lastInvoiceNumber: lastInvoiceNumber ?? this.lastInvoiceNumber,
      membershipJoinedAt: membershipJoinedAt ?? this.membershipJoinedAt,
      userName: userName ?? this.userName,
      phone: phone ?? this.phone,
      activePackageName: activePackageName ?? this.activePackageName,
      walletBalance: walletBalance ?? this.walletBalance,
      ppobBalance: ppobBalance ?? this.ppobBalance,
      referralCode: referralCode ?? this.referralCode,
      earningsBalance: earningsBalance ?? this.earningsBalance,
      lockedBonusBalance: lockedBonusBalance ?? this.lockedBonusBalance,
      depositBalance: depositBalance ?? this.depositBalance,
      lockPercent: lockPercent ?? this.lockPercent,
    );
  }
}

String formatRupiah(int value) {
  final digits = value.toString();
  final buffer = StringBuffer();
  for (var index = 0; index < digits.length; index++) {
    final remaining = digits.length - index;
    buffer.write(digits[index]);
    if (remaining > 1 && remaining % 3 == 1) {
      buffer.write('.');
    }
  }
  return 'Rp${buffer.toString()}';
}
