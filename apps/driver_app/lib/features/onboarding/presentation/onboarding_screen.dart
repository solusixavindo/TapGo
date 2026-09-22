part of '../../../main.dart';

class _OnboardingPageData {
  const _OnboardingPageData({
    required this.icon,
    required this.iconColors,
    required this.title,
    required this.description,
  });

  final IconData icon;
  final List<Color> iconColors;
  final String title;
  final String description;
}

const List<_OnboardingPageData> _onboardingPages = [
  _OnboardingPageData(
    icon: Icons.two_wheeler_rounded,
    iconColors: [Color(0xFF0877E8), Color(0xFF0B5ED0)],
    title: 'Penghasilan Fleksibel,\nWaktu di Tangan Anda',
    description:
        'Nyalakan aplikasi kapan saja Anda siap narik. Tidak ada jam '
        'wajib, tidak ada target harian yang mengunci jadwal Anda.',
  ),
  _OnboardingPageData(
    icon: Icons.payments_rounded,
    iconColors: [Color(0xFFFFC857), Color(0xFFE0AE3F)],
    title: 'Tarif Terlihat\nSebelum Anda Terima',
    description:
        'Setiap orderan menampilkan estimasi pendapatan di depan — tidak '
        'ada kejutan setelah perjalanan selesai.',
  ),
  _OnboardingPageData(
    icon: Icons.verified_user_rounded,
    iconColors: [Color(0xFF12B981), Color(0xFF0E9268)],
    title: 'Dokumen Aman,\nTim Selalu Siap Bantu',
    description:
        'Berkas identitas Anda terenkripsi dan diverifikasi cepat. Tim '
        'dukungan TapGo siap membantu kapan pun dibutuhkan.',
  ),
];

/// Tiga layar perkenalan yang tampil sekali saat pemasangan pertama.
///
/// Ditandai selesai lewat [kOnboardingSeenKey] begitu pengguna menekan
/// "Lewati" atau menuntaskan seluruh halaman — sesudahnya [SplashScreen]
/// tidak akan menampilkan layar ini lagi pada peluncuran berikutnya.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _pageController = PageController();
  int _page = 0;

  Future<void> _finish() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      await preferences.setBool(kOnboardingSeenKey, true);
    } catch (_) {
      // Kegagalan menyimpan preferensi tidak boleh menghalangi pengguna
      // melanjutkan ke aplikasi — onboarding sekadar akan tampil lagi pada
      // peluncuran berikutnya, bukan kerugian yang fatal.
    }
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(builder: (_) => const DriverShell()),
    );
  }

  void _next() {
    if (_page == _onboardingPages.length - 1) {
      unawaited(_finish());
      return;
    }
    _pageController.nextPage(
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isLastPage = _page == _onboardingPages.length - 1;
    return Scaffold(
      backgroundColor: const Color(0xFFF3F7FB),
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.topRight,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 16, 0),
                child: TextButton(
                  key: const ValueKey('driver-onboarding-skip'),
                  onPressed: isLastPage ? null : () => unawaited(_finish()),
                  child: Text(
                    'Lewati',
                    style: TextStyle(
                      color: isLastPage
                          ? Colors.transparent
                          : const Color(0xFF061A2F).withValues(alpha: 0.55),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
            Expanded(
              child: PageView.builder(
                key: const ValueKey('driver-onboarding-pageview'),
                controller: _pageController,
                itemCount: _onboardingPages.length,
                onPageChanged: (index) => setState(() => _page = index),
                itemBuilder: (context, index) =>
                    _OnboardingPage(data: _onboardingPages[index]),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 28),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(
                      _onboardingPages.length,
                      (index) => AnimatedContainer(
                        duration: const Duration(milliseconds: 220),
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        width: index == _page ? 24 : 8,
                        height: 8,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(4),
                          color: index == _page
                              ? const Color(0xFF0877E8)
                              : const Color(0xFFD7E3F2),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    key: const ValueKey('driver-onboarding-next'),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFFFFC857),
                      foregroundColor: const Color(0xFF061A2F),
                      minimumSize: const Size.fromHeight(52),
                      textStyle: const TextStyle(
                        fontFamily: 'Roboto',
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    onPressed: _next,
                    child: Text(isLastPage ? 'Mulai Sekarang' : 'Lanjut'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnboardingPage extends StatelessWidget {
  const _OnboardingPage({required this.data});

  final _OnboardingPageData data;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 176,
            height: 176,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                colors: data.iconColors,
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              boxShadow: [
                BoxShadow(
                  color: data.iconColors.last.withValues(alpha: 0.32),
                  blurRadius: 32,
                  offset: const Offset(0, 16),
                ),
              ],
            ),
            child: Icon(data.icon, size: 84, color: Colors.white),
          ),
          const SizedBox(height: 40),
          Text(
            data.title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w900,
              color: Color(0xFF061A2F),
              height: 1.25,
            ),
          ),
          const SizedBox(height: 14),
          Text(
            data.description,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 15,
              color: const Color(0xFF061A2F).withValues(alpha: 0.62),
              height: 1.45,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
