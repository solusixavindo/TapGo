part of '../main.dart';

class AdminPaymentScreen extends ConsumerWidget {
  const AdminPaymentScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final adminSnapshot = ref.watch(_adminConsoleSnapshotProvider);
    final invoices = adminSnapshot.valueOrNull?.invoices
            .map(DemoAdminInvoice.fromApi)
            .toList(growable: false) ??
        (_isTapGoDevelopmentBuild
            ? _demoAdminInvoices
            : const <DemoAdminInvoice>[]);
    final paid = invoices.where((invoice) => invoice.status == 'Lunas');
    final pending = invoices.where((invoice) => invoice.status == 'Pending');

    return _DemoScaffold(
      title: 'Payment Management',
      subtitle: adminSnapshot.hasValue
          ? 'Live Data invoice membership'
          : 'Invoice membership TapGo',
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                  child: _StatCard(label: 'Lunas', value: '${paid.length}')),
              const SizedBox(width: 10),
              Expanded(
                  child:
                      _StatCard(label: 'Pending', value: '${pending.length}')),
            ],
          ),
          const SizedBox(height: 14),
          if (adminSnapshot.isLoading)
            const _StatusSurface(
              icon: Icons.sync_rounded,
              title: 'Memuat invoice',
              subtitle: 'Mengambil data pembayaran...',
            )
          else if (invoices.isEmpty)
            const _StatusSurface(
              icon: Icons.receipt_long_rounded,
              title: 'Belum ada transaksi',
              subtitle: 'Invoice membership akan muncul setelah order dibuat.',
            )
          else
            ...invoices.map((invoice) => _AdminInvoiceTile(invoice)),
        ],
      ),
    );
  }
}

class _AdminInvoiceTile extends StatelessWidget {
  const _AdminInvoiceTile(this.invoice);

  final DemoAdminInvoice invoice;

  @override
  Widget build(BuildContext context) {
    final paid = invoice.status == 'Lunas';
    return InkWell(
      onTap: () => _openDemo(
        context,
        _AdminPaymentDetailScreen(invoice: invoice),
      ),
      child: _WalletLedgerItem(
        title: '${invoice.number} • ${invoice.memberName}',
        amount: formatRupiah(invoice.amount),
        note:
            '${invoice.packageName} • ${invoice.method} • ${invoice.status} • ${invoice.date}',
        color: paid ? const Color(0xFF00A86B) : _brandOrange,
      ),
    );
  }
}

class _AdminPaymentDetailScreen extends ConsumerStatefulWidget {
  const _AdminPaymentDetailScreen({required this.invoice});

  final DemoAdminInvoice invoice;

  @override
  ConsumerState<_AdminPaymentDetailScreen> createState() =>
      _AdminPaymentDetailScreenState();
}

class _AdminPaymentDetailScreenState
    extends ConsumerState<_AdminPaymentDetailScreen> {
  bool _checking = false;

  @override
  Widget build(BuildContext context) {
    final invoice = widget.invoice;
    final canCheckDoku = invoice.method.toUpperCase() == 'DOKU' &&
        invoice.referenceId != null &&
        invoice.referenceId!.isNotEmpty;

    return _DemoScaffold(
      title: 'Invoice Detail',
      subtitle: 'Detail operasional',
      child: Column(
        children: [
          ...[
            invoice.number,
            invoice.memberName,
            invoice.packageName,
            invoice.method,
            invoice.referenceId ?? '-',
            invoice.status,
            formatRupiah(invoice.amount),
          ].map(
            (row) => _WalletLedgerItem(
              title: row,
              amount: 'Live Data',
              note: 'Data dibuka dari dashboard admin.',
              color: _brandBlue,
            ),
          ),
          if (canCheckDoku)
            FilledButton.icon(
              onPressed: _checking ? null : _checkDokuStatus,
              icon: Icon(
                  _checking ? Icons.hourglass_top_rounded : Icons.sync_rounded),
              label: Text(_checking ? 'Mengecek...' : 'Check DOKU Status'),
              style: FilledButton.styleFrom(
                backgroundColor: _brandBlue,
                foregroundColor: Colors.white,
                padding:
                    const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _checkDokuStatus() async {
    final referenceId = widget.invoice.referenceId;
    if (referenceId == null || referenceId.isEmpty) {
      return;
    }

    setState(() => _checking = true);
    try {
      final session = ref.read(_demoSessionProvider);
      _apiClient.setAccessToken(session.accessToken);
      final response = await _apiClient.get(
        '/payments/doku/status/${Uri.encodeComponent(referenceId)}',
      );
      if (!mounted) {
        return;
      }
      await _showTapGoDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('DOKU Status'),
          content: SelectableText(response.toString()),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Tutup'),
            ),
          ],
        ),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gagal cek status DOKU: $error')),
      );
    } finally {
      if (mounted) {
        setState(() => _checking = false);
      }
    }
  }
}
