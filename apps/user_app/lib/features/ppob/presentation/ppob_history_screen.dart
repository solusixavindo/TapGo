import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/ppob_providers.dart';
import '../domain/ppob_models.dart';
import 'widgets/ppob_shared.dart';

/// Riwayat transaksi PPOB milik pengguna yang sedang login (backend hanya
/// mengembalikan order milik pemanggil; akses silang dijawab 404).
class PpobHistoryScreen extends ConsumerWidget {
  const PpobHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orders = ref.watch(ppobOrdersProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Riwayat PPOB')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(ppobOrdersProvider),
        child: switch (orders) {
          AsyncData(:final value) => value.isEmpty
              ? ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: const [
                    SizedBox(height: 120),
                    PpobNoticeView(
                      icon: Icons.receipt_long_outlined,
                      title: 'Belum ada transaksi',
                      message:
                          'Transaksi PPOB Anda akan muncul di sini.',
                    ),
                  ],
                )
              : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  itemCount: value.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (context, index) =>
                      _PpobOrderTile(order: value[index]),
                ),
          AsyncError(:final error) => ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                const SizedBox(height: 120),
                PpobNoticeView(
                  icon: Icons.cloud_off_rounded,
                  title: 'Gagal memuat riwayat',
                  message: ppobErrorMessage(error),
                  actionLabel: 'Coba Lagi',
                  onAction: () => ref.invalidate(ppobOrdersProvider),
                ),
              ],
            ),
          _ => const Center(child: CircularProgressIndicator()),
        },
      ),
    );
  }
}

class _PpobOrderTile extends StatelessWidget {
  const _PpobOrderTile({required this.order});

  final PpobOrder order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Material(
      color: theme.cardColor,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: theme.colorScheme.primary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                ppobCategoryIcon(null),
                color: theme.colorScheme.primary,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    order.productName,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    order.targetNumber,
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  ppobFormatRupiah(order.amount),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                PpobStatusChip(status: order.status),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
