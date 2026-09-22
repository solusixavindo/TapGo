part of '../../../main.dart';

/// Titik masuk pengajuan mitra pada tab Akun / layar kapabilitas.
///
/// Menggantikan [DriverDocumentsSection] + bekas `DriverApplicationSection`
/// yang sebelumnya ditumpuk langsung di layar (dengan urutan yang berbeda
/// di dua tempat pemakaiannya) — sekarang satu kartu status/CTA saja, dan
/// seluruh alur unggah dokumen + data diri + data kendaraan + pernyataan
/// dipindah ke [DriverApplicationWizardScreen] yang konsisten di mana pun
/// dibuka dari.
class DriverApplicationEntryPoint extends ConsumerStatefulWidget {
  const DriverApplicationEntryPoint({super.key});

  @override
  ConsumerState<DriverApplicationEntryPoint> createState() =>
      _DriverApplicationEntryPointState();
}

class _DriverApplicationEntryPointState
    extends ConsumerState<DriverApplicationEntryPoint> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(driverControllerProvider.notifier).refreshApplication();
    });
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

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(driverControllerProvider);
    final application = state.application;

    if (application != null && application.status.isOpen) {
      return _OpenApplicationCard(
        application: application,
        plateMasked: state.vehiclePlateMasked,
        busy: state.isBusy,
        onWithdraw: _confirmWithdraw,
      );
    }

    return Card(
      key: const ValueKey('driver-application-entry'),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
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
            const Text(
              'Lengkapi dokumen, data diri, data kendaraan, dan pernyataan '
              'untuk mengajukan diri sebagai mitra driver.',
            ),
            const SizedBox(height: 16),
            FilledButton(
              key: const ValueKey('start-application-wizard'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const DriverApplicationWizardScreen(),
                ),
              ),
              child: const Text('Ajukan Jadi Mitra Driver'),
            ),
          ],
        ),
      ),
    );
  }
}

const List<DriverDocumentKind> _kCoreDocumentKinds = [
  DriverDocumentKind.ktp,
  DriverDocumentKind.sim,
  DriverDocumentKind.stnk,
  DriverDocumentKind.selfie,
];

/// Wizard 5 langkah: Upload Dokumen -> Data Diri -> Data Kendaraan ->
/// Upload Data Tambahan (SKCK) -> Pernyataan. Setiap langkah menyimpan
/// input-nya di state widget ini (bukan provider) — hanya dikirim ke
/// server sekali, di langkah terakhir.
class DriverApplicationWizardScreen extends ConsumerStatefulWidget {
  const DriverApplicationWizardScreen({super.key});

  @override
  ConsumerState<DriverApplicationWizardScreen> createState() =>
      _DriverApplicationWizardScreenState();
}

class _DriverApplicationWizardScreenState
    extends ConsumerState<DriverApplicationWizardScreen> {
  static const _pageCount = 5;

  static bool _isValidPlate(String? value) {
    final cleaned = (value ?? '').trim().toUpperCase();
    return RegExp(r'^[A-Z0-9][A-Z0-9 -]{2,11}$').hasMatch(cleaned);
  }

  final _pageController = PageController();
  int _page = 0;

  // Halaman 2 — Data Diri (validasi manual di _canAdvanceFrom, tidak perlu
  // Form/validator karena field opsional tidak punya aturan format).
  final _fullNameController = TextEditingController();
  final _addressController = TextEditingController();
  final _emergencyContactNameController = TextEditingController();
  final _emergencyContactPhoneController = TextEditingController();
  DateTime? _dateOfBirth;

  // Halaman 3 — Data Kendaraan.
  final _dataDiriFormKey = GlobalKey<FormState>();
  final _vehicleFormKey = GlobalKey<FormState>();
  final _plateController = TextEditingController();
  final _colorController = TextEditingController();
  String _serviceType = 'MOTORCYCLE';
  String? _brand;
  String? _model;

  // Halaman 5 — Pernyataan.
  bool _declarationAccepted = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(driverControllerProvider.notifier).refreshDocuments();
    });
  }

  @override
  void dispose() {
    _pageController.dispose();
    _fullNameController.dispose();
    _addressController.dispose();
    _emergencyContactNameController.dispose();
    _emergencyContactPhoneController.dispose();
    _plateController.dispose();
    _colorController.dispose();
    super.dispose();
  }

  bool _canAdvanceFrom(int page, DriverState state) {
    switch (page) {
      case 0:
        return _kCoreDocumentKinds
            .every((kind) => state.documentOf(kind)?.available == true);
      case 1:
        // Seluruh field Data Diri wajib diisi — tidak ada yang opsional.
        return _fullNameController.text.trim().isNotEmpty &&
            _addressController.text.trim().isNotEmpty &&
            _dateOfBirth != null &&
            _emergencyContactNameController.text.trim().isNotEmpty &&
            _emergencyContactPhoneController.text.trim().isNotEmpty;
      case 2:
        // Dicek langsung dari controller, bukan lewat
        // GlobalKey<FormState>.currentState?.validate() — halaman yang
        // sedang tidak tampil di PageView bisa saja belum ter-mount, dan
        // canAdvance dihitung dari _page manapun tanpa syarat itu.
        return _isValidPlate(_plateController.text);
      case 3:
        return state.documentOf(DriverDocumentKind.skck)?.available == true;
      case 4:
        return _declarationAccepted;
      default:
        return true;
    }
  }

  void _goNext(DriverState state) {
    if (!_canAdvanceFrom(_page, state)) return;
    if (_page == _pageCount - 1) {
      unawaited(_submit());
      return;
    }
    _pageController.nextPage(
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
    );
  }

  void _goBack() {
    if (_page == 0) {
      Navigator.of(context).pop();
      return;
    }
    _pageController.previousPage(
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
    );
  }

  Future<void> _submit() async {
    final controller = ref.read(driverControllerProvider.notifier);
    await controller.submitApplication(
      serviceType: _serviceType,
      plateNumber: _plateController.text,
      brand: _brand,
      model: _model,
      color: _colorController.text.trim(),
      fullName: _fullNameController.text.trim(),
      dateOfBirth: _dateOfBirth?.toIso8601String().split('T').first,
      address: _addressController.text.trim(),
      emergencyContactName: _emergencyContactNameController.text.trim(),
      emergencyContactPhone: _emergencyContactPhoneController.text.trim(),
      declarationAccepted: _declarationAccepted,
    );
    if (!mounted) return;
    final message = ref.read(driverControllerProvider).message;
    if (message != null && message.contains('terkirim')) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(driverControllerProvider);
    final canAdvance = _canAdvanceFrom(_page, state);
    final isLastPage = _page == _pageCount - 1;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pengajuan Mitra Driver'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: _goBack,
        ),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(
                _pageCount,
                (index) => AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  width: index == _page ? 24 : 8,
                  height: 8,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(4),
                    color: index == _page
                        ? Theme.of(context).colorScheme.primary
                        : Theme.of(context).colorScheme.outlineVariant,
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: PageView(
              key: const ValueKey('driver-application-wizard-pageview'),
              controller: _pageController,
              physics: const NeverScrollableScrollPhysics(),
              onPageChanged: (index) => setState(() => _page = index),
              children: [
                const _WizardStep(
                  title: 'Upload Dokumen',
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 20),
                    child: DriverDocumentsSection(
                      kinds: _kCoreDocumentKinds,
                    ),
                  ),
                ),
                _WizardStep(title: 'Data Diri', child: _buildDataDiriForm()),
                _WizardStep(
                  title: 'Data Kendaraan',
                  child: _buildVehicleForm(),
                ),
                const _WizardStep(
                  title: 'Upload Data Tambahan (SKCK)',
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 20),
                    child: DriverDocumentsSection(
                      kinds: [DriverDocumentKind.skck],
                      showHeader: false,
                    ),
                  ),
                ),
                _WizardStep(
                  title: 'Pernyataan',
                  child: _buildDeclaration(),
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
              child: FilledButton(
                key: const ValueKey('driver-application-wizard-next'),
                onPressed: state.isBusy || !canAdvance
                    ? null
                    : () => _goNext(state),
                child: state.isBusy
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(isLastPage ? 'Kirim Pengajuan' : 'Lanjut'),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDataDiriForm() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Form(
        key: _dataDiriFormKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextFormField(
              key: const ValueKey('wizard-full-name'),
              controller: _fullNameController,
              decoration: const InputDecoration(labelText: 'Nama lengkap'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const ValueKey('wizard-address'),
              controller: _addressController,
              maxLines: 2,
              decoration: const InputDecoration(labelText: 'Alamat domisili'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            InkWell(
              key: const ValueKey('wizard-date-of-birth'),
              onTap: () async {
                final now = DateTime.now();
                final picked = await showDatePicker(
                  context: context,
                  initialDate: _dateOfBirth ?? DateTime(now.year - 25),
                  firstDate: DateTime(now.year - 100),
                  lastDate: now,
                );
                if (picked != null) setState(() => _dateOfBirth = picked);
              },
              child: InputDecorator(
                decoration: const InputDecoration(labelText: 'Tanggal lahir'),
                child: Text(
                  _dateOfBirth == null
                      ? 'Ketuk untuk memilih'
                      : '${_dateOfBirth!.day}/${_dateOfBirth!.month}/${_dateOfBirth!.year}',
                ),
              ),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const ValueKey('wizard-emergency-name'),
              controller: _emergencyContactNameController,
              decoration:
                  const InputDecoration(labelText: 'Nama kontak darurat'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const ValueKey('wizard-emergency-phone'),
              controller: _emergencyContactPhoneController,
              keyboardType: TextInputType.phone,
              decoration:
                  const InputDecoration(labelText: 'Nomor kontak darurat'),
              onChanged: (_) => setState(() {}),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildVehicleForm() {
    final brandModels = vehicleBrandModelsFor(_serviceType);
    final models = _brand == null ? const <String>[] : brandModels[_brand] ?? const [];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Form(
        key: _vehicleFormKey,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<String>(
              key: const ValueKey('wizard-service-type'),
              initialValue: _serviceType,
              decoration: const InputDecoration(labelText: 'Jenis layanan'),
              items: const [
                DropdownMenuItem(value: 'MOTORCYCLE', child: Text('Motor')),
                DropdownMenuItem(value: 'CAR', child: Text('Mobil')),
              ],
              onChanged: (value) {
                if (value == null) return;
                setState(() {
                  _serviceType = value;
                  _brand = null;
                  _model = null;
                });
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const ValueKey('wizard-plate'),
              controller: _plateController,
              textCapitalization: TextCapitalization.characters,
              decoration:
                  const InputDecoration(labelText: 'Nomor plat kendaraan'),
              onChanged: (_) => setState(() {}),
              validator: (value) =>
                  _isValidPlate(value) ? null : 'Nomor plat tidak valid',
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: const ValueKey('wizard-brand'),
              initialValue: _brand,
              decoration: const InputDecoration(labelText: 'Merek (opsional)'),
              items: brandModels.keys
                  .map((brand) =>
                      DropdownMenuItem(value: brand, child: Text(brand)))
                  .toList(),
              onChanged: (value) => setState(() {
                _brand = value;
                _model = null;
              }),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: const ValueKey('wizard-model'),
              initialValue: _model,
              decoration: const InputDecoration(labelText: 'Model (opsional)'),
              items: models
                  .map((model) =>
                      DropdownMenuItem(value: model, child: Text(model)))
                  .toList(),
              onChanged: models.isEmpty
                  ? null
                  : (value) => setState(() => _model = value),
            ),
            const SizedBox(height: 12),
            TextFormField(
              key: const ValueKey('wizard-color'),
              controller: _colorController,
              decoration: const InputDecoration(labelText: 'Warna (opsional)'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDeclaration() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Dengan mengirim pengajuan ini, saya menyatakan bahwa:\n\n'
            '1. Seluruh data dan dokumen yang saya lampirkan adalah benar '
            'dan sesuai identitas asli saya.\n'
            '2. Saya bersedia mematuhi kebijakan dan standar layanan TapGo '
            'sebagai mitra driver.\n'
            '3. Saya memahami bahwa data yang tidak sesuai dapat '
            'menyebabkan pengajuan ditolak atau akun dinonaktifkan.',
          ),
          const SizedBox(height: 16),
          CheckboxListTile(
            key: const ValueKey('wizard-declaration-checkbox'),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            value: _declarationAccepted,
            onChanged: (value) =>
                setState(() => _declarationAccepted = value ?? false),
            title: const Text('Saya menyetujui pernyataan di atas.'),
          ),
        ],
      ),
    );
  }
}

class _WizardStep extends StatelessWidget {
  const _WizardStep({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
            child: Text(
              title,
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
          ),
          child,
        ],
      ),
    );
  }
}
