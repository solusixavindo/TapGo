part of '../main.dart';

class SuperAdminDashboardScreen extends ConsumerWidget {
  const SuperAdminDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(_demoSessionProvider);
    if (!session.isSuperAdmin) {
      return const _AccessDeniedScreen();
    }
    return const _AdminDashboardBody(
      title: 'Super Admin Dashboard',
      subtitle: 'Kontrol bisnis, role, package, commission, dan audit.',
      isSuperAdminDashboard: true,
    );
  }
}

class AdminDashboardScreen extends ConsumerWidget {
  const AdminDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(_demoSessionProvider);
    if (!session.isAdmin) {
      return const _AccessDeniedScreen();
    }
    if (session.isSuperAdmin) {
      return const SuperAdminDashboardScreen();
    }
    return const _AdminDashboardBody(
      title: 'Admin Dashboard',
      subtitle: 'Operasional bisnis, member, payment, wallet, withdrawal.',
      isSuperAdminDashboard: false,
    );
  }
}

class _AdminDashboardBody extends ConsumerWidget {
  const _AdminDashboardBody({
    required this.title,
    required this.subtitle,
    required this.isSuperAdminDashboard,
  });

  final String title;
  final String subtitle;
  final bool isSuperAdminDashboard;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final adminSnapshot = ref.watch(_adminConsoleSnapshotProvider);
    final summary = adminSnapshot.valueOrNull?.summary;
    final totalMembers = _intFrom(summary?['totalMembers']);
    final totalRevenue = _intFrom(summary?['totalRevenue']);
    final totalCommission = _intFrom(summary?['totalCommission']);
    final totalWithdrawPending = _intFrom(summary?['totalWithdrawPending']);
    return _DemoScaffold(
      title: title,
      subtitle: subtitle,
      showBackButton: false,
      child: Column(
        children: [
          _AdminApiStatusTile(state: adminSnapshot),
          const SizedBox(height: 12),
          const _AdminHeroCard(),
          const SizedBox(height: 14),
          if (adminSnapshot.hasError) ...[
            _RetryStatusSurface(
              icon: Icons.cloud_off_rounded,
              title: 'Gagal memuat data dashboard',
              subtitle:
                  'Silakan muat ulang untuk mengambil data admin terbaru.',
              onRetry: () => ref.invalidate(_adminConsoleSnapshotProvider),
            ),
          ] else ...[
            Row(
              children: [
                Expanded(
                  child: _StatCard(
                    label: 'Total Member',
                    value: '${adminSnapshot.hasValue ? totalMembers : 0}',
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _StatCard(
                    label: 'Omzet',
                    value: _formatCompactRupiah(
                      adminSnapshot.hasValue ? totalRevenue : 0,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: _StatCard(
                    label: 'Total Komisi',
                    value: _formatCompactRupiah(
                      adminSnapshot.hasValue ? totalCommission : 0,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _StatCard(
                    label: 'Withdraw Pending',
                    value: _formatCompactRupiah(
                      adminSnapshot.hasValue ? totalWithdrawPending : 0,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            _AdminPackageBreakdown(summary: summary),
            const SizedBox(height: 14),
            ..._adminMenuItems(isSuperAdminDashboard).map(
              (item) => _DemoMenuTile(
                icon: item.icon,
                title: item.title,
                subtitle: item.subtitle,
                onTap: () => item.open(context),
              ),
            ),
            const SizedBox(height: 10),
          ],
          _DemoMenuTile(
            icon: Icons.logout_rounded,
            title: 'Logout',
            subtitle: 'Keluar dari akun admin di perangkat ini',
            onTap: () => _confirmAndLogout(context, ref),
          ),
        ],
      ),
    );
  }
}

class _AdminDashboardMenuItem {
  const _AdminDashboardMenuItem({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.open,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final void Function(BuildContext context) open;
}

List<_AdminDashboardMenuItem> _adminMenuItems(bool isSuperAdmin) {
  final operational = [
    _AdminDashboardMenuItem(
      icon: Icons.insights_rounded,
      title: 'Business Overview',
      subtitle: 'Statistik bisnis membership, revenue, komisi, withdrawal',
      open: (context) =>
          _openDemo(context, const AdminBusinessOverviewScreen()),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.groups_rounded,
      title: 'Member Management',
      subtitle: 'List member, status paket, sponsor, jaringan',
      open: (context) => _openDemo(context, const AdminMemberListScreen()),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.verified_rounded,
      title: 'Approve Member',
      subtitle: 'Approve/reject pengajuan upgrade membership',
      open: (context) => _openDemo(context, const AdminMemberRequestScreen()),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.receipt_long_rounded,
      title: 'Payment Management',
      subtitle: 'Invoice pending/lunas dan metode pembayaran',
      open: (context) => _openDemo(context, const AdminPaymentScreen()),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.account_balance_wallet_rounded,
      title: 'Wallet Management',
      subtitle: 'Saldo user dan riwayat transaksi wallet',
      open: (context) => _openDemo(context, const AdminWalletScreen()),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.payments_rounded,
      title: 'Withdrawal Management',
      subtitle: isSuperAdmin
          ? 'Approve, reject, dan mark paid withdrawal'
          : 'Approve/reject withdrawal operasional',
      open: (context) => _openDemo(context, const AdminWithdrawalScreen()),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.hub_rounded,
      title: 'Referral Analytics',
      subtitle: 'Top sponsor, level aktif, referal tim',
      open: (context) =>
          _openDemo(context, const AdminReferralAnalyticsScreen()),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.assessment_rounded,
      title: 'Laporan Bonus',
      subtitle: 'Registration, sponsor, level, reward bonus',
      open: (context) => _openDemo(
        context,
        const _AdminReportScreen(
          title: 'Laporan Bonus',
          type: _AdminReportType.bonus,
        ),
      ),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.phone_android_rounded,
      title: 'Laporan PPOB',
      subtitle: 'Riwayat benefit saldo PPOB per paket',
      open: (context) => _openDemo(
        context,
        const _AdminReportScreen(
          title: 'Laporan PPOB',
          type: _AdminReportType.ppob,
        ),
      ),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.emoji_events_rounded,
      title: 'Laporan Reward',
      subtitle: 'Reward member dan status pembayaran',
      open: (context) => _openDemo(
        context,
        const _AdminReportScreen(
          title: 'Laporan Reward',
          type: _AdminReportType.reward,
        ),
      ),
    ),
  ];

  if (!isSuperAdmin) {
    return [
      ...operational,
      _AdminDashboardMenuItem(
        icon: Icons.campaign_rounded,
        title: 'Broadcast',
        subtitle: 'Memerlukan persetujuan admin utama',
        open: (context) => _openDemo(
          context,
          const _AdminProductionApprovalScreen(title: 'Broadcast'),
        ),
      ),
      _AdminDashboardMenuItem(
        icon: Icons.support_agent_rounded,
        title: 'Support',
        subtitle: 'Memerlukan persetujuan admin utama',
        open: (context) => _openDemo(
          context,
          const _AdminProductionApprovalScreen(title: 'Support'),
        ),
      ),
    ];
  }

  return [
    ...operational,
    _AdminDashboardMenuItem(
      icon: Icons.workspace_premium_rounded,
      title: 'Founder Program',
      subtitle: 'Slot Founder Platinum, status, komisi, dan audit ringkas',
      open: (context) => _openDemo(context, const FounderProgramScreen()),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.pie_chart_rounded,
      title: 'Profit Sharing',
      subtitle: 'Memerlukan persetujuan admin utama',
      open: (context) => _openDemo(
        context,
        const _AdminProductionApprovalScreen(title: 'Profit Sharing'),
      ),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.tune_rounded,
      title: 'Commission Settings',
      subtitle: 'Memerlukan persetujuan admin utama',
      open: (context) => _openDemo(
        context,
        const _AdminProductionApprovalScreen(title: 'Commission Settings'),
      ),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.workspace_premium_rounded,
      title: 'Membership Package Settings',
      subtitle: 'Memerlukan persetujuan admin utama',
      open: (context) => _openDemo(
        context,
        const _AdminProductionApprovalScreen(
          title: 'Membership Package Settings',
        ),
      ),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.admin_panel_settings_rounded,
      title: 'Admin & Role Management',
      subtitle: 'Memerlukan persetujuan admin utama',
      open: (context) => _openDemo(
        context,
        const _AdminProductionApprovalScreen(title: 'Admin & Role Management'),
      ),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.fact_check_rounded,
      title: 'Audit Log',
      subtitle: 'Memerlukan persetujuan admin utama',
      open: (context) => _openDemo(
        context,
        const _AdminProductionApprovalScreen(title: 'Audit Log'),
      ),
    ),
    _AdminDashboardMenuItem(
      icon: Icons.settings_rounded,
      title: 'App Settings',
      subtitle: 'Memerlukan persetujuan admin utama',
      open: (context) => _openDemo(
        context,
        const _AdminProductionApprovalScreen(title: 'App Settings'),
      ),
    ),
  ];
}

class _AdminApiStatusTile extends ConsumerWidget {
  const _AdminApiStatusTile({required this.state});

  final AsyncValue<_AdminConsoleApiSnapshot> state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (state.isLoading) {
      return const _StatusSurface(
        icon: Icons.sync_rounded,
        title: 'Memuat data admin',
        subtitle: 'Mengecek layanan admin TapGo...',
      );
    }

    if (state.hasError) {
      return _RetryStatusSurface(
        icon: Icons.cloud_off_rounded,
        title: 'Data belum tersedia',
        subtitle: 'Koneksi admin belum berhasil dimuat.',
        onRetry: () => ref.invalidate(_adminConsoleSnapshotProvider),
      );
    }

    final data = state.value!;
    return _StatusSurface(
      icon: Icons.cloud_done_rounded,
      title: 'Data Aktif',
      subtitle:
          '${data.members.length} member, ${data.invoices.length} invoice, ${data.withdrawals.length} withdrawal.',
    );
  }
}

class _AdminHeroCard extends StatelessWidget {
  const _AdminHeroCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF0A2A43),
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(
            color: Color(0x220A2A43),
            blurRadius: 24,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.business_center_rounded, color: Colors.white, size: 34),
          SizedBox(height: 14),
          Text(
            'TapGo Business Console',
            style: TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
          SizedBox(height: 6),
          Text(
            'Monitoring membership, referral, wallet, invoice, dan withdraw.',
            style: TextStyle(color: Color(0xCCFFFFFF), height: 1.4),
          ),
        ],
      ),
    );
  }
}

class _AdminProductionApprovalScreen extends StatelessWidget {
  const _AdminProductionApprovalScreen({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: title,
      subtitle: 'Memerlukan persetujuan admin utama',
      child: const _StatusSurface(
        icon: Icons.lock_clock_rounded,
        title: 'Fitur ini memerlukan persetujuan admin utama.',
        subtitle: 'Layanan belum aktif untuk akun ini.',
      ),
    );
  }
}

class AdminBusinessOverviewScreen extends ConsumerWidget {
  const AdminBusinessOverviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final adminSnapshot = ref.watch(_adminConsoleSnapshotProvider);
    final summary = adminSnapshot.valueOrNull?.summary;

    return _DemoScaffold(
      title: 'Business Overview',
      subtitle: adminSnapshot.hasValue
          ? 'Ringkasan data TapGo'
          : 'Ringkasan bisnis TapGo',
      child: Column(
        children: [
          if (adminSnapshot.isLoading)
            const _StatusSurface(
              icon: Icons.sync_rounded,
              title: 'Memuat Business Overview',
              subtitle: 'Mengambil ringkasan bisnis TapGo...',
            )
          else if (adminSnapshot.hasError)
            _RetryStatusSurface(
              icon: Icons.cloud_off_rounded,
              title: 'Gagal memuat data dashboard',
              subtitle: 'Silakan muat ulang Business Overview.',
              onRetry: () => ref.invalidate(_adminConsoleSnapshotProvider),
            )
          else ...[
            _InfoPanel(
              color: _brandBlue,
              title: 'Total Omzet',
              value: _summaryMoney(summary, ['totalRevenue']),
              subtitle: 'Komisi ${_summaryMoney(summary, [
                    'totalCommission'
                  ])} • Wallet ${_summaryMoney(summary, [
                    'totalWalletBalance'
                  ])}',
              icon: Icons.insights_rounded,
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: _StatCard(
                    label: 'Total Member',
                    value: _summaryCount(summary, ['totalMembers']),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _StatCard(
                    label: 'Member Active',
                    value: _summaryCount(summary, [
                      'activeMembers',
                      'totalActiveMembers',
                      'totalActiveMemberships',
                    ]),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: _StatCard(
                    label: 'Total Withdraw',
                    value: _summaryMoney(summary, [
                      'totalWithdraw',
                      'totalWithdrawal',
                      'totalWithdrawalAmount',
                      'totalWithdrawAmount',
                    ]),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _StatCard(
                    label: 'Pending Withdraw',
                    value: _summaryMoney(summary, ['totalWithdrawPending']),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            _AdminPackageBreakdown(summary: summary),
          ],
        ],
      ),
    );
  }
}

class FounderProgramScreen extends ConsumerStatefulWidget {
  const FounderProgramScreen({super.key});

  @override
  ConsumerState<FounderProgramScreen> createState() =>
      _FounderProgramScreenState();
}

class _FounderProgramScreenState extends ConsumerState<FounderProgramScreen> {
  late Future<Map<String, dynamic>> _future;
  final Map<String, bool> _processing = {};

  @override
  void initState() {
    super.initState();
    _future = _loadFounderProgram();
  }

  Future<Map<String, dynamic>> _loadFounderProgram() async {
    final results = await Future.wait([
      _apiClient.adminFounderChairman(),
      _apiClient.adminFounderPlatinum(),
    ]);
    return {'chairman': results[0], 'platinum': results[1]};
  }

  void _reload() {
    setState(() => _future = _loadFounderProgram());
  }

  Future<void> _changeStatus(
    String founderId,
    String status, {
    bool requireReason = false,
  }) async {
    final reason = await _statusReasonDialog(
      context,
      status: status,
      requireReason: requireReason,
    );
    if (reason == null) {
      return;
    }

    setState(() => _processing[founderId] = true);
    try {
      if (founderId.startsWith('FCH-')) {
        await _apiClient.updateFounderChairmanStatus(
          founderId: founderId,
          status: status,
          reason: reason,
        );
      } else {
        await _apiClient.updateFounderPlatinumStatus(
          founderId: founderId,
          status: status,
          reason: reason,
        );
      }
      if (!mounted) return;
      _TapGoSnackbar.success(context, 'Status Founder $founderId diperbarui');
      ref.invalidate(_adminConsoleSnapshotProvider);
      _reload();
    } catch (error) {
      if (!mounted) return;
      _TapGoSnackbar.error(context, 'Gagal memperbarui status Founder: $error');
    } finally {
      if (mounted) {
        setState(() => _processing[founderId] = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: 'Founder Program',
      subtitle: 'Founder Chairman dan Founder Platinum',
      child: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const _StatusSurface(
              icon: Icons.sync_rounded,
              title: 'Memuat Founder Program',
              subtitle: 'Mengambil data Founder Chairman dan Platinum...',
            );
          }
          if (snapshot.hasError) {
            return _RetryStatusSurface(
              icon: Icons.cloud_off_rounded,
              title: 'Founder Program belum tersedia',
              subtitle: 'Silakan muat ulang data Founder.',
              onRetry: _reload,
            );
          }

          final data = snapshot.data ?? const <String, dynamic>{};
          final chairman =
              (data['chairman'] as Map?)?.cast<String, dynamic>() ??
                  const <String, dynamic>{};
          final platinum =
              (data['platinum'] as Map?)?.cast<String, dynamic>() ??
                  const <String, dynamic>{};
          final chairmanItem =
              (chairman['item'] as Map?)?.cast<String, dynamic>();
          final items = ((platinum['items'] as List?) ?? const [])
              .whereType<Map>()
              .map((item) => item.cast<String, dynamic>())
              .toList(growable: false);
          final statusSummary =
              (platinum['statusSummary'] as Map?)?.cast<String, dynamic>() ??
                  const <String, dynamic>{};
          final chairmanStatusSummary =
              (chairman['statusSummary'] as Map?)?.cast<String, dynamic>() ??
                  const <String, dynamic>{};
          int combinedStatus(String status) =>
              _intFrom(statusSummary[status]) +
              _intFrom(chairmanStatusSummary[status]);

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: _StatCard(
                      label: 'Total Slot',
                      value:
                          '${_intFrom(platinum['totalSlot']) + _intFrom(chairman['totalSlot'])}',
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _StatCard(
                      label: 'Terpakai',
                      value:
                          '${_intFrom(platinum['usedSlot']) + _intFrom(chairman['usedSlot'])}',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _StatCard(
                      label: 'Sisa Slot',
                      value:
                          '${_intFrom(platinum['availableSlot']) + _intFrom(chairman['availableSlot'])}',
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _StatCard(
                      label: 'Active',
                      value: '${_intFrom(statusSummary['ACTIVE'])}',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _StatusSurface(
                icon: Icons.verified_user_rounded,
                title: 'Lifecycle Founder',
                subtitle:
                    'ACTIVE ${combinedStatus('ACTIVE')} • SUSPENDED ${combinedStatus('SUSPENDED')} • REVOKED ${combinedStatus('REVOKED')}',
              ),
              const SizedBox(height: 12),
              if (chairmanItem != null) ...[
                _founderCard(chairmanItem),
                const SizedBox(height: 4),
              ] else
                const _StatusSurface(
                  icon: Icons.emoji_events_rounded,
                  title: 'Founder Chairman',
                  subtitle: 'Slot FCH-001 belum diberikan.',
                ),
              const SizedBox(height: 12),
              if (items.isEmpty)
                const _EmptyState(
                  icon: Icons.workspace_premium_rounded,
                  title: 'Belum ada Founder Platinum',
                  subtitle: 'Grant Founder akan muncul di console ini.',
                )
              else
                ...items.map(_founderCard),
            ],
          );
        },
      ),
    );
  }

  Widget _founderCard(Map<String, dynamic> item) {
    final founderId = item['founderId']?.toString() ?? '-';
    final status = item['status']?.toString() ?? 'ACTIVE';
    final busy = _processing[founderId] == true;
    final isRevoked = status == 'REVOKED';
    final isChairman = founderId.startsWith('FCH-');

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFEAF0F6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  item['name']?.toString() ?? 'Founder Platinum',
                  style: const TextStyle(
                    color: Color(0xFF0A2A43),
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
              ),
              _FounderStatusChip(status: status),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '$founderId • ${item['phone'] ?? '-'} • ${item['email'] ?? '-'}',
            style: const TextStyle(
              color: Color(0xFF64748B),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Referral ${item['referralCount'] ?? 0} • Cash ${item['walletCash'] ?? '0.00'} • PPOB ${item['walletPpob'] ?? '0.00'}',
            style: const TextStyle(color: Color(0xFF94A3B8)),
          ),
          const SizedBox(height: 6),
          Text(
            'Sponsor ${item['totalSponsorBonus'] ?? '0.00'} • Level ${item['totalLevelBonus'] ?? '0.00'} • Total ${item['totalCommission'] ?? '0.00'}',
            style: const TextStyle(color: Color(0xFF94A3B8)),
          ),
          if (isChairman && item['bankAccountMasked'] != null) ...[
            const SizedBox(height: 6),
            Text(
              'Bank Account ${item['bankAccountMasked']}',
              style: const TextStyle(color: Color(0xFF94A3B8)),
            ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: busy
                    ? null
                    : () => _openDemo(
                          context,
                          FounderProgramDetailScreen(founderId: founderId),
                        ),
                icon: const Icon(Icons.visibility_rounded),
                label: const Text('Detail'),
              ),
              if (status == 'ACTIVE')
                OutlinedButton.icon(
                  onPressed: busy
                      ? null
                      : () => _changeStatus(
                            founderId,
                            'SUSPENDED',
                            requireReason: true,
                          ),
                  icon: const Icon(Icons.pause_circle_outline_rounded),
                  label: const Text('Suspend'),
                ),
              if (status == 'SUSPENDED')
                OutlinedButton.icon(
                  onPressed:
                      busy ? null : () => _changeStatus(founderId, 'ACTIVE'),
                  icon: const Icon(Icons.play_circle_outline_rounded),
                  label: const Text('Aktifkan'),
                ),
              if (!isRevoked)
                FilledButton.icon(
                  onPressed: busy
                      ? null
                      : () => _changeStatus(
                            founderId,
                            'REVOKED',
                            requireReason: true,
                          ),
                  icon: const Icon(Icons.block_rounded),
                  label: const Text('Revoke'),
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFFB42318),
                    foregroundColor: Colors.white,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class FounderProgramDetailScreen extends StatelessWidget {
  const FounderProgramDetailScreen({super.key, required this.founderId});

  final String founderId;

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: 'Detail Founder',
      subtitle: founderId,
      child: FutureBuilder<Map<String, dynamic>>(
        future: founderId.startsWith('FCH-')
            ? _apiClient.adminFounderChairmanDetail(founderId)
            : _apiClient.adminFounderPlatinumDetail(founderId),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const _StatusSurface(
              icon: Icons.sync_rounded,
              title: 'Memuat detail Founder',
              subtitle: 'Mengambil data Founder Program...',
            );
          }
          if (snapshot.hasError) {
            return const _StatusSurface(
              icon: Icons.cloud_off_rounded,
              title: 'Detail Founder belum tersedia',
              subtitle: 'Silakan kembali dan buka ulang detail.',
            );
          }

          final data = snapshot.data ?? const <String, dynamic>{};
          final auditTrail = ((data['auditTrail'] as List?) ?? const [])
              .whereType<Map>()
              .map((item) => item.cast<String, dynamic>())
              .toList(growable: false);

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _InfoPanel(
                color: const Color(0xFFD6A437),
                title: data['status']?.toString() ?? 'ACTIVE',
                value: data['name']?.toString() ?? 'Founder Platinum',
                subtitle: '${data['phone'] ?? '-'} • ${data['email'] ?? '-'}',
                icon: Icons.workspace_premium_rounded,
              ),
              const SizedBox(height: 12),
              _FounderDetailRow('Founder ID', data['founderId']),
              _FounderDetailRow('Membership', data['membership']),
              _FounderDetailRow('Granted At', _dateLabel(data['grantedAt'])),
              _FounderDetailRow('Wallet Cash', data['walletCash']),
              _FounderDetailRow('Wallet PPOB', data['walletPpob']),
              if (data['bankAccountMasked'] != null)
                _FounderDetailRow('Bank Account', data['bankAccountMasked']),
              _FounderDetailRow('Referral Count', data['referralCount']),
              _FounderDetailRow('Sponsor Bonus', data['totalSponsorBonus']),
              _FounderDetailRow('Level Bonus', data['totalLevelBonus']),
              _FounderDetailRow('Total Commission', data['totalCommission']),
              const SizedBox(height: 12),
              const Text(
                'Audit Trail',
                style: TextStyle(
                  color: Color(0xFF0A2A43),
                  fontWeight: FontWeight.w900,
                  fontSize: 16,
                ),
              ),
              const SizedBox(height: 8),
              if (auditTrail.isEmpty)
                const _EmptyState(
                  icon: Icons.fact_check_rounded,
                  title: 'Belum ada audit tambahan',
                  subtitle: 'Perubahan status akan tercatat di sini.',
                )
              else
                ...auditTrail.map(
                  (item) => _WalletLedgerItem(
                    title: item['action']?.toString() ?? 'Audit',
                    amount: _dateLabel(item['createdAt']) ?? '-',
                    note: item['metadata']?.toString() ?? 'Audit Founder',
                    color: const Color(0xFFD6A437),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _FounderStatusChip extends StatelessWidget {
  const _FounderStatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      'ACTIVE' => const Color(0xFF079455),
      'SUSPENDED' => const Color(0xFFB54708),
      'REVOKED' => const Color(0xFFB42318),
      _ => const Color(0xFF64748B),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        status,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _FounderDetailRow extends StatelessWidget {
  const _FounderDetailRow(this.label, this.value);

  final String label;
  final Object? value;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEAF0F6)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF64748B),
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value?.toString() ?? '-',
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

Future<String?> _statusReasonDialog(
  BuildContext context, {
  required String status,
  required bool requireReason,
}) async {
  final controller = TextEditingController();
  return _showTapGoDialog<String?>(
    context: context,
    builder: (context) {
      return AlertDialog(
        title: Text('Ubah status ke $status'),
        content: TextField(
          controller: controller,
          minLines: 2,
          maxLines: 4,
          decoration: InputDecoration(
            labelText: requireReason ? 'Alasan wajib' : 'Alasan opsional',
            border: const OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(null),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () {
              final reason = controller.text.trim();
              if (requireReason && reason.isEmpty) {
                _TapGoSnackbar.warning(context, 'Alasan wajib diisi');
                return;
              }
              Navigator.of(context).pop(reason);
            },
            child: const Text('Simpan'),
          ),
        ],
      );
    },
  );
}

class _AdminRecordDetailScreen extends StatelessWidget {
  const _AdminRecordDetailScreen({required this.title, required this.rows});

  final String title;
  final List<String> rows;

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: title,
      subtitle: 'Detail operasional',
      child: Column(
        children: rows
            .map(
              (row) => _WalletLedgerItem(
                title: row,
                amount: 'Live Data',
                note: 'Data dibuka dari dashboard admin.',
                color: _brandBlue,
              ),
            )
            .toList(),
      ),
    );
  }
}

int? _summaryInt(Map<String, dynamic>? summary, List<String> keys) {
  if (summary == null) {
    return null;
  }
  for (final key in keys) {
    if (!summary.containsKey(key) || summary[key] == null) {
      continue;
    }
    return _intFrom(summary[key]);
  }
  return null;
}

String _summaryCount(Map<String, dynamic>? summary, List<String> keys) {
  final value = _summaryInt(summary, keys);
  return value == null ? '-' : '$value';
}

String _summaryMoney(Map<String, dynamic>? summary, List<String> keys) {
  final value = _summaryInt(summary, keys);
  return value == null ? '-' : _formatCompactRupiah(value);
}

class _AdminPackageBreakdown extends StatelessWidget {
  const _AdminPackageBreakdown({required this.summary});

  final Map<String, dynamic>? summary;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Membership Breakdown',
            style: TextStyle(
              color: Color(0xFF0A2A43),
              fontSize: 17,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _BenefitChip(
                label:
                    'Basic ${summary == null ? 0 : _intFrom(summary!['totalBasic'])}',
              ),
              _BenefitChip(
                label:
                    'Silver ${summary == null ? _countPackage('Silver') : _intFrom(summary!['totalSilver'])}',
              ),
              _BenefitChip(
                label:
                    'Gold ${summary == null ? _countPackage('Gold') : _intFrom(summary!['totalGold'])}',
              ),
              _BenefitChip(
                label:
                    'Platinum ${summary == null ? _countPackage('Platinum') : _intFrom(summary!['totalPlatinum'])}',
              ),
              _BenefitChip(
                label: summary == null
                    ? 'Sponsor Bonus Rp0'
                    : 'Sponsor ${_formatCompactRupiah(_intFrom(summary!['totalSponsorBonus']))}',
              ),
              _BenefitChip(
                label: summary == null
                    ? 'Level Bonus Rp0'
                    : 'Level ${_formatCompactRupiah(_intFrom(summary!['totalLevelBonus']))}',
              ),
              _BenefitChip(
                label: summary == null
                    ? 'Reward Rp0'
                    : 'Reward ${_formatCompactRupiah(_intFrom(summary!['totalRewardBonus']))}',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class AdminMemberRequestScreen extends ConsumerStatefulWidget {
  const AdminMemberRequestScreen({super.key});

  @override
  ConsumerState<AdminMemberRequestScreen> createState() =>
      _AdminMemberRequestScreenState();
}

class _AdminMemberRequestScreenState
    extends ConsumerState<AdminMemberRequestScreen> {
  late Future<List<Map<String, dynamic>>> _future;
  final Map<String, bool> _processing = {};

  @override
  void initState() {
    super.initState();
    _future = _apiClient.adminMemberRequests();
  }

  void _reload() {
    setState(() => _future = _apiClient.adminMemberRequests());
  }

  Future<void> _action(
    String id,
    Future<Map<String, dynamic>> Function() call,
    String successMessage,
  ) async {
    setState(() => _processing[id] = true);
    try {
      await call();
      if (!mounted) return;
      _TapGoSnackbar.success(context, successMessage);
      _reload();
      ref.invalidate(_adminConsoleSnapshotProvider);
    } catch (error) {
      if (!mounted) return;
      _TapGoSnackbar.error(context, 'Gagal memproses pengajuan: $error');
    } finally {
      if (mounted) {
        setState(() => _processing[id] = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: 'Approve Member',
      subtitle: 'Pengajuan upgrade membership',
      child: FutureBuilder<List<Map<String, dynamic>>>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const _StatusSurface(
              icon: Icons.sync_rounded,
              title: 'Memuat pengajuan',
              subtitle: 'Mengambil data membership order...',
            );
          }
          if (snapshot.hasError) {
            return _RetryStatusSurface(
              icon: Icons.cloud_off_rounded,
              title: 'Data belum tersedia',
              subtitle: 'Silakan muat ulang.',
              onRetry: _reload,
            );
          }
          final items = snapshot.data ?? const <Map<String, dynamic>>[];
          if (items.isEmpty) {
            return const _EmptyState(
              icon: Icons.verified_rounded,
              title: 'Belum ada pengajuan member',
              subtitle: 'Order membership baru akan muncul di sini.',
            );
          }
          return Column(children: items.map(_requestCard).toList());
        },
      ),
    );
  }

  Widget _requestCard(Map<String, dynamic> item) {
    final user = (item['user'] as Map?)?.cast<String, dynamic>() ?? {};
    final membership =
        (item['membership'] as Map?)?.cast<String, dynamic>() ?? {};
    final invoice = (item['invoice'] as Map?)?.cast<String, dynamic>() ?? {};
    final id = item['id']?.toString() ?? '';
    final busy = _processing[id] == true;
    final status = item['status']?.toString() ?? '-';
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFEAF0F6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            user['fullName']?.toString() ?? 'Member TapGo',
            style: const TextStyle(
              color: Color(0xFF0A2A43),
              fontWeight: FontWeight.w900,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '${user['phone'] ?? '-'} • ${membership['name'] ?? membership['tier'] ?? '-'} • ${formatRupiah(_intFrom(item['totalAmount']))}',
            style: const TextStyle(
              color: Color(0xFF64748B),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Invoice ${invoice['number'] ?? '-'} • Status $status • ${_dateLabel(item['createdAt']) ?? '-'}',
            style: const TextStyle(color: Color(0xFF94A3B8)),
          ),
          if (status == 'PENDING') ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: busy
                        ? null
                        : () => _action(
                              id,
                              () => _apiClient.rejectMemberRequest(id),
                              'Pengajuan member ditolak.',
                            ),
                    child: const Text('Reject'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: busy
                        ? null
                        : () => _action(
                              id,
                              () => _apiClient.approveMemberRequest(id),
                              'Pengajuan member disetujui.',
                            ),
                    child: Text(busy ? 'Memproses...' : 'Approve'),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

enum _AdminReportType { bonus, ppob, reward }

class _AdminReportScreen extends StatefulWidget {
  const _AdminReportScreen({required this.title, required this.type});

  final String title;
  final _AdminReportType type;

  @override
  State<_AdminReportScreen> createState() => _AdminReportScreenState();
}

class _AdminReportScreenState extends State<_AdminReportScreen> {
  late Future<Map<String, dynamic>> _future;
  final _dateFromController = TextEditingController();
  final _dateToController = TextEditingController();
  final _userIdController = TextEditingController();
  final _typeController = TextEditingController();
  final _statusController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Map<String, dynamic>> _load() {
    final query = _query();
    return switch (widget.type) {
      _AdminReportType.bonus => _apiClient.adminBonusReport(query: query),
      _AdminReportType.ppob => _apiClient.adminPpobReport(query: query),
      _AdminReportType.reward => _apiClient.adminRewardReport(query: query),
    };
  }

  @override
  void dispose() {
    _dateFromController.dispose();
    _dateToController.dispose();
    _userIdController.dispose();
    _typeController.dispose();
    _statusController.dispose();
    super.dispose();
  }

  void _reload() {
    setState(() => _future = _load());
  }

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: widget.title,
      subtitle: 'Laporan transaksi TapGo',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _filterPanel(),
          const SizedBox(height: 12),
          FutureBuilder<Map<String, dynamic>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const _StatusSurface(
                  icon: Icons.sync_rounded,
                  title: 'Memuat laporan',
                  subtitle: 'Mengambil data laporan...',
                );
              }
              if (snapshot.hasError) {
                return _RetryStatusSurface(
                  icon: Icons.cloud_off_rounded,
                  title: 'Data belum tersedia',
                  subtitle: 'Silakan muat ulang.',
                  onRetry: _reload,
                );
              }
              final data = snapshot.data ?? const <String, dynamic>{};
              final items = _reportItems(data);
              final total = data['totalBonus'] ??
                  data['totalPpob'] ??
                  data['transactionCount'] ??
                  items.length;
              if (items.isEmpty) {
                return const _EmptyState(
                  icon: Icons.assessment_rounded,
                  title: 'Belum ada data laporan',
                  subtitle: 'Transaksi akan muncul setelah tercatat.',
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: _StatCard(
                          label: 'Total',
                          value: total.toString(),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _StatCard(
                          label: 'Transaksi',
                          value: '${data['transactionCount'] ?? items.length}',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: _StatCard(
                          label: 'Pending',
                          value: '${data['totalPending'] ?? '0.00'}',
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _StatCard(
                          label: 'Approved/Paid',
                          value: '${data['totalApprovedPaid'] ?? '0.00'}',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  ...items.map(
                    (item) => _WalletLedgerItem(
                      title: _reportTitle(item),
                      amount: formatRupiah(_intFrom(item['amount'])),
                      note:
                          '${item['type'] ?? item['status'] ?? '-'} • ${_dateLabel(item['createdAt']) ?? '-'}',
                      color: _brandBlue,
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _filterPanel() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFEAF0F6)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _dateFromController,
                  decoration: const InputDecoration(
                    labelText: 'Tanggal awal',
                    hintText: '2026-06-01',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _dateToController,
                  decoration: const InputDecoration(
                    labelText: 'Tanggal akhir',
                    hintText: '2026-06-30',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _userIdController,
            decoration: const InputDecoration(labelText: 'User ID opsional'),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _typeController,
                  decoration: const InputDecoration(
                    labelText: 'Jenis',
                    hintText: 'SPONSOR_BONUS',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _statusController,
                  decoration: const InputDecoration(
                    labelText: 'Status',
                    hintText: 'POSTED',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: _reload,
            icon: const Icon(Icons.filter_alt_rounded),
            label: const Text('Terapkan Filter'),
          ),
          const SizedBox(height: 6),
          const Text(
            'CSV tersedia dengan filter laporan yang sama.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF64748B),
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Map<String, dynamic> _query() {
    return {
      if (_dateFromController.text.trim().isNotEmpty)
        'dateFrom': _dateFromController.text.trim(),
      if (_dateToController.text.trim().isNotEmpty)
        'dateTo': _dateToController.text.trim(),
      if (_userIdController.text.trim().isNotEmpty)
        'userId': _userIdController.text.trim(),
      if (_typeController.text.trim().isNotEmpty)
        'type': _typeController.text.trim(),
      if (_statusController.text.trim().isNotEmpty)
        'status': _statusController.text.trim(),
    };
  }

  List<Map<String, dynamic>> _reportItems(Map<String, dynamic> data) {
    final value = data['items'];
    if (value is List) {
      return value
          .whereType<Map>()
          .map((item) => item.cast<String, dynamic>())
          .toList(growable: false);
    }
    return const <Map<String, dynamic>>[];
  }

  String _reportTitle(Map<String, dynamic> item) {
    final beneficiary =
        (item['beneficiary'] as Map?)?.cast<String, dynamic>() ?? {};
    final wallet = (item['wallet'] as Map?)?.cast<String, dynamic>() ?? {};
    final user = (wallet['user'] as Map?)?.cast<String, dynamic>() ?? {};
    return beneficiary['fullName']?.toString() ??
        user['fullName']?.toString() ??
        'Member TapGo';
  }
}
