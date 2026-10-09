import 'dart:async';

import '../domain/ppob_models.dart';

bool ppobOrderIsOpen(PpobOrderStatus status) =>
    status == PpobOrderStatus.pending || status == PpobOrderStatus.processing;

/// Menanyakan ulang satu order ke server selama masih Menunggu/Diproses, supaya hasil
/// (mis. nomor token listrik) muncul sendiri di layar hasil tanpa pengguna keluar-masuk
/// Riwayat. Berhenti saat order final, saat [dispose]/[stop] dipanggil, atau setelah
/// [maxTicks] kali tanya; sesudah itu Riwayat tetap memuat hasil akhirnya.
///
/// Kegagalan jaringan diabaikan (percobaan berikutnya jalan terus): pembeli tidak boleh
/// melihat galat hanya karena satu pertanyaan ulang gagal.
class PpobOrderWatcher {
  PpobOrderWatcher({
    required this.fetchOrders,
    required this.onUpdate,
    this.interval = const Duration(seconds: 6),
    this.maxTicks = 40,
  });

  final Future<List<PpobOrder>> Function() fetchOrders;
  final void Function(PpobOrder updated) onUpdate;
  final Duration interval;
  final int maxTicks;

  Timer? _timer;
  String? _orderId;
  PpobOrderStatus? _lastStatus;
  String? _lastSerial;
  int _ticks = 0;
  bool _busy = false;

  bool get isWatching => _timer != null;

  /// Mulai (atau mulai ulang) memantau [order]; tidak melakukan apa pun bila sudah final.
  void watch(PpobOrder order) {
    stop();
    if (!ppobOrderIsOpen(order.status)) return;
    _orderId = order.id;
    _lastStatus = order.status;
    _lastSerial = order.serialNumber;
    _ticks = 0;
    _timer = Timer.periodic(interval, (_) => unawaited(_tick()));
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _tick() async {
    if (_busy || _orderId == null) return;
    _busy = true;
    _ticks += 1;
    try {
      final orders = await fetchOrders();
      for (final order in orders) {
        if (order.id != _orderId) continue;
        if (order.status != _lastStatus || order.serialNumber != _lastSerial) {
          _lastStatus = order.status;
          _lastSerial = order.serialNumber;
          onUpdate(order);
        }
        if (!ppobOrderIsOpen(order.status)) stop();
        break;
      }
    } catch (_) {
      // Dicoba lagi pada tick berikutnya.
    } finally {
      _busy = false;
      if (_ticks >= maxTicks) stop();
    }
  }
}
