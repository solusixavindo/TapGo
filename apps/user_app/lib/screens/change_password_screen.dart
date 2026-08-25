part of '../main.dart';

/// Pesan ramah pengguna untuk kegagalan ubah password.
///
/// Tidak pernah menampilkan exception mentah dari backend. Kode yang tidak
/// dikenali jatuh ke pesan umum, bukan ke `error.toString()`.
String tapGoChangePasswordErrorMessage(Object error) {
  if (error is DioException) {
    final data = _authResponseDataMap(error.response?.data);
    final code = data?['code']?.toString();
    switch (code) {
      case 'INVALID_CREDENTIALS':
        return 'Password saat ini salah.';
      case 'PASSWORD_UNCHANGED':
        return 'Password baru harus berbeda dari password saat ini.';
      case 'AUTH_PASSWORD_POLICY_FAILED':
      case 'VALIDATION_ERROR':
        return 'Password baru belum memenuhi ketentuan.';
    }
    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout) {
      return 'Server TapGo belum dapat dihubungi. Silakan coba beberapa saat lagi.';
    }
  }
  return 'Gagal mengubah password. Silakan coba lagi.';
}

/// Layar ubah password untuk akun yang sedang masuk
/// (Pengaturan → Ubah password).
///
/// Kontrak backend `POST /auth/change-password`: menjawab 204 tanpa badan dan
/// MENCABUT semua sesi, termasuk sesi pemanggil. Karena itu setelah sukses
/// layar ini membersihkan sesi lokal lalu mengembalikan pengguna ke layar
/// masuk — tidak ada cara mempertahankan sesi lama, dan memang itulah
/// tujuannya.
class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() =>
      _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _currentController = TextEditingController();
  final _newController = TextEditingController();
  final _confirmController = TextEditingController();

  bool _obscureCurrent = true;
  bool _obscureNew = true;
  bool _obscureConfirm = true;

  /// Kunci single-flight. Selama true, tombol simpan dinonaktifkan sehingga
  /// tidak ada permintaan ganda dari tap beruntun.
  bool _isSubmitting = false;
  String? _errorMessage;

  /// Cermin `passwordSchema` backend untuk change-password (min 6, maks 128).
  /// Kebijakan yang lebih ketat milik pemulihan password sengaja tidak
  /// dipakai di sini supaya aplikasi tidak menolak password yang justru
  /// diterima backend.
  static const int _minPasswordLength = 6;
  static const int _maxPasswordLength = 128;

  @override
  void dispose() {
    _currentController.dispose();
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  /// Validasi lokal sebelum jaringan disentuh. Mengembalikan pesan kesalahan,
  /// atau null bila isian sah.
  String? _validate(String current, String next, String confirm) {
    if (current.isEmpty) {
      return 'Isi password saat ini dulu.';
    }
    if (next.length < _minPasswordLength) {
      return 'Password baru minimal $_minPasswordLength karakter.';
    }
    if (next.length > _maxPasswordLength) {
      return 'Password baru maksimal $_maxPasswordLength karakter.';
    }
    if (next == current) {
      return 'Password baru harus berbeda dari password saat ini.';
    }
    if (confirm != next) {
      return 'Konfirmasi password baru belum sama.';
    }
    return null;
  }

  Future<void> _submit() {
    if (_isSubmitting) {
      return Future<void>.value();
    }
    final current = _currentController.text;
    final next = _newController.text;
    final localError = _validate(current, next, _confirmController.text);
    if (localError != null) {
      setState(() => _errorMessage = localError);
      return Future<void>.value();
    }
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });
    return _guardedSubmit(current, next);
  }

  Future<void> _guardedSubmit(String current, String next) async {
    try {
      await _submitWithSessionRetry(current, next);
      if (!mounted) {
        return;
      }
      await _showSuccessAndLogout();
    } catch (error) {
      if (mounted) {
        setState(
          () => _errorMessage = tapGoChangePasswordErrorMessage(error),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  /// Mengirim permintaan ubah password, dengan satu kali percobaan ulang
  /// setelah tukar refresh token bila penolakan berasal dari token kedaluwarsa
  /// — bukan dari password lama yang salah (INVALID_CREDENTIALS langsung
  /// diteruskan apa adanya).
  Future<void> _submitWithSessionRetry(String current, String next) async {
    final submitter = tapGoChangePasswordSubmitterForTests;
    if (submitter != null) {
      await submitter(currentPassword: current, newPassword: next);
      return;
    }
    try {
      await _apiClient.changePassword(
        currentPassword: current,
        newPassword: next,
      );
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      final code =
          _authResponseDataMap(error.response?.data)?['code']?.toString();
      if ((status != 401 && status != 403) || code == 'INVALID_CREDENTIALS') {
        rethrow;
      }
      final session = ref.read(_demoSessionProvider);
      final (result, refreshed) =
          await _apiClient.refreshSession(session.refreshToken ?? '');
      if (result != TapGoSessionRefreshResult.refreshed || refreshed == null) {
        rethrow;
      }
      _apiClient.setAccessToken(refreshed.accessToken);
      final updated = session.copyWith(
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      );
      ref.read(_demoSessionProvider.notifier).state = updated;
      unawaited(_persistentStore.saveSession(updated));
      await _apiClient.changePassword(
        currentPassword: current,
        newPassword: next,
      );
    }
  }

  Future<void> _showSuccessAndLogout() async {
    await _showTapGoDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Password berhasil diubah'),
        content: const Text(
          'Demi keamanan, semua sesi telah keluar. '
          'Silakan masuk kembali dengan password baru Anda.',
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            style: FilledButton.styleFrom(
              backgroundColor: _brandBlue,
              foregroundColor: Colors.white,
            ),
            child: const Text('Masuk kembali'),
          ),
        ],
      ),
    );
    if (!mounted) {
      return;
    }
    _apiClient.setAccessToken(null);
    await _persistentStore.clearSession();
    ref.read(_demoSessionProvider.notifier).state = DemoClientSession.initial();
    ref.read(_isAuthenticatedProvider.notifier).state = false;
    if (!mounted) {
      return;
    }
    Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
      _tapGoPageRoute((_) => const AuthScreen()),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ubah Password'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Amankan akun Anda',
                style: TextStyle(
                  color: colorScheme.onSurface,
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Setelah password diganti, semua perangkat akan keluar '
                'dan Anda perlu masuk kembali.',
                style: TextStyle(
                  color: colorScheme.onSurfaceVariant,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 20),
              _InputField(
                controller: _currentController,
                icon: Icons.lock_outline_rounded,
                label: 'Password saat ini',
                hint: 'Password yang sedang dipakai',
                obscureText: _obscureCurrent,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.password],
                suffixIcon: IconButton(
                  icon: Icon(
                    _obscureCurrent
                        ? Icons.visibility_off_rounded
                        : Icons.visibility_rounded,
                  ),
                  onPressed: () =>
                      setState(() => _obscureCurrent = !_obscureCurrent),
                ),
              ),
              const SizedBox(height: 14),
              _InputField(
                controller: _newController,
                icon: Icons.lock_reset_rounded,
                label: 'Password baru',
                hint: 'Minimal $_minPasswordLength karakter',
                obscureText: _obscureNew,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.newPassword],
                suffixIcon: IconButton(
                  icon: Icon(
                    _obscureNew
                        ? Icons.visibility_off_rounded
                        : Icons.visibility_rounded,
                  ),
                  onPressed: () => setState(() => _obscureNew = !_obscureNew),
                ),
              ),
              const SizedBox(height: 14),
              _InputField(
                controller: _confirmController,
                icon: Icons.lock_rounded,
                label: 'Konfirmasi password baru',
                hint: 'Ulangi password baru',
                obscureText: _obscureConfirm,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.newPassword],
                onFieldSubmitted: (_) => _submit(),
                suffixIcon: IconButton(
                  icon: Icon(
                    _obscureConfirm
                        ? Icons.visibility_off_rounded
                        : Icons.visibility_rounded,
                  ),
                  onPressed: () =>
                      setState(() => _obscureConfirm = !_obscureConfirm),
                ),
              ),
              const SizedBox(height: 20),
              _RecoveryPrimaryButton(
                label: 'Simpan password',
                isLoading: _isSubmitting,
                onPressed: _submit,
              ),
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
}
