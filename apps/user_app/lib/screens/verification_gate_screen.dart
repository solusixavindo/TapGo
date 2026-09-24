part of '../main.dart';

/// Pesan error layar verifikasi. Memakai pemetaan pemulihan untuk kode yang
/// sama, tetapi kata "pemulihan" tidak boleh muncul di layar verifikasi, dan
/// kode khusus alur tambah-email dipetakan di sini.
String tapGoVerificationErrorMessage(Object error) {
  if (error is DioException) {
    final code =
        _authResponseDataMap(error.response?.data)?['code']?.toString();
    switch (code) {
      case 'EMAIL_ALREADY_IN_USE':
      case 'EMAIL_ALREADY_REGISTERED':
        return 'Email ini sudah dipakai akun lain.';
      case 'INVALID_CREDENTIALS':
        return 'Password saat ini salah.';
      case 'AUTH_RECOVERY_CHANNEL_UNAVAILABLE':
      case 'AUTH_RECOVERY_SECRET_UNAVAILABLE':
        return 'Layanan verifikasi belum tersedia. Hubungi bantuan TapGo.';
    }
  }
  final message = tapGoRecoveryErrorMessage(error);
  return message == 'Pemulihan gagal. Silakan coba lagi.'
      ? 'Verifikasi belum berhasil. Silakan coba lagi.'
      : message;
}

/// Gate verifikasi kontak untuk akun yang belum membuktikan kepemilikan
/// nomor telepon.
///
/// Akun legacy dari pengujian sebelumnya sampai di sini karena migration
/// sengaja tidak melakukan backfill status verifikasi. Layar ini adalah
/// jalur pembuktian kepemilikan tersebut.
class VerificationGateScreen extends ConsumerStatefulWidget {
  const VerificationGateScreen({super.key, this.initialStatus});

  /// Status awal yang sudah dimuat. Bila diisi, layar TIDAK memanggil
  /// backend saat initState. Dipakai widget test agar dapat menguji
  /// tampilan tanpa jaringan; produksi selalu membiarkannya null.
  final Map<String, dynamic>? initialStatus;

  @override
  ConsumerState<VerificationGateScreen> createState() =>
      _VerificationGateScreenState();
}

class _VerificationGateScreenState
    extends ConsumerState<VerificationGateScreen> {
  final _codeController = TextEditingController();
  final _emailController = TextEditingController();
  final _emailPasswordController = TextEditingController();
  final _emailCodeController = TextEditingController();

  bool _isLoading = true;
  bool _isSubmitting = false;
  bool _codeSent = false;
  String? _errorMessage;

  String _maskedPhone = '';
  bool _phoneVerified = false;
  String? _maskedEmail;
  bool _emailVerified = false;

  /// True setelah [_addEmail] berhasil pada sesi layar ini, sehingga formulir
  /// tambah-email diganti langsung dengan kolom kode — tanpa ini pengguna
  /// harus menutup lalu membuka ulang layar untuk melihat kolom kode.
  bool _emailJustAdded = false;
  bool _emailCodeSent = false;
  bool _obscureEmailPassword = true;

  int _resendSeconds = 0;
  Timer? _resendTimer;
  int _emailResendSeconds = 0;
  Timer? _emailResendTimer;
  static const int _resendCooldownSeconds = 60;

  @override
  void initState() {
    super.initState();
    final seeded = widget.initialStatus;
    if (seeded != null) {
      _applyStatus(seeded);
      return;
    }
    _loadStatus();
  }

  void _applyStatus(Map<String, dynamic> data) {
    final phone = data['phone'] as Map<String, dynamic>?;
    final email = data['email'] as Map<String, dynamic>?;
    _maskedPhone = phone?['masked']?.toString() ?? '';
    _phoneVerified = phone?['verified'] == true;
    _maskedEmail = email?['masked']?.toString();
    _emailVerified = email?['verified'] == true;
    _isLoading = false;
  }

  @override
  void dispose() {
    _resendTimer?.cancel();
    _emailResendTimer?.cancel();
    _codeController.dispose();
    _emailController.dispose();
    _emailPasswordController.dispose();
    _emailCodeController.dispose();
    super.dispose();
  }

  Future<void> _loadStatus() async {
    try {
      final data = await _apiClient.verificationStatus();
      if (!mounted) {
        return;
      }
      setState(() => _applyStatus(data));
    } catch (error) {
      if (mounted) {
        setState(() {
          _errorMessage = tapGoVerificationErrorMessage(error);
          _isLoading = false;
        });
      }
    }
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
        setState(() => _errorMessage = tapGoVerificationErrorMessage(error));
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  Future<void> _requestCode() {
    return _guarded(() async {
      await _apiClient.requestContactVerification('PHONE');
      if (mounted) {
        setState(() => _codeSent = true);
        _startResendCountdown();
      }
    });
  }

  Future<void> _confirmCode() {
    return _guarded(() async {
      final code = _codeController.text.trim();
      if (code.length != 6 || int.tryParse(code) == null) {
        setState(() => _errorMessage = 'Kode harus 6 digit angka.');
        return;
      }
      await _apiClient.confirmContactVerification(channel: 'PHONE', code: code);
      if (!mounted) {
        return;
      }
      setState(() {
        _phoneVerified = true;
        _codeSent = false;
        _codeController.clear();
      });
    });
  }

  void _startEmailResendCountdown() {
    _emailResendTimer?.cancel();
    setState(() => _emailResendSeconds = _resendCooldownSeconds);
    _emailResendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() {
        _emailResendSeconds -= 1;
        if (_emailResendSeconds <= 0) {
          _emailResendSeconds = 0;
          timer.cancel();
        }
      });
    });
  }

  /// Menyimpan email baru, lalu langsung meminta kode verifikasi — pengguna
  /// tidak perlu dua kali tekan tombol untuk sampai ke langkah kode.
  Future<void> _addEmail() {
    return _guarded(() async {
      final email = _emailController.text.trim();
      final password = _emailPasswordController.text;
      if (email.isEmpty || !email.contains('@')) {
        setState(() => _errorMessage = 'Masukkan alamat email yang valid.');
        return;
      }
      if (password.isEmpty) {
        setState(() => _errorMessage = 'Isi password saat ini.');
        return;
      }
      final saved = await _apiClient.updateEmail(
        email: email,
        currentPassword: password,
      );
      await _apiClient.requestContactVerification('EMAIL');
      if (!mounted) {
        return;
      }
      setState(() {
        _maskedEmail = _maskEmailLocal(saved);
        _emailJustAdded = true;
        _emailCodeSent = true;
        _emailPasswordController.clear();
      });
      _startEmailResendCountdown();
    });
  }

  Future<void> _requestEmailCode() {
    return _guarded(() async {
      await _apiClient.requestContactVerification('EMAIL');
      if (mounted) {
        setState(() => _emailCodeSent = true);
        _startEmailResendCountdown();
      }
    });
  }

  Future<void> _confirmEmailCode() {
    return _guarded(() async {
      final code = _emailCodeController.text.trim();
      if (code.length != 6 || int.tryParse(code) == null) {
        setState(() => _errorMessage = 'Kode harus 6 digit angka.');
        return;
      }
      await _apiClient.confirmContactVerification(channel: 'EMAIL', code: code);
      if (!mounted) {
        return;
      }
      setState(() {
        _emailVerified = true;
        _emailCodeSent = false;
        _emailCodeController.clear();
      });
    });
  }

  /// Penyamaran ringan untuk tampilan lokal segera setelah email disimpan —
  /// backend tidak mengembalikan versi tersamar pada respons PUT, hanya pada
  /// GET verification/status.
  String _maskEmailLocal(String email) {
    final at = email.indexOf('@');
    if (at <= 1) {
      return email;
    }
    return '${email[0]}${'*' * (at - 1)}${email.substring(at)}';
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Verifikasi Akun'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: _isLoading
            ? const Center(child: _TapGoLoading(color: _brandBlue))
            : SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _VerificationStatusCard(
                      icon: Icons.phone_rounded,
                      label: 'Nomor HP',
                      value: _maskedPhone,
                      verified: _phoneVerified,
                      requiredChannel: true,
                    ),
                    const SizedBox(height: 12),
                    _VerificationStatusCard(
                      icon: Icons.mail_rounded,
                      label: 'Email',
                      value: _maskedEmail ?? 'Belum diisi',
                      verified: _emailVerified,
                      requiredChannel: false,
                    ),
                    const SizedBox(height: 24),
                    if (!_phoneVerified)
                      ..._phoneVerificationSection(colorScheme),
                    if (_phoneVerified) ..._verifiedSection(colorScheme),
                    if (!_emailVerified) ...[
                      const SizedBox(height: 28),
                      ..._emailManagementSection(colorScheme),
                    ],
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

  List<Widget> _phoneVerificationSection(ColorScheme colorScheme) {
    return [
      Text(
        'Verifikasi nomor HP kamu',
        style: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 18,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 8),
      Text(
        'Nomor HP adalah identitas utama akun TapGo. '
        'Verifikasi diperlukan agar kamu bisa memulihkan akun bila lupa password.',
        style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 14),
      ),
      const SizedBox(height: 20),
      if (!_codeSent)
        _RecoveryPrimaryButton(
          label: 'Kirim kode verifikasi',
          isLoading: _isSubmitting,
          onPressed: _requestCode,
        ),
      if (_codeSent) ...[
        _InputField(
          controller: _codeController,
          icon: Icons.pin_rounded,
          label: 'Kode 6 digit',
          hint: '000000',
          keyboardType: TextInputType.number,
          inputFormatters: tapGoOtpInputFormatters,
          textInputAction: TextInputAction.done,
          onFieldSubmitted: (_) => _confirmCode(),
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            onPressed:
                (_resendSeconds > 0 || _isSubmitting) ? null : _requestCode,
            child: Text(
              _resendSeconds > 0
                  ? 'Kirim ulang kode dalam $_resendSeconds detik'
                  : 'Kirim ulang kode',
            ),
          ),
        ),
        const SizedBox(height: 8),
        _RecoveryPrimaryButton(
          label: 'Verifikasi',
          isLoading: _isSubmitting,
          onPressed: _confirmCode,
        ),
      ],
    ];
  }

  /// Email bersifat opsional, jadi bagian ini tidak pernah memblokir apa pun
  /// — beda dari [_phoneVerificationSection] yang menahan layar sampai
  /// terbukti. Tiga kondisi: belum ada email sama sekali, sudah ada tapi
  /// belum terbukti, atau (ditangani di [build] lewat `if (!_emailVerified)`)
  /// sudah terverifikasi sehingga bagian ini tidak ditampilkan sama sekali.
  List<Widget> _emailManagementSection(ColorScheme colorScheme) {
    final hasEmail = _maskedEmail != null && !_emailJustAdded ||
        (_emailJustAdded && _emailCodeSent);

    if (!hasEmail) {
      return [
        Text(
          'Tambahkan email',
          style: TextStyle(
            color: colorScheme.onSurface,
            fontSize: 18,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Email dipakai sebagai jalur cadangan pemulihan password bila kamu '
          'lupa. Opsional, tapi disarankan.',
          style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 14),
        ),
        const SizedBox(height: 20),
        _InputField(
          controller: _emailController,
          icon: Icons.mail_outline_rounded,
          label: 'Alamat email',
          hint: 'nama@email.com',
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.next,
        ),
        const SizedBox(height: 14),
        _InputField(
          controller: _emailPasswordController,
          icon: Icons.lock_outline_rounded,
          label: 'Password saat ini',
          hint: 'Konfirmasi dengan password kamu',
          obscureText: _obscureEmailPassword,
          textInputAction: TextInputAction.done,
          autofillHints: const [AutofillHints.password],
          suffixIcon: IconButton(
            icon: Icon(
              _obscureEmailPassword
                  ? Icons.visibility_off_rounded
                  : Icons.visibility_rounded,
            ),
            onPressed: () => setState(
              () => _obscureEmailPassword = !_obscureEmailPassword,
            ),
          ),
          onFieldSubmitted: (_) => _addEmail(),
        ),
        const SizedBox(height: 18),
        _RecoveryPrimaryButton(
          label: 'Simpan dan kirim kode',
          isLoading: _isSubmitting,
          onPressed: _addEmail,
        ),
      ];
    }

    return [
      Text(
        'Verifikasi email kamu',
        style: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 18,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 8),
      Text(
        'Masukkan kode yang dikirim ke $_maskedEmail.',
        style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 14),
      ),
      const SizedBox(height: 20),
      if (!_emailCodeSent)
        _RecoveryPrimaryButton(
          label: 'Kirim kode verifikasi',
          isLoading: _isSubmitting,
          onPressed: _requestEmailCode,
        ),
      if (_emailCodeSent) ...[
        _InputField(
          controller: _emailCodeController,
          icon: Icons.pin_rounded,
          label: 'Kode 6 digit',
          hint: '000000',
          keyboardType: TextInputType.number,
          inputFormatters: tapGoOtpInputFormatters,
          textInputAction: TextInputAction.done,
          onFieldSubmitted: (_) => _confirmEmailCode(),
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            onPressed: (_emailResendSeconds > 0 || _isSubmitting)
                ? null
                : _requestEmailCode,
            child: Text(
              _emailResendSeconds > 0
                  ? 'Kirim ulang kode dalam $_emailResendSeconds detik'
                  : 'Kirim ulang kode',
            ),
          ),
        ),
        const SizedBox(height: 8),
        _RecoveryPrimaryButton(
          label: 'Verifikasi',
          isLoading: _isSubmitting,
          onPressed: _confirmEmailCode,
        ),
      ],
    ];
  }

  List<Widget> _verifiedSection(ColorScheme colorScheme) {
    return [
      const Icon(Icons.verified_rounded, size: 64, color: _brandBlue),
      const SizedBox(height: 12),
      Text(
        'Nomor HP terverifikasi',
        textAlign: TextAlign.center,
        style: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 18,
          fontWeight: FontWeight.w800,
        ),
      ),
      const SizedBox(height: 8),
      Text(
        'Akun kamu sekarang bisa dipulihkan lewat nomor HP ini.',
        textAlign: TextAlign.center,
        style: TextStyle(color: colorScheme.onSurfaceVariant, fontSize: 14),
      ),
      const SizedBox(height: 24),
      _RecoveryPrimaryButton(
        label: 'Lanjutkan',
        isLoading: false,
        onPressed: () => Navigator.of(context).pop(true),
      ),
    ];
  }
}

class _VerificationStatusCard extends StatelessWidget {
  const _VerificationStatusCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.verified,
    required this.requiredChannel,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool verified;
  final bool requiredChannel;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x11000000),
            blurRadius: 14,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          Icon(icon, color: _brandBlue, size: 22),
          const SizedBox(width: 12),
          // Expanded menjaga label dan nilai tidak meluber di layar sempit.
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  requiredChannel ? '$label (wajib)' : '$label (opsional)',
                  style: TextStyle(
                    color: colorScheme.onSurfaceVariant,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: colorScheme.onSurface,
                    fontSize: 14.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          _VerificationBadge(verified: verified),
        ],
      ),
    );
  }
}

class _VerificationBadge extends StatelessWidget {
  const _VerificationBadge({required this.verified});

  final bool verified;

  @override
  Widget build(BuildContext context) {
    final color = verified ? const Color(0xFF1B8A5A) : const Color(0xFF8A6D1B);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        verified ? 'Terverifikasi' : 'Belum',
        style: TextStyle(
          color: color,
          fontSize: 11.5,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}
