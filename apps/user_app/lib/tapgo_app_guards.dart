part of 'main.dart';

void installTapGoCrashGuards() {
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    if (kDebugMode) return;
    // Produksi: jendela merah default diganti layar netral; crash tetap
    // tercatat di log, bukan hilang diam-diam.
    ErrorWidget.builder =
        (FlutterErrorDetails details) => const _CrashFallbackScreen();
  };

  // Kesalahan asinkron di luar tangkapan framework — melewati handler ini
  // berarti jejaknya ada, bukan aplikasi yang mati tanpa catatan.
  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('[TapGo Crash] ${error.runtimeType}: $error\n$stack');
    return true;
  };
}

class _CrashFallbackScreen extends StatelessWidget {
  const _CrashFallbackScreen();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(24),
      child: const Text(
        'Terjadi gangguan tampilan. Tutup lalu buka kembali aplikasi.',
        textDirection: TextDirection.ltr,
        textAlign: TextAlign.center,
        // Warna tetap — tidak membaca Theme supaya layar ini tetap
        // dapat dirender bila kerusakan justru terjadi di Theme.
        style: TextStyle(color: Colors.black87, fontSize: 14),
      ),
    );
  }
}

/// Penangan tombol back Android di layar-root aplikasi: mengetuk back di
/// root berarti keluar aplikasi, jadi dimintakan konfirmasi. Sub-layar
/// punya route sendiri dan tidak menyentuh helper ini.
Future<bool> confirmTapGoExit(BuildContext context) async {
  final decision = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Keluar dari TapGo?'),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Batal'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: const Text('Keluar'),
        ),
      ],
    ),
  );
  return decision ?? false;
}
