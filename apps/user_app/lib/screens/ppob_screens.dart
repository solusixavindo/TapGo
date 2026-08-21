part of '../main.dart';

/// Layar PPOB (Stage R2.7) — Pulsa, Data, Token PLN, BPJS, dan E-Wallet.
///
/// Mengikuti konvensi layar Ojek Online: nol panggilan HTTP di dalam `build`,
/// seluruh aksi mutasi berpenjaga single-flight, exception mentah tidak pernah
/// ditampilkan, dan semua state (loading/error/empty/success) punya tampilan
/// yang jujur. Pembelian memakai saldo PPOB & Benefit (ppobBalance) — bucket
/// benefit non-withdrawable, bukan saldo tunai.

// ===========================================================================
// Metadata kategori
// ===========================================================================

class _PpobCategoryMeta {
  const _PpobCategoryMeta({
    required this.value,
    required this.label,
    required this.icon,
    required this.color,
    required this.targetLabel,
    required this.targetHint,
    required this.msisdn,
  });

  final String value;
  final String label;
  final IconData icon;
  final Color color;
  final String targetLabel;
  final String targetHint;
  final bool msisdn;
}

const _ppobCategories = <_PpobCategoryMeta>[
  _PpobCategoryMeta(
    value: 'PULSA',
    label: 'Pulsa',
    icon: Icons.phone_iphone_rounded,
    color: Color(0xFF1486B8),
    targetLabel: 'Nomor HP Tujuan',
    targetHint: 'Contoh: 0812xxxxxxx',
    msisdn: true,
  ),
  _PpobCategoryMeta(
    value: 'DATA',
    label: 'Data',
    icon: Icons.wifi_rounded,
    color: Color(0xFF0B7A75),
    targetLabel: 'Nomor HP Tujuan',
    targetHint: 'Contoh: 0812xxxxxxx',
    msisdn: true,
  ),
  _PpobCategoryMeta(
    value: 'PLN_PREPAID',
    label: 'Token PLN',
    icon: Icons.bolt_rounded,
    color: Color(0xFFF59E0B),
    targetLabel: 'Nomor Meter / IDPEL',
    targetHint: '11–12 digit',
    msisdn: false,
  ),
  _PpobCategoryMeta(
    value: 'PLN_POSTPAID',
    label: 'PLN Pascabayar',
    icon: Icons.receipt_long_rounded,
    color: Color(0xFFD97706),
    targetLabel: 'ID Pelanggan',
    targetHint: '11–12 digit',
    msisdn: false,
  ),
  _PpobCategoryMeta(
    value: 'BPJS',
    label: 'BPJS',
    icon: Icons.health_and_safety_rounded,
    color: Color(0xFF16A34A),
    targetLabel: 'Nomor Kartu BPJS',
    targetHint: '13 digit',
    msisdn: false,
  ),
  _PpobCategoryMeta(
    value: 'EWALLET',
    label: 'E-Wallet',
    icon: Icons.account_balance_wallet_rounded,
    color: Color(0xFF6D28D9),
    targetLabel: 'Nomor HP E-Wallet',
    targetHint: 'Contoh: 0812xxxxxxx',
    msisdn: true,
  ),
];

_PpobCategoryMeta _ppobCategoryMetaFor(String value) {
  return _ppobCategories.firstWhere(
    (meta) => meta.value == value,
    orElse: () => _ppobCategories.first,
  );
}

/// Validasi ringan di sisi klien untuk umpan balik cepat. Server tetap
/// otoritatif — aturan ini hanya cermin agar kesalahan ketik tertangkap sebelum
/// permintaan dikirim.
String? _ppobTargetError(String category, String rawValue) {
  final meta = _ppobCategoryMetaFor(category);
  final digits = rawValue.replaceAll(RegExp(r'\D'), '');
  if (digits.isEmpty) {
    return '${meta.targetLabel} wajib diisi.';
  }
  if (meta.msisdn) {
    final normalized =
        digits.startsWith('62') ? '0${digits.substring(2)}' : digits;
    if (!RegExp(r'^08\d{8,11}$').hasMatch(normalized)) {
      return 'Nomor HP harus diawali 08 dan berisi 10–13 digit.';
    }
    return null;
  }
  final pattern = switch (meta.value) {
    'BPJS' => RegExp(r'^\d{13}$'),
    _ => RegExp(r'^\d{11,12}$'),
  };
  if (!pattern.hasMatch(digits)) {
    return '${meta.targetLabel} tidak valid (${meta.targetHint}).';
  }
  return null;
}

/// Memetakan kegagalan menjadi kalimat Indonesia yang ramah — tidak pernah
/// menampilkan exception mentah.
String tapGoPpobErrorMessage(Object error) {
  if (error is DioException) {
    final data = _authResponseDataMap(error.response?.data);
    final code = data?['code']?.toString();
    switch (code) {
      case 'INSUFFICIENT_PPOB_BALANCE':
        return 'Saldo PPOB & Benefit kamu tidak mencukupi.';
      case 'PPOB_PRODUCT_NOT_FOUND':
        return 'Produk tidak ditemukan atau sedang tidak aktif.';
      case 'PPOB_TARGET_INVALID':
        return 'Nomor tujuan tidak valid. Periksa kembali ya.';
      case 'PPOB_IDEMPOTENCY_CONFLICT':
        return 'Permintaan ini sudah diproses dengan data berbeda.';
      case 'PPOB_PROVIDER_DISABLED':
        return 'Layanan PPOB sedang tidak tersedia. Coba lagi nanti.';
      case 'PPOB_TRANSACTION_NOT_FOUND':
        return 'Transaksi tidak ditemukan.';
      case 'RATE_LIMITED':
        return 'Terlalu banyak permintaan. Coba lagi beberapa saat lagi.';
    }
    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout) {
      return 'Koneksi ke server TapGo terputus. Silakan coba lagi.';
    }
  }
  return 'Permintaan belum dapat diproses. Silakan coba lagi.';
}

int _ppobMoneyInt(Object? value) {
  if (value is int) return value;
  if (value is double) return value.round();
  // Wallet menyajikan Decimal sebagai string ("100000.00"); int.tryParse
  // menolak titik desimal, jadi kanalnya harus double.
  return (double.tryParse('$value') ?? 0).round();
}

String _ppobDateTimeLabel(Object? value) {
  final parsed = DateTime.tryParse('$value');
  if (parsed == null) return '-';
  final local = parsed.toLocal();
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year} ${two(local.hour)}:${two(local.minute)}';
}

String _ppobIdempotencyKey() {
  final random = Random.secure();
  final suffix = List.generate(
    12,
    (_) => 'abcdefghjkmnpqrstuvwxyz23456789'[random.nextInt(31)],
  ).join();
  return 'ppob-${DateTime.now().microsecondsSinceEpoch}-$suffix';
}

// ===========================================================================
// Komponen bersama
// ===========================================================================

class _PpobSectionCard extends StatelessWidget {
  const _PpobSectionCard({required this.child, this.padding});

  final Widget child;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final radius = BorderRadius.circular(16);
    // ListTile menuntut Material ancestor; Container ber-decoration saja tidak
    // cukup dan memicu assert. Material transparan mempertahankan warna kartu
    // sekaligus menyediakan permukaan ripple yang terclip rapi.
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: radius,
        boxShadow: const [
          BoxShadow(
            color: Color(0x11000000),
            blurRadius: 14,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: Material(
          color: Colors.transparent,
          child: Padding(
            padding: padding ?? const EdgeInsets.all(16),
            child: child,
          ),
        ),
      ),
    );
  }
}

class _PpobStatusChip extends StatelessWidget {
  const _PpobStatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      'SUCCESS' => ('Berhasil', const Color(0xFF16A34A)),
      'FAILED' => ('Gagal · Dana kembali', const Color(0xFFDC2626)),
      'PROCESSING' => ('Diproses', const Color(0xFFD97706)),
      'PENDING' => ('Menunggu', const Color(0xFFD97706)),
      'REFUNDED' => ('Dikembalikan', const Color(0xFF6D28D9)),
      _ => (status, const Color(0xFF697386)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _PpobSkeleton extends StatelessWidget {
  const _PpobSkeleton({required this.height, this.width});

  final double height;
  final double? width;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      height: height,
      width: width,
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF22314A) : const Color(0xFFE6EDF5),
        borderRadius: BorderRadius.circular(10),
      ),
    );
  }
}

// ===========================================================================
// Layar utama PPOB
// ===========================================================================

class PpobHomeScreen extends StatefulWidget {
  const PpobHomeScreen({super.key});

  @override
  State<PpobHomeScreen> createState() => _PpobHomeScreenState();
}

class _PpobHomeScreenState extends State<PpobHomeScreen> {
  String? _selectedCategory;
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _products = const [];
  int? _ppobBalance;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        (tapGoPpobCatalogLoaderForTests ??
                ({String? category}) =>
                    _apiClient.ppobProducts(category: category))
            .call(category: _selectedCategory),
        (tapGoPpobWalletLoaderForTests ?? _apiClient.walletSummary).call(),
      ]);
      if (!mounted) return;
      final products = results[0] as List<Map<String, dynamic>>;
      final wallet = results[1] as Map<String, dynamic>;
      setState(() {
        _products = products;
        _ppobBalance = _ppobMoneyInt(wallet['ppobBalance']);
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = tapGoPpobErrorMessage(error);
        _loading = false;
      });
    }
  }

  void _selectCategory(String? category) {
    if (_selectedCategory == category) return;
    setState(() => _selectedCategory = category);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: colorScheme.surfaceContainerLowest,
      appBar: AppBar(
        title: const Text(
          'PPOB',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        actions: [
          IconButton(
            tooltip: 'Riwayat transaksi',
            onPressed: () {
              Navigator.of(context).push(
                _tapGoPageRoute((_) => const PpobHistoryScreen()),
              );
            },
            icon: const Icon(Icons.history_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            _buildBalanceCard(context),
            const SizedBox(height: 16),
            _buildCategoryChips(context),
            const SizedBox(height: 16),
            if (_loading)
              ..._buildSkeletonList()
            else if (_error != null)
              RideNoticeCard(
                icon: Icons.cloud_off_rounded,
                title: 'Katalog belum termuat',
                message: _error!,
                actionLabel: 'Coba lagi',
                onAction: _load,
              )
            else if (_products.isEmpty)
              const RideNoticeCard(
                icon: Icons.inventory_2_outlined,
                title: 'Belum ada produk',
                message:
                    'Produk pada kategori ini belum tersedia. Coba kategori lain ya.',
              )
            else
              ..._products.map(_buildProductTile),
          ],
        ),
      ),
    );
  }

  Widget _buildBalanceCard(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF0569E8), Color(0xFF0B7A75)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Saldo PPOB & Benefit',
                  style: TextStyle(
                    color: Colors.white70,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 6),
                _loading && _ppobBalance == null
                    ? const _PpobSkeleton(height: 26, width: 140)
                    : Text(
                        formatRupiah(_ppobBalance ?? 0),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 24,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                const SizedBox(height: 4),
                const Text(
                  'Saldo benefit, tidak dapat ditarik tunai',
                  style: TextStyle(color: Colors.white60, fontSize: 11),
                ),
              ],
            ),
          ),
          const Icon(
            Icons.account_balance_wallet_rounded,
            color: Colors.white54,
            size: 40,
          ),
        ],
      ),
    );
  }

  Widget _buildCategoryChips(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final entries = <(String?, String, IconData, Color)>[
      (null, 'Semua', Icons.grid_view_rounded, const Color(0xFF697386)),
      ..._ppobCategories.map(
        (meta) => (meta.value as String?, meta.label, meta.icon, meta.color),
      ),
    ];
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: entries.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final (value, label, icon, color) = entries[index];
          final selected = _selectedCategory == value;
          return ChoiceChip(
            selected: selected,
            onSelected: (_) => _selectCategory(value),
            avatar: Icon(
              icon,
              size: 16,
              color: selected ? Colors.white : color,
            ),
            label: Text(label),
            labelStyle: TextStyle(
              color: selected ? Colors.white : colorScheme.onSurface,
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
            selectedColor: _brandBlue,
            backgroundColor: colorScheme.surface,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(999),
              side: BorderSide(
                color: selected
                    ? _brandBlue
                    : colorScheme.outline.withValues(alpha: 0.3),
              ),
            ),
            showCheckmark: false,
          );
        },
      ),
    );
  }

  List<Widget> _buildSkeletonList() {
    return List.generate(
      4,
      (index) => const Padding(
        padding: EdgeInsets.only(bottom: 12),
        child: _PpobSkeleton(height: 76),
      ),
    );
  }

  Widget _buildProductTile(Map<String, dynamic> product) {
    final colorScheme = Theme.of(context).colorScheme;
    final meta = _ppobCategoryMetaFor('${product['category'] ?? ''}');
    final price = _ppobMoneyInt(product['price']);
    final adminFee = _ppobMoneyInt(product['adminFee']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: _PpobSectionCard(
        padding: EdgeInsets.zero,
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 8,
          ),
          leading: CircleAvatar(
            backgroundColor: meta.color.withValues(alpha: 0.14),
            child: Icon(meta.icon, color: meta.color),
          ),
          title: Text(
            '${product['name'] ?? '-'}',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
          ),
          subtitle: Text(
            adminFee > 0
                ? '${product['brand'] ?? ''} · +biaya admin ${formatRupiah(adminFee)}'
                : '${product['brand'] ?? ''}',
            style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 12),
          ),
          trailing: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                formatRupiah(price),
                style: const TextStyle(
                  color: _brandBlue,
                  fontWeight: FontWeight.w900,
                  fontSize: 14,
                ),
              ),
              const Icon(Icons.chevron_right_rounded, size: 16),
            ],
          ),
          onTap: () {
            Navigator.of(context).push(
              _tapGoPageRoute(
                (_) => PpobCheckoutScreen(
                  product: product,
                  initialBalance: _ppobBalance,
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

// ===========================================================================
// Checkout
// ===========================================================================

class PpobCheckoutScreen extends StatefulWidget {
  const PpobCheckoutScreen({
    super.key,
    required this.product,
    this.initialBalance,
  });

  final Map<String, dynamic> product;
  final int? initialBalance;

  @override
  State<PpobCheckoutScreen> createState() => _PpobCheckoutScreenState();
}

class _PpobCheckoutScreenState extends State<PpobCheckoutScreen> {
  final _targetController = TextEditingController();
  final _targetFocus = FocusNode();
  // Dibuat SEKALI per checkout: percobaan ulang memakai key yang sama sehingga
  // server mengenalinya sebagai permintaan yang sama, bukan pembelian ganda.
  late final String _idempotencyKey = _ppobIdempotencyKey();
  bool _submitting = false;
  String? _error;

  _PpobCategoryMeta get _meta =>
      _ppobCategoryMetaFor('${widget.product['category'] ?? ''}');

  int get _total =>
      _ppobMoneyInt(widget.product['price']) +
      _ppobMoneyInt(widget.product['adminFee']);

  @override
  void dispose() {
    _targetController.dispose();
    _targetFocus.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    if (_submitting) return;
    final targetError = _ppobTargetError(_meta.value, _targetController.text);
    if (targetError != null) {
      setState(() => _error = targetError);
      _targetFocus.requestFocus();
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final purchase = tapGoPpobPurchaseForTests ??
          ({
            required String sku,
            required String targetNumber,
            required String idempotencyKey,
          }) =>
              _apiClient.createPpobPurchase(
                sku: sku,
                targetNumber: targetNumber,
                idempotencyKey: idempotencyKey,
              );
      final result = await purchase(
        sku: '${widget.product['sku']}',
        targetNumber: _targetController.text.trim(),
        idempotencyKey: _idempotencyKey,
      );
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        _tapGoPageRoute((_) => PpobResultScreen(transaction: result)),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = tapGoPpobErrorMessage(error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final balance = widget.initialBalance;
    final balanceShort = balance != null && balance < _total;
    return Scaffold(
      backgroundColor: colorScheme.surfaceContainerLowest,
      appBar: AppBar(
        title: const Text(
          'Konfirmasi Pembelian',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          _PpobSectionCard(
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: _meta.color.withValues(alpha: 0.14),
                  child: Icon(_meta.icon, color: _meta.color),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${widget.product['name'] ?? '-'}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 15,
                        ),
                      ),
                      Text(
                        '${widget.product['brand'] ?? ''} · ${widget.product['sku'] ?? ''}',
                        style: TextStyle(
                          color: colorScheme.onSurfaceVariant,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _PpobSectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _meta.targetLabel,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _targetController,
                  focusNode: _targetFocus,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _confirm(),
                  decoration: InputDecoration(
                    hintText: _meta.targetHint,
                    prefixIcon: Icon(_meta.icon, color: _meta.color),
                    filled: true,
                    fillColor: colorScheme.surfaceContainerHighest
                        .withValues(alpha: 0.5),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _PpobSectionCard(
            child: Column(
              children: [
                _priceRow(
                  context,
                  'Harga',
                  formatRupiah(_ppobMoneyInt(widget.product['price'])),
                ),
                const SizedBox(height: 8),
                _priceRow(
                  context,
                  'Biaya admin',
                  formatRupiah(_ppobMoneyInt(widget.product['adminFee'])),
                ),
                const Divider(height: 24),
                _priceRow(context, 'Total bayar', formatRupiah(_total),
                    emphasize: true),
                if (balance != null) ...[
                  const SizedBox(height: 8),
                  _priceRow(
                    context,
                    'Saldo PPOB kamu',
                    formatRupiah(balance),
                    valueColor: balanceShort
                        ? const Color(0xFFDC2626)
                        : const Color(0xFF16A34A),
                  ),
                ],
              ],
            ),
          ),
          if (balanceShort) ...[
            const SizedBox(height: 12),
            const RideNoticeCard(
              icon: Icons.account_balance_wallet_outlined,
              title: 'Saldo belum cukup',
              message:
                  'Saldo PPOB & Benefit kamu belum mencukupi untuk produk ini.',
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            RideNoticeCard(
              icon: Icons.error_outline_rounded,
              title: 'Belum bisa diproses',
              message: _error!,
            ),
          ],
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: FilledButton.icon(
              onPressed: (_submitting || balanceShort) ? null : _confirm,
              style: FilledButton.styleFrom(
                backgroundColor: _brandBlue,
                disabledBackgroundColor:
                    colorScheme.outline.withValues(alpha: 0.3),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              icon: _submitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.lock_rounded, size: 18),
              label: Text(
                _submitting ? 'Memproses…' : 'Bayar ${formatRupiah(_total)}',
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Pembayaran memakai saldo PPOB & Benefit. Transaksi yang gagal '
            'mengembalikan saldo secara otomatis dan penuh.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: colorScheme.onSurfaceVariant,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }

  Widget _priceRow(
    BuildContext context,
    String label,
    String value, {
    bool emphasize = false,
    Color? valueColor,
  }) {
    final colorScheme = Theme.of(context).colorScheme;
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(
            color: colorScheme.onSurfaceVariant,
            fontSize: emphasize ? 14 : 13,
            fontWeight: emphasize ? FontWeight.w800 : FontWeight.w500,
          ),
        ),
        Text(
          value,
          style: TextStyle(
            color: valueColor ??
                (emphasize ? _brandBlue : colorScheme.onSurface),
            fontSize: emphasize ? 16 : 13,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }
}

// ===========================================================================
// Hasil transaksi
// ===========================================================================

class PpobResultScreen extends StatelessWidget {
  const PpobResultScreen({
    super.key,
    required this.transaction,
    this.embedded = false,
  });

  final Map<String, dynamic> transaction;

  /// Mode tersemat untuk dipakai di dalam layar detail: tanpa Scaffold,
  /// AppBar, dan tombol navigasi.
  final bool embedded;

  @override
  Widget build(BuildContext context) {
    final content = _buildContent(context);
    if (embedded) {
      return content;
    }
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: colorScheme.surfaceContainerLowest,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: const Text(
          'Status Transaksi',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
        children: [content],
      ),
    );
  }

  Widget _buildContent(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final status = '${transaction['status'] ?? ''}';
    final success = status == 'SUCCESS';
    final failed = status == 'FAILED' || status == 'REFUNDED';
    return Column(
      children: [
        Icon(
          success
              ? Icons.check_circle_rounded
              : failed
                  ? Icons.cancel_rounded
                  : Icons.hourglass_top_rounded,
          size: 72,
          color: success
              ? const Color(0xFF16A34A)
              : failed
                  ? const Color(0xFFDC2626)
                  : const Color(0xFFD97706),
        ),
        const SizedBox(height: 12),
        Text(
          success
              ? 'Pembelian Berhasil'
              : failed
                  ? 'Pembelian Gagal'
                  : 'Pembelian Diproses',
          textAlign: TextAlign.center,
          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20),
        ),
        const SizedBox(height: 6),
        Text(
          success
              ? '${transaction['productName'] ?? ''} sudah dikirim ke ${transaction['targetNumber'] ?? ''}.'
              : failed
                  ? '${transaction['failureReason'] ?? 'Penyedia tidak dapat memproses.'} Saldo kamu sudah dikembalikan penuh.'
                  : 'Penyedia sedang memproses. Status akan diperbarui otomatis.',
          textAlign: TextAlign.center,
          style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 13),
        ),
        const SizedBox(height: 20),
        _PpobSectionCard(
          child: Column(
            children: [
              _detailRow(context, 'Referensi', '${transaction['reference'] ?? '-'}'),
              _detailRow(context, 'Produk', '${transaction['productName'] ?? '-'}'),
              _detailRow(context, 'Tujuan', '${transaction['targetNumber'] ?? '-'}'),
              _detailRow(
                context,
                'Total',
                formatRupiah(_ppobMoneyInt(transaction['totalAmount'])),
              ),
              _detailRow(
                context,
                'Waktu',
                _ppobDateTimeLabel(transaction['createdAt']),
              ),
            ],
          ),
        ),
        if (success && transaction['serialNumber'] != null) ...[
          const SizedBox(height: 16),
          _PpobSectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Serial / Token',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: SelectableText(
                        '${transaction['serialNumber']}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 16,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Salin',
                      icon: const Icon(Icons.copy_rounded, size: 18),
                      onPressed: () {
                        Clipboard.setData(
                          ClipboardData(
                            text: '${transaction['serialNumber']}',
                          ),
                        );
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Serial disalin ke clipboard.'),
                          ),
                        );
                      },
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
        if (!embedded) ...[
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: FilledButton(
              onPressed: () {
                Navigator.of(context).pushAndRemoveUntil(
                  _tapGoPageRoute((_) => const PpobHomeScreen()),
                  (route) => route.isFirst,
                );
              },
              style: FilledButton.styleFrom(
                backgroundColor: _brandBlue,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: const Text(
                'Selesai',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: OutlinedButton(
              onPressed: () {
                Navigator.of(context).pushReplacement(
                  _tapGoPageRoute((_) => const PpobHistoryScreen()),
                );
              },
              style: OutlinedButton.styleFrom(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: const Text(
                'Lihat Riwayat',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _detailRow(BuildContext context, String label, String value) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 13),
          ),
          const SizedBox(width: 16),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

// ===========================================================================
// Riwayat & detail
// ===========================================================================

class PpobHistoryScreen extends StatefulWidget {
  const PpobHistoryScreen({super.key});

  @override
  State<PpobHistoryScreen> createState() => _PpobHistoryScreenState();
}

class _PpobHistoryScreenState extends State<PpobHistoryScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _transactions = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final loader = tapGoPpobHistoryLoaderForTests ??
          ({int limit = 20}) => _apiClient.ppobHistory(limit: limit);
      final items = await loader(limit: 20);
      if (!mounted) return;
      setState(() {
        _transactions = items;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = tapGoPpobErrorMessage(error);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: colorScheme.surfaceContainerLowest,
      appBar: AppBar(
        title: const Text(
          'Riwayat PPOB',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
          children: [
            if (_loading)
              ...List.generate(
                4,
                (index) => const Padding(
                  padding: EdgeInsets.only(bottom: 12),
                  child: _PpobSkeleton(height: 72),
                ),
              )
            else if (_error != null)
              RideNoticeCard(
                icon: Icons.cloud_off_rounded,
                title: 'Riwayat belum termuat',
                message: _error!,
                actionLabel: 'Coba lagi',
                onAction: _load,
              )
            else if (_transactions.isEmpty)
              const RideNoticeCard(
                icon: Icons.receipt_long_outlined,
                title: 'Belum ada transaksi',
                message:
                    'Transaksi PPOB yang kamu lakukan akan tampil di sini.',
              )
            else
              ..._transactions.map(_buildTile),
          ],
        ),
      ),
    );
  }

  Widget _buildTile(Map<String, dynamic> transaction) {
    final colorScheme = Theme.of(context).colorScheme;
    final meta = _ppobCategoryMetaFor('${transaction['category'] ?? ''}');
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: _PpobSectionCard(
        padding: EdgeInsets.zero,
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 8,
          ),
          leading: CircleAvatar(
            backgroundColor: meta.color.withValues(alpha: 0.14),
            child: Icon(meta.icon, color: meta.color),
          ),
          title: Text(
            '${transaction['productName'] ?? '-'}',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
          ),
          subtitle: Text(
            '${transaction['targetNumber'] ?? ''} · ${_ppobDateTimeLabel(transaction['createdAt'])}',
            style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 12),
          ),
          trailing: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                formatRupiah(_ppobMoneyInt(transaction['totalAmount'])),
                style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13),
              ),
              const SizedBox(height: 4),
              _PpobStatusChip(status: '${transaction['status'] ?? ''}'),
            ],
          ),
          onTap: () {
            Navigator.of(context).push(
              _tapGoPageRoute(
                (_) => PpobTransactionDetailScreen(
                  reference: '${transaction['reference']}',
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class PpobTransactionDetailScreen extends StatefulWidget {
  const PpobTransactionDetailScreen({super.key, required this.reference});

  final String reference;

  @override
  State<PpobTransactionDetailScreen> createState() =>
      _PpobTransactionDetailScreenState();
}

class _PpobTransactionDetailScreenState
    extends State<PpobTransactionDetailScreen> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _transaction;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final loader = tapGoPpobTransactionDetailLoaderForTests ??
          _apiClient.ppobTransactionDetail;
      final detail = await loader(widget.reference);
      if (!mounted) return;
      setState(() {
        _transaction = detail;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = tapGoPpobErrorMessage(error);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: colorScheme.surfaceContainerLowest,
      appBar: AppBar(
        title: const Text(
          'Detail Transaksi',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        actions: [
          IconButton(
            tooltip: 'Muat ulang',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          if (_loading)
            const _PpobSkeleton(height: 220)
          else if (_error != null)
            RideNoticeCard(
              icon: Icons.cloud_off_rounded,
              title: 'Detail belum termuat',
              message: _error!,
              actionLabel: 'Coba lagi',
              onAction: _load,
            )
          else if (_transaction != null)
            PpobResultScreen(transaction: _transaction!, embedded: true),
        ],
      ),
    );
  }
}
