part of '../../../main.dart';

/// Bagian pengajuan mitra (H1): status pengajuan aktif + form kendaraan.
///
/// Ditampilkan pada layar capability (pending/rejected) — saat driver paling
/// membutuhkan jalur memperbaiki atau mengirim pengajuannya. Form kendaraan
/// hanya muncul bila belum ada pengajuan terbuka; bila sudah ada, yang
/// ditampilkan adalah statusnya dan pilihan menarik pengajuan.
class DriverApplicationSection extends ConsumerStatefulWidget {
  const DriverApplicationSection({super.key});

  @override
  ConsumerState<DriverApplicationSection> createState() =>
      _DriverApplicationSectionState();
}

class _DriverApplicationSectionState
    extends ConsumerState<DriverApplicationSection> {
  final _formKey = GlobalKey<FormState>();
  final _plateController = TextEditingController();
  final _brandController = TextEditingController();
  final _modelController = TextEditingController();
  final _colorController = TextEditingController();
  String _serviceType = 'MOTORCYCLE';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(driverControllerProvider.notifier).refreshApplication();
    });
  }

  @override
  void dispose() {
    _plateController.dispose();
    _brandController.dispose();
    _modelController.dispose();
    _colorController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(driverControllerProvider);
    final application = state.application;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Pengajuan Mitra',
          style: Theme.of(context)
              .textTheme
              .titleMedium
              ?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        if (application != null && application.status.isOpen)
          _OpenApplicationCard(
            application: application,
            plateMasked: state.vehiclePlateMasked,
            busy: state.isBusy,
            onWithdraw: _confirmWithdraw,
          )
        else
          _ApplicationForm(
            formKey: _formKey,
            plateController: _plateController,
            brandController: _brandController,
            modelController: _modelController,
            colorController: _colorController,
            serviceType: _serviceType,
            documentsComplete: state.documentsComplete,
            busy: state.isBusy,
            onServiceTypeChanged: (value) =>
                setState(() => _serviceType = value),
            onSubmit: _submit,
          ),
      ],
    );
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    await ref.read(driverControllerProvider.notifier).submitApplication(
          serviceType: _serviceType,
          plateNumber: _plateController.text,
          brand: _brandController.text.trim(),
          model: _modelController.text.trim(),
          color: _colorController.text.trim(),
        );
  }

  Future<void> _confirmWithdraw() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Tarik pengajuan?'),
        content: const Text(
          'Pengajuan yang ditarik tidak lagi diproses. Anda bisa mengajukan lagi kapan saja.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Tarik'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await ref.read(driverControllerProvider.notifier).withdrawApplication();
  }
}

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

class _ApplicationForm extends StatelessWidget {
  const _ApplicationForm({
    required this.formKey,
    required this.plateController,
    required this.brandController,
    required this.modelController,
    required this.colorController,
    required this.serviceType,
    required this.documentsComplete,
    required this.busy,
    required this.onServiceTypeChanged,
    required this.onSubmit,
  });

  final GlobalKey<FormState> formKey;
  final TextEditingController plateController;
  final TextEditingController brandController;
  final TextEditingController modelController;
  final TextEditingController colorController;
  final String serviceType;
  final bool documentsComplete;
  final bool busy;
  final ValueChanged<String> onServiceTypeChanged;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const ValueKey('driver-application-form'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!documentsComplete)
                const Padding(
                  padding: EdgeInsets.only(bottom: 12),
                  child: Text(
                    'Lengkapi keempat dokumen di atas dulu, lalu isi data kendaraan Anda.',
                  ),
                ),
              DropdownButtonFormField<String>(
                key: const ValueKey('driver-application-service-type'),
                initialValue: serviceType,
                decoration: const InputDecoration(labelText: 'Jenis layanan'),
                items: const [
                  DropdownMenuItem(
                      value: 'MOTORCYCLE', child: Text('Motor')),
                  DropdownMenuItem(value: 'CAR', child: Text('Mobil')),
                ],
                onChanged: (value) {
                  if (value != null) onServiceTypeChanged(value);
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const ValueKey('driver-application-plate'),
                controller: plateController,
                textCapitalization: TextCapitalization.characters,
                decoration:
                    const InputDecoration(labelText: 'Nomor plat kendaraan'),
                validator: (value) {
                  final cleaned = (value ?? '').trim().toUpperCase();
                  if (!RegExp(r'^[A-Z0-9][A-Z0-9 -]{2,11}$')
                      .hasMatch(cleaned)) {
                    return 'Nomor plat tidak valid';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const ValueKey('driver-application-brand'),
                controller: brandController,
                decoration: const InputDecoration(
                    labelText: 'Merek (opsional)'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const ValueKey('driver-application-model'),
                controller: modelController,
                decoration: const InputDecoration(
                    labelText: 'Model (opsional)'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: const ValueKey('driver-application-color'),
                controller: colorController,
                decoration:
                    const InputDecoration(labelText: 'Warna (opsional)'),
              ),
              const SizedBox(height: 16),
              FilledButton(
                key: const ValueKey('driver-application-submit'),
                onPressed: busy || !documentsComplete ? null : onSubmit,
                child: const Text('Kirim Pengajuan'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
