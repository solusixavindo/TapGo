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
