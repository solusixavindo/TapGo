import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/ppob_providers.dart';
import '../domain/ppob_models.dart';
import 'ppob_history_screen.dart';
import 'widgets/ppob_shared.dart';

/// Layar checkout PPOB: isi nomor tujuan → inquiry (cek harga) → konfirmasi
/// bayar → hasil. Alur dua langkah ini disengaja: pengguna selalu melihat
/// total dan rincian saldo gabungan SEBELUM uang bergerak.
///
/// Single-flight: selama satu permintaan berjalan, tombol terkunci — klien
/// tidak pernah mengirim dua pembelian untuk satu niat. Di sisi server,
/// idempotency key yang sama memastikan retry tidak menduplikasi order.
class PpobCheckoutScreen extends ConsumerStatefulWidget {
  const PpobCheckoutScreen({
    super.key,
    required this.categoryCode,
    required this.product,
  });

  final String categoryCode;
  final PpobProduct product;

  @override
  ConsumerState<PpobCheckoutScreen> createState() => _PpobCheckoutScreenState();
}

class _PpobCheckoutScreenState extends ConsumerState<PpobCheckoutScreen> {
  final _targetController = TextEditingController();

  // Key dibuat SEKALI per layar checkout: rebuild/retry tetap memakai key yang
  // sama sehingga server mengenali retry sebagai replay, bukan order baru.
  late final String _idempotencyKey =
      'ppob-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 20)}';

  bool _isBusy = false;
  String? _errorMessage;
  PpobInquiryResult? _inquiry;
  PpobOrder? _result;

  @override
  void dispose() {
    _targetController.dispose();
    super.dispose();
  }

  String get _normalizedTarget =>
      _targetController.text.replaceAll(RegExp(r'[\s-]+'), '').trim();

  bool get _targetReady => _normalizedTarget.length >= 5;

  Future<void> _runInquiry() async {
    if (_isBusy || !_targetReady) {
      return;
    }
    setState(() {
      _isBusy = true;
      _errorMessage = null;
      _result = null;
    });
    try {
      final inquiry = await ref.read(ppobRepositoryProvider).inquiry(
            sku: widget.product.sku,
            targetNumber: _normalizedTarget,
          );
      if (!mounted) {
        return;
      }
      setState(() => _inquiry = inquiry);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _inquiry = null;
        _errorMessage = ppobErrorMessage(error);
      });
    } finally {
      if (mounted) {
        setState(() => _isBusy = false);
      }
    }
  }

  Future<void> _pay() async {
    final inquiry = _inquiry;
    if (_isBusy || inquiry == null) {
      return;
    }
    setState(() {
      _isBusy = true;
      _errorMessage = null;
    });
    try {
      final order = await ref.read(ppobRepositoryProvider).createOrder(
            sku: widget.product.sku,
            targetNumber: inquiry.targetNumber,
            idempotencyKey: _idempotencyKey,
          );
      if (!mounted) {
        return;
      }
      setState(() => _result = order);
      // Riwayat di-refresh agar order baru langsung terlihat.
      ref.invalidate(ppobOrdersProvider);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _errorMessage = ppobErrorMessage(error));
    } finally {
      if (mounted) {
        setState(() => _isBusy = false);
      }
    }
  }

  void _resetTarget() {
    setState(() {
      _inquiry = null;
      _result = null;
      _errorMessage = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final product = widget.product;
    final result = _result;

    return Scaffold(
      appBar: AppBar(title: Text(product.name)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _ProductSummaryCard(product: product),
            const SizedBox(height: 16),
            TextFormField(
              controller: _targetController,
              keyboardType: TextInputType.phone,
              enabled: !_isBusy && result == null,
              onChanged: (_) => _resetTarget(),
              decoration: InputDecoration(
                labelText: product.targetLabel,
                hintText: 'Masukkan ${product.targetLabel.toLowerCase()}',
                prefixIcon: const Icon(Icons.dialpad_rounded),
              ),
            ),
            const SizedBox(height: 12),
            if (_errorMessage != null) ...[
              _ErrorBanner(message: _errorMessage!),
              const SizedBox(height: 12),
            ],
            if (_inquiry != null) ...[
              _BreakdownCard(inquiry: _inquiry!),
              const SizedBox(height: 12),
            ],
            if (result != null) ...[
              _ResultCard(order: result),
              const SizedBox(height: 12),
            ],
            if (result == null)
              FilledButton.icon(
                onPressed: _isBusy
                    ? null
                    : (_inquiry == null
                        ? (_targetReady ? _runInquiry : null)
                        : (_inquiry!.payment.sufficient ? _pay : null)),
                icon: _isBusy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(_inquiry == null
                        ? Icons.price_check_rounded
                        : Icons.lock_rounded),
                label: Text(
                  _isBusy
                      ? 'Memproses…'
                      : (_inquiry == null ? 'Cek Harga' : 'Bayar Sekarang'),
                ),
              )
            else
              OutlinedButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const PpobHistoryScreen(),
                  ),
                ),
                icon: const Icon(Icons.receipt_long_rounded),
                label: const Text('Lihat Riwayat'),
              ),
            const SizedBox(height: 8),
            Text(
              'Pembayaran memakai saldo TapGo Anda (saldo utama + saldo benefit '
              'PPOB). Tidak ada tautan pembayaran eksternal.',
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _ProductSummaryCard extends StatelessWidget {
  const _ProductSummaryCard({required this.product});

  final PpobProduct product;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    product.name,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  if (product.description != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      product.description!,
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ],
              ),
            ),
            Text(
              ppobFormatRupiah(product.totalPrice),
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
                color: theme.colorScheme.primary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BreakdownCard extends StatelessWidget {
  const _BreakdownCard({required this.inquiry});

  final PpobInquiryResult inquiry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final payment = inquiry.payment;

    return Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Rincian Pembayaran',
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 10),
            _row(context, 'Harga produk', ppobFormatRupiah(inquiry.product.price)),
            _row(context, 'Biaya admin', ppobFormatRupiah(inquiry.product.adminFee)),
            const Divider(height: 20),
            _row(context, 'Total', ppobFormatRupiah(payment.amount), bold: true),
            _row(context, 'Dari saldo benefit PPOB',
                ppobFormatRupiah(payment.benefitAmount)),
            _row(context, 'Dari saldo utama',
                ppobFormatRupiah(payment.balanceAmount)),
            const Divider(height: 20),
            _row(context, 'Saldo Anda', ppobFormatRupiah(inquiry.walletBalance)),
            if (!payment.sufficient) ...[
              const SizedBox(height: 10),
              Text(
                'Saldo tidak cukup untuk transaksi ini.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: const Color(0xFFEF4444),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _row(BuildContext context, String label, String value,
      {bool bold = false}) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: bold ? FontWeight.w800 : FontWeight.w500,
              ),
            ),
          ),
          Text(
            value,
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard({required this.order});

  final PpobOrder order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
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
                    'Hasil Transaksi',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                PpobStatusChip(status: order.status),
              ],
            ),
            const SizedBox(height: 10),
            _row(context, 'Produk', order.productName),
            _row(context, 'Tujuan', order.targetNumber),
            _row(context, 'Total', ppobFormatRupiah(order.amount)),
            if (order.failureReason != null) ...[
              const SizedBox(height: 8),
              Text(
                order.status == PpobOrderStatus.refunded
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
    );
  }

  Widget _row(BuildContext context, String label, String value) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: theme.textTheme.bodyMedium),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFEF4444).withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: const Color(0xFFEF4444).withValues(alpha: 0.35),
        ),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_rounded, color: Color(0xFFEF4444), size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: Color(0xFFEF4444),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
