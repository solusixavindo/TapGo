part of '../../../main.dart';

final driverRatingsProvider =
    FutureProvider.autoDispose<DriverRatingsSummary>((ref) {
  return ref.watch(driverRepositoryProvider).ratingsSummary();
});

String _ratingText(double value) => value.toStringAsFixed(1).replaceAll('.', ',');

/// Penilaian dan ulasan dari penumpang. Identitas penumpang tidak pernah dikirim server.
class DriverRatingsScreen extends ConsumerWidget {
  const DriverRatingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ratings = ref.watch(driverRatingsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Penilaian penumpang')),
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(driverRatingsProvider.future),
        child: ratings.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => ListView(
            padding: const EdgeInsets.all(20),
            children: [
              _EarningsError(
                error: error,
                onRetry: () => ref.invalidate(driverRatingsProvider),
              ),
            ],
          ),
          data: (summary) => _RatingsBody(summary: summary),
        ),
      ),
    );
  }
}

class _RatingsBody extends StatelessWidget {
  const _RatingsBody({required this.summary});
  final DriverRatingsSummary summary;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (summary.ratingCount == 0) {
      return ListView(
        padding: const EdgeInsets.all(20),
        children: const [
          EmptyStateCard(
            icon: Icons.star_outline_rounded,
            title: 'Belum ada penilaian',
            message:
                'Penumpang dapat menilai Anda setelah perjalanan selesai. Penilaian pertama akan muncul di sini.',
          ),
        ],
      );
    }
    final maxCount = summary.distribution.values.fold<int>(1, (a, b) => b > a ? b : a);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: [
        Card(
          key: const ValueKey('ratings-summary-card'),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Column(
                  children: [
                    Text(
                      _ratingText(summary.ratingAverage ?? 0),
                      style: Theme.of(context).textTheme.displaySmall?.copyWith(
                            fontWeight: FontWeight.w900,
                          ),
                    ),
                    const Icon(Icons.star_rounded, color: Color(0xFFF5A623)),
                    const SizedBox(height: 4),
                    Text('${summary.ratingCount} penilaian',
                        style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
                const SizedBox(width: 24),
                Expanded(
                  child: Column(
                    children: [
                      for (var star = 5; star >= 1; star--)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Row(
                            children: [
                              SizedBox(width: 14, child: Text('$star')),
                              const SizedBox(width: 6),
                              Expanded(
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(4),
                                  child: LinearProgressIndicator(
                                    minHeight: 8,
                                    value: (summary.distribution[star] ?? 0) / maxCount,
                                    backgroundColor: scheme.surfaceContainerHighest,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              SizedBox(
                                width: 28,
                                child: Text('${summary.distribution[star] ?? 0}',
                                    textAlign: TextAlign.end),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 20),
        Text('Ulasan terbaru', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        for (final review in summary.recent)
          Card(
            child: ListTile(
              leading: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.star_rounded, color: Color(0xFFF5A623)),
                  const SizedBox(width: 2),
                  Text('${review.stars}',
                      style: const TextStyle(fontWeight: FontWeight.w800)),
                ],
              ),
              title: Text(
                (review.note ?? '').trim().isEmpty ? 'Tanpa catatan' : review.note!,
              ),
              subtitle: Text(_shortDate(review.createdAt)),
            ),
          ),
      ],
    );
  }
}
