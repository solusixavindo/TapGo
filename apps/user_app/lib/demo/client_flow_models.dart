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
