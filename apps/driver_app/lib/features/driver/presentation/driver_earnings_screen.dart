part of '../../../main.dart';

/// Ringkasan pendapatan kotor untuk rentang tertentu — diambil ulang setiap
/// kali rentang berubah lewat FutureProvider.family, pola sama seperti
/// driverRideHistoryProvider.
final driverEarningsProvider =
    FutureProvider.autoDispose.family<DriverEarningsSummary, String>((ref, range) {
  final repository = ref.watch(driverRepositoryProvider);
  return repository.earningsSummary(range: range);
});

/// Statistik performa tidak bergantung pada rentang — dihitung dari seluruh
/// riwayat driver (lihat RideService.performanceSummary).
final driverPerformanceProvider =
    FutureProvider.autoDispose<DriverPerformanceSummary>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return repository.performanceSummary();
});

final driverWalletProvider =
    FutureProvider.autoDispose<DriverWalletSummary>((ref) {
  return ref.watch(driverRepositoryProvider).walletSummary();
});

const _earningsRanges = [
  ('today', 'Hari ini'),
  ('week', '7 hari'),
  ('month', '30 hari'),
];

class DriverEarningsScreen extends ConsumerStatefulWidget {
  const DriverEarningsScreen({super.key});

  @override
  ConsumerState<DriverEarningsScreen> createState() => _DriverEarningsScreenState();
}

class _DriverEarningsScreenState extends ConsumerState<DriverEarningsScreen>
    with WidgetsBindingObserver {
  String _range = 'today';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Driver mengisi Saldo TapGo di peramban lalu kembali ke aplikasi: saldo yang tampil harus sudah yang baru, tanpa
  /// harus berpindah tab atau menutup aplikasi (pesanan tunai ditolak selama saldo di layar masih tampak kurang).
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      ref.invalidate(driverWalletProvider);
    }
  }

  Future<void> _refreshAll() async {
    ref.invalidate(driverWalletProvider);
    ref.invalidate(driverEarningsProvider(_range));
    ref.invalidate(driverPerformanceProvider);
    try {
      await ref.read(driverWalletProvider.future);
    } catch (_) {
      // Galat sudah ditampilkan kartu saldo dengan tombol coba lagi.
    }
  }

  @override
  Widget build(BuildContext context) {
    final earnings = ref.watch(driverEarningsProvider(_range));
    final performance = ref.watch(driverPerformanceProvider);
    final topPadding = kDriverDemoMode ? 52.0 : 20.0;

    return RefreshIndicator(
      key: const ValueKey('earnings-refresh'),
      onRefresh: _refreshAll,
      child: ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: EdgeInsets.fromLTRB(16, topPadding, 16, 120),
      children: [
        Text('Pendapatan', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 16),
        ref.watch(driverWalletProvider).when(
              loading: () => const SizedBox.shrink(),
              error: (error, _) => _EarningsError(
                error: error,
                onRetry: () => ref.invalidate(driverWalletProvider),
              ),
              data: (wallet) => _WalletCard(wallet: wallet),
            ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 8,
          children: [
            for (final (value, label) in _earningsRanges)
              ChoiceChip(
                key: ValueKey('earnings-range-$value'),
                label: Text(label),
                selected: _range == value,
                onSelected: (_) => setState(() => _range = value),
              ),
          ],
        ),
        const SizedBox(height: 16),
        earnings.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (error, _) => _EarningsError(
            error: error,
            onRetry: () => ref.invalidate(driverEarningsProvider(_range)),
          ),
          data: (summary) => _EarningsSummaryCard(summary: summary),
        ),
        const SizedBox(height: 20),
        Text('Performa', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        performance.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (error, _) => _EarningsError(
            error: error,
            onRetry: () => ref.invalidate(driverPerformanceProvider),
          ),
          data: (summary) => _PerformanceCard(summary: summary),
        ),
        if (kDriverDemoMode) ...[
          const SizedBox(height: 16),
          const DemoScenarioSelector(),
        ],
      ],
      ),
    );
  }
}

String _signedRupiah(int amount) =>
    amount < 0 ? '-${_rupiah(-amount)}' : '+${_rupiah(amount)}';

String _shortDate(DateTime? value) {
  if (value == null) return '';
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}.${two(local.minute)}';
}

class _WalletCard extends StatelessWidget {
  const _WalletCard({required this.wallet});
  final DriverWalletSummary wallet;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      key: const ValueKey('wallet-card'),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Saldo TapGo'),
            const SizedBox(height: 4),
            Text(_rupiah(wallet.balance),
                key: const ValueKey('wallet-balance'),
                style: theme.textTheme.headlineMedium),
            if (wallet.commissionEnabled) ...[
              const SizedBox(height: 8),
              Text(
                'Pesanan tunai dikenai komisi ${wallet.commissionPercent}% dari tarif, '
                'ditahan dari saldo ini saat Anda menerima pesanan (dikembalikan bila dibatalkan).'
                '${wallet.minCashBalance > 0 ? ' Untuk menerima pesanan tunai, saldo minimal ${_rupiah(wallet.minCashBalance)}.' : ' Saldo harus cukup untuk menerima pesanan tunai.'}',
                key: const ValueKey('wallet-commission-note'),
                style: theme.textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 12),
            OutlinedButton.icon(
              key: const ValueKey('wallet-topup-button'),
              onPressed: () => launchUrl(
                Uri.parse(wallet.topUpUrl),
                mode: LaunchMode.externalApplication,
              ),
              icon: const Icon(Icons.add_card_rounded),
              label: const Text('Isi saldo di tapgolion.id'),
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                key: const ValueKey('wallet-web-password-hint'),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const DriverWebPasswordScreen(),
                  ),
                ),
                child: const Text('Daftar dengan Google? Atur password web di sini'),
              ),
            ),
            if (wallet.entries.isNotEmpty) ...[
              const Divider(height: 28),
              Text('Riwayat saldo', style: theme.textTheme.titleMedium),
              const SizedBox(height: 4),
              for (final entry in wallet.entries)
                ListTile(
                  key: ValueKey('wallet-entry-${entry.id}'),
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text(entry.isCommission
                      ? 'Komisi pesanan tunai'
                      : 'Isi saldo'),
                  subtitle: Text([
                    _shortDate(entry.createdAt),
                    if (entry.rideReference != null) entry.rideReference!,
                    if (entry.shortfall > 0)
                      'kurang ${_rupiah(entry.shortfall)}',
                  ].where((s) => s.isNotEmpty).join(' · ')),
                  trailing: Text(
                    _signedRupiah(entry.amount),
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: entry.amount < 0
                          ? theme.colorScheme.error
                          : theme.colorScheme.primary,
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _EarningsError extends StatelessWidget {
  const _EarningsError({required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Text(
              error is DriverApiException
                  ? (error as DriverApiException).message
                  : 'Gagal memuat data.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            FilledButton(
              key: const ValueKey('earnings-retry'),
              onPressed: onRetry,
              child: const Text('Coba Lagi'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EarningsSummaryCard extends StatelessWidget {
  const _EarningsSummaryCard({required this.summary});
  final DriverEarningsSummary summary;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          key: const ValueKey('earnings-summary-card'),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${summary.tripCount}',
                          style: Theme.of(context).textTheme.headlineMedium),
                      const Text('Perjalanan'),
                    ],
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_rupiah(summary.grossFare),
                          style: Theme.of(context).textTheme.headlineMedium),
                      const Text('Pendapatan kotor'),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        if (summary.byDay.isNotEmpty) ...[
          const SizedBox(height: 12),
          for (final day in summary.byDay.reversed)
            Card(
              key: ValueKey('earnings-day-${day.date}'),
              child: ListTile(
                title: Text(day.date),
                subtitle: Text('${day.tripCount} perjalanan'),
                trailing: Text(_rupiah(day.grossFare)),
              ),
            ),
        ] else
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text('Belum ada perjalanan selesai pada rentang ini.'),
          ),
      ],
    );
  }
}

class _PerformanceCard extends StatelessWidget {
  const _PerformanceCard({required this.summary});
  final DriverPerformanceSummary summary;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const ValueKey('performance-card'),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              key: const ValueKey('performance-rating-row'),
              borderRadius: BorderRadius.circular(8),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const DriverRatingsScreen()),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    const Expanded(child: Text('Penilaian penumpang')),
                    const Icon(Icons.star_rounded, size: 18, color: Color(0xFFF5A623)),
                    const SizedBox(width: 4),
                    Text(
                      summary.ratingAverage == null
                          ? 'Belum ada'
                          : '${_ratingText(summary.ratingAverage!)} (${summary.ratingCount})',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const Icon(Icons.chevron_right_rounded),
                  ],
                ),
              ),
            ),
            const Divider(height: 20),
            _PerformanceRow(label: 'Tingkat penerimaan tawaran', value: summary.acceptanceRate),
            const Divider(height: 20),
            _PerformanceRow(label: 'Tingkat penyelesaian', value: summary.completionRate),
            const Divider(height: 20),
            _PerformanceRow(label: 'Tingkat pembatalan', value: summary.cancellationRate),
            const Divider(height: 20),
            Row(
              children: [
                const Expanded(child: Text('Total perjalanan selesai')),
                Text('${summary.totalTrips}',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PerformanceRow extends StatelessWidget {
  const _PerformanceRow({required this.label, required this.value});
  final String label;
  final double? value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(child: Text(label)),
        Text(
          value == null ? 'Belum ada data' : '${(value! * 100).round()}%',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
      ],
    );
  }
}
