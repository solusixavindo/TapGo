import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import '../application/ppob_providers.dart';
import '../domain/ppob_models.dart';
import '../domain/ppob_operator.dart';
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

  /// Status operator untuk produk yang dibatasi operator (pulsa/data). Null =
  /// produk tidak dibatasi operator, jadi tidak ada pemeriksaan/tampilan operator.
  _OperatorCheck? get _operatorCheck {
    final supported = widget.product.supportedOperators;
    if (supported.isEmpty) {
      return null;
    }
    final target = _normalizedTarget;
    if (normalizePpobMsisdn(target).length < 4) {
      return _OperatorCheck.idle(supported);
    }
    final detected = detectPpobOperator(target);
    if (detected == null) {
      return _OperatorCheck.unknown(supported);
    }
    return supported.contains(detected)
        ? _OperatorCheck.ok(detected, supported)
        : _OperatorCheck.unsupported(detected, supported);
  }

  bool get _targetReady {
    final target = _normalizedTarget;
    if (target.length < 5) {
      return false;
    }
    final operatorCheck = _operatorCheck;
    if (operatorCheck != null && !operatorCheck.accepted) {
      return false;
    }
    final pattern = widget.product.targetPattern;
    if (pattern == null) {
      return true;
    }
    // Server tetap memvalidasi ulang (sumber kebenaran); ini murni menghindari
    // round-trip inquiry yang sudah pasti akan ditolak dengan PPOB_TARGET_INVALID.
    return RegExp(pattern).hasMatch(target);
  }

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
    } catch (error, stackTrace) {
      if (Sentry.isEnabled) {
        Sentry.captureException(
          error,
          stackTrace: stackTrace,
          withScope: (scope) => scope.setContexts('ppob_order', {
            'sku': widget.product.sku,
            // JANGAN sertakan targetNumber mentah (nomor tujuan pelanggan) —
            // itu identifier pribadi, sama alasannya dengan redaksi "phone"
            // di logger backend.
          }),
        );
      }
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
            if (_operatorCheck != null) ...[
              const SizedBox(height: 8),
              _OperatorStatus(check: _operatorCheck!),
            ],
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

enum _OperatorState { idle, ok, unsupported, unknown }

/// Hasil pemeriksaan operator nomor tujuan terhadap operator yang didukung produk.
class _OperatorCheck {
  const _OperatorCheck._(this.state, this.detected, this.supported);

  factory _OperatorCheck.idle(List<String> supported) =>
      _OperatorCheck._(_OperatorState.idle, null, supported);
  factory _OperatorCheck.ok(String detected, List<String> supported) =>
      _OperatorCheck._(_OperatorState.ok, detected, supported);
  factory _OperatorCheck.unsupported(String detected, List<String> supported) =>
      _OperatorCheck._(_OperatorState.unsupported, detected, supported);
  factory _OperatorCheck.unknown(List<String> supported) =>
      _OperatorCheck._(_OperatorState.unknown, null, supported);

  final _OperatorState state;
  final String? detected;
  final List<String> supported;

  /// Nomor boleh dilanjutkan ke cek harga (idle tetap diperbolehkan karena
  /// panjang nomor sudah dijaga aturan lain).
  bool get accepted =>
      state == _OperatorState.ok || state == _OperatorState.idle;
}

class _OperatorStatus extends StatelessWidget {
  const _OperatorStatus({required this.check});

  final _OperatorCheck check;

  @override
  Widget build(BuildContext context) {
    final list = ppobOperatorList(check.supported);
    final (IconData icon, Color color, String text) = switch (check.state) {
      _OperatorState.idle => (
          Icons.sim_card_outlined,
          Theme.of(context).colorScheme.onSurfaceVariant,
          'Operator terdeteksi otomatis dari nomor. Tersedia untuk: $list.',
        ),
      _OperatorState.ok => (
          Icons.check_circle_rounded,
          const Color(0xFF16A34A),
          'Operator: ${ppobOperatorLabel(check.detected!)}',
        ),
      _OperatorState.unsupported => (
          Icons.warning_amber_rounded,
          const Color(0xFFB45309),
          'Produk ini belum tersedia untuk ${ppobOperatorLabel(check.detected!)}. '
              'Tersedia untuk: $list.',
        ),
      _OperatorState.unknown => (
          Icons.help_outline_rounded,
          const Color(0xFFB45309),
          'Operator nomor ini belum dikenali. Tersedia untuk: $list.',
        ),
    };
    return Row(
      key: ValueKey('ppob-operator-${check.state.name}'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              color: color,
              fontSize: 13,
              fontWeight: check.state == _OperatorState.ok
                  ? FontWeight.w700
                  : FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }
}
