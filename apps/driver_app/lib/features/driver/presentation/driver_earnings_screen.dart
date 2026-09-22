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

class _DriverEarningsScreenState extends ConsumerState<DriverEarningsScreen> {
  String _range = 'today';

  @override
  Widget build(BuildContext context) {
    final earnings = ref.watch(driverEarningsProvider(_range));
    final performance = ref.watch(driverPerformanceProvider);
    final topPadding = kDriverDemoMode ? 52.0 : 20.0;

    return ListView(
      padding: EdgeInsets.fromLTRB(16, topPadding, 16, 120),
      children: [
        Text('Pendapatan', style: Theme.of(context).textTheme.headlineSmall),
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
