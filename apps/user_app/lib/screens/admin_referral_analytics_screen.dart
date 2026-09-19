part of '../main.dart';

class AdminReferralAnalyticsScreen extends ConsumerWidget {
  const AdminReferralAnalyticsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final adminSnapshot = ref.watch(_adminConsoleSnapshotProvider);
    final topSponsors = adminSnapshot.valueOrNull?.members
            .map(DemoAdminMember.fromApi)
            .toList(growable: false) ??
        (_isTapGoDevelopmentBuild
            ? [..._demoAdminMembers]
            : <DemoAdminMember>[]);
    topSponsors.sort((a, b) => b.totalDownline.compareTo(a.totalDownline));
    final summary = adminSnapshot.valueOrNull?.summary;

    return _DemoScaffold(
      title: 'Referral Analytics',
      subtitle: adminSnapshot.hasValue
          ? 'Top referral dan tingkat aktif'
          : 'Analytics referral TapGo',
      child: Column(
        children: [
          if (adminSnapshot.hasError)
            _RetryStatusSurface(
              icon: Icons.cloud_off_rounded,
              title: 'Data referral belum tersedia',
              subtitle: 'Silakan muat ulang analytics referral.',
              onRetry: () => ref.invalidate(_adminConsoleSnapshotProvider),
            )
          else
            Row(
              children: [
                Expanded(
                  child: _StatCard(
                    label: 'Tingkat Aktif',
                    value: adminSnapshot.hasValue
                        ? '${_activeLevelFromDirectSponsor(_intFrom(summary?['maxDirectSponsor']))}'
                        : '-',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _StatCard(
                    label: 'Member',
                    value: adminSnapshot.hasValue
                        ? '${_intFrom(summary?['totalMembers'])}'
                        : '-',
                  ),
                ),
              ],
            ),
          const SizedBox(height: 14),
          const _StatusSurface(
            icon: Icons.account_tree_rounded,
            title: 'Global Referral Analytics belum tersedia',
            subtitle:
                'Tree admin global belum aktif. Data top referral tetap dibaca dari sistem TapGo.',
          ),
          const SizedBox(height: 6),
          if (adminSnapshot.hasError)
            const SizedBox.shrink()
          else if (adminSnapshot.isLoading)
            const _StatusSurface(
              icon: Icons.sync_rounded,
              title: 'Memuat referral',
              subtitle: 'Mengambil data top referral...',
            )
          else if (topSponsors.isEmpty)
            const _StatusSurface(
              icon: Icons.hub_rounded,
              title: 'Belum ada referral',
              subtitle:
                  'Data referral akan muncul setelah user memakai kode referral.',
            )
          else
            ...topSponsors.take(12).map(
                  (member) => _WalletLedgerItem(
                    title: member.name,
                    amount: '${member.totalDownline} referral',
                    note:
                        '${member.packageName} • Pemberi ${member.sponsor} • Komisi ${formatRupiah(member.totalCommission)}',
                    color: _packageAccent(member.packageName),
                  ),
                ),
        ],
      ),
    );
  }
}
