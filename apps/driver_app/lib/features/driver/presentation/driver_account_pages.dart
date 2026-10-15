part of '../../../main.dart';

// Halaman-halaman yang dibuka dari tab Akun (gaya daftar berkategori), plus
// banner Beranda untuk notifikasi yang dimatikan.

/// Satu kategori di tab Akun: judul kecil lalu baris-baris dalam satu kartu.
class _AccountSection extends StatelessWidget {
  const _AccountSection({super.key, required this.title, required this.rows});

  final String title;
  final List<Widget> rows;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
          child: Text(
            title,
            style: theme.textTheme.titleSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        Card(
          margin: EdgeInsets.zero,
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (var i = 0; i < rows.length; i++) ...[
                if (i > 0) const Divider(height: 1, indent: 60),
                rows[i],
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Satu baris menu: ikon, judul, keterangan singkat, dan panah.
class _AccountRow extends StatelessWidget {
  const _AccountRow({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.showChevron = true,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  final bool showChevron;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: Theme.of(context).colorScheme.primary),
      title: Text(title),
      subtitle: subtitle == null ? null : Text(subtitle!),
      trailing: showChevron ? const Icon(Icons.chevron_right_rounded) : null,
      onTap: onTap,
    );
  }
}

/// Halaman "Tampilan": tiga pilihan tema, berlaku langsung.
class DriverAppearanceScreen extends ConsumerWidget {
  const DriverAppearanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(driverThemePreferenceProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Tampilan')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            margin: EdgeInsets.zero,
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (final (mode, label, icon) in _themeChoices)
                  ListTile(
                    key: ValueKey('theme-choice-${mode?.name ?? 'system'}'),
                    leading: Icon(icon),
                    title: Text(label),
                    trailing: _SelectionMark(selected: selected == mode),
                    onTap: () => ref
                        .read(driverThemePreferenceProvider.notifier)
                        .setThemeMode(mode),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Penanda pilihan seperti pemilih nada dering.
class _SelectionMark extends StatelessWidget {
  const _SelectionMark({required this.selected});
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Icon(
      selected
          ? Icons.radio_button_checked_rounded
          : Icons.radio_button_unchecked_rounded,
      color: selected
          ? Theme.of(context).colorScheme.primary
          : Theme.of(context).colorScheme.outline,
    );
  }
}

/// Halaman "Notifikasi": hanya tiga pilihan bunyi, seperti memilih nada dering.
/// Mengetuk satu pilihan memilihnya sekaligus membunyikannya.
class DriverNotificationScreen extends ConsumerWidget {
  const DriverNotificationScreen({super.key});

  Future<void> _choose(WidgetRef ref, DriverAlertTone tone) async {
    unawaited(driverPlayNotificationRingtone(tone));
    await ref.read(driverAlertToneProvider.notifier).select(tone);
    // Server memakai bunyi baru untuk notifikasi saat aplikasi tertutup.
    unawaited(ref.read(driverControllerProvider.notifier).refreshPushRegistration());
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(driverAlertToneProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifikasi')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            margin: EdgeInsets.zero,
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (final tone in DriverAlertTone.values)
                  ListTile(
                    key: ValueKey('tone-${tone.key}'),
                    leading: const Icon(Icons.music_note_rounded),
                    title: Text(tone.label),
                    trailing: _SelectionMark(selected: selected == tone),
                    onTap: () => unawaited(_choose(ref, tone)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Banner Beranda bila notifikasi dimatikan di Android: tanpa izin ini order
/// baru tidak terdengar saat aplikasi tertutup.
class _NotificationOffBanner extends StatefulWidget {
  const _NotificationOffBanner();

  @override
  State<_NotificationOffBanner> createState() => _NotificationOffBannerState();
}

class _NotificationOffBannerState extends State<_NotificationOffBanner>
    with WidgetsBindingObserver {
  bool _enabled = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_check());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Kembali dari pengaturan Android: periksa ulang.
    if (state == AppLifecycleState.resumed) unawaited(_check());
  }

  Future<void> _check() async {
    final enabled = await driverAreNotificationsEnabled();
    if (mounted && enabled != _enabled) setState(() => _enabled = enabled);
  }

  @override
  Widget build(BuildContext context) {
    if (_enabled) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: _SafetyBanner(
        key: const ValueKey('notifications-off-banner'),
        icon: Icons.notifications_off_rounded,
        text: 'Notifikasi TapGo dimatikan di HP. Anda tidak akan mendengar order baru '
            'saat aplikasi tertutup.',
        buttonLabel: 'Nyalakan Notifikasi',
        onPressed: () => unawaited(openSystemNotificationSettings()),
      ),
    );
  }
}

/// Atur password untuk tapgolion.id (halaman isi Saldo TapGo). Akun yang mendaftar dengan Google dibuat dengan password
/// acak yang tidak diketahui siapa pun, sehingga tanpa layar ini driver tidak bisa masuk ke web untuk mengisi saldo,
/// padahal komisi pesanan tunai ditahan dari saldo itu. Dua langkah: (1) buktikan akun Google yang sama, (2) pilih password.
class DriverWebPasswordScreen extends ConsumerStatefulWidget {
  const DriverWebPasswordScreen({super.key});

  @override
  ConsumerState<DriverWebPasswordScreen> createState() =>
      _DriverWebPasswordScreenState();
}

class _DriverWebPasswordScreenState
    extends ConsumerState<DriverWebPasswordScreen> {
  static const int _minLength = 8;
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  String? _idToken;
  String? _email;
  String? _error;
  bool _busy = false;
  bool _done = false;
  bool _visible = false;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref.read(driverGoogleIdTokenProvider)();
      if (!mounted) return;
      if (result != null) {
        setState(() {
          _idToken = result.idToken;
          _email = result.email;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = googleSignInFailureMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    if (_busy || _idToken == null) return;
    final password = _password.text;
    if (password.length < _minLength) {
      setState(() => _error = 'Password minimal $_minLength karakter.');
      return;
    }
    if (password != _confirm.text) {
      setState(() => _error = 'Konfirmasi password belum sama.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final message = await ref
        .read(driverControllerProvider.notifier)
        .setWebPassword(idToken: _idToken!, newPassword: password);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (message == null) {
        _done = true;
        _password.clear();
        _confirm.clear();
      } else {
        // Token Google dipakai sekali per percobaan; minta verifikasi ulang agar tidak mengirim token yang sama.
        _error = message;
        _idToken = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Password tapgolion.id')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_done) ...[
            Icon(Icons.check_circle_rounded,
                size: 56, color: theme.colorScheme.primary),
            const SizedBox(height: 12),
            Text('Password tersimpan',
                key: const ValueKey('web-password-done'),
                style: theme.textTheme.titleLarge),
            const SizedBox(height: 8),
            const Text(
              'Masuk ke tapgolion.id dengan nomor HP akun TapGo Anda dan password yang baru Anda buat, lalu isi Saldo TapGo.',
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              key: const ValueKey('web-password-open-topup'),
              onPressed: () => launchUrl(
                Uri.parse('https://tapgolion.id/topup'),
                mode: LaunchMode.externalApplication,
              ),
              icon: const Icon(Icons.add_card_rounded),
              label: const Text('Buka halaman isi saldo'),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: () => Navigator.of(context).maybePop(),
              child: const Text('Selesai'),
            ),
          ] else ...[
            Text(
              'Saldo TapGo diisi lewat tapgolion.id. Halaman itu masuk dengan nomor HP dan password. '
              'Akun yang mendaftar dengan Google belum punya password yang Anda ketahui, jadi buat di sini.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 20),
            Text('1. Verifikasi dengan Google',
                style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            if (_idToken == null)
              OutlinedButton.icon(
                key: const ValueKey('web-password-verify-button'),
                onPressed: _busy ? null : _verify,
                icon: const Icon(Icons.verified_user_outlined),
                label: Text(_busy ? 'Memeriksa…' : 'Pilih akun Google saya'),
              )
            else
              Row(
                key: const ValueKey('web-password-verified'),
                children: [
                  Icon(Icons.check_circle_rounded,
                      color: theme.colorScheme.primary),
                  const SizedBox(width: 8),
                  Expanded(child: Text('Terverifikasi: ${_email ?? ''}')),
                ],
              ),
            const SizedBox(height: 24),
            Text('2. Buat password', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            TextField(
              key: const ValueKey('web-password-new'),
              controller: _password,
              enabled: _idToken != null && !_busy,
              obscureText: !_visible,
              autofillHints: const [AutofillHints.newPassword],
              decoration: InputDecoration(
                labelText: 'Password baru (minimal $_minLength karakter)',
                suffixIcon: IconButton(
                  tooltip: _visible ? 'Sembunyikan password' : 'Tampilkan password',
                  icon: Icon(_visible
                      ? Icons.visibility_off_outlined
                      : Icons.visibility_outlined),
                  onPressed: () => setState(() => _visible = !_visible),
                ),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('web-password-confirm'),
              controller: _confirm,
              enabled: _idToken != null && !_busy,
              obscureText: !_visible,
              decoration: const InputDecoration(labelText: 'Ulangi password'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                key: const ValueKey('web-password-error'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ],
            const SizedBox(height: 20),
            FilledButton(
              key: const ValueKey('web-password-save'),
              onPressed: _idToken == null || _busy ? null : _save,
              child: Text(_busy && _idToken != null ? 'Menyimpan…' : 'Simpan password'),
            ),
          ],
        ],
      ),
    );
  }
}
