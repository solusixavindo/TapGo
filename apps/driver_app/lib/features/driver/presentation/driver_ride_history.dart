part of '../../../main.dart';

/// Riwayat seluruh perjalanan milik driver, terbaru dulu — berbeda dari
/// current ride (status aktif) yang sudah dipantau [driverControllerProvider].
/// Diambil sekali per kunjungan layar lewat FutureProvider.autoDispose, bukan
/// disatukan ke DriverController: daftar ini bukan bagian dari status
/// operasional yang perlu dipantau terus-menerus selama app berjalan.
final driverRideHistoryProvider =
    FutureProvider.autoDispose<List<DriverRide>>((ref) {
  final repository = ref.watch(driverRepositoryProvider);
  return repository.rideHistory();
});

/// Konten riwayat perjalanan TANPA Scaffold/AppBar sendiri — dipasang sebagai
/// sub-tab "Riwayat" di dalam DriverOrdersScreen, yang sudah punya AppBar
/// lewat DriverShell.
class DriverRideHistoryBody extends ConsumerWidget {
  const DriverRideHistoryBody({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(driverRideHistoryProvider);
    return history.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.wifi_off_rounded, size: 48, color: Colors.grey),
              const SizedBox(height: 12),
              Text(
                error is DriverApiException
                    ? error.message
                    : 'Gagal memuat riwayat perjalanan.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton(
                key: const ValueKey('ride-history-retry'),
                onPressed: () => ref.invalidate(driverRideHistoryProvider),
                child: const Text('Coba Lagi'),
              ),
            ],
          ),
        ),
      ),
      data: (rides) {
        if (rides.isEmpty) {
          return const EmptyStateCard(
            key: ValueKey('ride-history-empty'),
            icon: Icons.history_rounded,
            title: 'Belum ada riwayat',
            message: 'Perjalanan yang sudah selesai atau dibatalkan akan tampil di sini.',
          );
        }
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(driverRideHistoryProvider),
          child: ListView.separated(
            key: const ValueKey('ride-history-list'),
            padding: const EdgeInsets.only(top: 8, bottom: 120),
            itemCount: rides.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) => _RideHistoryCard(ride: rides[index]),
          ),
        );
      },
    );
  }
}

class _RideHistoryCard extends StatelessWidget {
  const _RideHistoryCard({required this.ride});
  final DriverRide ride;

  @override
  Widget build(BuildContext context) {
    final cancelled = ride.status == RideStatus.cancelledByPassenger ||
        ride.status == RideStatus.cancelledByDriver ||
        ride.status == RideStatus.cancelledBySystem;
    return Card(
      key: ValueKey('ride-history-${ride.reference}'),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  ride.serviceType == 'CAR'
                      ? Icons.directions_car_rounded
                      : Icons.two_wheeler_rounded,
                  color: const Color(0xFF0877E8),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    _serviceLabel(ride.serviceType),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                _StatusPill(status: ride.status, cancelled: cancelled),
              ],
            ),
            Text(
              ride.reference,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: Colors.grey[600]),
            ),
            const SizedBox(height: 10),
            Text('${ride.pickupAddress} ke ${ride.dropoffAddress}', maxLines: 3),
            if (ride.pickupNote != null && ride.pickupNote!.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                'Catatan: ${ride.pickupNote}',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(fontStyle: FontStyle.italic, color: Colors.grey[700]),
              ),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (ride.distanceMeters != null)
                  InfoChip(label: _distance(ride.distanceMeters!)),
                if (ride.totalFare != null) InfoChip(label: _rupiah(ride.totalFare!)),
                if (ride.updatedAt != null) InfoChip(label: _historyDate(ride.updatedAt!)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status, required this.cancelled});
  final RideStatus status;
  final bool cancelled;

  @override
  Widget build(BuildContext context) {
    final color = cancelled ? Colors.red : Colors.green;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        _statusLabel(status),
        style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600),
      ),
    );
  }
}

String _historyDate(DateTime date) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
    'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des',
  ];
  return '${date.day} ${months[date.month - 1]} ${date.year}';
}
