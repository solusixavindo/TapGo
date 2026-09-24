part of '../main.dart';

/// Umpan Aktivitas: pembelian PPOB, perjalanan ojek, dan mutasi saldo yang
/// aman ditampilkan di aplikasi Play (top up, transfer, pengembalian dana).
/// Bonus, komisi, dan pencairan sengaja TIDAK ditampilkan: fitur itu tidak ada
/// di aplikasi Play. Pembelian PPOB dan bayar ojek tidak diambil dari mutasi
/// saldo karena sudah tampil sebagai order/perjalanannya sendiri.
const _activityMonths = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

/// "24 Sep 2026, 17:41" (waktu lokal perangkat) atau "Baru saja".
String tapGoActivityDateLabel(DateTime? at) {
  if (at == null) {
    return 'Baru saja';
  }
  final local = at.toLocal();
  final hh = local.hour.toString().padLeft(2, '0');
  final mm = local.minute.toString().padLeft(2, '0');
  return '${local.day} ${_activityMonths[local.month - 1]} ${local.year}, $hh:$mm';
}

String _signedRupiah(int value) =>
    '${value < 0 ? '-' : '+'}${formatRupiah(value.abs())}';

/// Menggabungkan tiga sumber menjadi satu daftar, terbaru di atas.
List<ActivityItem> tapGoBuildActivityItems({
  List<PpobOrder> ppobOrders = const [],
  List<RideOrderView> rides = const [],
  List<Map<String, dynamic>> walletTransactions = const [],
  int limit = 60,
}) {
  final items = <ActivityItem>[];

  for (final order in ppobOrders) {
    final spent = order.status == PpobOrderStatus.success ||
        order.status == PpobOrderStatus.pending ||
        order.status == PpobOrderStatus.processing;
    items.add(
      ActivityItem(
        'Layanan',
        ppobCategoryIcon(null, categoryCode: order.categoryCode),
        order.productName.isEmpty ? 'Pembelian PPOB' : order.productName,
        'Ke ${order.targetNumber}',
        spent ? '-${formatRupiah(order.amount.round())}' : null,
        ppobStatusLabel(order.status),
        tapGoActivityDateLabel(order.createdAt),
        order.createdAt,
      ),
    );
  }

  for (final ride in rides) {
    final isCar = ride.serviceType == 'CAR';
    final completed = ride.phase == RideUiPhase.completed;
    items.add(
      ActivityItem(
        'Layanan',
        isCar ? Icons.local_taxi_rounded : Icons.two_wheeler_rounded,
        isCar ? 'Ojek Mobil' : 'Ojek Motor',
        '${ride.pickupAddress} → ${ride.dropoffAddress}',
        completed ? '-${formatRupiah(ride.totalFare)}' : null,
        ride.statusTitle,
        tapGoActivityDateLabel(ride.createdAt),
        ride.createdAt,
      ),
    );
  }

  for (final tx in walletTransactions) {
    final type = tx['type']?.toString();
    final (String title, IconData icon)? kind = switch (type) {
      'TOPUP' => ('Top up saldo', Icons.add_card_rounded),
      'TRANSFER_IN' => ('Transfer masuk', Icons.south_west_rounded),
      'TRANSFER_OUT' => ('Transfer keluar', Icons.north_east_rounded),
      'REFUND' => ('Pengembalian dana', Icons.undo_rounded),
      _ => null,
    };
    if (kind == null) {
      continue;
    }
    final at = DateTime.tryParse(tx['createdAt']?.toString() ?? '');
    // Debit disimpan negatif oleh server; tanda dipastikan dari jenisnya.
    final magnitude = _intFrom(tx['amount']).abs();
    final signed = type == 'TRANSFER_OUT' ? -magnitude : magnitude;
    items.add(
      ActivityItem(
        'Saldo',
        kind.$2,
        kind.$1,
        'TapGoPay',
        _signedRupiah(signed),
        'Berhasil',
        tapGoActivityDateLabel(at),
        at,
      ),
    );
  }

  items.sort((a, b) {
    final x = a.at;
    final y = b.at;
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return y.compareTo(x);
  });
  return items.length <= limit ? items : items.sublist(0, limit);
}

class _ActivityFeed {
  const _ActivityFeed(this.items, {this.failedSources = 0});

  final List<ActivityItem> items;

  /// Jumlah sumber (dari tiga) yang gagal dimuat; daftar tetap ditampilkan
  /// dari sumber yang berhasil.
  final int failedSources;
}

final _activityFeedProvider = FutureProvider.autoDispose<_ActivityFeed>((
  ref,
) async {
  if (tapGoDashboardVisualFixtureEnabledForTests) {
    return const _ActivityFeed([]);
  }
  final session = ref.read(_demoSessionProvider);
  if (session.accessToken == null || session.accessToken!.isEmpty) {
    throw StateError('Belum ada token backend.');
  }
  _apiClient.setAccessToken(session.accessToken);

  var failed = 0;
  Future<T?> guarded<T>(Future<T> Function() load) async {
    try {
      return await load();
    } catch (error) {
      _tapGoDebugLog('[TapGo Activity] sumber gagal: $error');
      failed += 1;
      return null;
    }
  }

  final results = await Future.wait<Object?>([
    guarded(() => _buildPpobRepository().fetchOrders()),
    guarded(() => _apiClient.rideHistory(limit: 30)),
    guarded(() => _apiClient.walletTransactions(pageSize: 30)),
  ]);
  if (failed >= 3) {
    throw StateError('Aktivitas tidak dapat dimuat.');
  }
  final rides = results[1] as List<Map<String, dynamic>>?;
  return _ActivityFeed(
    tapGoBuildActivityItems(
      ppobOrders: (results[0] as List<PpobOrder>?) ?? const [],
      rides: rides?.map(RideOrderView.fromJson).toList() ?? const [],
      walletTransactions:
          (results[2] as List<Map<String, dynamic>>?) ?? const [],
    ),
    failedSources: failed,
  );
});
