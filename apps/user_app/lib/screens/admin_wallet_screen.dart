part of '../main.dart';

class AdminWalletScreen extends ConsumerWidget {
  const AdminWalletScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final adminSnapshot = ref.watch(_adminConsoleSnapshotProvider);
    final topWallets =
        adminSnapshot.valueOrNull?.wallets
            .map(DemoAdminMember.fromWalletApi)
            .toList(growable: false) ??
        (_isTapGoDevelopmentBuild
            ? [..._demoAdminMembers]
            : <DemoAdminMember>[]);
    topWallets.sort((a, b) => b.walletBalance.compareTo(a.walletBalance));
    final totalWallet = adminSnapshot.hasValue
        ? _intFrom(adminSnapshot.valueOrNull?.summary['totalWalletBalance'])
        : _adminFallbackWalletBalance();

    return _DemoScaffold(
      title: 'Wallet Management',
      subtitle: adminSnapshot.hasValue
          ? 'Live Data saldo user dan ledger'
          : 'Saldo user dan ledger TapGo',
      child: Column(
        children: [
          _InfoPanel(
            color: _brandBlue,
            title: 'Total Wallet Member',
            value: _formatCompactRupiah(totalWallet),
            subtitle: adminSnapshot.hasValue
                ? 'Akumulasi saldo seluruh member'
                : 'Data saldo belum berhasil dimuat.',
            icon: Icons.account_balance_wallet_rounded,
          ),
          const SizedBox(height: 14),
          if (adminSnapshot.isLoading)
            const _StatusSurface(
              icon: Icons.sync_rounded,
              title: 'Memuat wallet',
              subtitle: 'Mengambil saldo member...',
            )
          else if (topWallets.isEmpty)
            const _StatusSurface(
              icon: Icons.account_balance_wallet_rounded,
              title: 'Belum ada data wallet member',
              subtitle: 'Wallet akan muncul setelah user memiliki transaksi.',
            )
          else
            ...topWallets
                .take(16)
                .map(
                  (member) => InkWell(
                    onTap: () => _openDemo(
                      context,
                      _AdminRecordDetailScreen(
                        title: 'Wallet Transaction',
                        rows: [
                          member.name,
                          member.packageName,
                          'Saldo ${formatRupiah(member.walletBalance)}',
                          'Komisi ${formatRupiah(member.totalCommission)}',
                        ],
                      ),
                    ),
                    child: _WalletLedgerItem(
                      title: member.name,
                      amount: formatRupiah(member.walletBalance),
                      note:
                          '${member.packageName} • Komisi ${formatRupiah(member.totalCommission)}',
                      color: _packageAccent(member.packageName),
                    ),
                  ),
                ),
        ],
      ),
    );
  }
}

int _adminFallbackWalletBalance() => _isTapGoDevelopmentBuild
    ? _demoAdminMembers.fold(0, (sum, item) => sum + item.walletBalance)
    : 0;
