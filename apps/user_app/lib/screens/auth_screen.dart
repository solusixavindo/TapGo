part of '../main.dart';

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
  bool _isRegister = false;
  bool _isSubmitting = false;
  int _logoTapCount = 0;

  Future<void> _continueToDashboard() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() => _isSubmitting = true);
    try {
      final authResult = _isRegister
          ? await _apiClient.register(
              name: _nameController.text.trim(),
              phone: _phoneController.text.trim(),
              password: _passwordController.text,
              referralCode: _referralController.text.trim(),
            )
          : await _apiClient.login(
              phone: _phoneController.text.trim(),
              password: _passwordController.text,
            );
      _apiClient.setAccessToken(authResult.accessToken);
      final referralCode = _referralController.text.trim();
      if (_isRegister &&
          referralCode.isNotEmpty &&
          (authResult.accessToken ?? '').isNotEmpty) {
        try {
          await _apiClient.claimReferral(referralCode);
        } on DioException catch (error) {
          final code =
              _dioResponseDataMap(error.response?.data)?['code']?.toString();
          if (code != 'REFERRAL_ALREADY_CLAIMED') {
            rethrow;
          }
          debugPrint('[TapGo Auth] referral already persisted by backend.');
        }
      }
      var session = _sessionFromAuthUser(
        authResult.user,
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
      );
      if (authResult.user.name == 'Member TapGo' &&
          (authResult.accessToken ?? '').isNotEmpty) {
        final user = await _apiClient.me();
        session = _sessionFromAuthUser(
          user,
          accessToken: authResult.accessToken,
          refreshToken: authResult.refreshToken,
          fallback: session,
        );
      }
      session = await _persistentStore.restoreMembershipSnapshot(session);
      debugPrint('[TapGo Auth] active user name: ${session.userName}');
      await _saveAuthenticatedSession(session);
    } on DioException catch (error) {
      debugPrint('[TapGo Auth] backend auth failed: ${error.message}');
      debugPrint('[TapGo Auth] error status: ${error.response?.statusCode}');
      debugPrint('[TapGo Auth] error body: ${error.response?.data}');
      _showAuthError(_authErrorMessage(error, isRegister: _isRegister));
    } catch (error) {
      debugPrint('[TapGo Auth] auth failed: $error');
      _showAuthError(
          'Login berhasil, tetapi session lokal gagal disimpan. Coba ulangi.');
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  Future<void> _saveAuthenticatedSession(DemoClientSession session) async {
    ref.read(_demoSessionProvider.notifier).state = session;
    await _persistentStore.saveSession(session);
    await _persistentStore.saveMembershipSnapshot(session);
    await _persistentStore.saveTokens(
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    );
    await _persistentStore.saveRegisteredUser(session);
    await _persistentStore.saveAuth(true);
    ref.read(_isAuthenticatedProvider.notifier).state = true;
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
      return 'Server TapGo belum dapat dihubungi. Pastikan server UAT aktif.';
    }
    return message ??
        (isRegister
            ? 'Registrasi gagal. Periksa data lalu coba lagi.'
            : 'Login gagal. Periksa data lalu coba lagi.');
  }

  Map<String, dynamic>? _dioResponseDataMap(Object? data) {
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

  void _showAuthError(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
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
    await showDialog<void>(
      context: context,
      builder: (_) => _ServerConfigurationDialog(
        initialUrl: saved ?? _apiClient.rootUrl,
      ),
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _referralController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
              const Text(
                'TapGo Lion',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF0A2A43),
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
                style: TextStyle(color: Colors.grey.shade700, fontSize: 15),
              ),
              const SizedBox(height: 28),
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: Colors.white,
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
                        icon: Icons.person_rounded,
                        label: 'Nama lengkap',
                        hint: 'Nama kamu',
                        validator: _nameValidator,
                      ),
                      const SizedBox(height: 12),
                    ],
                    _InputField(
                      controller: _phoneController,
                      icon: Icons.phone_rounded,
                      label: 'Nomor HP',
                      hint: '+62 812 0000 0000',
                      keyboardType: TextInputType.phone,
                      validator: _phoneValidator,
                    ),
                    const SizedBox(height: 12),
                    _InputField(
                      controller: _passwordController,
                      icon: Icons.lock_rounded,
                      label: 'Password',
                      hint: 'Minimal 8 karakter',
                      obscureText: true,
                      validator: _passwordValidator,
                    ),
                    if (_isRegister) ...[
                      const SizedBox(height: 12),
                      _InputField(
                        controller: _referralController,
                        icon: Icons.badge_rounded,
                        label: 'Kode referral optional',
                        hint: 'TAPGO123',
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
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.4,
                          color: Colors.white,
                        ),
                      )
                    : Text(
                        _isRegister ? 'Register & Masuk' : 'Login',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String? _nameValidator(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'Nama wajib diisi';
    }
    return null;
  }

  String? _phoneValidator(String? value) {
    final phone = value?.trim() ?? '';
    if (phone.isEmpty) {
      return 'Nomor HP wajib diisi';
    }
    final digits = phone.replaceAll(RegExp(r'[^0-9]'), '');
    if (digits.length < 10 ||
        !(phone.startsWith('08') || phone.startsWith('+62'))) {
      return 'Nomor HP tidak valid';
    }
    return null;
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
        _statusMessage = 'API Base URL tidak valid.';
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
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Server URL berhasil disimpan')),
    );
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
      _statusMessage = 'Server configuration dikembalikan ke default.';
      _urlController.text = rootUrl;
    });
  }

  Future<void> _testConnection() async {
    final value = _urlController.text.trim();
    if (!_isValidServerUrl(value)) {
      setState(() {
        _isSuccess = false;
        _statusMessage = 'API Base URL tidak valid.';
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
            'Connection OK\nURL: ${result.url}\nStatus: ${result.statusCode}\nMessage: ${result.message}';
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
      title: const Text('Server Configuration'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _urlController,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'API Base URL',
                hintText: 'https://api.tapgolion.id',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Boleh isi root URL tunnel atau URL lengkap sampai /api/v1.',
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
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
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
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(vertical: 13),
          decoration: BoxDecoration(
            color: selected ? _brandBlue : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? Colors.white : const Color(0xFF536273),
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
  });

  final TextEditingController? controller;
  final IconData icon;
  final String label;
  final String hint;
  final bool obscureText;
  final TextInputType? keyboardType;
  final String? Function(String?)? validator;
  final Widget? suffixIcon;
  final bool readOnly;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      obscureText: obscureText,
      keyboardType: keyboardType,
      validator: validator,
      readOnly: readOnly,
      onTap: onTap,
      style: const TextStyle(
        color: Color(0xFF172033),
        fontWeight: FontWeight.w700,
      ),
      cursorColor: _brandBlue,
      decoration: InputDecoration(
        prefixIcon: Icon(icon, color: _brandBlue),
        suffixIcon: suffixIcon,
        labelText: label,
        hintText: hint,
        labelStyle: const TextStyle(color: Color(0xFF536273)),
        hintStyle: const TextStyle(color: Color(0xFF94A3B8)),
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }
}
