import 'package:flutter/material.dart';

import '../domain/ppob_models.dart';
import 'widgets/ppob_shared.dart';

/// Bukti transaksi PPOB: dibuka dari Riwayat. Memuat produk, tujuan, total, rincian tagihan
/// (nama pelanggan, periode) untuk pascabayar, nomor transaksi, waktu, dan nomor
/// token/referensi dari penyedia — semua yang pembeli butuhkan sebagai bukti.
class PpobReceiptScreen extends StatelessWidget {
  const PpobReceiptScreen({super.key, required this.order});

  final PpobOrder order;

  Widget _row(BuildContext context, String label, String value) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: theme.textTheme.bodyMedium),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final refunded = order.status == PpobOrderStatus.refunded ||
        (order.status == PpobOrderStatus.failed && order.refundedAt != null);
    return Scaffold(
      appBar: AppBar(title: const Text('Bukti Transaksi')),
      body: ListView(
        key: const ValueKey('ppob-receipt'),
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            elevation: 0,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          order.productName,
                          style: theme.textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w800),
                        ),
                      ),
                      const SizedBox(width: 8),
                      PpobStatusChip(status: order.status),
                    ],
                  ),
                  const SizedBox(height: 10),
                  _row(context, 'Tujuan', order.targetNumber),
                  _row(context, 'Total', ppobFormatRupiah(order.amount)),
                  PpobReceiptRows(order: order),
                  PpobSerialNumberBlock(order: order),
                  if (order.failureReason != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      refunded
                          ? 'Dana dikembalikan penuh ke saldo Anda. ${order.failureReason}'
                          : order.failureReason!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
