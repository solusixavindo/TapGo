enum PaymentStatus {
  waitingPayment,
  paid,
}

class MembershipPackageModel {
  const MembershipPackageModel({
    required this.name,
    required this.price,
    required this.benefits,
    required this.sponsorBonus,
    required this.levelBonus,
    required this.ppobBalance,
    required this.bpjsBenefit,
    required this.businessRight,
  });

  final String name;
  final int price;
  final List<String> benefits;
  final String sponsorBonus;
  final String levelBonus;
  final int ppobBalance;
  final String bpjsBenefit;
  final String businessRight;

  bool get isBasic => price == 0;
}

class RegistrationFormModel {
  const RegistrationFormModel({
    required this.fullName,
    required this.phone,
    required this.email,
    required this.address,
    required this.ktpNumber,
    required this.birthPlace,
    required this.birthDate,
    required this.gender,
    required this.referralCode,
    required this.packageName,
  });

  final String fullName;
  final String phone;
  final String email;
  final String address;
  final String ktpNumber;
  final String birthPlace;
  final String birthDate;
  final String gender;
  final String referralCode;
  final String packageName;
}

class InvoiceModel {
  const InvoiceModel({
    required this.number,
    required this.memberName,
    required this.packageName,
    required this.packagePrice,
    required this.benefits,
    required this.adminFee,
    required this.total,
    required this.status,
    this.backendOrderId,
    this.paymentRedirectUrl,
  });

  final String number;
  final String memberName;
  final String packageName;
  final int packagePrice;
  final List<String> benefits;
  final int adminFee;
  final int total;
  final PaymentStatus status;
  final String? backendOrderId;
  final String? paymentRedirectUrl;

  InvoiceModel copyWith({
    String? number,
    PaymentStatus? status,
    String? backendOrderId,
    String? paymentRedirectUrl,
  }) {
    return InvoiceModel(
      number: number ?? this.number,
      memberName: memberName,
      packageName: packageName,
      packagePrice: packagePrice,
      benefits: benefits,
      adminFee: adminFee,
      total: total,
      status: status ?? this.status,
      backendOrderId: backendOrderId ?? this.backendOrderId,
      paymentRedirectUrl: paymentRedirectUrl ?? this.paymentRedirectUrl,
    );
  }
}

class WalletTransactionModel {
  const WalletTransactionModel({
    required this.title,
    required this.description,
    required this.amount,
    required this.status,
  });

  final String title;
  final String description;
  final int amount;
  final String status;
}

class DemoClientSession {
  const DemoClientSession({
    this.userId,
    this.email,
    this.role = 'USER',
    this.accessToken,
    this.refreshToken,
    this.isDemoMode = true,
    this.selfieImagePath,
    this.ktpImagePath,
    this.lastInvoiceNumber,
    this.membershipJoinedAt,
    this.isFounderChairman = false,
    this.isFounderPlatinum = false,
    required this.userName,
    required this.phone,
    required this.activePackageName,
    required this.walletBalance,
    required this.ppobBalance,
    required this.referralCode,
    required this.directSponsor,
    required this.downline,
    required this.activeLevel,
    required this.todayBonus,
    required this.transactions,
  });

  factory DemoClientSession.initial() {
    return const DemoClientSession(
      userName: 'Member TapGo',
      phone: '',
      activePackageName: 'Basic',
      walletBalance: 0,
      ppobBalance: 0,
      referralCode: '-',
      directSponsor: 0,
      downline: 0,
      activeLevel: 0,
      todayBonus: 0,
      transactions: [],
    );
  }

  final String? userId;
  final String? email;
  final String role;
  final String? accessToken;
  final String? refreshToken;
  final bool isDemoMode;
  final String? selfieImagePath;
  final String? ktpImagePath;
  final String? lastInvoiceNumber;
  final String? membershipJoinedAt;
  final bool isFounderChairman;
  final bool isFounderPlatinum;
  final String userName;
  final String phone;
  final String activePackageName;
  final int walletBalance;
  final int ppobBalance;
  final String referralCode;
  final int directSponsor;
  final int downline;
  final int activeLevel;
  final int todayBonus;
  final List<WalletTransactionModel> transactions;

  bool get isSuperAdmin => role == 'SUPER_ADMIN';
  bool get isAdmin => role == 'ADMIN' || role == 'SUPER_ADMIN';
  bool get isMember => !isAdmin;

  DemoClientSession copyWith({
    String? userId,
    String? email,
    String? role,
    String? accessToken,
    String? refreshToken,
    bool? isDemoMode,
    String? selfieImagePath,
    String? ktpImagePath,
    String? lastInvoiceNumber,
    String? membershipJoinedAt,
    bool? isFounderChairman,
    bool? isFounderPlatinum,
    String? userName,
    String? phone,
    String? activePackageName,
    int? walletBalance,
    int? ppobBalance,
    String? referralCode,
    int? directSponsor,
    int? downline,
    int? activeLevel,
    int? todayBonus,
    List<WalletTransactionModel>? transactions,
  }) {
    return DemoClientSession(
      userId: userId ?? this.userId,
      email: email ?? this.email,
      role: role ?? this.role,
      accessToken: accessToken ?? this.accessToken,
      refreshToken: refreshToken ?? this.refreshToken,
      isDemoMode: isDemoMode ?? this.isDemoMode,
      selfieImagePath: selfieImagePath ?? this.selfieImagePath,
      ktpImagePath: ktpImagePath ?? this.ktpImagePath,
      lastInvoiceNumber: lastInvoiceNumber ?? this.lastInvoiceNumber,
      membershipJoinedAt: membershipJoinedAt ?? this.membershipJoinedAt,
      isFounderChairman: isFounderChairman ?? this.isFounderChairman,
      isFounderPlatinum: isFounderPlatinum ?? this.isFounderPlatinum,
      userName: userName ?? this.userName,
      phone: phone ?? this.phone,
      activePackageName: activePackageName ?? this.activePackageName,
      walletBalance: walletBalance ?? this.walletBalance,
      ppobBalance: ppobBalance ?? this.ppobBalance,
      referralCode: referralCode ?? this.referralCode,
      directSponsor: directSponsor ?? this.directSponsor,
      downline: downline ?? this.downline,
      activeLevel: activeLevel ?? this.activeLevel,
      todayBonus: todayBonus ?? this.todayBonus,
      transactions: transactions ?? this.transactions,
    );
  }
}

class DemoClientCatalog {
  const DemoClientCatalog._();

  static const packages = [
    MembershipPackageModel(
      name: 'Basic',
      price: 0,
      benefits: [
        'Bonus saldo Rp5.000',
        'Sponsor bonus Rp2.000',
        'Berlaku 1.000 user pertama',
      ],
      sponsorBonus: 'Rp2.000 untuk referral Basic',
      levelBonus: 'Belum membuka bonus level',
      ppobBalance: 0,
      bpjsBenefit: 'Tidak termasuk',
      businessRight: 'Akses pengguna',
    ),
    MembershipPackageModel(
      name: 'Silver',
      price: 500000,
      benefits: [
        'Kaos TapGo',
        'Saldo PPOB Rp100.000',
        'BPJS TK JKK/JKM',
        'Hak Usaha',
      ],
      sponsorBonus: '8% dari paket direct referral',
      levelBonus: 'Unlock level 3 dengan 3 sponsor',
      ppobBalance: 100000,
      bpjsBenefit: 'BPJS TK, JKK, JKM',
      businessRight: 'Hak Usaha',
    ),
    MembershipPackageModel(
      name: 'Gold',
      price: 3000000,
      benefits: [
        'Kaos + Topi',
        'Saldo PPOB Rp600.000',
        'BPJS TK JKK/JKM',
        'Hak Usaha',
      ],
      sponsorBonus: '8% dari paket direct referral',
      levelBonus: 'Unlock level 5 dengan 5 sponsor',
      ppobBalance: 600000,
      bpjsBenefit: 'BPJS TK, JKK, JKM',
      businessRight: 'Hak Usaha',
    ),
    MembershipPackageModel(
      name: 'Platinum',
      price: 5500000,
      benefits: [
        'Kaos + Jaket + Rompi',
        'Saldo PPOB Rp1.000.000',
        'BPJS TK JKK/JKM/JHT',
        'Hak Usaha Mitra',
      ],
      sponsorBonus: '8% dari paket direct referral',
      levelBonus: 'Unlock level 10 dengan 10 sponsor',
      ppobBalance: 1000000,
      bpjsBenefit: 'BPJS TK, JKK, JKM, JHT',
      businessRight: 'Hak Usaha MITRA',
    ),
  ];

  static MembershipPackageModel packageByName(String name) {
    return packages.firstWhere(
      (package) => package.name == name,
      orElse: () => packages.first,
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
