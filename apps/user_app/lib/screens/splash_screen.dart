part of '../main.dart';

/// Lama splash bermerek tampil sejak aplikasi mulai. Sama seperti sebelumnya (2,4 dtk), tetapi dihitung sejak layar
/// pertama muncul, bukan sejak pekerjaan awal selesai: waktu menunggu penyimpanan aman tidak lagi menjadi layar putih
/// tambahan di depan splash.
const Duration _splashHold = Duration(milliseconds: 2400);

/// Lama animasi masuk logo.
const Duration _splashEntrance = Duration(milliseconds: 1800);

/// Bila pekerjaan awal sangat lama (HP lambat), cincin kecil muncul di bawah logo supaya pengguna tahu aplikasi masih bekerja.
const Duration _splashLoaderAfter = Duration(seconds: 5);

/// Splash bermerek TapGo. Dipakai SEBAGAI layar pertama (selama aplikasi membaca penyimpanan) dan sebagai splash biasa,
/// dengan jam animasi yang sama ([launchedAt]) sehingga peralihan di antara keduanya mulus tanpa lompatan.
///
/// Akar masalah yang diperbaiki (laporan Owner 16 Nov 2026, "halaman putih dengan lingkaran sebelum splash"): dulu
/// layar pertama adalah Scaffold putih dengan CircularProgressIndicator selama penyimpanan aman dibaca (paling lama
/// pada pembukaan pertama, saat Keystore Android baru diinisialisasi), dan splash ini baru muncul sesudahnya.
class _BrandLaunchView extends StatefulWidget {
  const _BrandLaunchView({
    required this.launchedAt,
    this.showLoaderIfSlow = false,
  });

  final DateTime launchedAt;
  final bool showLoaderIfSlow;

  @override
  State<_BrandLaunchView> createState() => _BrandLaunchViewState();
}

class _BrandLaunchViewState extends State<_BrandLaunchView>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fade;
  late final Animation<double> _scale;
  Timer? _loaderTimer;
  bool _showLoader = false;

  @override
  void initState() {
    super.initState();
    final elapsed = tapGoClockForTests().difference(widget.launchedAt);
    // Animasi dilanjutkan dari titik yang sama bila layar ini menggantikan layar sebelumnya (jam bersama).
    final progress =
        (elapsed.inMilliseconds / _splashEntrance.inMilliseconds).clamp(0.0, 1.0);
    _controller = AnimationController(
      vsync: this,
      duration: _splashEntrance,
      value: progress,
    );
    if (progress < 1) _controller.forward();
    _fade = CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic);
    _scale = Tween<double>(
      begin: 0.82,
      end: 1,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.elasticOut));
    if (widget.showLoaderIfSlow) {
      final wait = _splashLoaderAfter - elapsed;
      if (wait <= Duration.zero) {
        _showLoader = true;
      } else {
        _loaderTimer = Timer(wait, () {
          if (mounted) setState(() => _showLoader = true);
        });
      }
    }
  }

  @override
  void dispose() {
    _loaderTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: const ValueKey('brand_launch_view'),
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFF061A32), Color(0xFF0569E8)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: SafeArea(
          child: FadeTransition(
            opacity: _fade,
            child: ScaleTransition(
              scale: _scale,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: _brandOrange.withValues(alpha: 0.42),
                          blurRadius: 44,
                          spreadRadius: 6,
                        ),
                        BoxShadow(
                          color: _brandBlue.withValues(alpha: 0.34),
                          blurRadius: 58,
                          spreadRadius: 18,
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(34),
                      child: Image.asset(
                        'assets/images/tapgo_logo.jpeg',
                        width: 178,
                        height: 178,
                        fit: BoxFit.cover,
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  const Text(
                    'TapGo Lion',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 34,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Akun Basic • Membership • Bantuan',
                    style: TextStyle(
                      color: Color(0xDFFFFFFF),
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (_showLoader) ...[
                    const SizedBox(height: 28),
                    const SizedBox(
                      key: ValueKey('brand_launch_slow_loader'),
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class SplashGate extends StatefulWidget {
  const SplashGate({super.key, this.launchedAt});

  /// Saat aplikasi mulai menampilkan layar pertama. Kosong = sekarang (perilaku lama: splash penuh 2,4 dtk).
  final DateTime? launchedAt;

  @override
  State<SplashGate> createState() => _SplashGateState();
}

class _SplashGateState extends State<SplashGate> {
  late final DateTime _launchedAt = widget.launchedAt ?? tapGoClockForTests();
  bool _showAuth = false;

  @override
  void initState() {
    super.initState();
    // Sisa waktu tahan splash dihitung sejak layar pertama muncul, jadi waktu yang sudah dipakai menunggu penyimpanan
    // tidak ditambahkan lagi (dulu: tunggu + 2,4 dtk).
    final remaining = _splashHold - tapGoClockForTests().difference(_launchedAt);
    Future<void>.delayed(
      remaining.isNegative ? Duration.zero : remaining,
      () {
        if (mounted) {
          setState(() => _showAuth = true);
        }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_showAuth) {
      return const AuthScreen();
    }
    return _BrandLaunchView(launchedAt: _launchedAt);
  }
}
