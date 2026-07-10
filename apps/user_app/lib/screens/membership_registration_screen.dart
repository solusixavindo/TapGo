part of '../main.dart';

class MembershipRegistrationScreen extends ConsumerStatefulWidget {
  const MembershipRegistrationScreen({required this.package, super.key});

  final MembershipPackageModel package;

  @override
  ConsumerState<MembershipRegistrationScreen> createState() =>
      _MembershipRegistrationScreenState();
}

class _MembershipRegistrationScreenState
    extends ConsumerState<MembershipRegistrationScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _phoneController;
  late final TextEditingController _emailController;
  final _addressController = TextEditingController();
  final _ktpController = TextEditingController();
  final _birthPlaceController = TextEditingController();
  final _birthDateController = TextEditingController();
  final _referralController = TextEditingController();
  final _imagePicker = ImagePicker();
  String _gender = 'Laki-laki';
  _PickedDemoDocument? _ktpDocument;
  _PickedDemoDocument? _selfieDocument;
  bool _creatingOrder = false;

  @override
  void initState() {
    super.initState();
    final session = ref.read(_demoSessionProvider);
    _nameController = TextEditingController(text: session.userName);
    _phoneController = TextEditingController(text: session.phone);
    _emailController = TextEditingController(
      text: session.email ?? '',
    );
    _loadSponsorReferralCode();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _addressController.dispose();
    _ktpController.dispose();
    _birthPlaceController.dispose();
    _birthDateController.dispose();
    _referralController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return _DemoScaffold(
      title: 'Form Membership',
      subtitle: 'Paket ${widget.package.name}',
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _CheckoutSummaryCard(package: widget.package),
            const SizedBox(height: 14),
            _InputField(
              controller: _nameController,
              icon: Icons.person_rounded,
              label: 'Nama lengkap',
              hint: 'Nama sesuai KTP',
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            _InputField(
              controller: _phoneController,
              icon: Icons.phone_rounded,
              label: 'Nomor HP',
              hint: '0812xxxx',
              keyboardType: TextInputType.phone,
              validator: _phoneValidator,
            ),
            const SizedBox(height: 12),
            _InputField(
              controller: _emailController,
              icon: Icons.email_rounded,
              label: 'Email',
              hint: 'member@tapgo.id',
              keyboardType: TextInputType.emailAddress,
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            _InputField(
              controller: _addressController,
              icon: Icons.location_on_rounded,
              label: 'Alamat lengkap',
              hint: 'Alamat domisili',
              validator: _requiredValidator,
            ),
            const SizedBox(height: 12),
            _InputField(
              controller: _ktpController,
              icon: Icons.badge_rounded,
              label: 'Nomor KTP',
              hint: '16 digit',
              keyboardType: TextInputType.number,
              validator: _ktpValidator,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _InputField(
                    controller: _birthPlaceController,
                    icon: Icons.place_rounded,
                    label: 'Tempat lahir',
                    hint: 'Jakarta',
                    validator: _requiredValidator,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _InputField(
                    controller: _birthDateController,
                    icon: Icons.calendar_month_rounded,
                    label: 'Tanggal lahir',
                    hint: 'DD-MM-YYYY',
                    validator: _requiredValidator,
                    readOnly: true,
                    onTap: _pickBirthDate,
                    suffixIcon: IconButton(
                      onPressed: _pickBirthDate,
                      icon: const Icon(Icons.date_range_rounded),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _gender,
              items: const [
                DropdownMenuItem(value: 'Laki-laki', child: Text('Laki-laki')),
                DropdownMenuItem(value: 'Perempuan', child: Text('Perempuan')),
              ],
              onChanged: (value) => setState(() => _gender = value ?? _gender),
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.wc_rounded, color: _brandBlue),
                labelText: 'Jenis kelamin',
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(18),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: 12),
            _InputField(
              controller: _referralController,
              icon: Icons.qr_code_rounded,
              label: 'Kode referral optional',
              hint: 'TAPGO123',
            ),
            const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _UploadDocumentField(
                    label: 'KTP',
                    emptyButtonLabel: 'Upload KTP',
                    filledButtonLabel: 'Ganti KTP',
                    document: _ktpDocument,
                    onTap: () => _showUploadOptions(_DocumentKind.ktp),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _UploadDocumentField(
                    label: 'Foto Diri',
                    emptyButtonLabel: 'Upload Foto Diri',
                    filledButtonLabel: 'Ganti Foto Diri',
                    document: _selfieDocument,
                    onTap: () => _showUploadOptions(_DocumentKind.selfie),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: _creatingOrder ? null : _continueToCheckout,
              icon: const Icon(Icons.receipt_long_rounded),
              label: Text(
                _creatingOrder ? 'Menyiapkan invoice...' : 'Lanjut ke checkout',
              ),
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
    );
  }

  Future<void> _pickBirthDate() async {
    final now = DateTime.now();
    final selected = await showDatePicker(
      context: context,
      initialDate: DateTime(now.year - 25, now.month, now.day),
      firstDate: DateTime(1940),
      lastDate: DateTime(now.year - 17, now.month, now.day),
      helpText: 'Pilih tanggal lahir',
    );
    if (selected == null || !mounted) {
      return;
    }
    _birthDateController.text =
        '${selected.day.toString().padLeft(2, '0')}-${selected.month.toString().padLeft(2, '0')}-${selected.year}';
  }

  Future<void> _continueToCheckout() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    if (_ktpDocument == null || _selfieDocument == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Upload KTP dan foto diri wajib dipilih.'),
        ),
      );
      return;
    }

    final form = RegistrationFormModel(
      fullName: _nameController.text.trim(),
      phone: _phoneController.text.trim(),
      email: _emailController.text.trim(),
      address: _addressController.text.trim(),
      ktpNumber: _ktpController.text.trim(),
      birthPlace: _birthPlaceController.text.trim(),
      birthDate: _birthDateController.text.trim(),
      gender: _gender,
      referralCode: _referralController.text.trim(),
      packageName: widget.package.name,
    );
    InvoiceModel invoice = InvoiceModel(
      number: _generateInvoiceNumber(),
      memberName: form.fullName,
      packageName: widget.package.name,
      packagePrice: widget.package.price,
      benefits: widget.package.benefits,
      adminFee: 0,
      total: widget.package.price,
      status: PaymentStatus.waitingPayment,
    );

    setState(() => _creatingOrder = true);
    try {
      invoice = await _createBackendOrderIfAvailable(form, invoice);
    } finally {
      if (mounted) {
        setState(() => _creatingOrder = false);
      }
    }

    if (!mounted) {
      return;
    }
    _openDemo(context, CheckoutScreen(form: form, invoice: invoice));
  }

  Future<void> _loadSponsorReferralCode() async {
    final token = ref.read(_demoSessionProvider).accessToken;
    if (token == null || token.isEmpty) {
      return;
    }
    try {
      _apiClient.setAccessToken(token);
      final uplink = await _apiClient.referralUplink();
      if (!mounted || uplink.isEmpty || _referralController.text.isNotEmpty) {
        return;
      }
      final sponsorCode = uplink.first['referralCode']?.toString();
      if (sponsorCode != null && sponsorCode.isNotEmpty) {
        _referralController.text = sponsorCode;
      }
    } catch (_) {}
  }

  Future<InvoiceModel> _createBackendOrderIfAvailable(
    RegistrationFormModel form,
    InvoiceModel fallbackInvoice,
  ) async {
    final session = ref.read(_demoSessionProvider);
    final token = session.accessToken;
    if (token == null || token.isEmpty || session.isDemoMode) {
      return fallbackInvoice;
    }

    try {
      _apiClient.setAccessToken(token);
      final packages = await _apiClient.membershipPackages();
      Map<String, dynamic>? packageData;
      for (final item in packages) {
        final name = item['name']?.toString().toLowerCase();
        final tier = item['tier']?.toString().toLowerCase();
        if (name == widget.package.name.toLowerCase() ||
            tier == widget.package.name.toLowerCase()) {
          packageData = item;
          break;
        }
      }
      final packageId = packageData?['id']?.toString();
      if (packageId == null || packageId.isEmpty) {
        throw StateError('Paket backend tidak ditemukan.');
      }

      final order = await _apiClient.createMembershipOrder(
        packageId: packageId,
        registrationData: {
          'fullName': form.fullName,
          'phone': form.phone,
          'email': form.email,
          'address': form.address,
          'ktpNumber': form.ktpNumber,
          'birthPlace': form.birthPlace,
          'birthDate': form.birthDate,
          'gender': form.gender,
          'referralCode': form.referralCode,
          'ktpImagePath': _ktpDocument?.path,
          'selfieImagePath': _selfieDocument?.path,
        },
      );
      final invoice = (order['invoice'] as Map?)?.cast<String, dynamic>();
      return fallbackInvoice.copyWith(
        number: invoice?['number']?.toString(),
        backendOrderId: order['id']?.toString(),
        paymentRedirectUrl: null,
      );
    } on DioException catch (error) {
      final responseData = _dioResponseDataMap(error.response?.data);
      final code = responseData?['code']?.toString();
      if (code == 'MEMBERSHIP_ORDER_PENDING') {
        final pending =
            await _latestPendingOrderForPackage(widget.package.name);
        if (pending != null) {
          final invoice = (pending['invoice'] as Map?)?.cast<String, dynamic>();
          return fallbackInvoice.copyWith(
            number: invoice?['number']?.toString(),
            backendOrderId: pending['id']?.toString(),
            paymentRedirectUrl: null,
          );
        }
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Backend payment belum siap. Simulator development digunakan. ${responseData?['message'] ?? error.message}',
            ),
          ),
        );
      }
      return fallbackInvoice;
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Backend payment belum siap. Simulator development digunakan. $error',
            ),
          ),
        );
      }
      return fallbackInvoice;
    }
  }

  Map<String, dynamic>? _dioResponseDataMap(Object? data) {
    if (data is Map<String, dynamic>) {
      return data;
    }
    if (data is Map) {
      return data.cast<String, dynamic>();
    }
    return null;
  }

  Future<Map<String, dynamic>?> _latestPendingOrderForPackage(
    String packageName,
  ) async {
    final orders = await _apiClient.membershipOrders();
    for (final order in orders) {
      final status = order['status']?.toString().toUpperCase();
      final membership =
          (order['membership'] as Map?)?.cast<String, dynamic>() ?? {};
      final tier = membership['tier']?.toString().toLowerCase();
      final name = membership['name']?.toString().toLowerCase();
      if (status == 'PENDING' &&
          (tier == packageName.toLowerCase() ||
              name == packageName.toLowerCase())) {
        return order;
      }
    }
    return null;
  }

  String _generateInvoiceNumber() {
    final now = DateTime.now();
    return 'INV-${now.month.toString().padLeft(2, '0')}${now.day.toString().padLeft(2, '0')}-${now.millisecondsSinceEpoch.toString().substring(8)}';
  }

  String? _requiredValidator(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'Field wajib diisi';
    }
    return null;
  }

  String? _phoneValidator(String? value) {
    final phone = value?.trim() ?? '';
    final digits = phone.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length < 10 ||
        !(phone.startsWith('08') || phone.startsWith('+62'))) {
      return 'Nomor HP tidak valid';
    }
    return null;
  }

  String? _ktpValidator(String? value) {
    final digits = (value ?? '').replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length < 16) {
      return 'Nomor KTP minimal 16 digit';
    }
    return null;
  }

  Future<void> _showUploadOptions(_DocumentKind kind) async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading:
                    const Icon(Icons.photo_library_rounded, color: _brandBlue),
                title: const Text('Pilih dari Galeri'),
                onTap: () => Navigator.of(context).pop(ImageSource.gallery),
              ),
              ListTile(
                leading:
                    const Icon(Icons.photo_camera_rounded, color: _brandOrange),
                title: const Text('Ambil Foto dengan Kamera'),
                onTap: () => Navigator.of(context).pop(ImageSource.camera),
              ),
              ListTile(
                leading:
                    const Icon(Icons.close_rounded, color: Color(0xFF697386)),
                title: const Text('Batal'),
                onTap: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ),
      ),
    );

    if (source == null) {
      return;
    }

    try {
      final image = await _imagePicker.pickImage(
        source: source,
        imageQuality: 82,
        maxWidth: 1400,
      );
      if (!mounted || image == null) {
        _showUploadMessage('Pemilihan foto dibatalkan.');
        return;
      }
      _setPickedDocument(
        kind,
        _PickedDemoDocument(
          path: image.path,
          fileName: image.name,
          statusLabel: source == ImageSource.gallery
              ? 'Foto berhasil dipilih'
              : 'Foto berhasil diambil',
        ),
      );
    } on MissingPluginException {
      _setPickedDocument(
        kind,
        _PickedDemoDocument(
          path: null,
          fileName: source == ImageSource.gallery
              ? 'foto-galeri.jpg'
              : 'foto-kamera.jpg',
          statusLabel: source == ImageSource.gallery
              ? 'Foto berhasil dipilih'
              : 'Foto berhasil diambil',
        ),
      );
    } on PlatformException catch (error) {
      if (error.code == 'channel-error' || error.code == 'missing_plugin') {
        _setPickedDocument(
          kind,
          _PickedDemoDocument(
            path: null,
            fileName: source == ImageSource.gallery
                ? 'foto-galeri.jpg'
                : 'foto-kamera.jpg',
            statusLabel: source == ImageSource.gallery
                ? 'Foto berhasil dipilih'
                : 'Foto berhasil diambil',
          ),
        );
        return;
      }
      _showUploadMessage(
        error.message ?? 'Permission ditolak atau media tidak tersedia.',
      );
    } catch (_) {
      _showUploadMessage('Foto belum bisa dipilih. Silakan coba lagi.');
    }
  }

  void _setPickedDocument(_DocumentKind kind, _PickedDemoDocument document) {
    final current = ref.read(_demoSessionProvider);
    final updatedSession = kind == _DocumentKind.ktp
        ? current.copyWith(ktpImagePath: document.path)
        : current.copyWith(selfieImagePath: document.path);
    ref.read(_demoSessionProvider.notifier).state = updatedSession;
    setState(() {
      if (kind == _DocumentKind.ktp) {
        _ktpDocument = document;
      } else {
        _selfieDocument = document;
      }
    });
    _persistentStore.saveDocument(kind.name, document);
    _persistentStore.saveSession(updatedSession);
    _persistentStore.saveMembershipSnapshot(updatedSession);
    _persistentStore.saveRegisteredUser(updatedSession);
  }

  void _showUploadMessage(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }
}

enum _DocumentKind { ktp, selfie }

class _PickedDemoDocument {
  const _PickedDemoDocument({
    required this.path,
    required this.fileName,
    required this.statusLabel,
  });

  final String? path;
  final String fileName;
  final String statusLabel;
}
