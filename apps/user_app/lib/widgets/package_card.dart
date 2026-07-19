part of '../main.dart';

class _CheckoutSummaryCard extends StatelessWidget {
  const _CheckoutSummaryCard({required this.package});

  final MembershipPackageModel package;

  @override
  Widget build(BuildContext context) {
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
                  package.name,
                  style: const TextStyle(
                    color: Color(0xFF0A2A43),
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Text(
                package.price == 0 ? 'Gratis' : formatRupiah(package.price),
                style: const TextStyle(
                  color: _brandBlue,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
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

class _MembershipPackageCard extends StatelessWidget {
  const _MembershipPackageCard({
    required this.package,
    required this.selected,
    required this.onSelected,
  });

  final _MembershipPackage package;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    return AnimatedScale(
      scale: selected && !_TapGoMotion.reduce(context) ? 0.992 : 1,
      duration: _TapGoMotion.duration(context, _TapGoMotion.fast),
      curve: _TapGoMotion.standardCurve,
      child: AnimatedContainer(
        duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
        curve: _TapGoMotion.standardCurve,
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(
            color: selected
                ? package.accent.withValues(alpha: 0.42)
                : Colors.transparent,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    package.name,
                    style: TextStyle(
                      color: package.accent,
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                Text(
                  package.price,
                  style: const TextStyle(
                    color: Color(0xFF0A2A43),
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: package.benefits
                  .map((benefit) => _BenefitChip(label: benefit))
                  .toList(),
            ),
            const SizedBox(height: 14),
            _PackageRow(label: 'Bonus sponsor', value: package.sponsorBonus),
            _PackageRow(label: 'Bonus level', value: package.levelBonus),
            _PackageRow(label: 'Saldo PPOB', value: package.ppobBalance),
            _PackageRow(label: 'BPJS', value: package.bpjsBenefit),
            _PackageRow(label: 'Hak usaha', value: package.businessRight),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: onSelected,
                icon: const Icon(Icons.app_registration_rounded),
                label: const Text('Daftar'),
                style: FilledButton.styleFrom(
                  backgroundColor: package.accent,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
