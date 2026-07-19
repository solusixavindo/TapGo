part of '../main.dart';

class _InvoiceCard extends StatelessWidget {
  const _InvoiceCard({required this.invoice, required this.package});

  final InvoiceModel invoice;
  final MembershipPackageModel package;

  @override
  Widget build(BuildContext context) {
    final statusText =
        invoice.status == PaymentStatus.paid ? 'Lunas' : 'Menunggu Pembayaran';

    return AnimatedContainer(
      duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
      curve: _TapGoMotion.standardCurve,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  invoice.number,
                  style: const TextStyle(
                    color: Color(0xFF0A2A43),
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              _TapGoFadeSwitcher(
                valueKey: statusText,
                child: _LevelChip(
                  label: statusText,
                  active: invoice.status == PaymentStatus.paid,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _PackageRow(label: 'Nama member', value: invoice.memberName),
          _PackageRow(label: 'Paket', value: invoice.packageName),
          _PackageRow(
              label: 'Harga paket', value: formatRupiah(invoice.packagePrice)),
          _PackageRow(
              label: 'Admin fee', value: formatRupiah(invoice.adminFee)),
          const Divider(height: 24),
          _PackageRow(label: 'Total', value: formatRupiah(invoice.total)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: package.benefits
                .map((benefit) => _BenefitChip(label: benefit))
                .toList(),
          ),
        ],
      ),
    );
  }
}

class _PaymentMethodTile extends StatelessWidget {
  const _PaymentMethodTile({
    required this.title,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String title;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(18),
          child: AnimatedContainer(
            duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
            curve: _TapGoMotion.standardCurve,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: selected
                    ? _brandBlue.withValues(alpha: 0.24)
                    : Colors.transparent,
              ),
            ),
            child: Row(
              children: [
                AnimatedContainer(
                  duration:
                      _TapGoMotion.duration(context, _TapGoMotion.standard),
                  curve: _TapGoMotion.standardCurve,
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: selected
                        ? _brandBlue.withValues(alpha: 0.12)
                        : _softBackground,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(icon, color: selected ? _brandBlue : Colors.grey),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      color: Color(0xFF0A2A43),
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                _TapGoFadeSwitcher(
                  valueKey: selected,
                  child: Icon(
                    selected
                        ? Icons.radio_button_checked_rounded
                        : Icons.radio_button_off_rounded,
                    color: selected ? _brandBlue : const Color(0xFF718096),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
