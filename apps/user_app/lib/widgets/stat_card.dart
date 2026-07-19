part of '../main.dart';

String _formatCompactRupiah(int value) {
  if (value >= 1000000) {
    final compact = value / 1000000;
    final text = compact == compact.roundToDouble()
        ? compact.toStringAsFixed(0)
        : compact.toStringAsFixed(1).replaceAll('.', ',');
    return 'Rp$text jt';
  }
  if (value >= 1000) {
    return 'Rp${(value / 1000).round()} rb';
  }
  return formatRupiah(value);
}

class _MiniMetric extends StatelessWidget {
  const _MiniMetric({
    required this.label,
    required this.value,
    this.animatedValue,
    this.formatter,
    this.isLoading = false,
  });

  final String label;
  final String value;
  final int? animatedValue;
  final String Function(int value)? formatter;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _softBackground,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(0xFF718096),
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          SizedBox(
            height: 18,
            width: double.infinity,
            child: FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: isLoading
                  ? const _SkeletonBar(width: 84)
                  : animatedValue == null || formatter == null
                      ? _DashboardValueSwitcher(
                          value: value,
                          style: const TextStyle(
                            color: Color(0xFF0A2A43),
                            fontSize: 14,
                            fontWeight: FontWeight.w900,
                          ),
                        )
                      : _DashboardAnimatedValue(
                          value: animatedValue!,
                          formatter: formatter!,
                          style: const TextStyle(
                            color: Color(0xFF0A2A43),
                            fontSize: 14,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoPanel extends StatelessWidget {
  const _InfoPanel({
    required this.color,
    required this.title,
    required this.value,
    required this.subtitle,
    required this.icon,
  });

  final Color color;
  final String title;
  final String value;
  final String subtitle;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.24),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(color: Color(0xCCFFFFFF))),
                const SizedBox(height: 8),
                Text(
                  value,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 28,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  subtitle,
                  style: const TextStyle(color: Color(0xCCFFFFFF)),
                ),
              ],
            ),
          ),
          Icon(icon, color: Colors.white, size: 42),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(color: Color(0xFF718096), fontSize: 12),
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(
              color: Color(0xFF0A2A43),
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _BonusBreakdownCard extends StatelessWidget {
  const _BonusBreakdownCard({required this.transactions});

  final List<WalletTransactionModel> transactions;

  @override
  Widget build(BuildContext context) {
    final sponsor = _sumTransactions(transactions, ['sponsor']);
    final level = _sumTransactions(transactions, ['level']);
    final reward = _sumTransactions(transactions, ['reward']);
    final profit = _sumTransactions(transactions, ['profit sharing']);
    return Column(
      children: [
        _WalletLedgerItem(
          title: 'Total bonus sponsor',
          amount: formatRupiah(sponsor),
          note: sponsor > 0 ? 'Tercatat di wallet' : 'Belum ada bonus sponsor',
          color: const Color(0xFF0877EE),
        ),
        _WalletLedgerItem(
          title: 'Total bonus level',
          amount: formatRupiah(level),
          note: level > 0 ? 'Tercatat di wallet' : 'Belum ada bonus level',
          color: const Color(0xFF00A86B),
        ),
        _WalletLedgerItem(
          title: 'Total reward',
          amount: formatRupiah(reward),
          note: reward > 0 ? 'Reward aktif' : 'Belum ada reward aktif',
          color: const Color(0xFFFF8A00),
        ),
        _WalletLedgerItem(
          title: 'Profit sharing',
          amount: formatRupiah(profit),
          note: profit > 0 ? 'Tercatat di wallet' : 'Belum ada profit sharing',
          color: const Color(0xFF697386),
        ),
      ],
    );
  }
}

int _sumTransactions(
  List<WalletTransactionModel> transactions,
  List<String> needles,
) {
  return transactions.fold<int>(0, (total, item) {
    final haystack = '${item.title} ${item.description}'.toLowerCase();
    if (needles.any(haystack.contains)) {
      return total + item.amount.abs();
    }
    return total;
  });
}

class _WalletLedgerItem extends StatelessWidget {
  const _WalletLedgerItem({
    required this.title,
    required this.amount,
    required this.note,
    required this.color,
  });

  final String title;
  final String amount;
  final String note;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(Icons.trending_up_rounded, color: color),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Color(0xFF0A2A43),
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  note,
                  style: const TextStyle(
                    color: Color(0xFF718096),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          Text(
            amount,
            style: TextStyle(color: color, fontWeight: FontWeight.w900),
          ),
        ],
      ),
    );
  }
}

class _LevelChip extends StatelessWidget {
  const _LevelChip({required this.label, required this.active});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: active ? _brandBlue : const Color(0xFFE5E7EB),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: active ? Colors.white : const Color(0xFF697386),
          fontWeight: FontWeight.w900,
          fontSize: 12,
        ),
      ),
    );
  }
}

class RewardScreen extends ConsumerWidget {
  const RewardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final production = ref.watch(_productionSnapshotProvider);
    final rewards = ref
        .watch(_demoSessionProvider)
        .transactions
        .where((item) => '${item.title} ${item.description}'
            .toLowerCase()
            .contains('reward'))
        .toList(growable: false);
    return _DemoScaffold(
      title: 'Reward',
      subtitle: 'Reward dari aktivitas TapGo',
      child: Column(
        children: [
          _ProductionStatusTile(state: production),
          const SizedBox(height: 12),
          if (rewards.isEmpty)
            const _EmptyState(
              icon: Icons.emoji_events_rounded,
              title: 'Belum ada reward aktif',
              subtitle: 'Reward akan muncul setelah syarat tercapai.',
            )
          else
            ...rewards.map(
              (item) => _WalletLedgerItem(
                title: item.title,
                amount: '+ ${formatRupiah(item.amount.abs())}',
                note: '${item.description} • ${item.status}',
                color: const Color(0xFFFF8A00),
              ),
            ),
        ],
      ),
    );
  }
}

class _MarketingRulesCard extends StatelessWidget {
  const _MarketingRulesCard();

  static const _rates = [
    'Sponsor bonus: 8%',
    'Level 1: 8%',
    'Level 2: 4%',
    'Level 3: 2%',
    'Level 4: 2%',
    'Level 5: 2%',
    'Level 6: 1%',
    'Level 7: 1%',
    'Level 8: 1%',
    'Level 9: 1%',
    'Level 10: 1%',
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Rumus Marketing Plan',
            style: TextStyle(
              color: Color(0xFF0A2A43),
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _rates.map((rate) => _BenefitChip(label: rate)).toList(),
          ),
          const SizedBox(height: 14),
          const _PackageRow(label: '3 sponsor', value: 'Unlock sampai level 3'),
          const _PackageRow(label: '5 sponsor', value: 'Unlock sampai level 5'),
          const _PackageRow(
              label: '10 sponsor', value: 'Unlock sampai level 10'),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            color: Color(0xFF0A2A43),
            fontSize: 26,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: const TextStyle(
            color: Color(0xFF718096),
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}

class _SearchBox extends StatelessWidget {
  const _SearchBox({required this.hint});

  final String hint;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 54,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: [
          const Icon(Icons.search_rounded, color: _brandBlue),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              hint,
              style: const TextStyle(color: Color(0xFF718096)),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.item});

  final _ActivityItem item;

  @override
  Widget build(BuildContext context) {
    final amountColor = item.amount?.startsWith('-') ?? false
        ? const Color(0xFFE51E3E)
        : const Color(0xFF00A86B);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: _brandBlue.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(15),
            ),
            child: Icon(item.icon, color: _brandBlue),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: const TextStyle(
                    color: Color(0xFF0A2A43),
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  item.description,
                  style: const TextStyle(
                    color: Color(0xFF718096),
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  '${item.status} • ${item.date}',
                  style: const TextStyle(
                    color: Color(0xFF718096),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          if (item.amount != null)
            Text(
              item.amount!,
              style: TextStyle(
                color: amountColor,
                fontWeight: FontWeight.w900,
              ),
            ),
        ],
      ),
    );
  }
}

class _AccountHero extends StatelessWidget {
  const _AccountHero({required this.session});

  final DemoClientSession session;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: _TapGoProfileImage(
              imagePath: session.selfieImagePath,
              width: 72,
              height: 72,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            session.userName,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF0A2A43),
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
          if (session.isFounderChairman || session.isFounderPlatinum) ...[
            const SizedBox(height: 8),
            _FounderPlatinumBadge(
              label: session.isFounderChairman
                  ? 'Founder Chairman'
                  : 'Founder Platinum',
              icon: session.isFounderChairman
                  ? Icons.emoji_events_rounded
                  : Icons.workspace_premium_rounded,
            ),
          ],
          const SizedBox(height: 6),
          Text(
            'Paket aktif: ${session.activePackageName} • Kode ${session.referralCode}',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFF718096)),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _copyAccountReferralLink(context, session),
                  icon: const Icon(Icons.copy_rounded),
                  label: const Text('Salin link referral'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FounderPlatinumBadge extends StatelessWidget {
  const _FounderPlatinumBadge({
    this.label = 'Founder Platinum',
    this.icon = Icons.workspace_premium_rounded,
  });

  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF4D6),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFE3B341)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: const Color(0xFF9A6A00), size: 16),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF7A5200),
              fontWeight: FontWeight.w900,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

void _copyAccountReferralLink(
  BuildContext context,
  DemoClientSession session,
) {
  final referralCode = session.referralCode.trim();
  if (referralCode.isEmpty || referralCode == '-') {
    _TapGoSnackbar.warning(context, 'Kode referral belum tersedia');
    return;
  }
  final link = 'https://tapgolion.id/daftar?ref=$referralCode';
  Clipboard.setData(ClipboardData(text: link));
  _TapGoSnackbar.success(context, 'Link referral berhasil disalin');
}

class _AccountMenuTile extends StatelessWidget {
  const _AccountMenuTile(this.title, this.icon, this.onTap);

  final String title;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return _DemoMenuTile(
      icon: icon,
      title: title,
      subtitle: 'Lihat detail $title',
      onTap: onTap,
    );
  }
}

class _TapGoProfileImage extends StatelessWidget {
  const _TapGoProfileImage({
    required this.imagePath,
    required this.width,
    required this.height,
  });

  final String? imagePath;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final path = imagePath;
    if (path != null && path.isNotEmpty && File(path).existsSync()) {
      return Image.file(
        File(path),
        width: width,
        height: height,
        fit: BoxFit.cover,
      );
    }
    return Image.asset(
      'assets/images/tapgo_logo.jpeg',
      width: width,
      height: height,
      fit: BoxFit.cover,
    );
  }
}

class _DemoDocumentPreview extends StatelessWidget {
  const _DemoDocumentPreview({
    required this.title,
    required this.imagePath,
    required this.emptyLabel,
  });

  final String title;
  final String? imagePath;
  final String emptyLabel;

  @override
  Widget build(BuildContext context) {
    final hasImage = imagePath != null &&
        imagePath!.isNotEmpty &&
        File(imagePath!).existsSync();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: hasImage
                ? Image.file(
                    File(imagePath!),
                    width: 70,
                    height: 70,
                    fit: BoxFit.cover,
                  )
                : Container(
                    width: 70,
                    height: 70,
                    color: const Color(0xFFEAF2FA),
                    child: const Icon(Icons.image_rounded, color: _brandBlue),
                  ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Color(0xFF0A2A43),
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  hasImage ? 'Foto tersimpan lokal' : emptyLabel,
                  style: const TextStyle(color: Color(0xFF718096)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SuperMenuTile extends StatelessWidget {
  const _SuperMenuTile({required this.item, required this.onTap});

  final _SuperMenuItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final style = _serviceIconStyle(item.label);
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(22),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 4),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _ServiceAssetIcon(
                label: item.label,
                icon: item.icon,
                style: style,
                size: 72,
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: 76,
                height: 18,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    item.label,
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.visible,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFF263241),
                      fontSize: 12.5,
                      height: 1,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final reduced = _TapGoMotion.reduce(context);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: reduced ? 1 : 0, end: 1),
      duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
      curve: _TapGoMotion.standardCurve,
      builder: (context, value, child) => Opacity(
        opacity: value,
        child: Transform.translate(
          offset: Offset(0, (1 - value) * 8),
          child: child,
        ),
      ),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
        ),
        child: Column(
          children: [
            Icon(icon, color: _brandBlue, size: 44),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF0A2A43),
                fontSize: 18,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF718096)),
            ),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 16),
              FilledButton(
                onPressed: onAction,
                style: FilledButton.styleFrom(
                  backgroundColor: _brandBlue,
                  foregroundColor: Colors.white,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
