part of '../main.dart';

/// Riwayat mutasi saldo TapGoPay untuk layar saldo. Hanya jenis yang aman
/// ditampilkan di aplikasi Play (lihat activity_feed.dart).
final _walletHistoryProvider =
    FutureProvider.autoDispose<List<ActivityItem>>((ref) async {
  if (tapGoDashboardVisualFixtureEnabledForTests) {
    return const [];
  }
  final session = ref.read(_demoSessionProvider);
  if (session.accessToken == null || session.accessToken!.isEmpty) {
    throw StateError('Belum ada token backend.');
  }
  _apiClient.setAccessToken(session.accessToken);
  final rows = await _apiClient.walletTransactions(pageSize: 50);
  return tapGoBuildActivityItems(walletTransactions: rows);
});

/// Layar saldo: saldo TapGoPay dan PPOB, aksi top up (web) dan transfer, serta
/// riwayat mutasi. Dibuka dari kartu saldo di Beranda.
class WalletScreen extends ConsumerWidget {
  const WalletScreen({super.key});

  Future<void> _refresh(WidgetRef ref) async {
    ref.invalidate(_productionSnapshotProvider);
    await ref.refresh(_walletHistoryProvider.future).then((_) {}).catchError(
          (_) {},
        );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(_demoSessionProvider);
    final history = ref.watch(_walletHistoryProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('TapGoPay')),
      body: RefreshIndicator(
        onRefresh: () => _refresh(ref),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [
                    Color(0xFF041B33),
                    Color(0xFF0758C9),
                    Color(0xFF0B7BF7),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(24),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Saldo TapGoPay',
                    style: TextStyle(
                      color: Color(0xDFFFFFFF),
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(
                      formatRupiah(session.walletBalance),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 32,
                        height: 1.1,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'Saldo PPOB ${formatRupiah(session.ppobBalance)}',
                    style: const TextStyle(
                      color: Color(0xDFFFFFFF),
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _openTopUpWebsite(context),
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Top Up'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () =>
                        _openDemo(context, const WalletTransferScreen()),
                    icon: const Icon(Icons.near_me_rounded),
                    label: const Text('Transfer'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 22),
            Text(
              'Riwayat saldo',
              style: TextStyle(
                color: colorScheme.onSurface,
                fontSize: 17,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 12),
            if (history.isLoading && !history.hasValue)
              const _StatusSurface(
                icon: Icons.sync_rounded,
                title: 'Memuat riwayat',
                subtitle: 'Mengambil mutasi saldo TapGoPay...',
              )
            else if (history.hasError && !history.hasValue)
              _RetryStatusSurface(
                icon: Icons.cloud_off_rounded,
                title: 'Riwayat belum tersedia',
                subtitle: 'Silakan muat ulang.',
                onRetry: () => ref.invalidate(_walletHistoryProvider),
              )
            else if ((history.valueOrNull ?? const []).isEmpty)
              const _EmptyState(
                icon: Icons.receipt_long_rounded,
                title: 'Belum ada mutasi saldo',
                subtitle: 'Top up dan transfer akan muncul di sini.',
              )
            else
              ...history.valueOrNull!.map((item) => _ActivityTile(item: item)),
          ],
        ),
      ),
    );
  }
}
