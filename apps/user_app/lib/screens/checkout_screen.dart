part of '../main.dart';

class CheckoutScreen extends StatelessWidget {
  const CheckoutScreen({
    required this.form,
    required this.invoice,
    super.key,
  });

  final RegistrationFormModel form;
  final InvoiceModel invoice;

  @override
  Widget build(BuildContext context) {
    final package = DemoClientCatalog.packageByName(invoice.packageName);

    return _DemoScaffold(
      title: 'Checkout',
      subtitle: invoice.number,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _TapGoReveal(
            order: 0,
            child: _InvoiceCard(invoice: invoice, package: package),
          ),
          const SizedBox(height: 14),
          _TapGoReveal(
            order: 1,
            child: FilledButton.icon(
              onPressed: () => _openDemo(
                context,
                PaymentMethodScreen(form: form, invoice: invoice),
              ),
              icon: const Icon(Icons.payment_rounded),
              label: const Text('Bayar Sekarang'),
              style: FilledButton.styleFrom(
                backgroundColor: _brandBlue,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 15),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          _TapGoReveal(
            order: 2,
            child: OutlinedButton.icon(
              onPressed: () => _showWhatsAppPreview(context, invoice),
              icon: const Icon(Icons.chat_rounded),
              label: const Text('Kirim Notifikasi WhatsApp'),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF00A86B),
                padding: const EdgeInsets.symmetric(vertical: 15),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          _TapGoReveal(
            order: 3,
            child: TextButton.icon(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Invoice siap diunduh.')),
                );
              },
              icon: const Icon(Icons.download_rounded),
              label: const Text('Download Invoice'),
            ),
          ),
        ],
      ),
    );
  }

  void _showWhatsAppPreview(BuildContext context, InvoiceModel invoice) {
    _showTapGoBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Pratinjau WhatsApp',
              style: TextStyle(
                color: Color(0xFF0A2A43),
                fontSize: 20,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFE8FFF3),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Text(
                'Terima kasih sudah mendaftar TapGo.\n'
                'Invoice: ${invoice.number}\n'
                'Paket: ${invoice.packageName}\n'
                'Total: ${formatRupiah(invoice.total)}\n'
                'Silakan lanjutkan pembayaran melalui link berikut.',
                style: const TextStyle(
                  color: Color(0xFF0A2A43),
                  height: 1.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
