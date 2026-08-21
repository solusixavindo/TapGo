part of '../main.dart';

class AdminMemberDetailScreen extends StatelessWidget {
  const AdminMemberDetailScreen({required this.member, super.key});

  final DemoAdminMember member;

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: member.name,
      subtitle: '${member.id} • ${member.joinedAt}',
      child: Column(
        children: [
          _InfoPanel(
            color: _packageAccent(member.packageName),
            title: 'Paket Aktif',
            value: member.packageName,
            subtitle: 'Status pembayaran ${member.paymentStatus}',
            icon: Icons.workspace_premium_rounded,
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _StatCard(
                  label: 'Wallet',
                  value: _formatCompactRupiah(member.walletBalance),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _StatCard(
                  label: 'Komisi',
                  value: _formatCompactRupiah(member.totalCommission),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _StatCard(
                  label: 'Mitra',
                  value: '${member.totalDownline}',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _StatCard(label: 'Status', value: member.paymentStatus),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _DemoMenuTile(
            icon: Icons.person_pin_rounded,
            title: 'Sponsor / Upline',
            subtitle: member.sponsor,
            onTap: () {},
          ),
          _DemoMenuTile(
            icon: Icons.phone_rounded,
            title: 'Nomor HP',
            subtitle: member.phone,
            onTap: () {},
          ),
          if (member.selfieImagePath != null ||
              member.ktpImagePath != null) ...[
            const SizedBox(height: 8),
            _DemoDocumentPreview(
              title: 'Foto Diri Member',
              imagePath: member.selfieImagePath,
              emptyLabel: 'Belum ada foto diri',
            ),
            const SizedBox(height: 10),
            _DemoDocumentPreview(
              title: 'Pratinjau KTP',
              imagePath: member.ktpImagePath,
              emptyLabel: 'Belum ada pratinjau KTP',
            ),
          ],
          _DemoMenuTile(
            icon: Icons.account_tree_rounded,
            title: 'Lihat Jaringan',
            subtitle: 'Buka referal tim',
            onTap: () => _openDemo(context, const ReferralTreeScreen()),
          ),
        ],
      ),
    );
  }
}
