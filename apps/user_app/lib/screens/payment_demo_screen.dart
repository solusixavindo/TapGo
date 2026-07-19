part of '../main.dart';

class PaymentMethodScreen extends ConsumerStatefulWidget {
  const PaymentMethodScreen({
    required this.form,
    required this.invoice,
    super.key,
  });

  final RegistrationFormModel form;
  final InvoiceModel invoice;

  @override
  ConsumerState<PaymentMethodScreen> createState() =>
      _PaymentMethodScreenState();
}

class _PaymentMethodScreenState extends ConsumerState<PaymentMethodScreen> {
  String _selectedMethod = 'QRIS';
  bool _isPaying = false;

  static const _methods = [
    ('QRIS', Icons.qr_code_2_rounded),
    ('Virtual Account', Icons.account_balance_rounded),
    ('GoPay', Icons.account_balance_wallet_rounded),
    ('ShopeePay', Icons.shopping_bag_rounded),
    ('Bank Transfer', Icons.swap_horiz_rounded),
  ];

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: 'Pembayaran',
      subtitle: 'Pilih metode pembayaran yang tersedia',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _TapGoReveal(
            order: 0,
            child: _InfoPanel(
              color: _brandBlue,
              title: 'Total pembayaran',
              value: formatRupiah(widget.invoice.total),
              subtitle:
                  '${widget.invoice.packageName} • ${widget.invoice.number}',
              icon: Icons.payment_rounded,
            ),
          ),
          const SizedBox(height: 16),
          ..._methods.toList().asMap().entries.map(
                (entry) => _TapGoReveal(
                  order: entry.key + 1,
                  child: _PaymentMethodTile(
                    title: entry.value.$1,
                    icon: entry.value.$2,
                    selected: _selectedMethod == entry.value.$1,
                    onTap: () =>
                        setState(() => _selectedMethod = entry.value.$1),
                  ),
                ),
              ),
          const SizedBox(height: 16),
          _TapGoReveal(
            order: _methods.length + 1,
            child: AnimatedOpacity(
              opacity: _isPaying ? 0.82 : 1,
              duration: _TapGoMotion.duration(context, _TapGoMotion.fast),
              curve: _TapGoMotion.standardCurve,
              child: FilledButton.icon(
                onPressed: _isPaying ? null : _startPayment,
                icon: _TapGoFadeSwitcher(
                  valueKey: _isPaying,
                  child: Icon(
                    _isPaying
                        ? Icons.hourglass_top_rounded
                        : Icons.check_circle_rounded,
                  ),
                ),
                label: _TapGoFadeSwitcher(
                  valueKey: _isPaying ? 'processing' : 'pay',
                  child: Text(_isPaying ? 'Memproses...' : 'Bayar'),
                ),
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF00A86B),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _startPayment() async {
    final orderId = widget.invoice.backendOrderId;
    final session = ref.read(_demoSessionProvider);

    if (orderId == null ||
        orderId.isEmpty ||
        session.accessToken == null ||
        session.accessToken!.isEmpty ||
        session.isDemoMode) {
      if (!_isPaymentSimulatorEnabled) {
        _showPaymentUnavailable();
        return;
      }
      await _completePayment();
      return;
    }

    setState(() => _isPaying = true);
    try {
      _apiClient.setAccessToken(session.accessToken);
      final intent = await _apiClient.payMembershipOrder(orderId);
      if (intent.paid) {
        await _openSuccessFromBackend();
        return;
      }
      if (intent.redirectUrl.isEmpty) {
        throw StateError('URL pembayaran DOKU kosong.');
      }

      final opened = await launchUrl(
        Uri.parse(intent.redirectUrl),
        mode: LaunchMode.externalApplication,
      );
      if (!opened && mounted) {
        await _showPaymentUrlDialog(intent.redirectUrl);
      }

      await _showPaymentStatusDialog(orderId);
    } catch (error) {
      if (mounted) {
        _TapGoSnackbar.error(
          context,
          _isPaymentSimulatorEnabled
              ? 'Pembayaran belum dapat diproses melalui gateway. Silakan coba kembali.'
              : 'Pembayaran belum dapat diproses. Silakan ulangi proses pembayaran.',
        );
      }
      if (!_isPaymentSimulatorEnabled) {
        return;
      }
      await _completePayment();
    } finally {
      if (mounted) {
        setState(() => _isPaying = false);
      }
    }
  }

  Future<void> _showPaymentUrlDialog(String redirectUrl) async {
    if (!mounted) {
      return;
    }
    await _showTapGoDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Link Pembayaran DOKU'),
        content: SelectableText(redirectUrl),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Tutup'),
          ),
        ],
      ),
    );
  }

  Future<void> _showPaymentStatusDialog(String orderId) async {
    if (!mounted) {
      return;
    }
    await _showTapGoDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Status Pembayaran'),
        content: const Text(
          'Selesaikan pembayaran di halaman DOKU, lalu cek status pembayaran Anda.',
        ),
        actions: [
          TextButton(
            onPressed: () async {
              final closedContext = context;
              final paid = await _pollBackendOrderStatus(orderId);
              if (!closedContext.mounted) {
                return;
              }
              Navigator.of(closedContext).pop();
              if (paid) {
                await _openSuccessFromBackend();
              }
            },
            child: const Text('Cek Status'),
          ),
          if (_isPaymentSimulatorEnabled)
            FilledButton(
              onPressed: () {
                Navigator.of(context).pop();
                _completePayment();
              },
              child: const Text('Konfirmasi Pembayaran'),
            ),
        ],
      ),
    );
  }

  void _showPaymentUnavailable() {
    if (!mounted) {
      return;
    }
    _TapGoSnackbar.error(
      context,
      'Pembayaran belum dapat diproses. Silakan ulangi proses pembayaran.',
    );
  }

  Future<bool> _pollBackendOrderStatus(String orderId) async {
    try {
      final order = await _apiClient.membershipOrder(orderId);
      final status = order['status']?.toString();
      final invoice = (order['invoice'] as Map?)?.cast<String, dynamic>();
      final invoiceStatus = invoice?['status']?.toString();
      if (status == 'PAID' || invoiceStatus == 'PAID') {
        return true;
      }
      if (!mounted) {
        return false;
      }
      final message = status == 'FAILED' ||
              status == 'EXPIRED' ||
              invoiceStatus == 'FAILED' ||
              invoiceStatus == 'EXPIRED'
          ? 'Pembayaran gagal atau kedaluwarsa. Silakan coba lagi.'
          : 'Pembayaran masih pending. Coba cek lagi setelah callback masuk.';
      _TapGoSnackbar.warning(context, message);
    } catch (error) {
      if (mounted) {
        _TapGoSnackbar.error(context, 'Gagal cek status pembayaran: $error');
      }
    }
    return false;
  }

  Future<void> _openSuccessFromBackend() async {
    final snapshot = await ref.refresh(_productionSnapshotProvider.future);
    _tapGoDebugLog(
        '[TapGo Payment] snapshot refreshed at ${snapshot.loadedAt}');
    if (!mounted) {
      return;
    }
    final package = DemoClientCatalog.packageByName(widget.invoice.packageName);
    _openDemo(
      context,
      PaymentSuccessScreen(
        invoice: widget.invoice.copyWith(status: PaymentStatus.paid),
        package: package,
      ),
    );
  }

  Future<void> _completePayment() async {
    final package = DemoClientCatalog.packageByName(widget.invoice.packageName);
    final paidInvoice = widget.invoice.copyWith(status: PaymentStatus.paid);
    final transactions = [
      WalletTransactionModel(
        title: 'Membership ${package.name} aktif',
        description: 'Pembayaran via $_selectedMethod berhasil',
        amount: -package.price,
        status: 'Lunas',
      ),
      WalletTransactionModel(
        title: 'Saldo PPOB ${package.name}',
        description: 'Benefit paket masuk ke akun',
        amount: package.ppobBalance,
        status: 'Aktif',
      ),
      ...ref.read(_demoSessionProvider).transactions,
    ];

    final currentSession = ref.read(_demoSessionProvider);
    final session = currentSession.copyWith(
      userName: widget.form.fullName,
      phone: widget.form.phone,
      activePackageName: package.name,
      ppobBalance: package.ppobBalance,
      directSponsor: _isTapGoDevelopmentBuild
          ? (package.name == 'Platinum'
              ? 10
              : package.name == 'Gold'
                  ? 5
                  : package.name == 'Silver'
                      ? 3
                      : 0)
          : currentSession.directSponsor,
      downline: _isTapGoDevelopmentBuild && package.name != 'Basic' ? 124 : 0,
      activeLevel: _isTapGoDevelopmentBuild
          ? (package.name == 'Platinum'
              ? 10
              : package.name == 'Gold'
                  ? 5
                  : package.name == 'Silver'
                      ? 3
                      : 0)
          : currentSession.activeLevel,
      walletBalance: _isTapGoDevelopmentBuild
          ? (package.name == 'Platinum'
              ? 1300000
              : package.name == 'Gold'
                  ? 2400000
                  : package.name == 'Silver'
                      ? 240000
                      : 5000)
          : currentSession.walletBalance,
      todayBonus: _isTapGoDevelopmentBuild
          ? (package.name == 'Platinum'
              ? 1300000
              : package.name == 'Gold'
                  ? 2400000
                  : package.name == 'Silver'
                      ? 240000
                      : 5000)
          : currentSession.todayBonus,
      lastInvoiceNumber: widget.invoice.number,
      membershipJoinedAt: _formatDemoDate(DateTime.now()),
      transactions: transactions,
    );
    ref.read(_demoSessionProvider.notifier).state = session;
    await _persistentStore.saveSession(session);
    await _persistentStore.saveMembershipSnapshot(session);
    await _persistentStore.saveRegisteredUser(session);
    await _persistentStore.saveAuth(true);
    if (!mounted) {
      return;
    }

    _openDemo(
      context,
      PaymentSuccessScreen(invoice: paidInvoice, package: package),
    );
  }
}

String _formatDemoDate(DateTime date) {
  const months = [
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
  return '${date.day.toString().padLeft(2, '0')} ${months[date.month - 1]} ${date.year}';
}
