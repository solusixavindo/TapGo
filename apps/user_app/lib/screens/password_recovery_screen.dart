part of '../main.dart';

/// Langkah alur pemulihan password.
enum TapGoRecoveryStep { identifier, code, password, done }

/// Formatter field OTP: hanya angka, maksimum 6 digit.
/// Dipakai layar pemulihan dan layar verifikasi agar aturannya satu tempat.
final List<TextInputFormatter> tapGoOtpInputFormatters = [
  FilteringTextInputFormatter.digitsOnly,
  LengthLimitingTextInputFormatter(6),
];

/// Aturan password baru. Cerminan `validatePasswordPolicy` di backend;
/// backend tetap menjadi penentu akhir — ini hanya membantu pengguna melihat
/// syaratnya sebelum mengirim.
class TapGoPasswordRequirement {
  const TapGoPasswordRequirement({required this.label, required this.met});

  final String label;
  final bool met;
}

List<TapGoPasswordRequirement> tapGoPasswordRequirements(String password) {
  return [
    TapGoPasswordRequirement(
        label: 'Minimal 8 karakter', met: password.length >= 8),
    TapGoPasswordRequirement(
      label: 'Mengandung huruf',
      met: RegExp(r'[A-Za-z]').hasMatch(password),
    ),
    TapGoPasswordRequirement(
      label: 'Mengandung angka',
      met: RegExp(r'[0-9]').hasMatch(password),
    ),
  ];
}

bool tapGoPasswordMeetsPolicy(String password) {
  return tapGoPasswordRequirements(password).every((rule) => rule.met);
}

/// Pesan ramah pengguna untuk kode error pemulihan.
///
/// Tidak pernah menampilkan exception mentah dari backend. Kode yang tidak
/// dikenali jatuh ke pesan umum, bukan ke `error.toString()`.
String tapGoRecoveryErrorMessage(Object error) {
  if (error is DioException) {
    final data = _authResponseDataMap(error.response?.data);
    final code = data?['code']?.toString();
    switch (code) {
      case 'AUTH_RECOVERY_INVALID_OR_EXPIRED':
        return 'Kode salah atau sudah kedaluwarsa. Minta kode baru bila perlu.';
      case 'AUTH_RECOVERY_ATTEMPTS_EXCEEDED':
        return 'Percobaan kode sudah habis. Minta kode baru.';
      case 'AUTH_RECOVERY_RATE_LIMITED':
        return 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.';
      case 'AUTH_RECOVERY_CHANNEL_UNAVAILABLE':
      case 'AUTH_RECOVERY_SECRET_UNAVAILABLE':
        return 'Layanan pemulihan belum tersedia. Hubungi bantuan TapGo.';
      case 'AUTH_CONTACT_NOT_VERIFIED':
        return 'Kontak ini belum terverifikasi sehingga belum bisa dipakai.';
      case 'AUTH_PASSWORD_POLICY_FAILED':
        return 'Password baru belum memenuhi ketentuan di bawah.';
    }
    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout) {
      return 'Server TapGo belum dapat dihubungi. Silakan coba beberapa saat lagi.';
    }
  }
  return 'Pemulihan gagal. Silakan coba lagi.';
}

class PasswordRecoveryScreen extends ConsumerStatefulWidget {
  const PasswordRecoveryScreen({super.key});

  @override
  ConsumerState<PasswordRecoveryScreen> createState() =>
      _PasswordRecoveryScreenState();
}

class _PasswordRecoveryScreenState
    extends ConsumerState<PasswordRecoveryScreen> {
  final _identifierController = TextEditingController();
  final _codeController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();

  TapGoRecoveryStep _step = TapGoRecoveryStep.identifier;

  /// Kunci single-flight. Selama true, seluruh tombol aksi dinonaktifkan
  /// sehingga tidak ada permintaan ganda dari tap beruntun.
  bool _isSubmitting = false;

  String _resetToken = '';
  String _maskedDestination = '';
  String? _errorMessage;

  /// Sisa detik sebelum "Kirim ulang kode" aktif kembali.
  int _resendSeconds = 0;
  Timer? _resendTimer;

  static const int _resendCooldownSeconds = 60;

  @override
  void dispose() {
    _resendTimer?.cancel();
    _identifierController.dispose();
    _codeController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  void _startResendCountdown() {
    _resendTimer?.cancel();
    setState(() => _resendSeconds = _resendCooldownSeconds);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() {
        _resendSeconds -= 1;
        if (_resendSeconds <= 0) {
          _resendSeconds = 0;
          timer.cancel();
        }
      });
    });
  }

  /// Membungkus setiap aksi jaringan dengan kunci single-flight.
  Future<void> _guarded(Future<void> Function() action) async {
    if (_isSubmitting) {
      return;
    }
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) {
        setState(() => _errorMessage = tapGoRecoveryErrorMessage(error));
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  Future<void> _submitIdentifier() {
    return _guarded(() async {
      final identifier = _identifierController.text.trim();
      if (identifier.isEmpty) {
        setState(() => _errorMessage = 'Isi nomor HP atau email dulu.');
        return;
      }
      await _apiClient.requestPasswordRecovery(identifier);
      if (!mounted) {
        return;
      }
      // Konfirmasi generik: aplikasi tidak pernah tahu apakah akun terdaftar.
      setState(() => _step = TapGoRecoveryStep.code);
      _startResendCountdown();
    });
  }

  Future<void> _resendCode() {
    return _guarded(() async {
      await _apiClient
          .requestPasswordRecovery(_identifierController.text.trim());
      if (mounted) {
        _startResendCountdown();
      }
    });
  }

  Future<void> _submitCode() {
    return _guarded(() async {
      final code = _codeController.text.trim();
      if (code.length != 6 || int.tryParse(code) == null) {
        setState(() => _errorMessage = 'Kode harus 6 digit angka.');
        return;
      }
      final result = await _apiClient.verifyPasswordRecovery(
        identifier: _identifierController.text.trim(),
        code: code,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _resetToken = result['resetToken'] ?? '';
        _maskedDestination = result['maskedDestination'] ?? '';
        _step = TapGoRecoveryStep.password;
      });
    });
  }

  Future<void> _submitPassword() {
    return _guarded(() async {
      final password = _passwordController.text;
      if (!tapGoPasswordMeetsPolicy(password)) {
        setState(
            () => _errorMessage = 'Password baru belum memenuhi ketentuan.');
        return;
      }
      if (password != _confirmController.text) {
        setState(() => _errorMessage = 'Konfirmasi password belum sama.');
        return;
      }
      await _apiClient.resetPassword(
        resetToken: _resetToken,
        newPassword: password,
      );
      if (!mounted) {
        return;
      }
      // Reset token dibuang dari memori segera setelah dipakai.
      setState(() {
        _resetToken = '';
        _step = TapGoRecoveryStep.done;
      });
    });
  }

  void _backToLogin() {
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pemulihan Password'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _RecoveryStepIndicator(step: _step),
              const SizedBox(height: 24),
              ..._buildStep(colorScheme),
              if (_errorMessage != null) ...[
                const SizedBox(height: 16),
                _RecoveryMessage(message: _errorMessage!, isError: true),
              ],
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _buildStep(ColorScheme colorScheme) {
    switch (_step) {
      case TapGoRecoveryStep.identifier:
        return _identifierStep(colorScheme);
      case TapGoRecoveryStep.code:
        return _codeStep(colorScheme);
      case TapGoRecoveryStep.password:
        return _passwordStep(colorScheme);
      case TapGoRecoveryStep.done:
        return _doneStep(colorScheme);
    }
  }

  List<Widget> _identifierStep(ColorScheme colorScheme) {
    return [
      Text(
        'Masukkan nomor HP atau email',
        style: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 20,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 8),
      Text(
        'Kami akan mengirim kode verifikasi bila akun ditemukan.',
        style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 14),
      ),
      const SizedBox(height: 20),
      _InputField(
        controller: _identifierController,
        icon: Icons.account_circle_rounded,
        label: 'Nomor HP atau email',
        hint: '0812xxxxxxx atau nama@email.com',
        keyboardType: TextInputType.emailAddress,
        textInputAction: TextInputAction.done,
        onFieldSubmitted: (_) => _submitIdentifier(),
      ),
      const SizedBox(height: 20),
      _RecoveryPrimaryButton(
        label: 'Kirim kode',
        isLoading: _isSubmitting,
        onPressed: _submitIdentifier,
      ),
    ];
  }

  List<Widget> _codeStep(ColorScheme colorScheme) {
    return [
      Text(
        'Masukkan kode verifikasi',
        style: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 20,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 8),
      // Pesan generik yang sama persis dengan respons backend: aplikasi tidak
      // boleh mengonfirmasi bahwa nomor/email tersebut terdaftar.
      const _RecoveryMessage(
        message: 'Jika akun ditemukan, instruksi pemulihan telah dikirim.',
        isError: false,
      ),
      const SizedBox(height: 20),
      _InputField(
        controller: _codeController,
        icon: Icons.pin_rounded,
        label: 'Kode 6 digit',
        hint: '000000',
        keyboardType: TextInputType.number,
        inputFormatters: tapGoOtpInputFormatters,
        textInputAction: TextInputAction.done,
        onFieldSubmitted: (_) => _submitCode(),
      ),
      const SizedBox(height: 12),
      Align(
        alignment: Alignment.centerLeft,
        child: TextButton(
          onPressed: (_resendSeconds > 0 || _isSubmitting) ? null : _resendCode,
          child: Text(
            _resendSeconds > 0
                ? 'Kirim ulang kode dalam $_resendSeconds detik'
                : 'Kirim ulang kode',
          ),
        ),
      ),
      const SizedBox(height: 8),
      _RecoveryPrimaryButton(
        label: 'Verifikasi kode',
        isLoading: _isSubmitting,
        onPressed: _submitCode,
      ),
    ];
  }

  List<Widget> _passwordStep(ColorScheme colorScheme) {
    final requirements = tapGoPasswordRequirements(_passwordController.text);
    return [
      Text(
        'Buat password baru',
        style: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 20,
          fontWeight: FontWeight.w800,
        ),
      ),
      if (_maskedDestination.isNotEmpty) ...[
        const SizedBox(height: 8),
        Text(
          'Kode terverifikasi untuk $_maskedDestination.',
          style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 14),
        ),
      ],
      const SizedBox(height: 20),
      _InputField(
        controller: _passwordController,
        icon: Icons.lock_rounded,
        label: 'Password baru',
        hint: 'Minimal 8 karakter',
        obscureText: true,
        textInputAction: TextInputAction.next,
        // Daftar syarat diperbarui saat mengetik.
        onFieldSubmitted: (_) => setState(() {}),
      ),
      const SizedBox(height: 12),
      _InputField(
        controller: _confirmController,
        icon: Icons.lock_reset_rounded,
        label: 'Ulangi password baru',
        hint: 'Ketik ulang password',
        obscureText: true,
        textInputAction: TextInputAction.done,
        onFieldSubmitted: (_) => _submitPassword(),
      ),
      const SizedBox(height: 16),
      _PasswordRequirementList(requirements: requirements),
      const SizedBox(height: 20),
      _RecoveryPrimaryButton(
        label: 'Simpan password',
        isLoading: _isSubmitting,
        onPressed: () {
          setState(() {});
          _submitPassword();
        },
      ),
    ];
  }

  List<Widget> _doneStep(ColorScheme colorScheme) {
    return [
      const Icon(Icons.check_circle_rounded, size: 72, color: _brandBlue),
      const SizedBox(height: 16),
      Text(
        'Password berhasil diperbarui',
        textAlign: TextAlign.center,
        style: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 20,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 8),
      Text(
        'Demi keamanan, semua perangkat telah dikeluarkan. '
        'Silakan login kembali dengan password baru.',
        textAlign: TextAlign.center,
        style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 14),
      ),
      const SizedBox(height: 24),
      _RecoveryPrimaryButton(
        label: 'Kembali ke Login',
        isLoading: false,
        onPressed: _backToLogin,
      ),
    ];
  }
}

class _RecoveryStepIndicator extends StatelessWidget {
  const _RecoveryStepIndicator({required this.step});

  final TapGoRecoveryStep step;

  @override
  Widget build(BuildContext context) {
    final index = TapGoRecoveryStep.values.indexOf(step);
    return Row(
      children: List.generate(TapGoRecoveryStep.values.length, (position) {
        final active = position <= index;
        return Expanded(
          child: Container(
            height: 6,
            margin: EdgeInsets.only(
              right: position == TapGoRecoveryStep.values.length - 1 ? 0 : 6,
            ),
            decoration: BoxDecoration(
              color: active ? _brandBlue : const Color(0x1F0569E8),
              borderRadius: BorderRadius.circular(3),
            ),
          ),
        );
      }),
    );
  }
}

class _RecoveryPrimaryButton extends StatelessWidget {
  const _RecoveryPrimaryButton({
    required this.label,
    required this.isLoading,
    required this.onPressed,
  });

  final String label;
  final bool isLoading;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      // Dinonaktifkan selama permintaan berjalan: kunci single-flight.
      onPressed: isLoading ? null : onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: _brandBlue,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(56),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
      child: isLoading
          ? const _TapGoLoading(color: Colors.white)
          : Text(
              label,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
    );
  }
}

class _RecoveryMessage extends StatelessWidget {
  const _RecoveryMessage({required this.message, required this.isError});

  final String message;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final color = isError ? const Color(0xFFB3261E) : _brandBlue;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            isError ? Icons.error_outline_rounded : Icons.info_outline_rounded,
            color: color,
            size: 20,
          ),
          const SizedBox(width: 10),
          // Expanded mencegah teks panjang meluber pada layar sempit.
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: color, fontSize: 13.5, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

class _PasswordRequirementList extends StatelessWidget {
  const _PasswordRequirementList({required this.requirements});

  final List<TapGoPasswordRequirement> requirements;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Ketentuan password',
          style: TextStyle(
            color: colorScheme.onSurface,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        ...requirements.map(
          (rule) => Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Icon(
                  rule.met
                      ? Icons.check_circle_rounded
                      : Icons.radio_button_unchecked_rounded,
                  size: 18,
                  color: rule.met ? _brandBlue : colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    rule.label,
                    style: TextStyle(
                      color: rule.met
                          ? colorScheme.onSurface
                          : colorScheme.onSurfaceVariant,
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
