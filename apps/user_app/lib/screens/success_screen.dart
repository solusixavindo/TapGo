part of '../main.dart';

class PaymentSuccessScreen extends StatelessWidget {
  const PaymentSuccessScreen({
    required this.invoice,
    required this.package,
    super.key,
  });

  final InvoiceModel invoice;
  final MembershipPackageModel package;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TweenAnimationBuilder<double>(
                tween: Tween(begin: 0.7, end: 1),
                duration: const Duration(milliseconds: 700),
                curve: Curves.elasticOut,
                builder: (context, value, child) => Transform.scale(
                  scale: value,
                  child: child,
                ),
                child: Container(
                  width: 122,
                  height: 122,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: const Color(0xFF00A86B),
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFF00A86B).withValues(alpha: 0.3),
                        blurRadius: 32,
                        offset: const Offset(0, 18),
                      ),
                    ],
                  ),
                  child: const Icon(
                    Icons.check_rounded,
                    color: Colors.white,
                    size: 72,
                  ),
                ),
              ),
              const SizedBox(height: 28),
              const Text(
                'Pendaftaran Berhasil',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF0A2A43),
                  fontSize: 28,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Paket ${package.name} aktif. Invoice ${invoice.number} sudah lunas.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFF718096)),
              ),
              const SizedBox(height: 24),
              _InfoPanel(
                color: _brandBlue,
                title: 'Saldo PPOB',
                value: formatRupiah(package.ppobBalance),
                subtitle: 'Membership ${package.name} aktif',
                icon: Icons.workspace_premium_rounded,
              ),
              const SizedBox(height: 18),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).popUntil(
                  (route) => route.isFirst,
                ),
                icon: const Icon(Icons.home_rounded),
                label: const Text('Kembali ke dashboard'),
                style: FilledButton.styleFrom(
                  backgroundColor: _brandBlue,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
