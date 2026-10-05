part of '../main.dart';

/// Uji bunyi: keadaan HP yang menentukan apakah bunyi terdengar (izin notifikasi,
/// kategori notifikasi, mode dering, volume, Jangan Ganggu, nada bawaan).
/// Satu ketukan memberi penyebab, menggantikan tebak-tebakan.

/// Seam uji: mengganti pemanggilan MethodChannel sungguhan.
@visibleForTesting
Future<Map<String, Object?>?> Function()? tapGoSoundDiagnosticsForTests;

/// Meminta sisi native memutar bunyi dan melaporkan keadaan HP; null bila gagal.
Future<Map<String, Object?>?> tapGoSoundDiagnostics() async {
  final override = tapGoSoundDiagnosticsForTests;
  if (override != null) return override();
  try {
    return await tapGoAlertsMethodChannel
        .invokeMapMethod<String, Object?>('soundDiagnostics');
  } catch (_) {
    return null;
  }
}

/// Membuka pengaturan notifikasi Android untuk aplikasi ini.
Future<bool> tapGoOpenNotificationSettings() async {
  try {
    return await tapGoAlertsMethodChannel
            .invokeMethod<bool>('openNotificationSettings') ??
        false;
  } catch (_) {
    return false;
  }
}

enum TapGoSoundCheckLevel { ok, warn, bad }

class TapGoSoundCheck {
  const TapGoSoundCheck(this.level, this.title, this.detail);
  final TapGoSoundCheckLevel level;
  final String title;
  final String detail;
}

/// Mengubah laporan native menjadi daftar pemeriksaan beserta tindakan
/// perbaikannya. Fungsi murni (diuji).
List<TapGoSoundCheck> tapGoSoundChecks(Map<String, Object?> info) {
  int? intOf(String key) => info[key] is num ? (info[key] as num).toInt() : null;
  final checks = <TapGoSoundCheck>[];

  if (info['notificationsEnabled'] == false) {
    checks.add(const TapGoSoundCheck(TapGoSoundCheckLevel.bad, 'Notifikasi dimatikan',
        'Android memblokir semua notifikasi TapGo. Buka pengaturan notifikasi dan nyalakan.'));
  } else {
    checks.add(const TapGoSoundCheck(TapGoSoundCheckLevel.ok, 'Notifikasi diizinkan', ''));
  }

  if (info['soundResourceFound'] == false) {
    checks.add(const TapGoSoundCheck(TapGoSoundCheckLevel.bad,
        'Berkas suara tidak ada di aplikasi', 'Pasang ulang aplikasi dari berkas terbaru.'));
  }

  final importance = intOf('channelImportance');
  if (info['channelExists'] == false) {
    checks.add(const TapGoSoundCheck(TapGoSoundCheckLevel.bad,
        'Kategori "Peringatan TapGo" belum dibuat', 'Tutup aplikasi sepenuhnya lalu buka lagi.'));
  } else if (importance != null && importance < 4) {
    checks.add(TapGoSoundCheck(TapGoSoundCheckLevel.bad,
        'Kategori "Peringatan TapGo" tidak berstatus Penting',
        'Tingkat saat ini $importance (perlu 4). Buka pengaturan notifikasi, pilih "Peringatan TapGo", set ke Penting dengan suara.'));
  } else if (info['channelExists'] == true) {
    checks.add(const TapGoSoundCheck(
        TapGoSoundCheckLevel.ok, 'Kategori "Peringatan TapGo" aktif (Penting)', ''));
  }

  switch (intOf('ringerMode')) {
    case 0:
      checks.add(const TapGoSoundCheck(TapGoSoundCheckLevel.bad, 'HP dalam mode senyap',
          'Ubah mode dering ke Suara agar pemberitahuan terdengar.'));
    case 1:
      checks.add(const TapGoSoundCheck(TapGoSoundCheckLevel.warn, 'HP dalam mode getar',
          'Notifikasi hanya bergetar. Ubah ke Suara agar berbunyi.'));
    case 2:
      checks.add(const TapGoSoundCheck(TapGoSoundCheckLevel.ok, 'Mode dering: Suara', ''));
  }

  final volume = intOf('volumeNotification');
  final volumeMax = intOf('volumeNotificationMax');
  if (volume != null) {
    if (volume == 0) {
      checks.add(const TapGoSoundCheck(TapGoSoundCheckLevel.bad, 'Volume notifikasi nol',
          'Naikkan volume notifikasi: Pengaturan HP > Suara > Volume notifikasi.'));
    } else if (volumeMax != null && volume <= (volumeMax / 4).floor()) {
      checks.add(TapGoSoundCheck(TapGoSoundCheckLevel.warn,
          'Volume notifikasi sangat rendah ($volume/$volumeMax)',
          'Naikkan volume notifikasi agar terdengar.'));
    } else {
      checks.add(TapGoSoundCheck(
          TapGoSoundCheckLevel.ok, 'Volume notifikasi $volume/${volumeMax ?? '?'}', ''));
    }
  }

  final dnd = intOf('dndFilter');
  if (dnd != null && dnd > 1) {
    checks.add(TapGoSoundCheck(
        TapGoSoundCheckLevel.bad,
        'Mode Jangan Ganggu aktif',
        dnd == 4
            ? 'Hanya alarm yang berbunyi. Matikan Jangan Ganggu atau izinkan TapGo.'
            : 'Notifikasi dibisukan. Matikan Jangan Ganggu atau izinkan TapGo.'));
  }

  final playError = info['playError'];
  if (playError is String && playError.isNotEmpty) {
    checks.add(TapGoSoundCheck(TapGoSoundCheckLevel.bad, 'Bunyi gagal diputar', playError));
  } else if (info.containsKey('playError')) {
    checks.add(const TapGoSoundCheck(
        TapGoSoundCheckLevel.ok, 'Bunyi berhasil diputar oleh aplikasi', ''));
  }
  return checks;
}

/// Laporan teks untuk disalin dan dikirim ke tim.
String tapGoSoundReportText(Map<String, Object?> info) {
  final keys = info.keys.toList()..sort();
  return ['Laporan uji bunyi TapGo', for (final k in keys) '$k: ${info[k]}'].join('\n');
}

class TapGoSoundTestScreen extends StatefulWidget {
  const TapGoSoundTestScreen({super.key});

  @override
  State<TapGoSoundTestScreen> createState() => _TapGoSoundTestScreenState();
}

class _TapGoSoundTestScreenState extends State<TapGoSoundTestScreen> {
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
    final info = await tapGoSoundDiagnostics();
    if (!mounted) return;
    setState(() {
      _info = info;
      _failed = info == null;
      _running = false;
    });
  }

  Color _color(TapGoSoundCheckLevel level) => switch (level) {
        TapGoSoundCheckLevel.ok => const Color(0xFF16A34A),
        TapGoSoundCheckLevel.warn => const Color(0xFFF59E0B),
        TapGoSoundCheckLevel.bad => const Color(0xFFDC2626),
      };

  IconData _icon(TapGoSoundCheckLevel level) => switch (level) {
        TapGoSoundCheckLevel.ok => Icons.check_circle_rounded,
        TapGoSoundCheckLevel.warn => Icons.warning_amber_rounded,
        TapGoSoundCheckLevel.bad => Icons.cancel_rounded,
      };

  @override
  Widget build(BuildContext context) {
    final info = _info;
    final checks = info == null ? const <TapGoSoundCheck>[] : tapGoSoundChecks(info);
    final hasBad = checks.any((c) => c.level == TapGoSoundCheckLevel.bad);
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
            const Text('Uji bunyi tidak tersedia di perangkat ini.',
                key: ValueKey('sound-test-unavailable')),
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
                  onPressed: () => unawaited(tapGoOpenNotificationSettings()),
                  icon: const Icon(Icons.notifications_active_outlined),
                  label: const Text('Pengaturan notifikasi'),
                ),
                OutlinedButton.icon(
                  key: const ValueKey('sound-test-copy'),
                  onPressed: () async {
                    await Clipboard.setData(
                        ClipboardData(text: tapGoSoundReportText(info)));
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
