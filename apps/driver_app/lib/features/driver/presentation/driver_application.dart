part of '../../../main.dart';

/// Kartu status pengajuan terbuka — dipakai [DriverApplicationEntryPoint]
/// (lihat driver_application_wizard.dart) saat driver sudah punya pengajuan
/// yang masih berjalan, sehingga wizard tidak dibuka lagi dari awal.
class _OpenApplicationCard extends StatelessWidget {
  const _OpenApplicationCard({
    required this.application,
    required this.plateMasked,
    required this.busy,
    required this.onWithdraw,
  });

  final DriverApplicationInfo application;
  final String? plateMasked;
  final bool busy;
  final VoidCallback onWithdraw;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final statusLabel = switch (application.status) {
      DriverApplicationStatus.submitted => 'Terkirim — menunggu antrean tinjauan',
      DriverApplicationStatus.underReview => 'Sedang ditinjau tim TapGo',
      _ => 'Diproses',
    };
    return Card(
      key: const ValueKey('driver-application-open'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(Icons.fact_check_rounded, color: scheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Pengajuan #${application.cycleNumber}',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(statusLabel),
            if (plateMasked != null) ...[
              const SizedBox(height: 4),
              Text('Kendaraan: $plateMasked'),
            ],
            const SizedBox(height: 12),
            OutlinedButton(
              key: const ValueKey('driver-application-withdraw'),
              onPressed: busy ? null : onWithdraw,
              child: const Text('Tarik Pengajuan'),
            ),
          ],
        ),
      ),
    );
  }
}

