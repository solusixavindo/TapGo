part of '../../../main.dart';

/// Layar "Uji bunyi": memutar bunyi peringatan dan menampilkan keadaan HP yang
/// menentukan apakah terdengar (izin, kategori notifikasi, mode dering, volume,
/// Jangan Ganggu). Menggantikan tebak-tebakan: satu ketukan memberi penyebab.
class DriverSoundTestScreen extends StatefulWidget {
  const DriverSoundTestScreen({super.key});

  @override
  State<DriverSoundTestScreen> createState() => _DriverSoundTestScreenState();
}

class _DriverSoundTestScreenState extends State<DriverSoundTestScreen> {
  Map<String, Object?>? _info;
  bool _running = false;
  bool _failed = false;
  bool? _heard;

  @override
  void initState() {
    super.initState();
    unawaited(_run());
  }

  Future<void> _run() async {
    setState(() {
      _running = true;
      _failed = false;
      _heard = null;
    });
    final info = await driverSoundDiagnostics();
    if (!mounted) return;
    setState(() {
      _info = info;
      _failed = info == null;
      _running = false;
    });
  }

  Color _color(SoundCheckLevel level) => switch (level) {
        SoundCheckLevel.ok => const Color(0xFF16A34A),
        SoundCheckLevel.warn => const Color(0xFFF59E0B),
        SoundCheckLevel.bad => const Color(0xFFDC2626),
      };

  IconData _icon(SoundCheckLevel level) => switch (level) {
        SoundCheckLevel.ok => Icons.check_circle_rounded,
        SoundCheckLevel.warn => Icons.warning_amber_rounded,
        SoundCheckLevel.bad => Icons.cancel_rounded,
      };

  @override
  Widget build(BuildContext context) {
    final info = _info;
    final checks = info == null ? const <SoundCheck>[] : driverSoundChecks(info);
    final hasBad = checks.any((c) => c.level == SoundCheckLevel.bad);
    return Scaffold(
      appBar: AppBar(title: const Text('Uji bunyi')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Bunyi diputar sekarang. Dengarkan, lalu periksa daftar di bawah untuk '
            'melihat apa yang menghalangi bila tidak terdengar.',
          ),
          const SizedBox(height: 12),
          if (_running) const Center(child: CircularProgressIndicator()),
          if (_failed)
            const ErrorNotice(
              key: ValueKey('sound-test-unavailable'),
              message: 'Uji bunyi tidak tersedia di perangkat ini.',
            ),
          for (var i = 0; i < checks.length; i++)
            ListTile(
              key: ValueKey('sound-check-${checks[i].level.name}-$i'),
              contentPadding: EdgeInsets.zero,
              leading: Icon(_icon(checks[i].level), color: _color(checks[i].level)),
              title: Text(checks[i].title),
              subtitle: checks[i].detail.isEmpty ? null : Text(checks[i].detail),
            ),
          if (info != null) ...[
            const Divider(height: 24),
            Text(
              hasBad
                  ? 'Ada hal di HP yang menghalangi bunyi. Perbaiki yang bertanda merah.'
                  : 'Pengaturan HP sudah benar.',
              key: const ValueKey('sound-test-verdict'),
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            Text('Apakah bunyi terdengar?',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                FilledButton(
                  key: const ValueKey('sound-heard-yes'),
                  onPressed: () => setState(() => _heard = true),
                  child: const Text('Ya, terdengar'),
                ),
                OutlinedButton(
                  key: const ValueKey('sound-heard-no'),
                  onPressed: () => setState(() => _heard = false),
                  child: const Text('Tidak terdengar'),
                ),
              ],
            ),
            if (_heard == false && !hasBad)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Semua pengaturan terlihat benar tetapi tidak terdengar. Tekan '
                  '"Salin laporan" dan kirim ke tim TapGo.',
                  key: ValueKey('sound-test-report-hint'),
                ),
              ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  key: const ValueKey('sound-test-again'),
                  onPressed: _running ? null : _run,
                  icon: const Icon(Icons.volume_up_rounded),
                  label: const Text('Putar lagi'),
                ),
                OutlinedButton.icon(
                  key: const ValueKey('sound-test-settings'),
                  onPressed: () => unawaited(openSystemNotificationSettings()),
                  icon: const Icon(Icons.notifications_active_outlined),
                  label: const Text('Pengaturan notifikasi'),
                ),
                OutlinedButton.icon(
                  key: const ValueKey('sound-test-copy'),
                  onPressed: () async {
                    await Clipboard.setData(
                        ClipboardData(text: driverSoundReportText(info)));
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Laporan disalin.')));
                  },
                  icon: const Icon(Icons.copy_rounded),
                  label: const Text('Salin laporan'),
                ),
              ],
            ),
          ],
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
