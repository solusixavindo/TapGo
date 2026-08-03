part of '../main.dart';

class TapGoRuntimeActivationResult {
  const TapGoRuntimeActivationResult({required this.authenticated});

  final bool authenticated;
}

class TapGoSessionPersistenceResult {
  const TapGoSessionPersistenceResult({
    required this.success,
    required this.failedSteps,
  });

  final bool success;
  final List<String> failedSteps;
}

class TapGoSessionPersistStep {
  const TapGoSessionPersistStep({required this.name, required this.persist});

  final String name;
  final Future<bool> Function(DemoClientSession session) persist;
}

class TapGoReferralClaimResult {
  const TapGoReferralClaimResult({required this.success, this.warningMessage});

  final bool success;
  final String? warningMessage;
}

class TapGoSingleFlightGuard {
  bool _isRunning = false;

  bool get isRunning => _isRunning;

  Future<T?> run<T>(Future<T> Function() action) async {
    if (_isRunning) {
      return null;
    }
    _isRunning = true;
    try {
      return await action();
    } finally {
      _isRunning = false;
    }
  }
}

final tapGoPhoneInputFormatters = <TextInputFormatter>[
  FilteringTextInputFormatter.allow(RegExp(r'[0-9+\s-]')),
];

final tapGoDigitsOnlyInputFormatters = <TextInputFormatter>[
  FilteringTextInputFormatter.digitsOnly,
];

final tapGoNikInputFormatters = <TextInputFormatter>[
  FilteringTextInputFormatter.digitsOnly,
  LengthLimitingTextInputFormatter(16),
];

final tapGoRupiahInputFormatters = <TextInputFormatter>[
  TapGoRupiahInputFormatter(),
];

String tapGoDigitsOnly(String? value) {
  return (value ?? '').replaceAll(RegExp(r'[^0-9]'), '');
}

String tapGoSanitizePhoneInput(String? value) {
  final clean = (value ?? '').trim();
  final hasLeadingPlus = clean.startsWith('+');
  final digits = tapGoDigitsOnly(clean);
  return hasLeadingPlus ? '+$digits' : digits;
}

bool tapGoIsValidIndonesianPhone(String? value) {
  final phone = tapGoSanitizePhoneInput(value);
  final digits = tapGoDigitsOnly(phone);
  if (digits.length < 10) {
    return false;
  }
  if (phone.startsWith('+')) {
    return phone.startsWith('+628');
  }
  return phone.startsWith('08') || phone.startsWith('628');
}

String? tapGoPhoneValidatorMessage(String? value) {
  final phone = tapGoSanitizePhoneInput(value);
  if (phone.isEmpty) {
    return 'Nomor HP wajib diisi';
  }
  return tapGoIsValidIndonesianPhone(phone) ? null : 'Nomor HP tidak valid';
}

String? tapGoNikValidatorMessage(String? value) {
  final digits = tapGoDigitsOnly(value);
  return digits.length == 16 ? null : 'NIK harus terdiri dari 16 digit.';
}

String? tapGoBankAccountValidatorMessage(String? value) {
  final digits = tapGoDigitsOnly(value);
  return digits.length >= 6 ? null : 'Nomor rekening tidak valid';
}

int tapGoCanonicalRupiahValue(String? value) {
  final digits = tapGoDigitsOnly(value);
  if (digits.isEmpty) {
    return 0;
  }
  return int.tryParse(digits) ?? 0;
}

String tapGoFormatRupiahInput(String? value) {
  final digitsOnly = tapGoDigitsOnly(value);
  if (digitsOnly.isEmpty) {
    return '';
  }
  final amount = tapGoCanonicalRupiahValue(value);
  if (amount == 0) {
    return '0';
  }
  final digits = amount.toString();
  final buffer = StringBuffer();
  for (var index = 0; index < digits.length; index++) {
    final remaining = digits.length - index;
    buffer.write(digits[index]);
    if (remaining > 1 && remaining % 3 == 1) {
      buffer.write('.');
    }
  }
  return buffer.toString();
}

int tapGoRupiahSelectionOffset(String formatted, int digitsBeforeCursor) {
  if (digitsBeforeCursor <= 0) {
    return 0;
  }
  var seenDigits = 0;
  for (var index = 0; index < formatted.length; index++) {
    if (_isAsciiDigit(formatted.codeUnitAt(index))) {
      seenDigits++;
    }
    if (seenDigits >= digitsBeforeCursor) {
      return index + 1;
    }
  }
  return formatted.length;
}

bool _isAsciiDigit(int codeUnit) => codeUnit >= 48 && codeUnit <= 57;

class TapGoRupiahInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final formatted = tapGoFormatRupiahInput(newValue.text);
    final cursorEnd = newValue.selection.extentOffset.clamp(
      0,
      newValue.text.length,
    );
    final digitsBeforeCursor = tapGoDigitsOnly(
      newValue.text.substring(0, cursorEnd),
    ).length;
    final selectionOffset = tapGoRupiahSelectionOffset(
      formatted,
      digitsBeforeCursor,
    );
    return TextEditingValue(
      text: formatted,
      selection: TextSelection.collapsed(offset: selectionOffset),
    );
  }
}

class _InvalidAuthResponseException implements Exception {
  const _InvalidAuthResponseException(this.message);

  final String message;

  @override
  String toString() => message;
}

@visibleForTesting
TapGoRuntimeActivationResult tapGoActivateAuthenticatedRuntimeSession({
  required DemoClientSession session,
  required void Function(DemoClientSession session) setSession,
  required void Function(bool authenticated) setAuthenticated,
  VoidCallback? afterAuthenticated,
}) {
  setSession(session);
  setAuthenticated(true);
  afterAuthenticated?.call();
  return const TapGoRuntimeActivationResult(authenticated: true);
}

@visibleForTesting
Future<TapGoSessionPersistenceResult>
    tapGoPersistAuthenticatedSessionBestEffort({
  required DemoClientSession session,
  required List<TapGoSessionPersistStep> steps,
  Duration stepTimeout = const Duration(seconds: 1),
}) async {
  final failedSteps = <String>[];
  for (final step in steps) {
    late final Future<bool> persistFuture;
    try {
      persistFuture = step.persist(session);
    } catch (error) {
      _tapGoDebugLog('[TapGo Auth] local_persistence ${step.name}: $error');
      failedSteps.add(step.name);
      continue;
    }
    try {
      final success = await persistFuture.timeout(
        stepTimeout,
        onTimeout: () => false,
      );
      if (!success) {
        failedSteps.add(step.name);
      }
    } catch (error) {
      _tapGoDebugLog('[TapGo Auth] local_persistence ${step.name}: $error');
      failedSteps.add(step.name);
    }
  }
  return TapGoSessionPersistenceResult(
    success: failedSteps.isEmpty,
    failedSteps: List.unmodifiable(failedSteps),
  );
}

@visibleForTesting
Future<TapGoReferralClaimResult> tapGoClaimReferralBestEffort({
  required String referralCode,
  required Future<Object?> Function(String referralCode) claimReferral,
}) async {
  if (referralCode.trim().isEmpty) {
    return const TapGoReferralClaimResult(success: true);
  }
  try {
    await claimReferral(referralCode);
    _tapGoDebugLog('[TapGo Auth] referral_claim success.');
    return const TapGoReferralClaimResult(success: true);
  } on DioException catch (error) {
    final data = _authResponseDataMap(error.response?.data);
    final code = data?['code']?.toString();
    if (code == 'REFERRAL_ALREADY_CLAIMED') {
      _tapGoDebugLog('[TapGo Auth] referral already persisted by backend.');
      return const TapGoReferralClaimResult(success: true);
    }
    _tapGoDebugLog('[TapGo Auth] referral_claim skipped: ${error.message}');
    return const TapGoReferralClaimResult(
      success: false,
      warningMessage:
          'Registrasi berhasil. Kode referral belum dapat diproses saat ini.',
    );
  } catch (error) {
    _tapGoDebugLog('[TapGo Auth] referral_claim skipped: $error');
    return const TapGoReferralClaimResult(
      success: false,
      warningMessage:
          'Registrasi berhasil. Kode referral belum dapat diproses saat ini.',
    );
  }
}

Map<String, dynamic>? _authResponseDataMap(Object? data) {
  if (data is Map<String, dynamic>) {
    return data;
  }
  if (data is Map) {
    return data.cast<String, dynamic>();
  }
  if (data is String && data.trim().isNotEmpty) {
    try {
      final decoded = jsonDecode(data);
      if (decoded is Map<String, dynamic>) {
        return decoded;
      }
      if (decoded is Map) {
        return decoded.cast<String, dynamic>();
      }
    } catch (_) {
      return {'message': data};
    }
  }
  return null;
}

void _validateAuthResult(_TapGoAuthResult authResult) {
  if ((authResult.accessToken ?? '').isEmpty) {
    throw const _InvalidAuthResponseException('Missing access token.');
  }
  if (authResult.user.id.isEmpty) {
    throw const _InvalidAuthResponseException('Missing user id.');
  }
}

class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key});

  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _referralController = TextEditingController();
  final _nameFocusNode = FocusNode();
  final _phoneFocusNode = FocusNode();
  final _passwordFocusNode = FocusNode();
  final _referralFocusNode = FocusNode();
  bool _isRegister = false;
  bool _isSubmitting = false;
  int _logoTapCount = 0;

  Future<void> _continueToDashboard() async {
    if (_isSubmitting) {
      return;
    }
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() => _isSubmitting = true);
    final authMode = _isRegister ? 'register' : 'login';
    try {
      _tapGoDebugLog('[TapGo Auth] auth_request:$authMode');
      final phone = tapGoSanitizePhoneInput(_phoneController.text);
      final authResult = _isRegister
          ? await _apiClient.register(
              name: _nameController.text.trim(),
              phone: phone,
              password: _passwordController.text,
              referralCode: tapGoIsDirectDistribution
                  ? _referralController.text.trim()
                  : null,
            )
          : await _apiClient.login(
              phone: phone,
              password: _passwordController.text,
            );
      _tapGoDebugLog('[TapGo Auth] auth_response_mapping:$authMode');
      _validateAuthResult(authResult);
      _apiClient.setAccessToken(authResult.accessToken);
      final referralCode =
          tapGoIsDirectDistribution ? _referralController.text.trim() : '';
      if (_isRegister &&
          referralCode.isNotEmpty &&
          (authResult.accessToken ?? '').isNotEmpty) {
        final referralResult = await tapGoClaimReferralBestEffort(
          referralCode: referralCode,
          claimReferral: _apiClient.claimReferral,
        );
        if (!referralResult.success && referralResult.warningMessage != null) {
          _showAuthWarning(referralResult.warningMessage!);
        }
      }
      var session = _sessionFromAuthUser(
        authResult.user,
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
      );
      if (authResult.user.name == 'Member TapGo' &&
          (authResult.accessToken ?? '').isNotEmpty) {
        try {
          final user = await _apiClient.me();
          session = _sessionFromAuthUser(
            user,
            accessToken: authResult.accessToken,
            refreshToken: authResult.refreshToken,
            fallback: session,
          );
        } catch (error) {
          _tapGoDebugLog('[TapGo Auth] profile refresh skipped: $error');
        }
      }
      try {
        session = await _persistentStore
            .restoreMembershipSnapshot(session)
            .timeout(const Duration(seconds: 1), onTimeout: () => session);
      } catch (error) {
        _tapGoDebugLog('[TapGo Auth] membership snapshot skipped: $error');
      }
      _tapGoDebugLog('[TapGo Auth] in_memory_session:$authMode');
      _activateAuthenticatedSession(session);
    } on DioException catch (error) {
      _tapGoDebugLog('[TapGo Auth] backend auth failed: ${error.message}');
      _tapGoDebugLog(
        '[TapGo Auth] error status: ${error.response?.statusCode}',
      );
      _tapGoDebugLog('[TapGo Auth] error body: <redacted>');
      _showAuthError(_authErrorMessage(error, isRegister: _isRegister));
    } on _InvalidAuthResponseException catch (error) {
      _tapGoDebugLog('[TapGo Auth] invalid auth response: ${error.message}');
      _apiClient.setAccessToken(null);
      _showAuthError(
        'Autentikasi berhasil, tetapi respons sesi tidak valid. Silakan coba lagi.',
      );
    } catch (error) {
      _tapGoDebugLog('[TapGo Auth] unexpected post-auth failure: $error');
      _apiClient.setAccessToken(null);
      _showAuthError(
        'Terjadi kendala saat menyiapkan sesi. Silakan coba lagi.',
      );
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  void _activateAuthenticatedSession(DemoClientSession session) {
    tapGoActivateAuthenticatedRuntimeSession(
      session: session,
      setSession: (value) =>
          ref.read(_demoSessionProvider.notifier).state = value,
      setAuthenticated: (value) =>
          ref.read(_isAuthenticatedProvider.notifier).state = value,
      afterAuthenticated: _openAuthenticatedDashboard,
    );
    unawaited(_persistAuthenticatedSession(session));
  }

  void _openAuthenticatedDashboard() {
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) {
        return;
      }
      await _runVerificationGateIfNeeded();
      if (!mounted) {
        return;
      }
      Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
        _tapGoPageRoute((_) => _roleDashboardForContext(context)),
        (_) => false,
      );
    });
  }

  /// Menampilkan gate verifikasi bila nomor telepon akun belum terbukti.
  ///
  /// Akun legacy dari pengujian sebelumnya masuk ke sini karena migration
  /// sengaja tidak melakukan backfill status verifikasi.
  ///
  /// Kegagalan pemeriksaan status TIDAK memblokir masuk ke dashboard:
  /// backend tetap menjadi penjaga sebenarnya untuk setiap aksi, dan
  /// mengunci pengguna di luar aplikasi karena satu permintaan status yang
  /// gagal akan lebih merugikan daripada melewatkan gate satu kali.
  Future<void> _runVerificationGateIfNeeded() async {
    try {
      final status = await _apiClient.verificationStatus();
      if (!mounted || status['requiresVerification'] != true) {
        return;
      }
      await Navigator.of(context).push(
        MaterialPageRoute<bool>(
          builder: (_) => VerificationGateScreen(initialStatus: status),
        ),
      );
    } catch (_) {
      // Sengaja diabaikan: lihat doc-comment di atas.
    }
  }

  Future<void> _persistAuthenticatedSession(DemoClientSession session) async {
    final result = await tapGoPersistAuthenticatedSessionBestEffort(
      session: session,
      steps: [
        TapGoSessionPersistStep(
          name: 'saveSession',
          persist: (value) => _persistentStore.saveSession(value),
        ),
        TapGoSessionPersistStep(
          name: 'saveMembershipSnapshot',
          persist: (value) => _persistentStore.saveMembershipSnapshot(value),
        ),
        TapGoSessionPersistStep(
          name: 'saveTokens',
          persist: (value) => _persistentStore.saveTokens(
            accessToken: value.accessToken,
            refreshToken: value.refreshToken,
          ),
        ),
        TapGoSessionPersistStep(
          name: 'saveRegisteredUser',
          persist: (value) => _persistentStore.saveRegisteredUser(value),
        ),
        TapGoSessionPersistStep(
          name: 'saveAuth',
          persist: (_) => _persistentStore.saveAuth(true),
        ),
      ],
    );
    if (!result.success) {
      _tapGoDebugLog(
        '[TapGo Auth] local_persistence warning: ${result.failedSteps.join(', ')}',
      );
      _showAuthWarning(tapGoLocalSessionPersistenceWarning);
    }
  }

  bool _isNetworkFailure(DioException error) {
    return error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.error is SocketException ||
        error.error is TimeoutException ||
        (error.response == null && error.type == DioExceptionType.unknown);
  }

  String _authErrorMessage(DioException error, {required bool isRegister}) {
    final data = _dioResponseDataMap(error.response?.data);
    final message = data?['message']?.toString();
    final code = data?['code']?.toString();
    if (code == 'PHONE_ALREADY_REGISTERED') {
      return 'Nomor HP sudah terdaftar. Silakan pilih Login.';
    }
    if (code == 'INVALID_CREDENTIALS') {
      return 'Nomor HP atau password salah.';
    }
    if (code == 'SPONSOR_NOT_FOUND') {
      return 'Kode referral tidak valid.';
    }
    if (code == 'SELF_REFERRAL_BLOCKED') {
      return 'Kode referral tidak bisa memakai kode sendiri.';
    }
    if (_isNetworkFailure(error)) {
      return 'Server TapGo belum dapat dihubungi. Silakan coba beberapa saat lagi.';
    }
    return message ??
        (isRegister
            ? 'Registrasi gagal. Periksa data lalu coba lagi.'
            : 'Login gagal. Periksa data lalu coba lagi.');
  }

  Map<String, dynamic>? _dioResponseDataMap(Object? data) {
    return _authResponseDataMap(data);
  }

  void _showAuthError(String message) {
    if (!mounted) {
      return;
    }
    _TapGoSnackbar.error(context, message);
  }

  void _showAuthWarning(String message) {
    if (mounted) {
      _TapGoSnackbar.warning(context, message);
      return;
    }
    final messenger = _tapGoScaffoldMessengerKey.currentState;
    if (messenger != null) {
      _TapGoSnackbar.showWithMessenger(
        messenger,
        message,
        type: _TapGoFeedbackType.warning,
      );
    }
  }

  void _handleLogoTap() {
    if (_isTapGoProductionBuild) {
      return;
    }
    _logoTapCount += 1;
    if (_logoTapCount >= 5) {
      _logoTapCount = 0;
      _openServerConfiguration();
    }
  }

  Future<void> _openServerConfiguration() async {
    final saved = await _serverConfigStore.loadApiBaseUrl();
    if (!mounted) {
      return;
    }
    await _showTapGoDialog<void>(
      context: context,
      builder: (_) =>
          _ServerConfigurationDialog(initialUrl: saved ?? _apiClient.rootUrl),
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _referralController.dispose();
    _nameFocusNode.dispose();
    _phoneFocusNode.dispose();
    _passwordFocusNode.dispose();
    _referralFocusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 20),
              Center(
                child: GestureDetector(
                  onTap: _handleLogoTap,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(24),
                    child: Image.asset(
                      'assets/images/tapgo_logo.jpeg',
                      width: 168,
                      height: 168,
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 22),
              Text(
                'TapGo Lion',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colorScheme.onSurface,
                  fontSize: 30,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _isRegister
                    ? 'Daftar dan mulai pesan layanan TapGo.'
                    : 'Masuk untuk lanjut ke dashboard layanan.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colorScheme.onSurfaceVariant,
                  fontSize: 15,
                ),
              ),
              const SizedBox(height: 28),
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: colorScheme.surface,
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x16000000),
                      blurRadius: 18,
                      offset: Offset(0, 8),
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    _AuthModeButton(
                      label: 'Login',
                      selected: !_isRegister,
                      onTap: () => setState(() => _isRegister = false),
                    ),
                    _AuthModeButton(
                      label: 'Register',
                      selected: _isRegister,
                      onTap: () => setState(() => _isRegister = true),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              Form(
                key: _formKey,
                child: Column(
                  children: [
                    if (_isRegister) ...[
                      _InputField(
                        controller: _nameController,
                        focusNode: _nameFocusNode,
                        icon: Icons.person_rounded,
                        label: 'Nama lengkap',
                        hint: 'Nama kamu',
                        validator: _nameValidator,
                        textInputAction: TextInputAction.next,
                        onFieldSubmitted: (_) => _phoneFocusNode.requestFocus(),
                      ),
                      const SizedBox(height: 12),
                    ],
                    _InputField(
                      controller: _phoneController,
                      focusNode: _phoneFocusNode,
                      icon: Icons.phone_rounded,
                      label: 'Nomor HP',
                      hint: '+62 812 0000 0000',
                      keyboardType: TextInputType.phone,
                      inputFormatters: tapGoPhoneInputFormatters,
                      autofillHints: const [AutofillHints.telephoneNumber],
                      validator: _phoneValidator,
                      textInputAction: TextInputAction.next,
                      onFieldSubmitted: (_) =>
                          _passwordFocusNode.requestFocus(),
                    ),
                    const SizedBox(height: 12),
                    _InputField(
                      controller: _passwordController,
                      focusNode: _passwordFocusNode,
                      icon: Icons.lock_rounded,
                      label: 'Password',
                      hint: 'Minimal 8 karakter',
                      obscureText: true,
                      validator: _passwordValidator,
                      textInputAction: _isRegister
                          ? (tapGoIsDirectDistribution
                              ? TextInputAction.next
                              : TextInputAction.done)
                          : TextInputAction.done,
                      onFieldSubmitted: (_) {
                        if (_isRegister && tapGoIsDirectDistribution) {
                          _referralFocusNode.requestFocus();
                        } else {
                          _continueToDashboard();
                        }
                      },
                    ),
                    if (_isRegister && tapGoIsDirectDistribution) ...[
                      const SizedBox(height: 12),
                      _InputField(
                        controller: _referralController,
                        focusNode: _referralFocusNode,
                        icon: Icons.badge_rounded,
                        label: 'Kode referral optional',
                        hint: 'TAPGO123',
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _continueToDashboard(),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _isSubmitting ? null : _continueToDashboard,
                style: FilledButton.styleFrom(
                  backgroundColor: _brandBlue,
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(56),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18),
                  ),
                ),
                child: _isSubmitting
                    ? const _TapGoLoading(color: Colors.white)
                    : Text(
                        _isRegister ? 'Register & Masuk' : 'Login',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
              ),
              // Hanya muncul pada mode Login. Dinonaktifkan selama submit
              // berjalan agar tidak ada navigasi di tengah permintaan.
              if (!_isRegister) ...[
                const SizedBox(height: 4),
                TextButton(
                  onPressed: _isSubmitting ? null : _openPasswordRecovery,
                  child: const Text(
                    'Lupa Password?',
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _openPasswordRecovery() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const PasswordRecoveryScreen()),
    );
  }

  String? _nameValidator(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'Nama wajib diisi';
    }
    return null;
  }

  String? _phoneValidator(String? value) {
    return tapGoPhoneValidatorMessage(value);
  }

  String? _passwordValidator(String? value) {
    if ((value ?? '').isEmpty) {
      return 'Password wajib diisi';
    }
    if ((value ?? '').length < 6) {
      return 'Password minimal 6 karakter';
    }
    return null;
  }
}

class _ServerConfigurationDialog extends StatefulWidget {
  const _ServerConfigurationDialog({required this.initialUrl});

  final String initialUrl;

  @override
  State<_ServerConfigurationDialog> createState() =>
      _ServerConfigurationDialogState();
}

class _ServerConfigurationDialogState
    extends State<_ServerConfigurationDialog> {
  late final TextEditingController _urlController;
  bool _isTesting = false;
  String? _statusMessage;
  bool _isSuccess = false;

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(text: widget.initialUrl);
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final value = _urlController.text.trim();
    if (!_isValidServerUrl(value)) {
      setState(() {
        _isSuccess = false;
        _statusMessage = 'Alamat server TapGo tidak valid.';
      });
      return;
    }
    final rootUrl = _normalizeApiRootUrl(value);
    await _serverConfigStore.saveApiBaseUrl(rootUrl);
    _apiClient.setBaseUrl(rootUrl);
    if (!mounted) {
      return;
    }
    setState(() {
      _isSuccess = true;
      _statusMessage = 'Server URL berhasil disimpan';
      _urlController.text = rootUrl;
    });
    _TapGoSnackbar.success(context, 'Server URL berhasil disimpan');
  }

  Future<void> _resetDefault() async {
    await _serverConfigStore.resetApiBaseUrl();
    final rootUrl = _rootUrlFromApiBaseUrl(_tapGoApiBaseUrl);
    _apiClient.setBaseUrl(rootUrl);
    if (!mounted) {
      return;
    }
    setState(() {
      _isSuccess = true;
      _statusMessage = 'Pengaturan server dikembalikan ke default.';
      _urlController.text = rootUrl;
    });
  }

  Future<void> _testConnection() async {
    final value = _urlController.text.trim();
    if (!_isValidServerUrl(value)) {
      setState(() {
        _isSuccess = false;
        _statusMessage = 'Alamat server TapGo tidak valid.';
      });
      return;
    }
    setState(() {
      _isTesting = true;
      _statusMessage = null;
    });
    try {
      final result = await _apiClient.testConnection(baseUrlOverride: value);
      if (!mounted) {
        return;
      }
      setState(() {
        _isSuccess = true;
        _statusMessage =
            'Koneksi berhasil\nURL: ${result.url}\nStatus: ${result.statusCode}\nPesan: ${result.message}';
      });
    } on DioException catch (error) {
      if (!mounted) {
        return;
      }
      final rootUrl = _normalizeApiRootUrl(value);
      final healthUrl = _healthUrlFromApiBaseUrl(rootUrl);
      final statusCode = error.response?.statusCode;
      final responseData = error.response?.data;
      setState(() {
        _isSuccess = false;
        _statusMessage =
            'Server TapGo belum dapat dihubungi.\nURL: $healthUrl\nStatus: ${statusCode ?? '-'}\nError: ${responseData ?? error.message}';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      final rootUrl = _normalizeApiRootUrl(value);
      final healthUrl = _healthUrlFromApiBaseUrl(rootUrl);
      setState(() {
        _isSuccess = false;
        _statusMessage =
            'Server TapGo belum dapat dihubungi.\nURL: $healthUrl\nError: $error';
      });
    } finally {
      if (mounted) {
        setState(() => _isTesting = false);
      }
    }
  }

  bool _isValidServerUrl(String value) {
    final rootUrl = _normalizeApiRootUrl(value);
    final uri = Uri.tryParse(rootUrl);
    return uri != null &&
        uri.hasScheme &&
        (uri.scheme == 'https' || uri.scheme == 'http') &&
        uri.host.isNotEmpty;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Pengaturan Server TapGo'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _urlController,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'Alamat Server TapGo',
                hintText: 'https://api.tapgolion.id',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Masukkan alamat server resmi TapGo.',
              style: TextStyle(color: Colors.grey.shade700, fontSize: 12),
            ),
            if (_statusMessage != null) ...[
              const SizedBox(height: 12),
              Text(
                _statusMessage!,
                style: TextStyle(
                  color: _isSuccess ? Colors.green.shade700 : Colors.red,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isTesting ? null : () => Navigator.of(context).pop(),
          child: const Text('Tutup'),
        ),
        TextButton(
          onPressed: _isTesting ? null : _resetDefault,
          child: const Text('Reset Default'),
        ),
        OutlinedButton(
          onPressed: _isTesting ? null : _testConnection,
          child: _isTesting
              ? const _TapGoLoading(size: 16, strokeWidth: 2)
              : const Text('Test Connection'),
        ),
        FilledButton(
          onPressed: _isTesting ? null : _save,
          child: const Text('Save'),
        ),
      ],
    );
  }
}

class _AuthModeButton extends StatelessWidget {
  const _AuthModeButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: _TapGoMotion.duration(context, _TapGoMotion.quick),
          curve: _TapGoMotion.standardCurve,
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(vertical: 13),
          decoration: BoxDecoration(
            color: selected ? _brandBlue : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
  }
}

class _InputField extends StatelessWidget {
  const _InputField({
    this.controller,
    required this.icon,
    required this.label,
    required this.hint,
    this.obscureText = false,
    this.keyboardType,
    this.validator,
    this.suffixIcon,
    this.readOnly = false,
    this.onTap,
    this.focusNode,
    this.textInputAction,
    this.onFieldSubmitted,
    this.inputFormatters,
    this.autofillHints,
  });

  final TextEditingController? controller;
  final FocusNode? focusNode;
  final IconData icon;
  final String label;
  final String hint;
  final bool obscureText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onFieldSubmitted;
  final List<TextInputFormatter>? inputFormatters;
  final Iterable<String>? autofillHints;
  final String? Function(String?)? validator;
  final Widget? suffixIcon;
  final bool readOnly;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return TextFormField(
      controller: controller,
      focusNode: focusNode,
      obscureText: obscureText,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      onFieldSubmitted: onFieldSubmitted,
      inputFormatters: inputFormatters,
      autofillHints: autofillHints,
      validator: validator,
      readOnly: readOnly,
      onTap: onTap,
      style: TextStyle(
        color: colorScheme.onSurface,
        fontWeight: FontWeight.w700,
      ),
      cursorColor: _brandBlue,
      decoration: InputDecoration(
        prefixIcon: Icon(icon, color: _brandBlue),
        suffixIcon: suffixIcon,
        labelText: label,
        hintText: hint,
        labelStyle: TextStyle(color: colorScheme.onSurfaceVariant),
        hintStyle: TextStyle(color: colorScheme.onSurfaceVariant),
        filled: true,
        fillColor: colorScheme.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }
}
