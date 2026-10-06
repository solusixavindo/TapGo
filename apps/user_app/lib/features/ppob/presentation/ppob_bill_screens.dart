import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../application/ppob_providers.dart';
import '../domain/ppob_models.dart';
import 'ppob_history_screen.dart';
import 'widgets/ppob_shared.dart';

/// Tagihan pascabayar (BPJS dan PDAM): pilih produk (PDAM per daerah, dapat
/// dicari), isi nomor pelanggan, cek tagihan, lalu bayar.
///
/// Semua angka dihitung server dan disimpan sebagai hasil cek tagihan sekali
/// pakai; yang dikirim klien saat membayar hanyalah referensi cek tagihan.
class PpobBillProductsScreen extends ConsumerStatefulWidget {
  const PpobBillProductsScreen({
    super.key,
    required this.categoryCode,
    required this.title,
  });

  /// `BPJS` atau `PDAM`.
  final String categoryCode;
  final String title;

  @override
  ConsumerState<PpobBillProductsScreen> createState() =>
      _PpobBillProductsScreenState();
}

class _PpobBillProductsScreenState
    extends ConsumerState<PpobBillProductsScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  String _query = '';
  bool _forwarded = false;

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (mounted) setState(() => _query = value.trim());
    });
  }

  void _open(PpobBillProduct product, {bool replace = false}) {
    final route = MaterialPageRoute<void>(
      builder: (_) => PpobBillScreen(product: product),
    );
    final navigator = Navigator.of(context);
    if (replace) {
      navigator.pushReplacement(route);
    } else {
      navigator.push(route);
    }
  }

  @override
  Widget build(BuildContext context) {
    final products = ref.watch(
      ppobBillProductsProvider((category: widget.categoryCode, query: _query)),
    );

    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: TextField(
                  key: const ValueKey('bill-search'),
                  controller: _searchController,
                  onChanged: _onSearchChanged,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    hintText: 'Cari ${widget.title}',
                    prefixIcon: const Icon(Icons.search_rounded),
                  ),
                ),
              ),
            Expanded(
              child: products.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => PpobNoticeView(
                  icon: Icons.cloud_off_rounded,
                  title: 'Gagal memuat ${widget.title}',
                  message: ppobErrorMessage(error),
                  actionLabel: 'Coba Lagi',
                  onAction: () => ref.invalidate(ppobBillProductsProvider),
                ),
                data: (items) {
                  if (items.isEmpty) {
                    return _query.isEmpty
                        ? PpobNoticeView(
                            icon: Icons.hourglass_top_rounded,
                            title: '${widget.title} belum tersedia',
                            message:
                                'Kami sedang menyiapkan layanan ${widget.title} bersama mitra penyedia.',
                          )
                        : const PpobNoticeView(
                            icon: Icons.search_off_rounded,
                            title: 'Tidak ditemukan',
                            message: 'Coba kata pencarian lain.',
                          );
                  }
                  // Hanya satu produk (mis. BPJS, PLN pascabayar): langsung ke isian nomor.
                  if (items.length == 1 && _query.isEmpty && !_forwarded) {
                    _forwarded = true;
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      if (mounted) _open(items.single, replace: true);
                    });
                    return const Center(child: CircularProgressIndicator());
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final product = items[index];
                      return Material(
                        color: Theme.of(context).cardColor,
                        borderRadius: BorderRadius.circular(16),
                        child: ListTile(
                          key: ValueKey('bill-product-${product.sku}'),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                          leading: Icon(
                            ppobCategoryIcon(null,
                                categoryCode: widget.categoryCode),
                            color: ppobCategoryColor(widget.categoryCode),
                          ),
                          title: Text(product.name),
                          trailing: const Icon(Icons.chevron_right_rounded),
                          onTap: () => _open(product),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class PpobBillScreen extends ConsumerStatefulWidget {
  const PpobBillScreen({super.key, required this.product});

  final PpobBillProduct product;

  @override
  ConsumerState<PpobBillScreen> createState() => _PpobBillScreenState();
}

class _PpobBillScreenState extends ConsumerState<PpobBillScreen> {
  final _targetController = TextEditingController();
  Timer? _expiryTimer;

  bool _isBusy = false;
  String? _errorMessage;
  PpobBillInquiry? _inquiry;
  PpobOrder? _result;

  @override
  void initState() {
    super.initState();
    // Menyegarkan tombol bayar saat tagihan kedaluwarsa (server tetap yang
    // menegakkan; ini hanya agar tombol tidak menjanjikan yang sudah basi).
    _expiryTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (mounted && _inquiry != null && _result == null) setState(() {});
    });
  }

  @override
  void dispose() {
    _expiryTimer?.cancel();
    _targetController.dispose();
    super.dispose();
  }

  /// Nomor kontrak multifinance boleh memuat tanda hubung dan garis miring;
  /// kategori lain hanya angka (spasi dan strip dibuang).
  String get _target => widget.product.category == 'MULTIFINANCE'
      ? _targetController.text.replaceAll(RegExp(r'\s+'), '').trim()
      : _targetController.text.replaceAll(RegExp(r'[\s-]+'), '').trim();

  bool get _targetReady {
    final target = _target;
    return switch (widget.product.category) {
      'BPJS' => RegExp(r'^\d{13}$').hasMatch(target),
      'PDAM' => RegExp(r'^\d{6,20}$').hasMatch(target),
      'HP_POSTPAID' => RegExp(r'^(08|\+?628)\d{7,11}$').hasMatch(target),
      'TELKOM' => RegExp(r'^\d{8,14}$').hasMatch(target),
      'PBB' => RegExp(r'^\d{16,20}$').hasMatch(target),
      'MULTIFINANCE' => RegExp(r'^[A-Za-z0-9./-]{4,30}$').hasMatch(target),
      // Lainnya: format pasti ditentukan penyedia; server menolak nomor salah
      // saat cek tagihan (tanpa uang bergerak).
      _ => target.length >= 5,
    };
  }

  bool get _expired {
    final inquiry = _inquiry;
    return inquiry != null && inquiry.isExpiredAt(DateTime.now());
  }

  Future<void> _check() async {
    if (_isBusy || !_targetReady) return;
    setState(() {
      _isBusy = true;
      _errorMessage = null;
      _result = null;
    });
    try {
      final inquiry = await ref.read(ppobRepositoryProvider).billInquiry(
            sku: widget.product.sku,
            targetNumber: _target,
          );
      if (!mounted) return;
      setState(() => _inquiry = inquiry);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _inquiry = null;
        _errorMessage = ppobErrorMessage(error);
      });
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  Future<void> _pay() async {
    final inquiry = _inquiry;
    if (_isBusy || inquiry == null || _expired) return;
    setState(() {
      _isBusy = true;
      _errorMessage = null;
    });
    try {
      // Kunci tetap per cek tagihan: mengulang (jaringan putus, ketuk ganda)
      // dikenali server sebagai replay, bukan pembayaran kedua.
      final order = await ref.read(ppobRepositoryProvider).billPay(
            reference: inquiry.reference,
            idempotencyKey: 'ppob-bill-${inquiry.reference}',
          );
      if (!mounted) return;
      setState(() => _result = order);
      ref.invalidate(ppobOrdersProvider);
    } catch (error) {
      if (!mounted) return;
      setState(() => _errorMessage = ppobErrorMessage(error));
    } finally {
      if (mounted) setState(() => _isBusy = false);
    }
  }

  void _resetTarget() {
    // Selalu membangun ulang: kesiapan tombol bergantung pada isi kolom.
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
    final inquiry = _inquiry;
    final result = _result;
    final expired = _expired;

    return Scaffold(
      appBar: AppBar(title: Text(product.name)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              key: const ValueKey('bill-target'),
              controller: _targetController,
              keyboardType: product.category == 'MULTIFINANCE'
                  ? TextInputType.text
                  : TextInputType.number,
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
              _BillErrorBanner(message: _errorMessage!),
              const SizedBox(height: 12),
            ],
            if (inquiry != null && result == null) ...[
              _BillCard(inquiry: inquiry, expired: expired),
              const SizedBox(height: 12),
            ],
            if (result != null) ...[
              _BillResultCard(order: result),
              const SizedBox(height: 12),
            ],
            if (result == null)
              FilledButton.icon(
                key: ValueKey(inquiry == null || expired ? 'bill-check' : 'bill-pay'),
                onPressed: _isBusy
                    ? null
                    : (inquiry == null || expired
                        ? (_targetReady ? _check : null)
                        : (inquiry.sufficient ? _pay : null)),
                icon: _isBusy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(inquiry == null || expired
                        ? Icons.receipt_long_rounded
                        : Icons.lock_rounded),
                label: Text(
                  _isBusy
                      ? 'Memproses…'
                      : (inquiry == null
                          ? 'Cek Tagihan'
                          : (expired ? 'Cek Tagihan Lagi' : 'Bayar Sekarang')),
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
              'Pembayaran memakai saldo benefit PPOB Anda. Saldo utama tidak '
              'ikut terpakai. Tagihan berlaku singkat dan hanya untuk hari ini.',
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _BillCard extends StatelessWidget {
  const _BillCard({required this.inquiry, required this.expired});

  final PpobBillInquiry inquiry;
  final bool expired;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      key: const ValueKey('bill-card'),
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Rincian Tagihan',
              style: theme.textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 10),
            _row(context, 'Nama pelanggan', inquiry.customerName),
            if (inquiry.period != null) _row(context, 'Periode', inquiry.period!),
            _row(context, 'Tagihan', ppobFormatRupiah(inquiry.billAmount)),
            _row(context, 'Biaya admin & layanan',
                ppobFormatRupiah(inquiry.feeAmount)),
            const Divider(height: 20),
            _row(context, 'Total bayar', ppobFormatRupiah(inquiry.totalAmount),
                bold: true, key: const ValueKey('bill-total')),
            _row(context, 'Saldo benefit PPOB Anda',
                ppobFormatRupiah(inquiry.ppobBalance)),
            if (!inquiry.sufficient) ...[
              const SizedBox(height: 10),
              Text(
                'Saldo benefit PPOB tidak cukup untuk membayar tagihan ini. '
                'Saldo utama tidak dapat dipakai untuk menutup kekurangan.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: const Color(0xFFEF4444),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            if (expired) ...[
              const SizedBox(height: 10),
              Text(
                'Tagihan kedaluwarsa. Cek tagihan lagi sebelum membayar.',
                key: const ValueKey('bill-expired'),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: const Color(0xFFB45309),
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
      {bool bold = false, Key? key}) {
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
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              key: key,
              textAlign: TextAlign.end,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BillResultCard extends StatelessWidget {
  const _BillResultCard({required this.order});

  final PpobOrder order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final message = switch (order.status) {
      PpobOrderStatus.success => 'Tagihan berhasil dibayar.',
      PpobOrderStatus.processing ||
      PpobOrderStatus.pending =>
        'Pembayaran sedang diproses penyedia. Status akan diperbarui otomatis; '
            'cek Riwayat. Saldo tidak dipotong dua kali.',
      PpobOrderStatus.failed ||
      PpobOrderStatus.refunded =>
        'Pembayaran gagal dan dana dikembalikan penuh ke saldo Anda.',
      PpobOrderStatus.unknown => 'Status belum diketahui. Cek Riwayat.',
    };
    return Card(
      key: const ValueKey('bill-result'),
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Hasil Pembayaran',
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                PpobStatusChip(status: order.status),
              ],
            ),
            const SizedBox(height: 10),
            Text(order.productName, style: theme.textTheme.bodyMedium),
            Text('Pelanggan ${order.targetNumber}',
                style: theme.textTheme.bodySmall),
            const SizedBox(height: 6),
            Text(ppobFormatRupiah(order.amount),
                style: theme.textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text(message, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

class _BillErrorBanner extends StatelessWidget {
  const _BillErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('bill-error'),
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
