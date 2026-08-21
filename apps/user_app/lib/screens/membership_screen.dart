part of '../main.dart';

class SuperMenuScreen extends StatefulWidget {
  const SuperMenuScreen({super.key});

  @override
  State<SuperMenuScreen> createState() => _SuperMenuScreenState();
}

class _SuperMenuScreenState extends State<SuperMenuScreen> {
  static const _directGroups = [
    _SuperMenuGroup('Layanan', [
      _SuperMenuItem('TapGo Ride', Icons.two_wheeler_rounded),
      _SuperMenuItem('TapGo Car', Icons.local_taxi_rounded),
      _SuperMenuItem('TapGo Food', Icons.restaurant_menu_rounded),
      _SuperMenuItem('TapGo Mart', Icons.storefront_rounded),
    ]),
    _SuperMenuGroup('Digital', [
      _SuperMenuItem('Pulsa', Icons.phone_iphone_rounded),
      _SuperMenuItem('PPOB', Icons.receipt_long_rounded),
      _SuperMenuItem('BPJS', Icons.health_and_safety_rounded),
      _SuperMenuItem('Tagihan', Icons.request_quote_rounded),
    ]),
    _SuperMenuGroup('Bisnis', [
      _SuperMenuItem('Membership', Icons.workspace_premium_rounded),
      _SuperMenuItem('Referral', Icons.hub_rounded),
      _SuperMenuItem('Reward', Icons.emoji_events_rounded),
    ]),
    _SuperMenuGroup('Komunitas', [
      _SuperMenuItem('Kelas Online', Icons.school_rounded),
      _SuperMenuItem('Webinar', Icons.video_camera_front_rounded),
      _SuperMenuItem('Event', Icons.event_available_rounded),
      _SuperMenuItem('Support', Icons.volunteer_activism_rounded),
    ]),
  ];

  static const _playGroups = [
    _SuperMenuGroup('Akun', [
      _SuperMenuItem('Kartu Anggota', Icons.badge_rounded),
      _SuperMenuItem('Profil', Icons.person_rounded),
      _SuperMenuItem('Tiket Bantuan', Icons.volunteer_activism_rounded),
      _SuperMenuItem('Hapus Akun', Icons.delete_outline_rounded),
    ]),
  ];

  static const _searchHints = ['Cari Membership', 'Cari Referral', 'Cari PPOB'];

  int _hintIndex = 0;
  Timer? _hintTimer;

  @override
  void initState() {
    super.initState();
    _hintTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!mounted) return;
      setState(() => _hintIndex = (_hintIndex + 1) % _searchHints.length);
    });
  }

  @override
  void dispose() {
    _hintTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final groups = _superMenuGroupsForDistribution(_tapGoDistributionMode);
    return _DemoScaffold(
      title: 'Super Menu',
      subtitle: 'Semua layanan TapGo dalam satu akses',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (tapGoIsDirectDistribution) ...[
            _SuperMenuSearchBar(hint: _searchHints[_hintIndex]),
            const SizedBox(height: 18),
          ],
          ...groups.map(
            (group) => Padding(
              padding: const EdgeInsets.only(bottom: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    group.title,
                    style: const TextStyle(
                      color: Color(0xFF0A2A43),
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 12),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: group.items.length,
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 4,
                      mainAxisSpacing: 14,
                      crossAxisSpacing: 8,
                      childAspectRatio: 0.62,
                    ),
                    itemBuilder: (context, index) {
                      final item = group.items[index];
                      return _SuperMenuTile(
                        item: item,
                        onTap: () => _openMenuDetail(context, item.label),
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _openMenuDetail(BuildContext context, String label) {
    final destination = _superMenuDestinationForLabel(label);
    if (destination != null) {
      _openDemo(context, destination);
    }
  }
}

List<_SuperMenuGroup> _superMenuGroupsForDistribution(
  TapGoDistributionMode mode,
) =>
    mode == TapGoDistributionMode.play
        ? _SuperMenuScreenState._playGroups
        : _SuperMenuScreenState._directGroups;

List<String> tapGoSuperMenuLabelsForDistributionForTests(
  TapGoDistributionMode mode,
) =>
    _superMenuGroupsForDistribution(mode)
        .expand((group) => group.items.map((item) => item.label))
        .toList(growable: false);

Widget? _superMenuDestinationForLabel(String label) {
  if (tapGoIsPlayDistribution) {
    return switch (label) {
      'Kartu Anggota' => const BasicMemberCardScreen(),
      'Profil' => const ProfileDetailsScreen(),
      'Tiket Bantuan' => const ContactUsScreen(),
      'Hapus Akun' => const DeleteAccountRequestScreen(),
      _ => null,
    };
  }
  return switch (label) {
    'Membership' || 'Membership Saya' => const MembershipPackagesScreen(),
    'Referral' => const ReferralDashboardScreen(),
    'Marketing Plan' => const MarketingPlanScreen(),
    'Reward' => const RewardScreen(),
    _ => FeatureDetailScreen(title: label),
  };
}

Widget? tapGoSuperMenuDestinationForLabelForTests(String label) =>
    _superMenuDestinationForLabel(label);

class _SuperMenuSearchBar extends StatelessWidget {
  const _SuperMenuSearchBar({required this.hint});

  final String hint;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        onTap: () =>
            _showInfoSnack(context, 'Pencarian belum dapat digunakan saat ini'),
        borderRadius: BorderRadius.circular(24),
        child: Container(
          height: 56,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFFE5EDF6)),
            boxShadow: const [
              BoxShadow(
                color: Color(0x12000000),
                blurRadius: 18,
                offset: Offset(0, 8),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: _brandBlue,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(
                  Icons.search_rounded,
                  color: Colors.white,
                  size: 22,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: AnimatedSwitcher(
                  duration: _TapGoMotion.duration(
                    context,
                    _TapGoMotion.standard,
                  ),
                  switchInCurve: _TapGoMotion.standardCurve,
                  switchOutCurve: _TapGoMotion.exitCurve,
                  transitionBuilder: (child, animation) => FadeTransition(
                    opacity: animation,
                    child: SlideTransition(
                      position: Tween<Offset>(
                        begin: const Offset(0, 0.22),
                        end: Offset.zero,
                      ).animate(animation),
                      child: child,
                    ),
                  ),
                  child: Text(
                    hint,
                    key: ValueKey(hint),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF536273),
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
              const Icon(
                Icons.tune_rounded,
                color: Color(0xFF9AA8B8),
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class FeatureDetailScreen extends StatelessWidget {
  const FeatureDetailScreen({required this.title, super.key});

  final String title;

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: title,
      subtitle: 'Informasi layanan',
      child: _EmptyState(
        icon: Icons.rocket_launch_rounded,
        title: '$title belum dapat dibuka saat ini',
        subtitle: 'Silakan gunakan menu TapGo lain yang sudah tersedia.',
      ),
    );
  }
}

class MarketingPlanScreen extends StatelessWidget {
  const MarketingPlanScreen({super.key});

  @override
  Widget build(BuildContext context) {
    if (tapGoIsPlayDistribution) {
      return const MembershipScreen();
    }
    return _DemoScaffold(
      title: 'Marketing Plan',
      subtitle: 'PT. TapGo Lion Indonesia',
      child: Column(
        children: [
          const _MarketingRulesCard(),
          const SizedBox(height: 14),
          _DemoMenuTile(
            icon: Icons.workspace_premium_rounded,
            title: 'Membership Package',
            subtitle: 'Silver, Gold, Platinum',
            onTap: () => _openDemo(context, const MembershipPackagesScreen()),
          ),
          _DemoMenuTile(
            icon: Icons.hub_rounded,
            title: 'Referral Dashboard',
            subtitle: tapGoIsPlayDistribution
                ? 'Kode referral, level aktif, dan jaringan'
                : 'Kode referral, level aktif, jaringan, bonus',
            onTap: () => _openDemo(context, const ReferralDashboardScreen()),
          ),
          if (tapGoIsDirectDistribution)
            _DemoMenuTile(
              icon: Icons.account_balance_wallet_rounded,
              title: 'Wallet',
              subtitle: 'Saldo, PPOB, riwayat bonus, withdraw',
              onTap: () => _openDemo(context, const DemoWalletScreen()),
            ),
          _DemoMenuTile(
            icon: Icons.account_tree_rounded,
            title: 'Referal Tim',
            subtitle: 'Visual struktur referal tim level 1 sampai 10',
            onTap: () => _openDemo(context, const ReferralTreeScreen()),
          ),
        ],
      ),
    );
  }
}

class MembershipPackagesScreen extends StatefulWidget {
  const MembershipPackagesScreen({super.key});

  @override
  State<MembershipPackagesScreen> createState() =>
      _MembershipPackagesScreenState();
}

class _MembershipPackagesScreenState extends State<MembershipPackagesScreen> {
  String? _selectedPackageName;

  void _openPackage(_MembershipPackage package) {
    setState(() => _selectedPackageName = package.name);
    if (tapGoIsPlayDistribution) {
      _TapGoSnackbar.info(context, 'Akun Anda sudah aktif sebagai Basic.');
      return;
    }
    _openDemo(
      context,
      MembershipRegistrationScreen(
        package: DemoClientCatalog.packageByName(package.name),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (tapGoIsPlayDistribution) {
      return const BasicMemberCardScreen();
    }

    final upgradePackages = _demoMemberships
        .where((package) => package.name.toLowerCase() != 'basic')
        .toList(growable: false);

    return _DemoScaffold(
      title: 'Membership',
      subtitle: 'Pilih paket upgrade TapGo',
      child: Column(
        children: upgradePackages.isEmpty
            ? const [
                _StatusSurface(
                  icon: Icons.workspace_premium_rounded,
                  title: 'Paket upgrade belum tersedia',
                  subtitle: 'Silakan cek kembali beberapa saat lagi.',
                ),
              ]
            : upgradePackages.asMap().entries.map((entry) {
                final item = entry.value;
                return _TapGoReveal(
                  order: entry.key,
                  child: _MembershipPackageCard(
                    package: item,
                    selected: _selectedPackageName == item.name,
                    onSelected: () => _openPackage(item),
                  ),
                );
              }).toList(),
      ),
    );
  }
}

class MembershipScreen extends ConsumerWidget {
  const MembershipScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (tapGoIsPlayDistribution) {
      return const BasicMemberCardScreen();
    }

    final production = ref.watch(_productionSnapshotProvider);
    final session = ref.watch(_demoSessionProvider);
    final package = DemoClientCatalog.packageByName(session.activePackageName);
    final hasActivePackage = tapGoIsPlayDistribution ||
        session.activePackageName != 'Basic' ||
        session.lastInvoiceNumber != null ||
        session.ppobBalance > 0;
    if (!hasActivePackage) {
      return _DemoScaffold(
        title: 'Membership Saya',
        subtitle: 'Status paket aktif',
        child: _EmptyState(
          icon: Icons.workspace_premium_rounded,
          title: 'Anda belum memiliki paket aktif',
          subtitle: 'Pilih paket membership untuk mengaktifkan benefit TapGo.',
          actionLabel: 'Pilih Paket Membership',
          onAction: () => _openDemo(context, const MembershipPackagesScreen()),
        ),
      );
    }

    return _DemoScaffold(
      title: 'Membership Saya',
      subtitle: 'Paket aktif user',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ProductionStatusTile(state: production),
          const SizedBox(height: 12),
          _InfoPanel(
            color: _packageAccent(package.name),
            title: 'Paket Aktif',
            value: session.isFounderChairman
                ? 'Founder Chairman'
                : session.isFounderPlatinum
                    ? 'Founder Platinum'
                    : package.name,
            subtitle: 'Status: Aktif / Lunas',
            icon: Icons.workspace_premium_rounded,
          ),
          if (session.isFounderChairman || session.isFounderPlatinum) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: _FounderPlatinumBadge(
                label: session.isFounderChairman
                    ? 'Founder Chairman'
                    : 'Founder Platinum',
                icon: session.isFounderChairman
                    ? Icons.emoji_events_rounded
                    : Icons.workspace_premium_rounded,
              ),
            ),
          ],
          const SizedBox(height: 14),
          _MembershipActiveDetailRow(
            label: 'Harga',
            value: package.price == 0 ? 'Gratis' : formatRupiah(package.price),
          ),
          _MembershipActiveDetailRow(
            label: 'Tanggal daftar',
            value: session.membershipJoinedAt ?? 'Hari ini',
          ),
          _MembershipActiveDetailRow(
            label: 'Invoice terakhir',
            value: session.lastInvoiceNumber ?? 'Belum ada invoice',
          ),
          _MembershipActiveDetailRow(
            label: 'Saldo PPOB benefit',
            value: formatRupiah(package.ppobBalance),
          ),
          _MembershipActiveDetailRow(
            label: 'Hak usaha',
            value: package.businessRight,
          ),
          const SizedBox(height: 12),
          _BenefitPanel(package: package),
          const SizedBox(height: 12),
          _DemoDocumentPreview(
            title: 'Foto Diri',
            imagePath: session.selfieImagePath,
            emptyLabel: 'Belum ada foto diri',
          ),
          const SizedBox(height: 10),
          _DemoDocumentPreview(
            title: 'KTP',
            imagePath: session.ktpImagePath,
            emptyLabel: 'Belum ada pratinjau KTP',
          ),
          if (!tapGoIsPlayDistribution ||
              session.lastInvoiceNumber != null) ...[
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => _openDemo(
                context,
                MembershipInvoiceScreen(session: session, package: package),
              ),
              icon: const Icon(Icons.receipt_long_rounded),
              label: const Text('Lihat Invoice'),
              style: FilledButton.styleFrom(
                backgroundColor: _brandBlue,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
            ),
          ],
          if (tapGoIsDirectDistribution && package.name != 'Platinum') ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: () =>
                  _openDemo(context, const MembershipPackagesScreen()),
              icon: const Icon(Icons.upgrade_rounded),
              label: const Text('Upgrade Paket'),
              style: OutlinedButton.styleFrom(
                foregroundColor: _brandBlue,
                side: const BorderSide(color: _brandBlue),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class MembershipInvoiceScreen extends ConsumerWidget {
  const MembershipInvoiceScreen({
    required this.session,
    required this.package,
    super.key,
  });

  final DemoClientSession session;
  final MembershipPackageModel package;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invoiceNumber = session.lastInvoiceNumber;
    final token = ref.watch(_demoSessionProvider).accessToken;
    return _DemoScaffold(
      title: 'Invoice Membership',
      subtitle: invoiceNumber ?? 'Invoice belum tersedia',
      child: FutureBuilder<Map<String, dynamic>>(
        future: invoiceNumber == null ||
                invoiceNumber.isEmpty ||
                token == null ||
                token.isEmpty
            ? Future<Map<String, dynamic>>.value(const {})
            : _loadInvoice(token, invoiceNumber),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const _StatusSurface(
              icon: Icons.sync_rounded,
              title: 'Memuat invoice',
              subtitle: 'Mengambil detail invoice...',
            );
          }
          if (snapshot.hasError) {
            return _RetryStatusSurface(
              icon: Icons.receipt_long_rounded,
              title: 'Invoice belum tersedia',
              subtitle: 'Data invoice belum berhasil dimuat.',
              onRetry: () => ref.invalidate(_productionSnapshotProvider),
            );
          }
          return _InvoiceDetailPanel(
            invoice: snapshot.data ?? const {},
            session: session,
            package: package,
          );
        },
      ),
    );
  }

  Future<Map<String, dynamic>> _loadInvoice(
    String token,
    String invoiceNumber,
  ) async {
    _apiClient.setAccessToken(token);
    return _apiClient.invoice(invoiceNumber);
  }
}

class _InvoiceDetailPanel extends StatelessWidget {
  const _InvoiceDetailPanel({
    required this.invoice,
    required this.session,
    required this.package,
  });

  final Map<String, dynamic> invoice;
  final DemoClientSession session;
  final MembershipPackageModel package;

  @override
  Widget build(BuildContext context) {
    final user = (invoice['user'] as Map?)?.cast<String, dynamic>() ?? {};
    final order = (invoice['order'] as Map?)?.cast<String, dynamic>() ?? {};
    final membership =
        (order['membership'] as Map?)?.cast<String, dynamic>() ?? {};
    final status = invoice['status']?.toString();
    final amount = _intFrom(invoice['totalAmount'] ?? order['totalAmount']);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        children: [
          _PackageRow(
            label: 'Nama user',
            value: user['fullName']?.toString() ?? session.userName,
          ),
          _PackageRow(
            label: 'Nomor HP',
            value: user['phone']?.toString() ?? session.phone,
          ),
          _PackageRow(
            label: 'Paket',
            value: _titleCase(
              membership['tier']?.toString() ??
                  membership['name']?.toString() ??
                  package.name,
            ),
          ),
          _PackageRow(
            label: 'Harga paket',
            value: formatRupiah(amount > 0 ? amount : package.price),
          ),
          _PackageRow(
            label: 'Tanggal transaksi',
            value: _dateLabel(invoice['createdAt']) ??
                session.membershipJoinedAt ??
                'Belum tersedia',
          ),
          _PackageRow(
            label: 'Status pembayaran',
            value: status == null ? 'Belum tersedia' : _titleCase(status),
          ),
          _PackageRow(
            label: 'Nomor invoice/order ID',
            value: invoice['number']?.toString() ??
                session.lastInvoiceNumber ??
                'Belum tersedia',
          ),
        ],
      ),
    );
  }
}

class _MembershipActiveDetailRow extends StatelessWidget {
  const _MembershipActiveDetailRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(color: Color(0xFF718096)),
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: Color(0xFF0A2A43),
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BenefitPanel extends StatelessWidget {
  const _BenefitPanel({required this.package});

  final MembershipPackageModel package;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Benefit Paket',
            style: TextStyle(
              color: Color(0xFF0A2A43),
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          ...package.benefits.map(
            (benefit) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  const Icon(
                    Icons.check_circle_rounded,
                    color: Color(0xFF00A86B),
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      benefit,
                      style: const TextStyle(color: Color(0xFF536273)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class ReferralDashboardScreen extends ConsumerWidget {
  const ReferralDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (tapGoIsPlayDistribution) {
      return const MembershipScreen();
    }
    final production = ref.watch(_productionSnapshotProvider);
    final session = ref.watch(_demoSessionProvider);
    return _DemoScaffold(
      title: 'Referral Dashboard',
      subtitle:
          production.hasValue ? 'Data referral TapGo' : 'Referral member TapGo',
      child: Column(
        children: [
          _ProductionStatusTile(state: production),
          const SizedBox(height: 12),
          _InfoPanel(
            color: _brandBlue,
            title: 'Kode Referral',
            value: session.referralCode,
            subtitle: 'https://tapgo.app/r/${session.referralCode}',
            icon: Icons.badge_rounded,
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _StatCard(
                  label: 'Direct sponsor',
                  value: '${session.directSponsor}',
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _StatCard(
                  label: 'Level aktif',
                  value: '${session.activeLevel}',
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _StatCard(
                  label: 'Total mitra',
                  value: '${session.downline}',
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _StatCard(
                  label: tapGoIsPlayDistribution
                      ? 'Status benefit'
                      : 'Profit sharing',
                  value: tapGoIsPlayDistribution ? 'Aktif' : 'Bulanan',
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (tapGoIsDirectDistribution)
            _BonusBreakdownCard(transactions: session.transactions),
        ],
      ),
    );
  }
}

class CommissionHistoryScreen extends ConsumerWidget {
  const CommissionHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final production = ref.watch(_productionSnapshotProvider);
    final commissions = production.valueOrNull?.commissionTransactions ??
        const <WalletTransactionModel>[];
    return _DemoScaffold(
      title: 'Riwayat Komisi',
      subtitle: 'Komisi dari transaksi TapGo',
      child: Column(
        children: [
          _ProductionStatusTile(state: production),
          const SizedBox(height: 12),
          if (production.isLoading)
            const _StatusSurface(
              icon: Icons.sync_rounded,
              title: 'Memuat komisi',
              subtitle: 'Mengambil riwayat komisi...',
            )
          else if (production.hasError)
            _RetryStatusSurface(
              icon: Icons.cloud_off_rounded,
              title: 'Data belum tersedia',
              subtitle: 'Silakan muat ulang riwayat komisi.',
              onRetry: () => ref.invalidate(_productionSnapshotProvider),
            )
          else if (commissions.isEmpty)
            const _EmptyState(
              icon: Icons.receipt_long_rounded,
              title: 'Belum ada komisi',
              subtitle: 'Komisi akan muncul setelah bonus tercatat.',
            )
          else
            ...commissions.map(
              (transaction) => _WalletLedgerItem(
                title: transaction.title,
                amount: '+ ${formatRupiah(transaction.amount.abs())}',
                note: '${transaction.description} • ${transaction.status}',
                color: const Color(0xFF00A86B),
              ),
            ),
        ],
      ),
    );
  }
}

class DemoWalletScreen extends ConsumerWidget {
  const DemoWalletScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (tapGoIsPlayDistribution) {
      return const MembershipScreen();
    }

    final production = ref.watch(_productionSnapshotProvider);
    final session = ref.watch(_demoSessionProvider);
    return _DemoScaffold(
      title: 'Wallet',
      subtitle: production.hasValue
          ? 'Ledger bonus dan saldo TapGo'
          : 'Saldo dan transaksi TapGo',
      child: Column(
        children: [
          _ProductionStatusTile(state: production),
          const SizedBox(height: 12),
          _InfoPanel(
            color: _brandBlue,
            title: 'Saldo wallet',
            value: formatRupiah(session.walletBalance),
            subtitle: 'Saldo PPOB ${formatRupiah(session.ppobBalance)}',
            icon: Icons.account_balance_wallet_rounded,
          ),
          const SizedBox(height: 16),
          ...session.transactions.map(
            (transaction) => _WalletLedgerItem(
              title: transaction.title,
              amount: transaction.amount < 0
                  ? '- ${formatRupiah(transaction.amount.abs())}'
                  : '+ ${formatRupiah(transaction.amount)}',
              note: '${transaction.description} • ${transaction.status}',
              color: transaction.amount < 0
                  ? const Color(0xFFE51E3E)
                  : const Color(0xFF00A86B),
            ),
          ),
          if (session.transactions.isEmpty)
            const _EmptyState(
              icon: Icons.receipt_long_rounded,
              title: 'Belum ada transaksi',
              subtitle: 'Transaksi wallet akan muncul di sini.',
            ),
          if (_isTapGoDevelopmentBuild && !production.hasValue) ...[
            const _WalletLedgerItem(
              title: 'Sponsor Bonus',
              amount: '+ Rp400.000',
              note: '10 direct sponsor x Rp500.000 x 8%',
              color: Color(0xFF0877EE),
            ),
            const _WalletLedgerItem(
              title: 'Level Bonus',
              amount: '+ Rp400.000',
              note: 'Level 1 bonus dari 10 transaksi',
              color: Color(0xFF00A86B),
            ),
            const _WalletLedgerItem(
              title: 'Reward Bonus',
              amount: '+ Rp500.000',
              note: 'Platinum qualified 10 direct sponsor',
              color: Color(0xFFFF8A00),
            ),
            const _WalletLedgerItem(
              title: 'Profit Sharing',
              amount: 'Menunggu',
              note: 'Menunggu periode distribusi',
              color: Color(0xFF697386),
            ),
          ],
          const SizedBox(height: 10),
          if (session.accessToken != null && session.accessToken!.isNotEmpty)
            FutureBuilder<List<Map<String, dynamic>>>(
              future: _loadWithdrawalHistory(session.accessToken!),
              builder: (context, snapshot) {
                final withdrawals =
                    snapshot.data ?? const <Map<String, dynamic>>[];
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const _StatusSurface(
                    icon: Icons.sync_rounded,
                    title: 'Memuat withdraw',
                    subtitle: 'Mengambil riwayat withdrawal...',
                  );
                }
                if (withdrawals.isEmpty) {
                  return const SizedBox.shrink();
                }
                return Column(
                  children: withdrawals.take(5).map((item) {
                    final status = _withdrawalStatusLabel(
                      item['status']?.toString(),
                    );
                    return _WalletLedgerItem(
                      title: 'Withdraw $status',
                      amount: '- ${formatRupiah(_intFrom(item['amount']))}',
                      note:
                          '${item['bankName'] ?? 'Bank'} • ${_dateLabel(item['requestedAt']) ?? 'Tanggal belum tersedia'}',
                      color: switch (status) {
                        'Rejected' => const Color(0xFFE51E3E),
                        'Paid' => const Color(0xFF00A86B),
                        _ => _brandOrange,
                      },
                    );
                  }).toList(),
                );
              },
            ),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _showWithdrawalForm(context, ref),
              icon: const Icon(Icons.payments_rounded),
              label: const Text('Ajukan Withdraw'),
              style: OutlinedButton.styleFrom(
                foregroundColor: _brandBlue,
                side: const BorderSide(color: _brandBlue),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<List<Map<String, dynamic>>> _loadWithdrawalHistory(String token) {
    _apiClient.setAccessToken(token);
    return _apiClient.withdrawals();
  }

  Future<void> _showWithdrawalForm(BuildContext context, WidgetRef ref) async {
    if (tapGoIsPlayDistribution) {
      _TapGoSnackbar.info(
        context,
        'Pengelolaan saldo belum tersedia pada rilis Google Play.',
      );
      return;
    }

    final session = ref.read(_demoSessionProvider);
    Map<String, dynamic> bankAccount = const <String, dynamic>{};
    if (session.accessToken != null && session.accessToken!.isNotEmpty) {
      try {
        _apiClient.setAccessToken(session.accessToken);
        bankAccount = await _apiClient.bankAccount();
      } catch (_) {}
    }
    if (!context.mounted) {
      return;
    }
    final defaultAmount = session.walletBalance >= 100000
        ? 100000
        : session.walletBalance >= 50000
            ? session.walletBalance
            : 50000;
    final amountController = TextEditingController(
      text: tapGoFormatRupiahInput(defaultAmount.toString()),
    );
    final bankController = TextEditingController(
      text: bankAccount['bankName']?.toString() ?? '',
    );
    final accountController = TextEditingController(
      text: bankAccount['accountNumber']?.toString() ?? '',
    );
    final holderController = TextEditingController(
      text: bankAccount['accountHolderName']?.toString() ??
          ref.read(_demoSessionProvider).userName,
    );
    final formKey = GlobalKey<FormState>();
    final submitGuard = TapGoSingleFlightGuard();
    var isSubmitting = false;

    await _showTapGoBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            8,
            20,
            MediaQuery.of(context).viewInsets.bottom + 20,
          ),
          child: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Ajukan Withdrawal',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 14),
                _InputField(
                  controller: amountController,
                  icon: Icons.payments_rounded,
                  label: 'Nominal',
                  hint: 'Minimal Rp50.000',
                  keyboardType: TextInputType.number,
                  inputFormatters: tapGoRupiahInputFormatters,
                  readOnly: isSubmitting,
                  validator: (value) {
                    final amount = tapGoCanonicalRupiahValue(value);
                    if (amount < 50000) {
                      return 'Minimal withdraw Rp50.000';
                    }
                    if (amount > session.walletBalance) {
                      return 'Saldo TapGoPay belum cukup';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 10),
                AbsorbPointer(
                  absorbing: isSubmitting,
                  child: _BankDropdownField(
                    controller: bankController,
                    label: 'Bank',
                  ),
                ),
                const SizedBox(height: 10),
                _InputField(
                  controller: accountController,
                  icon: Icons.numbers_rounded,
                  label: 'Nomor rekening',
                  hint: '1234567890',
                  keyboardType: TextInputType.number,
                  inputFormatters: tapGoDigitsOnlyInputFormatters,
                  readOnly: isSubmitting,
                  validator: tapGoBankAccountValidatorMessage,
                ),
                const SizedBox(height: 10),
                _InputField(
                  controller: holderController,
                  icon: Icons.person_rounded,
                  label: 'Nama rekening',
                  hint: 'Nama pemilik rekening',
                  readOnly: isSubmitting,
                  validator: (value) => (value ?? '').trim().length >= 2
                      ? null
                      : 'Nama wajib diisi',
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: isSubmitting
                        ? null
                        : () async {
                            if (!(formKey.currentState?.validate() ?? false)) {
                              return;
                            }
                            setModalState(() => isSubmitting = true);
                            final rootContext = context;
                            try {
                              final success = await submitGuard.run(() async {
                                final session = ref.read(_demoSessionProvider);
                                _apiClient.setAccessToken(session.accessToken);
                                await _apiClient.requestWithdrawal(
                                  amount: tapGoCanonicalRupiahValue(
                                    amountController.text,
                                  ),
                                  bankName: bankController.text.trim(),
                                  bankCode: _bankByNameOrCode(
                                    bankController.text,
                                  )?.code,
                                  accountNumber: tapGoDigitsOnly(
                                    accountController.text,
                                  ),
                                  accountHolderName:
                                      holderController.text.trim(),
                                );
                                return true;
                              });
                              if (!rootContext.mounted) {
                                return;
                              }
                              if (success == true) {
                                setModalState(() => isSubmitting = false);
                                Navigator.of(rootContext).pop();
                                _TapGoSnackbar.success(
                                  rootContext,
                                  'Withdrawal berhasil diajukan.',
                                );
                                ref.invalidate(_productionSnapshotProvider);
                                return;
                              }
                            } catch (error) {
                              if (!rootContext.mounted) {
                                return;
                              }
                              _TapGoSnackbar.error(
                                rootContext,
                                _friendlyApiError(error),
                              );
                            } finally {
                              if (rootContext.mounted && isSubmitting) {
                                setModalState(() => isSubmitting = false);
                              }
                            }
                          },
                    icon: isSubmitting
                        ? const _TapGoLoading(size: 18, strokeWidth: 2)
                        : const Icon(Icons.send_rounded),
                    label: Text(
                      isSubmitting ? 'Mengirim...' : 'Kirim Pengajuan',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    amountController.dispose();
    bankController.dispose();
    accountController.dispose();
    holderController.dispose();
  }
}

class BankAccountScreen extends ConsumerStatefulWidget {
  const BankAccountScreen({super.key});

  @override
  ConsumerState<BankAccountScreen> createState() => _BankAccountScreenState();
}

class _BankOption {
  const _BankOption(this.code, this.name);

  final String code;
  final String name;
}

const _indonesianBanks = [
  _BankOption('BCA', 'Bank Central Asia (BCA)'),
  _BankOption('BRI', 'Bank Rakyat Indonesia (BRI)'),
  _BankOption('MANDIRI', 'Bank Mandiri'),
  _BankOption('BNI', 'Bank Negara Indonesia (BNI)'),
  _BankOption('BSI', 'Bank Syariah Indonesia (BSI)'),
  _BankOption('CIMB', 'CIMB Niaga'),
  _BankOption('PERMATA', 'Permata Bank'),
  _BankOption('BTN', 'BTN'),
  _BankOption('DANAMON', 'Danamon'),
  _BankOption('PANIN', 'Panin Bank'),
  _BankOption('OCBC', 'OCBC NISP'),
  _BankOption('MAYBANK', 'Maybank Indonesia'),
  _BankOption('MEGA', 'Bank Mega'),
  _BankOption('SINARMAS', 'Bank Sinarmas'),
  _BankOption('JAGO', 'Bank Jago'),
  _BankOption('SEABANK', 'SeaBank'),
  _BankOption('ALLO', 'Allo Bank'),
  _BankOption('NEO', 'Neo Commerce'),
  _BankOption('BTPN', 'BTPN'),
  _BankOption('BTPNS', 'BTPN Syariah'),
  _BankOption('MUAMALAT', 'Bank Muamalat'),
  _BankOption('BUKOPIN', 'Bank Bukopin'),
  _BankOption('DBS', 'Bank DBS Indonesia'),
  _BankOption('UOB', 'Bank UOB Indonesia'),
  _BankOption('HSBC', 'HSBC Indonesia'),
  _BankOption('SCB', 'Standard Chartered Indonesia'),
];

_BankOption? _bankByNameOrCode(String value) {
  final normalized = value.trim().toLowerCase();
  if (normalized.isEmpty) {
    return null;
  }
  for (final bank in _indonesianBanks) {
    if (bank.name.toLowerCase() == normalized ||
        bank.code.toLowerCase() == normalized) {
      return bank;
    }
  }
  return null;
}

class _BankDropdownField extends StatelessWidget {
  const _BankDropdownField({required this.controller, required this.label});

  final TextEditingController controller;
  final String label;

  @override
  Widget build(BuildContext context) {
    return FormField<String>(
      initialValue: controller.text,
      validator: (_) =>
          controller.text.trim().isEmpty ? 'Bank wajib dipilih' : null,
      builder: (field) {
        return InkWell(
          onTap: () async {
            final selected = await _showBankPicker(context, controller.text);
            if (selected == null || !field.context.mounted) {
              return;
            }
            controller.text = selected.name;
            field.didChange(selected.name);
          },
          borderRadius: BorderRadius.circular(18),
          child: InputDecorator(
            decoration: InputDecoration(
              prefixIcon: const Icon(
                Icons.account_balance_rounded,
                color: _brandBlue,
              ),
              suffixIcon: const Icon(Icons.expand_more_rounded),
              labelText: label,
              hintText: 'Pilih bank',
              errorText: field.errorText,
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(18),
                borderSide: BorderSide.none,
              ),
            ),
            child: Text(
              controller.text.isEmpty ? 'Pilih bank' : controller.text,
              style: TextStyle(
                color: controller.text.isEmpty
                    ? const Color(0xFF94A3B8)
                    : const Color(0xFF172033),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        );
      },
    );
  }

  Future<_BankOption?> _showBankPicker(BuildContext context, String current) {
    final searchController = TextEditingController();
    final picker = _showTapGoBottomSheet<_BankOption>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) {
        var query = '';
        return StatefulBuilder(
          builder: (context, setModalState) {
            final items = _indonesianBanks.where((bank) {
              final text = '${bank.code} ${bank.name}'.toLowerCase();
              return text.contains(query.toLowerCase());
            }).toList();
            return SafeArea(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  20,
                  4,
                  20,
                  MediaQuery.of(context).viewInsets.bottom + 20,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text(
                      'Pilih Bank',
                      style: TextStyle(
                        color: Color(0xFF0A2A43),
                        fontWeight: FontWeight.w900,
                        fontSize: 20,
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: searchController,
                      autofocus: true,
                      decoration: InputDecoration(
                        prefixIcon: const Icon(Icons.search_rounded),
                        hintText: 'Cari bank...',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                      onChanged: (value) => setModalState(() => query = value),
                    ),
                    const SizedBox(height: 12),
                    Flexible(
                      child: ListView.separated(
                        shrinkWrap: true,
                        itemCount: items.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final bank = items[index];
                          final selected =
                              bank.name == current || bank.code == current;
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor: _brandBlue.withValues(
                                alpha: selected ? 0.18 : 0.08,
                              ),
                              child: Text(
                                bank.code.length <= 2
                                    ? bank.code
                                    : bank.code.substring(0, 2),
                                style: const TextStyle(
                                  color: _brandBlue,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                            title: Text(bank.name),
                            subtitle: Text(bank.code),
                            trailing: selected
                                ? const Icon(
                                    Icons.check_circle_rounded,
                                    color: _brandBlue,
                                  )
                                : null,
                            onTap: () => Navigator.of(context).pop(bank),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
    return picker.whenComplete(() {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        searchController.dispose();
      });
    });
  }
}

class _BankAccountScreenState extends ConsumerState<BankAccountScreen> {
  final _formKey = GlobalKey<FormState>();
  final _bankController = TextEditingController();
  final _accountController = TextEditingController();
  final _holderController = TextEditingController();
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _holderController.text = ref.read(_demoSessionProvider).userName;
    _load();
  }

  @override
  void dispose() {
    _bankController.dispose();
    _accountController.dispose();
    _holderController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: 'Rekening Bank',
      subtitle: 'Data rekening withdrawal',
      child: Form(
        key: _formKey,
        child: Column(
          children: [
            if (_loading)
              const _StatusSurface(
                icon: Icons.sync_rounded,
                title: 'Memuat rekening',
                subtitle: 'Mengambil data rekening...',
              ),
            _BankDropdownField(controller: _bankController, label: 'Nama bank'),
            const SizedBox(height: 10),
            _InputField(
              controller: _accountController,
              icon: Icons.numbers_rounded,
              label: 'Nomor rekening',
              hint: 'Nomor rekening',
              keyboardType: TextInputType.number,
              inputFormatters: tapGoDigitsOnlyInputFormatters,
              validator: tapGoBankAccountValidatorMessage,
            ),
            const SizedBox(height: 10),
            _InputField(
              controller: _holderController,
              icon: Icons.person_rounded,
              label: 'Nama pemilik rekening',
              hint: 'Nama sesuai rekening',
              validator: (value) =>
                  (value ?? '').trim().length >= 2 ? null : 'Nama wajib diisi',
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? const _TapGoLoading(size: 18, strokeWidth: 2)
                    : const Icon(Icons.save_rounded),
                label: Text(
                  _saving ? 'Menyimpan...' : 'Simpan / Update Rekening',
                ),
                style: FilledButton.styleFrom(
                  backgroundColor: _brandBlue,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _load() async {
    final token = ref.read(_demoSessionProvider).accessToken;
    if (token == null || token.isEmpty) {
      setState(() => _loading = false);
      return;
    }
    try {
      _apiClient.setAccessToken(token);
      final account = await _apiClient.bankAccount();
      if (!mounted) {
        return;
      }
      final savedBank = account['bankCode']?.toString() ??
          account['bankName']?.toString() ??
          '';
      _bankController.text = _bankByNameOrCode(savedBank)?.name ??
          account['bankName']?.toString() ??
          '';
      _accountController.text = account['accountNumber']?.toString() ?? '';
      _holderController.text = account['accountHolderName']?.toString() ??
          ref.read(_demoSessionProvider).userName;
    } catch (_) {
      if (!mounted) {
        return;
      }
      _TapGoSnackbar.info(context, 'Data rekening belum tersedia.');
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final token = ref.read(_demoSessionProvider).accessToken;
    if (token == null || token.isEmpty) {
      _TapGoSnackbar.warning(context, 'Silakan login ulang untuk menyimpan.');
      return;
    }
    setState(() => _saving = true);
    try {
      _apiClient.setAccessToken(token);
      await _apiClient.updateBankAccount(
        bankName: _bankController.text.trim(),
        bankCode: _bankByNameOrCode(_bankController.text)?.code,
        accountNumber: tapGoDigitsOnly(_accountController.text),
        accountHolderName: _holderController.text.trim(),
      );
      if (!mounted) {
        return;
      }
      _TapGoSnackbar.success(context, 'Rekening bank berhasil disimpan.');
    } catch (error) {
      if (!mounted) {
        return;
      }
      _TapGoSnackbar.error(context, _friendlyApiError(error));
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }
}

const _privacyPolicyContent = '''
PT. TapGo Lion Indonesia mengumpulkan data yang diperlukan untuk menjalankan layanan membership, referral, wallet, dan withdraw TapGo.

Data yang dikumpulkan dapat meliputi nama, nomor HP, alamat, nomor KTP jika digunakan, foto KTP jika digunakan, foto diri jika digunakan, data rekening bank, data referral, data transaksi membership, data wallet, dan data withdraw.

Data digunakan untuk registrasi member, verifikasi akun, pengelolaan membership, referral dan komisi, invoice dan transaksi, withdraw, serta customer support.

TapGo menerapkan pembatasan akses, autentikasi, dan pencatatan transaksi untuk menjaga keamanan data. Data transaksi penting dapat disimpan sesuai kebutuhan hukum, audit, dan penyelesaian kewajiban layanan.

Pengguna dapat meminta penghapusan atau penonaktifan akun melalui menu Hapus Akun. Permintaan akan ditinjau agar tidak menghapus data transaksi penting yang wajib dipertahankan untuk audit dan kepatuhan.

Kontak support: support@tapgolion.id, WhatsApp +62 838-0025-5588, alamat Jalan Kp. Pasir Gendok No. 11, Desa Bojongleles, Kecamatan Rangkasbitung, Kabupaten Lebak, Banten, Indonesia.
''';

const _termsContent = '''
Dengan menggunakan TapGo, pengguna menyetujui ketentuan layanan membership, referral, wallet, PPOB, dan withdraw yang berlaku.

Paket Basic bersifat gratis dengan bonus registrasi Rp5.000 dan sponsor bonus Rp2.000 sesuai ketentuan 1.000 user pertama. Paket Silver, Gold, dan Platinum memiliki harga, benefit PPOB, dan hak usaha sesuai informasi yang ditampilkan di aplikasi.

Bonus sponsor, level, reward, dan profit sharing mengikuti marketing plan TapGo dan hanya diberikan jika syarat bisnis terpenuhi serta transaksi tercatat valid di sistem.

Saldo TapGoPay dan PPOB hanya dapat digunakan sesuai fungsi layanan yang tersedia. Withdraw mengikuti minimum nominal, verifikasi rekening, dan proses approval admin.

Pengguna dilarang membuat akun palsu, menyalahgunakan referral, melakukan klaim ganda, atau memanipulasi transaksi. TapGo berhak membatasi, menolak, atau menangguhkan akun yang melanggar.

TapGo dapat memperbarui layanan, benefit, dan ketentuan dengan pemberitahuan yang wajar. PT. TapGo Lion Indonesia tidak bertanggung jawab atas kerugian yang timbul dari penyalahgunaan akun atau informasi yang tidak benar dari pengguna.
''';

const _playPrivacyPolicyContent = '''
PT. TapGo Lion Indonesia mengumpulkan data yang diperlukan untuk menjalankan akun Basic dan layanan digital TapGo.

Data yang dikumpulkan dapat meliputi nama, nomor HP, alamat, nomor KTP jika digunakan, foto KTP jika digunakan, foto diri jika digunakan, serta riwayat permintaan layanan akun.

Data digunakan untuk registrasi, verifikasi akun, pengelolaan status Basic, keamanan akun, serta customer support.

TapGo menerapkan pembatasan akses, autentikasi, dan pencatatan transaksi untuk menjaga keamanan data. Data transaksi penting dapat disimpan sesuai kebutuhan hukum, audit, dan penyelesaian kewajiban layanan.

Pengguna dapat meminta penghapusan atau penonaktifan akun melalui menu Hapus Akun. Permintaan akan ditinjau agar tidak menghapus data transaksi penting yang wajib dipertahankan untuk audit dan kepatuhan.

Kontak support: support@tapgolion.id, WhatsApp +62 838-0025-5588, alamat Jalan Kp. Pasir Gendok No. 11, Desa Bojongleles, Kecamatan Rangkasbitung, Kabupaten Lebak, Banten, Indonesia.
''';

const _playTermsContent = '''
Dengan menggunakan TapGo, pengguna menyetujui ketentuan layanan akun Basic dan layanan digital yang berlaku.

Paket Basic bersifat gratis sebagai status awal member.

Benefit akun ditampilkan sesuai layanan yang tersedia di aplikasi.

Pengguna dilarang membuat akun palsu, melakukan klaim ganda, atau memanipulasi data layanan. TapGo berhak membatasi, menolak, atau menangguhkan akun yang melanggar.

TapGo dapat memperbarui layanan, benefit, dan ketentuan dengan pemberitahuan yang wajar. PT. TapGo Lion Indonesia tidak bertanggung jawab atas kerugian yang timbul dari penyalahgunaan akun atau informasi yang tidak benar dari pengguna.
''';

String get _tapGoPrivacyPolicyContent =>
    tapGoIsPlayDistribution ? _playPrivacyPolicyContent : _privacyPolicyContent;

String get _tapGoTermsContent =>
    tapGoIsPlayDistribution ? _playTermsContent : _termsContent;

class LegalInfoScreen extends StatelessWidget {
  const LegalInfoScreen({
    super.key,
    required this.title,
    required this.content,
  });

  final String title;
  final String content;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return _DemoScaffold(
      title: title,
      subtitle: 'PT. TapGo Lion Indonesia',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: colorScheme.surface,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: colorScheme.outlineVariant),
        ),
        child: Text(
          content,
          style: TextStyle(
            color: colorScheme.onSurface,
            height: 1.55,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class DeleteAccountRequestScreen extends ConsumerStatefulWidget {
  const DeleteAccountRequestScreen({super.key});

  @override
  ConsumerState<DeleteAccountRequestScreen> createState() =>
      _DeleteAccountRequestScreenState();
}

class _DeleteAccountRequestScreenState
    extends ConsumerState<DeleteAccountRequestScreen> {
  final _reasonController = TextEditingController();
  bool _submitting = false;
  Map<String, dynamic>? _latestRequest;

  @override
  void initState() {
    super.initState();
    _loadLatestRequest();
  }

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _loadLatestRequest() async {
    try {
      final data = await _apiClient.accountDeletionRequest();
      if (mounted) {
        setState(() => _latestRequest = data);
      }
    } catch (_) {
      // Empty state is acceptable when no request exists yet.
    }
  }

  Future<void> _submit() async {
    final confirmed = await _showTapGoDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Konfirmasi hapus akun'),
        content: const Text(
          'Permintaan ini akan ditinjau tim TapGo. Data transaksi penting '
          'seperti invoice, wallet ledger, dan withdrawal dapat tetap '
          'disimpan untuk audit dan kepatuhan.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Kirim Pengajuan'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) {
      return;
    }

    setState(() => _submitting = true);
    try {
      final data = await _apiClient.submitAccountDeletionRequest(
        reason: _reasonController.text,
      );
      if (!mounted) return;
      setState(() => _latestRequest = data);
      _TapGoSnackbar.success(context, 'Pengajuan hapus akun berhasil dikirim.');
    } catch (error) {
      if (!mounted) return;
      _TapGoSnackbar.error(
        context,
        'Pengajuan belum dapat dikirim. Silakan coba lagi.',
      );
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _latestRequest?['status']?.toString();
    return _DemoScaffold(
      title: 'Hapus Akun',
      subtitle: 'Ajukan penonaktifan akun sesuai kebijakan TapGo',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _StatusSurface(
            icon: Icons.info_outline_rounded,
            title: 'Penghapusan akun perlu ditinjau.',
            subtitle:
                'Data transaksi penting tidak langsung dihapus karena perlu disimpan untuk audit, kepatuhan, dan penyelesaian kewajiban.',
          ),
          if (status != null) ...[
            const SizedBox(height: 12),
            _InfoRow(label: 'Status request terakhir', value: status),
          ],
          const SizedBox(height: 16),
          TextField(
            controller: _reasonController,
            minLines: 3,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Alasan opsional',
              hintText: 'Tuliskan alasan penghapusan akun',
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _submitting ? null : _submit,
            icon: _submitting
                ? const _TapGoLoading(size: 18, strokeWidth: 2)
                : const Icon(Icons.send_rounded),
            label: Text(
              _submitting ? 'Mengirim...' : 'Ajukan Penghapusan Akun',
            ),
          ),
        ],
      ),
    );
  }
}

class ContactUsScreen extends ConsumerStatefulWidget {
  const ContactUsScreen({super.key});

  @override
  ConsumerState<ContactUsScreen> createState() => _ContactUsScreenState();
}

class _ContactUsScreenState extends ConsumerState<ContactUsScreen> {
  final _subjectController = TextEditingController();
  final _messageController = TextEditingController();
  bool _submitting = false;
  late Future<List<Map<String, dynamic>>> _ticketFuture;

  @override
  void initState() {
    super.initState();
    _ticketFuture = _loadTickets();
  }

  @override
  void dispose() {
    _subjectController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _loadTickets() async {
    final loader = tapGoSupportTicketsLoaderForTests;
    if (loader != null) {
      return loader();
    }
    if (tapGoDisablePersistenceForTests) {
      return const [];
    }
    return _apiClient.supportTickets();
  }

  Future<void> _submit() async {
    if (_subjectController.text.trim().length < 3 ||
        _messageController.text.trim().length < 10) {
      _TapGoSnackbar.warning(context, 'Lengkapi judul dan pesan bantuan.');
      return;
    }

    setState(() => _submitting = true);
    try {
      final createTicket = tapGoCreateSupportTicketForTests;
      await (createTicket != null
          ? createTicket(
              category: 'OTHER',
              subject: _subjectController.text,
              message: _messageController.text,
            )
          : _apiClient.createSupportTicket(
              category: 'OTHER',
              subject: _subjectController.text,
              message: _messageController.text,
            ));
      if (!mounted) return;
      _subjectController.clear();
      _messageController.clear();
      setState(() => _ticketFuture = _loadTickets());
      _TapGoSnackbar.success(context, 'Tiket bantuan berhasil dibuat.');
    } catch (error) {
      if (!mounted) return;
      _TapGoSnackbar.error(
        context,
        'Tiket bantuan belum dapat dibuat. Silakan coba lagi.',
      );
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: 'Bantuan TapGo',
      subtitle: 'Pusat bantuan member',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _StatusSurface(
            icon: Icons.support_agent_rounded,
            title: 'Support TapGo',
            subtitle:
                'Buat tiket bantuan untuk pertanyaan akun, membership Basic, atau kendala aplikasi.',
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _subjectController,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(labelText: 'Judul bantuan'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _messageController,
            minLines: 4,
            maxLines: 6,
            decoration: const InputDecoration(labelText: 'Pesan bantuan'),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _submitting ? null : _submit,
            icon: _submitting
                ? const _TapGoLoading(size: 18, strokeWidth: 2)
                : const Icon(Icons.send_rounded),
            label: Text(_submitting ? 'Mengirim...' : 'Kirim Pesan'),
          ),
          const SizedBox(height: 20),
          FutureBuilder<List<Map<String, dynamic>>>(
            future: _ticketFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: _TapGoLoading(size: 24));
              }
              if (snapshot.hasError) {
                return const _StatusSurface(
                  icon: Icons.wifi_off_rounded,
                  title: 'Riwayat bantuan belum dapat dimuat',
                  subtitle:
                      'Tiket baru tetap dapat dikirim saat koneksi tersedia.',
                );
              }
              final tickets = snapshot.data ?? const [];
              if (tickets.isEmpty) {
                return const _StatusSurface(
                  icon: Icons.mark_chat_unread_outlined,
                  title: 'Belum ada tiket bantuan',
                  subtitle: 'Tiket yang Anda kirim akan muncul di halaman ini.',
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const _SectionHeader(
                    title: 'Riwayat Bantuan',
                    subtitle: 'Status tiket yang pernah Anda kirim',
                  ),
                  const SizedBox(height: 10),
                  ...tickets.map(_SupportTicketCard.new),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _SupportTicketCard extends StatelessWidget {
  const _SupportTicketCard(this.ticket);

  final Map<String, dynamic> ticket;

  @override
  Widget build(BuildContext context) {
    final status = ticket['status']?.toString() ?? 'OPEN';
    final id = ticket['id']?.toString();
    final content = _InfoCard(
      icon: Icons.confirmation_number_rounded,
      title: ticket['subject']?.toString() ?? 'Tiket bantuan',
      subtitle:
          '${ticket['reference'] ?? '-'} • ${_supportStatusLabel(status)}',
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: id == null || id.isEmpty
          ? content
          : InkWell(
              borderRadius: BorderRadius.circular(22),
              onTap: () =>
                  _openDemo(context, SupportTicketDetailScreen(ticket: ticket)),
              child: content,
            ),
    );
  }
}

class SupportTicketDetailScreen extends StatelessWidget {
  const SupportTicketDetailScreen({required this.ticket, super.key});

  final Map<String, dynamic> ticket;

  Future<Map<String, dynamic>> _load() async {
    final id = ticket['id']?.toString();
    if (id == null || id.isEmpty) {
      return ticket;
    }
    final loader = tapGoSupportTicketDetailLoaderForTests;
    if (loader != null) {
      return loader(id);
    }
    if (tapGoDisablePersistenceForTests) {
      return ticket;
    }
    return _apiClient.supportTicketDetail(id);
  }

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: 'Detail Tiket',
      subtitle: 'Status dan pesan bantuan',
      child: FutureBuilder<Map<String, dynamic>>(
        future: _load(),
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: _TapGoLoading(size: 24));
          }
          if (snapshot.hasError) {
            return const _StatusSurface(
              icon: Icons.wifi_off_rounded,
              title: 'Detail tiket belum dapat dimuat',
              subtitle: 'Pastikan koneksi internet aktif, lalu coba lagi.',
            );
          }
          final data = snapshot.data ?? ticket;
          final status = data['status']?.toString() ?? 'OPEN';
          final messages = (data['messages'] is List)
              ? (data['messages'] as List)
                  .whereType<Map>()
                  .map((item) => item.cast<String, dynamic>())
                  .toList()
              : <Map<String, dynamic>>[];
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _StatusSurface(
                icon: Icons.confirmation_number_rounded,
                title: data['subject']?.toString() ?? 'Tiket bantuan',
                subtitle:
                    '${data['reference'] ?? '-'} • ${_supportStatusLabel(status)}',
              ),
              const SizedBox(height: 14),
              const _SectionHeader(
                title: 'Pesan',
                subtitle: 'Riwayat komunikasi terkait tiket ini',
              ),
              const SizedBox(height: 10),
              if (messages.isEmpty)
                const _StatusSurface(
                  icon: Icons.mark_chat_read_outlined,
                  title: 'Belum ada pesan tambahan',
                  subtitle: 'Balasan admin akan tampil di halaman ini.',
                )
              else
                ...messages.map(
                  (message) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _InfoCard(
                      icon: message['authorRole']?.toString() == 'USER'
                          ? Icons.person_rounded
                          : Icons.support_agent_rounded,
                      title: message['authorRole']?.toString() == 'USER'
                          ? 'Anda'
                          : 'Admin TapGo',
                      subtitle: message['body']?.toString() ?? '-',
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

String _supportStatusLabel(String status) {
  return switch (status.toUpperCase()) {
    'OPEN' => 'Terbuka',
    'IN_PROGRESS' => 'Diproses',
    'RESOLVED' => 'Selesai',
    'CLOSED' => 'Ditutup',
    _ => 'Terbuka',
  };
}

String _friendlyApiError(Object error) {
  if (error is DioException) {
    final responseData = error.response?.data;
    if (responseData is Map) {
      final code = responseData['code']?.toString();
      final message = responseData['message']?.toString();
      if (code == 'INSUFFICIENT_BALANCE') {
        return tapGoIsPlayDistribution
            ? 'Saldo belum cukup untuk melanjutkan.'
            : 'Saldo TapGoPay belum cukup untuk withdraw.';
      }
      if (code == 'WITHDRAWAL_MINIMUM_NOT_MET') {
        return 'Minimal withdraw Rp50.000.';
      }
      if (message != null && message.trim().isNotEmpty) {
        return message;
      }
    }
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.connectionError) {
      return 'Server TapGo belum dapat dihubungi. Silakan coba lagi.';
    }
  }
  return 'Pengajuan withdraw belum berhasil. Silakan coba lagi.';
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: colorScheme.onSurface,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}
