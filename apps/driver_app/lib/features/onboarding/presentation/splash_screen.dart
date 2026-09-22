part of '../../../main.dart';

/// Kunci penyimpanan lokal penanda "sudah pernah lihat onboarding".
///
/// Dibaca sekali oleh [SplashScreen] untuk memutuskan tujuan navigasi
/// berikutnya. Sengaja disimpan di SharedPreferences (bukan secure storage):
/// nilainya bukan rahasia, hanya preferensi tampilan, dan tetap harus terbaca
/// bahkan sebelum sesi login mana pun diketahui.
const String kOnboardingSeenKey = 'tapgo_driver.onboarding_seen.v1';

/// Layar pembuka TapGo Driver.
///
/// Tampil sekitar 1.2 detik untuk memberi jeda visual bermerek sebelum
/// aplikasi memutuskan tujuan: [OnboardingScreen] untuk pemasangan pertama,
/// atau langsung [DriverShell] bila onboarding sudah pernah dilihat.
/// Keputusan itu SENGAJA tidak bergantung pada status login — driver yang
/// sudah login tetap melihat splash ini, lalu masuk ke DriverShell yang akan
/// menampilkan workspace aktifnya sendiri.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fade;
  late final Animation<double> _scale;

  // Menandai kapan frame PERTAMA layar ini benar-benar tergambar di layar.
  // Ini beda dari "initState dipanggil": di instalasi APK pertama kali di
  // HP nyata, warm-up engine (verifikasi ART atas APK baru, JIT Dart belum
  // pernah jalan) bisa lebih lama dari jeda minimum tampil di bawah. Kalau
  // jeda dihitung dari initState (lewat Stopwatch biasa), navigasi ke
  // halaman berikutnya bisa SELESAI sebelum frame pertama sempat tergambar
  // — splash bermerek jadi tidak pernah benar-benar terlihat pengguna.
  final Completer<void> _firstFrameShown = Completer<void>();

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    )..forward();
    _fade = CurvedAnimation(parent: _controller, curve: Curves.easeOut);
    _scale = Tween<double>(begin: 0.88, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutBack),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_firstFrameShown.isCompleted) {
        _firstFrameShown.complete();
      }
    });
    unawaited(_decideNextRoute());
  }

  Future<bool> _loadOnboardingSeen() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      return preferences.getBool(kOnboardingSeenKey) ?? false;
    } catch (_) {
      // Preferensi gagal dibaca (mis. platform tanpa dukungan) tidak boleh
      // mengunci splash selamanya — anggap belum pernah dilihat, jalan
      // teraman yang tetap membiarkan aplikasi terpakai.
      return false;
    }
  }

  Future<void> _decideNextRoute() async {
    final onboardingSeenFuture = _loadOnboardingSeen();

    // Tunggu frame pertama benar-benar tergambar SEBELUM mulai menghitung
    // jeda minimum tampil — lihat catatan di _firstFrameShown.
    await _firstFrameShown.future;

    // Jeda minimum supaya splash tidak berkedip pada perangkat cepat; tanpa
    // ini merek TapGo nyaris tidak sempat terlihat sebelum layar berikutnya
    // langsung menimpanya. Dihitung dari titik ini (setelah frame pertama
    // tergambar), bukan dari initState.
    const minimumDisplay = Duration(milliseconds: 1200);
    final minimumDisplayFuture = Future<void>.delayed(minimumDisplay);
    final onboardingSeen = await onboardingSeenFuture;
    await minimumDisplayFuture;

    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => onboardingSeen
            ? const DriverShell()
            : const OnboardingScreen(),
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFF061A2F), Color(0xFF0877E8)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: Center(
          child: FadeTransition(
            opacity: _fade,
            child: ScaleTransition(
              scale: _scale,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Semantics(
                    label: 'Logo TapGo',
                    image: true,
                    child: Image.asset(
                      driverBrandLogoAsset,
                      width: 128,
                      height: 128,
                      fit: BoxFit.contain,
                      filterQuality: FilterQuality.high,
                      excludeFromSemantics: true,
                    ),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'TapGo Driver',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 26,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0.2,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Mitra pengemudi tepercaya',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.78),
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 40),
                  const SizedBox(
                    width: 28,
                    height: 28,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.6,
                      valueColor: AlwaysStoppedAnimation<Color>(
                        Color(0xFFFFC857),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
