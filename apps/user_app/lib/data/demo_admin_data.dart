part of '../main.dart';

class DemoAdminMember {
  const DemoAdminMember({
    required this.id,
    required this.name,
    required this.phone,
    required this.packageName,
    required this.paymentStatus,
    required this.sponsor,
    required this.totalDownline,
    required this.walletBalance,
    required this.totalCommission,
    required this.joinedAt,
    this.selfieImagePath,
    this.ktpImagePath,
  });

  final String id;
  final String name;
  final String phone;
  final String packageName;
  final String paymentStatus;
  final String sponsor;
  final int totalDownline;
  final int walletBalance;
  final int totalCommission;
  final String joinedAt;
  final String? selfieImagePath;
  final String? ktpImagePath;

  factory DemoAdminMember.fromSession(DemoClientSession session) {
    return DemoAdminMember(
      id: session.userId ??
          'LOCAL-${session.phone.replaceAll(RegExp(r'[^0-9]'), '')}',
      name: session.userName,
      phone: session.phone,
      packageName: session.activePackageName,
      paymentStatus: session.isDemoMode ? 'Local' : 'Registered',
      sponsor: session.referralCode,
      totalDownline: session.downline,
      walletBalance: session.walletBalance,
      totalCommission: session.transactions.fold(
        0,
        (total, transaction) => total + transaction.amount,
      ),
      joinedAt: session.membershipJoinedAt ?? 'Hari ini',
      selfieImagePath: session.selfieImagePath,
      ktpImagePath: session.ktpImagePath,
    );
  }

  factory DemoAdminMember.fromApi(Map<String, dynamic> data) {
    final membership = (data['membership'] as Map?)?.cast<String, dynamic>();
    final activeMembership =
        (data['activeMembership'] as Map?)?.cast<String, dynamic>();
    final activePackage =
        (activeMembership?['membership'] as Map?)?.cast<String, dynamic>();
    final sponsor = (data['sponsor'] as Map?)?.cast<String, dynamic>();
    final invoice = ((activeMembership?['order'] as Map?)
        ?.cast<String, dynamic>())?['invoice'] as Map?;
    return DemoAdminMember(
      id: data['id']?.toString() ?? 'API-MEMBER',
      name: (data['fullName'] ?? data['name'] ?? 'Member TapGo').toString(),
      phone: data['phone']?.toString() ?? '-',
      packageName: _titleCase(
        activePackage?['tier']?.toString() ??
            membership?['tier']?.toString() ??
            'Basic',
      ),
      paymentStatus: invoice?['status']?.toString() ?? 'Registered',
      sponsor: sponsor?['fullName']?.toString() ?? 'Tanpa sponsor',
      totalDownline: _intFrom(data['totalDownline']),
      walletBalance: _intFrom(data['walletBalance']),
      totalCommission: _intFrom(data['commissionTotal']),
      joinedAt: _dateLabel(data['joinedAt']) ?? 'Backend',
    );
  }

  factory DemoAdminMember.fromWalletApi(Map<String, dynamic> data) {
    final user = (data['user'] as Map?)?.cast<String, dynamic>() ?? {};
    final membership = (user['membership'] as Map?)?.cast<String, dynamic>();
    return DemoAdminMember(
      id: user['id']?.toString() ?? data['userId']?.toString() ?? 'API-WALLET',
      name: user['fullName']?.toString() ?? 'Member TapGo',
      phone: user['phone']?.toString() ?? '-',
      packageName: _titleCase(membership?['tier']?.toString() ?? 'Basic'),
      paymentStatus: 'Wallet Aktif',
      sponsor: user['referralCode']?.toString() ?? '-',
      totalDownline: 0,
      walletBalance: _intFrom(data['balance']),
      totalCommission: 0,
      joinedAt: 'Backend',
    );
  }
}

class DemoAdminInvoice {
  const DemoAdminInvoice({
    required this.number,
    required this.memberName,
    required this.packageName,
    required this.amount,
    required this.status,
    required this.method,
    this.referenceId,
    required this.date,
  });

  final String number;
  final String memberName;
  final String packageName;
  final int amount;
  final String status;
  final String method;
  final String? referenceId;
  final String date;

  factory DemoAdminInvoice.fromApi(Map<String, dynamic> data) {
    final user = (data['user'] as Map?)?.cast<String, dynamic>() ?? {};
    final order = (data['order'] as Map?)?.cast<String, dynamic>() ?? {};
    final membership =
        (order['membership'] as Map?)?.cast<String, dynamic>() ?? {};
    final payments = data['payments'] is List ? data['payments'] as List : [];
    final payment = payments.isNotEmpty && payments.first is Map
        ? (payments.first as Map).cast<String, dynamic>()
        : const <String, dynamic>{};
    return DemoAdminInvoice(
      number: data['number']?.toString() ??
          payment['invoiceId']?.toString() ??
          'INV-API',
      memberName: user['fullName']?.toString() ?? 'Member TapGo',
      packageName: _titleCase(membership['tier']?.toString() ?? 'Basic'),
      amount: _intFrom(data['amount'] ?? payment['amount']),
      status: _paymentStatusLabel(
        data['status']?.toString() ?? payment['status']?.toString(),
      ),
      method: payment['provider']?.toString() ??
          payment['method']?.toString() ??
          data['provider']?.toString() ??
          'Backend',
      referenceId: payment['providerReference']?.toString(),
      date: _dateLabel(data['createdAt'] ?? payment['createdAt']) ?? 'Backend',
    );
  }
}

class DemoAdminWithdrawal {
  const DemoAdminWithdrawal({
    required this.id,
    required this.memberName,
    required this.amount,
    required this.bank,
    required this.status,
    required this.date,
  });

  final String id;
  final String memberName;
  final int amount;
  final String bank;
  final String status;
  final String date;

  factory DemoAdminWithdrawal.fromApi(Map<String, dynamic> data) {
    final user = (data['user'] as Map?)?.cast<String, dynamic>() ?? {};
    final bank = [
      data['bankName']?.toString(),
      data['accountNumber']?.toString(),
      data['accountHolderName']?.toString(),
    ].where((item) => item != null && item.isNotEmpty).join(' • ');
    final bankAccount = (data['bankAccount'] as Map?)?.cast<String, dynamic>();
    return DemoAdminWithdrawal(
      id: data['id']?.toString() ?? 'WD-API',
      memberName: user['fullName']?.toString() ??
          data['userName']?.toString() ??
          'Member TapGo',
      amount: _intFrom(data['amount']),
      bank: bank.isNotEmpty
          ? bank
          : [
              bankAccount?['bankName']?.toString() ??
                  bankAccount?['bank']?.toString(),
              bankAccount?['accountNumber']?.toString() ??
                  bankAccount?['accountNo']?.toString(),
              bankAccount?['accountHolderName']?.toString() ??
                  bankAccount?['accountName']?.toString(),
            ].where((item) => item != null && item.isNotEmpty).join(' • '),
      status: _withdrawalStatusLabel(data['status']?.toString()),
      date: _dateLabel(data['requestedAt'] ?? data['createdAt']) ?? 'Backend',
    );
  }
}

const _demoAdminMembers = <DemoAdminMember>[];
const _demoAdminInvoices = <DemoAdminInvoice>[];
const _demoAdminWithdrawals = <DemoAdminWithdrawal>[];

int _countPackage(String packageName) {
  return _demoAdminMembers
      .where((member) => member.packageName == packageName)
      .length;
}

String _paymentStatusLabel(String? status) {
  return switch (status) {
    'PAID' => 'Lunas',
    'PENDING' => 'Pending',
    'FAILED' => 'Gagal',
    'EXPIRED' => 'Expired',
    'CANCELLED' => 'Batal',
    _ => status ?? 'Backend',
  };
}

String _withdrawalStatusLabel(String? status) {
  return switch (status) {
    'PENDING' => 'Pending',
    'APPROVED' => 'Approved',
    'REJECTED' => 'Rejected',
    'PAID' => 'Paid',
    _ => status ?? 'Pending',
  };
}
