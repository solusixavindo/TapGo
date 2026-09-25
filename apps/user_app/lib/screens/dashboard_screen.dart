part of '../main.dart';

class TapGoDashboard extends StatefulWidget {
  const TapGoDashboard({super.key});

  @override
  State<TapGoDashboard> createState() => _TapGoDashboardState();
}

class _TapGoDashboardState extends State<TapGoDashboard> {
  int _selectedIndex = 0;

  static const _pages = [
    _HomeTab(),
    ActivityScreen(),
    ChatScreen(),
    AccountScreen(),
  ];

  void _selectTab(int index) {
    HapticFeedback.selectionClick();
    setState(() => _selectedIndex = index);
  }

  void _openSuperMenu() {
    HapticFeedback.lightImpact();
    _openDemo(context, const SuperMenuScreen());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            AnimatedSwitcher(
              duration: _TapGoMotion.duration(context, _TapGoMotion.quick),
              switchInCurve: _TapGoMotion.standardCurve,
              switchOutCurve: _TapGoMotion.exitCurve,
              child: KeyedSubtree(
                key: ValueKey(_selectedIndex),
                child: _pages[_selectedIndex],
              ),
            ),
            _DashboardEntrance(
              order: 7,
              child: _BottomNav(
                selectedIndex: _selectedIndex,
                onTabSelected: _selectTab,
                onCenterTap: _openSuperMenu,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HomeTab extends ConsumerStatefulWidget {
  const _HomeTab();

  @override
  ConsumerState<_HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends ConsumerState<_HomeTab> {
  final _scrollController = ScrollController();
  double _scrollOffset = 0;
  bool _refreshing = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_handleScroll);
  }

  void _handleScroll() {
    final nextOffset = _scrollController.offset.clamp(0, 120).toDouble();
    if ((nextOffset - _scrollOffset).abs() < 1) return;
    setState(() => _scrollOffset = nextOffset);
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_handleScroll)
      ..dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final production = ref.watch(_productionSnapshotProvider);
    final session = ref.watch(_demoSessionProvider);
    final parallax = _scrollOffset / 120;
    final promoScale = 1 + (parallax * 0.035);
    return RefreshIndicator(
      color: _brandBlue,
      onRefresh: () async {
        setState(() => _refreshing = true);
        try {
          final _ = await ref.refresh(_productionSnapshotProvider.future);
        } finally {
          if (mounted) {
            setState(() => _refreshing = false);
          }
        }
      },
      child: AnimatedOpacity(
        opacity: _refreshing ? 0.86 : 1,
        duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
        curve: _TapGoMotion.standardCurve,
        child: SingleChildScrollView(
          controller: _scrollController,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 176),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Hanya tampil saat harness bukti visual menyalakan fixture.
              // Tidak pernah muncul pada aplikasi yang dirilis.
              if (tapGoDashboardVisualFixtureEnabledForTests)
                const _DashboardFixtureBadge(),
              _ProductionBindingBanner(state: production),
              if (production.isLoading) const SizedBox(height: 10),
              _DashboardEntrance(
                order: 0,
                child: Transform.translate(
                  offset: Offset(0, -parallax * 8),
                  child: Transform.scale(
                    scale: 1 - (parallax * 0.025),
                    child: _TopBar(session: session),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              _DashboardEntrance(
                order: 2,
                child: Transform.translate(
                  offset: Offset(0, parallax * 8),
                  child: Transform.scale(
                    scale: promoScale,
                    child: const _PromoHero(),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              // Kartu Membership biru dihapus (permintaan Owner) — Akun sudah
              // menampilkan tier & status. Beranda selalu menampilkan kartu
              // saldo TapGoPay.
              _DashboardEntrance(
                order: 3,
                child: _WalletCard(
                  session: session,
                  state: production,
                ),
              ),
              // Play: kartu "Paket aktif: Basic" dihapus (permintaan Owner —
              // Akun sudah menampilkan tier & status, kartu ini cuma
              // mengulanginya) dan digantikan kartu saldo PPOB yang lebih
              // berguna di Beranda.
              const SizedBox(height: 16),
              _DashboardEntrance(
                order: 4,
                child: _PpobBalanceCard(
                  session: session,
                  isLoading: production.isLoading,
                ),
              ),
              const SizedBox(height: 22),
              const _DashboardEntrance(
                order: 5,
                child: _ServiceGrid(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

bool get _dashboardLiveAnimationsEnabled => !WidgetsBinding.instance.runtimeType
    .toString()
    .contains('TestWidgetsFlutterBinding');

class _DashboardEntrance extends StatefulWidget {
  const _DashboardEntrance({required this.order, required this.child});

  final int order;
  final Widget child;

  @override
  State<_DashboardEntrance> createState() => _DashboardEntranceState();
}

class _DashboardEntranceState extends State<_DashboardEntrance> {
  bool _visible = false;

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(Duration(milliseconds: 54 * widget.order), () {
      if (mounted) setState(() => _visible = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final reduced = _TapGoMotion.reduce(context);
    return AnimatedOpacity(
      opacity: _visible || reduced ? 1 : 0,
      duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
      curve: _TapGoMotion.standardCurve,
      child: AnimatedSlide(
        offset: _visible || reduced ? Offset.zero : const Offset(0, 0.055),
        duration: _TapGoMotion.duration(context, _TapGoMotion.page),
        curve: _TapGoMotion.standardCurve,
        child: widget.child,
      ),
    );
  }
}

class _ProductionBindingBanner extends ConsumerWidget {
  const _ProductionBindingBanner({required this.state});

  final AsyncValue<_TapGoProductionSnapshot> state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    late final Widget child;
    late final String stateKey;
    if (state.isLoading) {
      stateKey = 'loading';
      child = const _DashboardSkeletonLoading();
    } else if (state.hasError) {
      stateKey = 'error';
      child = _CompactRetryPill(
        icon: Icons.cloud_off_rounded,
        label: 'Data belum tersedia',
        onRetry: () => ref.invalidate(_productionSnapshotProvider),
      );
    } else {
      stateKey = 'ready';
      child = const _InlineStatePill(
        icon: Icons.cloud_done_rounded,
        label: 'Data TapGo tersinkron',
      );
    }

    return AnimatedSwitcher(
      duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
      switchInCurve: _TapGoMotion.standardCurve,
      switchOutCurve: _TapGoMotion.exitCurve,
      transitionBuilder: (child, animation) =>
          FadeTransition(opacity: animation, child: child),
      child: KeyedSubtree(key: ValueKey(stateKey), child: child),
    );
  }
}

class _DashboardSkeletonLoading extends StatelessWidget {
  const _DashboardSkeletonLoading();

  @override
  Widget build(BuildContext context) {
    return const Column(
      children: [
        Padding(
          padding: EdgeInsets.only(bottom: 10),
          child: Row(
            children: [
              _SkeletonBar(width: 72),
              SizedBox(width: 8),
              Expanded(child: _SkeletonBar(width: double.infinity)),
              SizedBox(width: 8),
              _SkeletonBar(width: 48),
            ],
          ),
        ),
        _DashboardSkeletonCard(),
        SizedBox(height: 10),
      ],
    );
  }
}

class _DashboardSkeletonCard extends StatelessWidget {
  const _DashboardSkeletonCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SkeletonBar(width: 112),
          SizedBox(height: 12),
          _SkeletonBar(width: 220),
          SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _SkeletonBar(width: double.infinity)),
              SizedBox(width: 12),
              Expanded(child: _SkeletonBar(width: double.infinity)),
            ],
          ),
        ],
      ),
    );
  }
}

class _SkeletonBar extends StatelessWidget {
  const _SkeletonBar({required this.width});

  final double width;

  @override
  Widget build(BuildContext context) {
    final reduced = _TapGoMotion.reduce(context);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.45, end: 1),
      duration: _TapGoMotion.duration(
        context,
        reduced ? Duration.zero : const Duration(milliseconds: 700),
      ),
      curve: Curves.easeInOut,
      builder: (context, value, child) => Opacity(opacity: value, child: child),
      child: Container(
        width: width,
        height: 14,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          gradient: const LinearGradient(
            colors: [Color(0xFFE7EEF8), Color(0xFFF8FBFF), Color(0xFFE7EEF8)],
          ),
        ),
      ),
    );
  }
}

class _DashboardValueSwitcher extends StatelessWidget {
  const _DashboardValueSwitcher({required this.value, required this.style});

  final String value;
  final TextStyle style;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
      switchInCurve: _TapGoMotion.standardCurve,
      switchOutCurve: _TapGoMotion.exitCurve,
      transitionBuilder: (child, animation) =>
          FadeTransition(opacity: animation, child: child),
      child: Text(
        value,
        key: ValueKey(value),
        maxLines: 1,
        softWrap: false,
        overflow: TextOverflow.ellipsis,
        style: style,
      ),
    );
  }
}

class _DashboardAnimatedValue extends StatefulWidget {
  const _DashboardAnimatedValue({
    required this.value,
    required this.formatter,
    required this.style,
  });

  final int value;
  final String Function(int value) formatter;
  final TextStyle style;

  @override
  State<_DashboardAnimatedValue> createState() =>
      _DashboardAnimatedValueState();
}

class _DashboardAnimatedValueState extends State<_DashboardAnimatedValue> {
  late int _beginValue;

  @override
  void initState() {
    super.initState();
    _beginValue = widget.value;
  }

  @override
  void didUpdateWidget(covariant _DashboardAnimatedValue oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.value != widget.value) {
      _beginValue = oldWidget.value;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_TapGoMotion.reduce(context)) {
      return Text(
        widget.formatter(widget.value),
        maxLines: 1,
        softWrap: false,
        overflow: TextOverflow.ellipsis,
        style: widget.style,
      );
    }

    return TweenAnimationBuilder<double>(
      tween: Tween<double>(
        begin: _beginValue.toDouble(),
        end: widget.value.toDouble(),
      ),
      duration: _TapGoMotion.duration(
        context,
        const Duration(milliseconds: 360),
      ),
      curve: _TapGoMotion.standardCurve,
      builder: (context, animatedValue, child) {
        return Text(
          widget.formatter(animatedValue.round()),
          maxLines: 1,
          softWrap: false,
          overflow: TextOverflow.ellipsis,
          style: widget.style,
        );
      },
    );
  }
}

/// Label kejujuran saat dashboard memakai fixture visual.
///
/// Keberadaannya membuat tangkapan layar tidak dapat disalahartikan sebagai
/// data produksi.
class _DashboardFixtureBadge extends StatelessWidget {
  const _DashboardFixtureBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFFF8A00).withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(10),
      ),
      child: const Row(
        children: [
          Icon(Icons.science_rounded, size: 16, color: Color(0xFFB45309)),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              '$tapGoDashboardFixtureLabel — data contoh untuk tinjauan '
              'visual, bukan data nyata.',
              style: TextStyle(
                color: Color(0xFFB45309),
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CompactRetryPill extends StatelessWidget {
  const _CompactRetryPill({
    required this.icon,
    required this.label,
    required this.onRetry,
  });

  final IconData icon;
  final String label;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colorScheme.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: colorScheme.outlineVariant),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              Icon(icon, size: 16, color: _brandBlue),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                ),
              ),
              // Tombol ikut dibatasi ruang yang ada; tanpa ini labelnya
              // meluber saat teks diperbesar.
              Flexible(
                child: TextButton(
                  onPressed: onRetry,
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: const Size(0, 32),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text(
                    'Muat Ulang',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InlineStatePill extends StatelessWidget {
  const _InlineStatePill({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colorScheme.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: colorScheme.outlineVariant),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              Icon(icon, size: 16, color: _brandBlue),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    color: colorScheme.onSurfaceVariant,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TopBar extends ConsumerWidget {
  const _TopBar({required this.session});

  final DemoClientSession session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF06284A), Color(0xFF0B5FC7)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(28),
        boxShadow: [
          BoxShadow(
            color: _brandBlue.withValues(alpha: 0.24),
            blurRadius: 22,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Colors.white.withValues(alpha: 0.22)),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(17),
              child: Image.asset(
                'assets/images/tapgo_logo.jpeg',
                width: 50,
                height: 50,
                fit: BoxFit.cover,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Halo, ${session.userName}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xDDEAF7FF),
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 7),
                Container(
                  constraints: const BoxConstraints(maxWidth: 160),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFB000),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    session.activePackageName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF0A2A43),
                      fontSize: 12,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
          ),
          _HeaderIconButton(
            icon: Icons.notifications_none_rounded,
            tooltip: 'Notifikasi',
            onTap: () => _showInfoSnack(
              context,
              'Notifikasi belum dapat dibuka saat ini',
            ),
          ),
          const SizedBox(width: 8),
          _HeaderIconButton(
            icon: Icons.logout_rounded,
            tooltip: 'Logout',
            onTap: () => _confirmAndLogout(context, ref),
          ),
        ],
      ),
    );
  }
}

class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Semantics(
        button: true,
        label: tooltip,
        child: _TapScale(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.16),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white.withValues(alpha: 0.20)),
            ),
            child: Icon(icon, color: Colors.white, size: 23),
          ),
        ),
      ),
    );
  }
}

class _TapScale extends StatelessWidget {
  const _TapScale({
    required this.child,
    required this.onTap,
    required this.borderRadius,
  });

  final Widget child;
  final VoidCallback onTap;
  final BorderRadius borderRadius;

  @override
  Widget build(BuildContext context) {
    return _TapGoPressable(
      onTap: onTap,
      borderRadius: borderRadius,
      pressedScale: 0.96,
      child: child,
    );
  }
}

void _showInfoSnack(BuildContext context, String message) {
  _TapGoSnackbar.info(context, message);
}

/// Top up TapGoPay diproses di web (tapgolion.id), bukan di dalam app —
/// pembayaran eksternal in-app menuntut Play Billing, sama seperti alasan
/// upgrade membership dipindah ke web (lihat ADR R2 di docs/release-2/).
Future<void> _openTopUpWebsite(BuildContext context) async {
  final uri = Uri.parse('https://tapgolion.id/topup');
  if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
    if (context.mounted) {
      _showInfoSnack(context, 'Halaman top up belum dapat dibuka.');
    }
  }
}

class _PromoHero extends StatefulWidget {
  const _PromoHero();

  @override
  State<_PromoHero> createState() => _PromoHeroState();
}

class _PromoHeroState extends State<_PromoHero> {
  final _controller = PageController();
  Timer? _timer;
  int _index = 0;

  static const _slides = [
    _PromoSlideData(
      title: 'TapGo Ride',
      subtitle: 'Mitra TapGo siap bergerak bersama komunitas.',
      chip: 'Mitra di Jalan',
      icon: Icons.two_wheeler_rounded,
      accent: Color(0xFFFFB000),
      imageAsset: 'assets/images/banners/tapgo_driver_banner.jpeg',
    ),
    _PromoSlideData(
      title: 'Jaket Mitra TapGo',
      subtitle: 'Identitas premium untuk member dan mitra.',
      chip: 'Official Gear',
      icon: Icons.verified_rounded,
      accent: Color(0xFFFFD36B),
      imageAsset: 'assets/images/banners/tapgo_jacket_banner.jpeg',
    ),
    _PromoSlideData(
      title: 'Gabung Mitra TapGo',
      subtitle: 'Membership, referral, dan benefit dalam satu aplikasi.',
      chip: 'Benefit Mitra',
      icon: Icons.workspace_premium_rounded,
      accent: Color(0xFFFFB000),
      imageAsset: 'assets/images/banners/tapgo_membership_partner_banner.jpeg',
    ),
  ];

  @override
  void initState() {
    super.initState();
    if (_dashboardLiveAnimationsEnabled) {
      _timer = Timer.periodic(const Duration(seconds: 5), (_) {
        if (!mounted || !_controller.hasClients) return;
        final next = (_index + 1) % _slides.length;
        _controller.animateToPage(
          next,
          duration: const Duration(milliseconds: 420),
          curve: Curves.easeOutCubic,
        );
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Tinggi carousel dulu tetap 238 dp, sehingga isi kartu meluber saat teks
    // diperbesar. Faktor di bawah bernilai 1 pada skala normal, jadi tampilan
    // biasa tidak berubah sedikit pun.
    final textScaleFactor = max(
      1.0,
      MediaQuery.textScalerOf(context).scale(12) / 12,
    );
    return SizedBox(
      height: 238 * textScaleFactor,
      child: Stack(
        children: [
          PageView.builder(
            controller: _controller,
            itemCount: _slides.length,
            onPageChanged: (index) => setState(() => _index = index),
            itemBuilder: (context, index) => _PromoSlide(data: _slides[index]),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 12,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(
                _slides.length,
                (index) => AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  width: _index == index ? 18 : 7,
                  height: 7,
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(
                      alpha: _index == index ? 0.95 : 0.42,
                    ),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                        color: Theme.of(context).colorScheme.outlineVariant),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PromoSlideData {
  const _PromoSlideData({
    required this.title,
    required this.subtitle,
    required this.chip,
    required this.icon,
    required this.accent,
    this.imageAsset,
  });

  final String title;
  final String subtitle;
  final String chip;
  final IconData icon;
  final Color accent;
  final String? imageAsset;
}

class _PromoSlide extends StatelessWidget {
  const _PromoSlide({required this.data});

  final _PromoSlideData data;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final isCompact = constraints.maxWidth < 380;
        final hasImage = data.imageAsset != null;
        final textWidth = hasImage
            ? (isCompact ? constraints.maxWidth * 0.56 : 228.0)
            : (isCompact ? constraints.maxWidth * 0.62 : 248.0);
        return Container(
          margin: const EdgeInsets.only(bottom: 2),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            color: const Color(0xFF06284A),
            gradient: hasImage
                ? null
                : const LinearGradient(
                    colors: [
                      Color(0xFF06284A),
                      Color(0xFF0B5FC7),
                      Color(0xFFFFB000),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
            boxShadow: [
              BoxShadow(
                color: _brandBlue.withValues(alpha: 0.24),
                blurRadius: 24,
                offset: const Offset(0, 14),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            children: [
              if (data.imageAsset != null)
                Positioned.fill(
                  child: Image.asset(data.imageAsset!, fit: BoxFit.cover),
                ),
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: hasImage
                          ? [
                              const Color(0xE6041B33),
                              const Color(0x9906284A),
                              const Color(0x2206284A),
                              const Color(0x88041B33),
                            ]
                          : [
                              Colors.transparent,
                              Colors.white.withValues(alpha: 0.02),
                            ],
                      stops: hasImage ? const [0, 0.42, 0.72, 1] : null,
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                    ),
                  ),
                ),
              ),
              if (!hasImage)
                Positioned(
                  right: isCompact ? 12 : 18,
                  bottom: 18,
                  child: _HeroOrbit(accent: data.accent, icon: data.icon),
                ),
              if (!hasImage)
                Positioned(
                  right: isCompact ? 92 : 118,
                  bottom: 30,
                  child: _HeroMiniIcon(icon: data.icon, color: data.accent),
                ),
              Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.asset(
                            'assets/images/tapgo_logo.jpeg',
                            width: 28,
                            height: 28,
                            fit: BoxFit.cover,
                          ),
                        ),
                        const SizedBox(width: 8),
                        const Text(
                          'TAPGO',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: textWidth,
                      child: Text(
                        data.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: isCompact ? 20 : 22,
                          height: 1.06,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    const SizedBox(height: 9),
                    SizedBox(
                      width: textWidth,
                      child: Text(
                        data.subtitle,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xDDEAF7FF),
                          fontSize: 12,
                          height: 1.32,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    Container(
                      constraints: BoxConstraints(maxWidth: textWidth + 24),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.18),
                        ),
                      ),
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          data.chip,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _HeroOrbit extends StatelessWidget {
  const _HeroOrbit({required this.accent, required this.icon});

  final Color accent;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 112,
      height: 112,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          colors: [
            Colors.white.withValues(alpha: 0.24),
            Colors.white.withValues(alpha: 0.08),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: Colors.white.withValues(alpha: 0.24)),
      ),
      child: Center(
        child: Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            boxShadow: const [
              BoxShadow(
                color: Color(0x33000000),
                blurRadius: 18,
                offset: Offset(0, 10),
              ),
            ],
            border:
                Border.all(color: Theme.of(context).colorScheme.outlineVariant),
          ),
          child: Icon(icon, color: accent, size: 34),
        ),
      ),
    );
  }
}

class _HeroMiniIcon extends StatelessWidget {
  const _HeroMiniIcon({required this.icon, required this.color});

  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 54,
      height: 54,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
            color: Color(0x26000000),
            blurRadius: 14,
            offset: Offset(0, 8),
          ),
        ],
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Icon(icon, color: color, size: 27),
    );
  }
}

class _WalletCard extends ConsumerWidget {
  const _WalletCard({required this.session, required this.state});

  final DemoClientSession session;
  final AsyncValue<_TapGoProductionSnapshot> state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasError = state.hasError;
    final isLoading = state.isLoading;
    final caption = hasError
        ? 'Muat ulang'
        : isLoading
            ? 'Menghubungkan wallet'
            : 'Klik untuk riwayat';
    return _TapScale(
      borderRadius: BorderRadius.circular(28),
      onTap: hasError
          ? () => ref.invalidate(_productionSnapshotProvider)
          : () => _openDemo(context, const WalletScreen()),
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF041B33), Color(0xFF0758C9), Color(0xFF0B7BF7)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(28),
          boxShadow: [
            BoxShadow(
              color: _brandBlue.withValues(alpha: 0.30),
              blurRadius: 30,
              offset: const Offset(0, 18),
            ),
          ],
        ),
        child: Stack(
          children: [
            Positioned(
              left: 24,
              top: 10,
              right: 124,
              child: Container(
                height: 1,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      Colors.white.withValues(alpha: 0.00),
                      Colors.white.withValues(alpha: 0.34),
                      Colors.white.withValues(alpha: 0.00),
                    ],
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 38,
                              height: 38,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.18),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: 0.16),
                                ),
                              ),
                              child: const Icon(
                                Icons.account_balance_wallet_rounded,
                                color: Colors.white,
                                size: 23,
                              ),
                            ),
                            const SizedBox(width: 9),
                            // Judul dibatasi ruang yang ada supaya tidak
                            // meluber saat teks diperbesar.
                            const Flexible(
                              child: Text(
                                'TapGoPay',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 15,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: isLoading
                              ? const _SkeletonBar(width: 168)
                              : hasError
                                  ? const _DashboardValueSwitcher(
                                      value: 'Gagal memuat data',
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontSize: 31,
                                        height: 1,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    )
                                  : _DashboardAnimatedValue(
                                      value: session.walletBalance,
                                      formatter: formatRupiah,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 31,
                                        height: 1,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                        ),
                        const SizedBox(height: 10),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(
                              color: Colors.white.withValues(alpha: 0.12),
                            ),
                          ),
                          child: _DashboardValueSwitcher(
                            value: caption,
                            style: const TextStyle(
                              color: Color(0xE6FFFFFF),
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  _WalletAction(
                    icon: Icons.add_rounded,
                    onTap: () => _openTopUpWebsite(context),
                  ),
                  const SizedBox(width: 12),
                  _WalletAction(
                    icon: Icons.near_me_rounded,
                    onTap: () =>
                        _openDemo(context, const WalletTransferScreen()),
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

/// Kartu saldo PPOB untuk Beranda (Play). Menggantikan _MarketingPlanCard
/// yang sebelumnya di sini — lihat catatan di call site dashboard_screen.dart.
class _PpobBalanceCard extends StatelessWidget {
  const _PpobBalanceCard({required this.session, required this.isLoading});

  final DemoClientSession session;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    // Sebelumnya pakai teknik "bingkai gradien" (Container gradien luar +
    // padding tipis + ClipRRect radius sedikit lebih kecil di dalam) yang
    // dipinjam dari _MarketingPlanCard. Kombinasi gradien linear kontras
    // tinggi (lavender-ungu-putih) dengan selisih radius luar/dalam membuat
    // cincin tipis itu terlihat tidak rata tepat di sudut — laporan "ujung
    // lancip" dari Owner. Diganti satu Container radius tunggal + border
    // solid tipis supaya sudutnya benar-benar mulus.
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white.withValues(alpha: 0.55)),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF4F46E5).withValues(alpha: 0.20),
            blurRadius: 22,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Stack(
          children: [
            const Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Color(0xFF4F46E5), Color(0xFF6D5AE6)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
              ),
            ),
            const Positioned.fill(child: _ShineSweep()),
            Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const _ServiceAssetIcon(
                        label: 'PPOB',
                        icon: Icons.receipt_long_rounded,
                        style: _ServiceIconStyle(
                          primary: Color(0xFF4F46E5),
                          secondary: Color(0xFF818CF8),
                          background: Color(0xFFEEF0FF),
                        ),
                        size: 52,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Saldo PPOB',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 13,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              isLoading
                                  ? 'Memuat saldo...'
                                  : _formatCompactRupiah(session.ppobBalance),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 24,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Gunakan saldo PPOB untuk Pulsa, Paket Data, Token PLN, '
                    'E-Wallet, BPJS, dan PDAM.',
                    style: TextStyle(
                      color: Color(0xDDFFFFFF),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () => tapGoOpenPpobHome(context),
                      icon: const Icon(Icons.receipt_long_rounded),
                      label: const Text('Buka PPOB'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: const Color(0xFF4F46E5),
                        backgroundColor: Colors.white.withValues(alpha: 0.92),
                        side: BorderSide(
                          color: Colors.white.withValues(alpha: 0.72),
                        ),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                    ),
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

class _ShineSweep extends StatefulWidget {
  const _ShineSweep();

  @override
  State<_ShineSweep> createState() => _ShineSweepState();
}

class _ShineSweepState extends State<_ShineSweep>
    with SingleTickerProviderStateMixin {
  // Versi lama: sapuan LINEAR (tanpa easing) berulang nonstop setiap 3.6
  // detik — laporan Owner: "animasi kurang profesional" pada kartu saldo
  // PPOB. Diganti pola yang dipakai app kelas atas: satu kedipan cahaya
  // singkat dengan easing halus, lalu jeda diam yang jauh lebih panjang
  // sebelum berulang, bukan lampu sorot yang muter terus-menerus.
  static const _cycleDuration = Duration(milliseconds: 5200);
  static const _sweepFraction = 0.22;

  late final AnimationController _controller;
  late final Animation<double> _progress;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: _cycleDuration);
    _progress = CurvedAnimation(
      parent: _controller,
      curve: const Interval(
        0,
        _sweepFraction,
        curve: Curves.easeInOutCubic,
      ),
    );
    if (_dashboardLiveAnimationsEnabled) {
      _controller.repeat();
    } else {
      _controller.value = 0.24;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _progress,
      builder: (context, child) {
        final dx = -1.4 + (_progress.value * 2.8);
        return Transform.translate(
          offset: Offset(dx * 180, 0),
          child: Transform.rotate(
            angle: -0.42,
            child: Center(
              child: Container(
                width: 42,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      Colors.white.withValues(alpha: 0),
                      Colors.white.withValues(alpha: 0.22),
                      Colors.white.withValues(alpha: 0),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _ServiceGrid extends StatelessWidget {
  const _ServiceGrid();

  static const _playServices = [
    // Release 2 yang diunggah ke Play Store memuat Ojek Online, sehingga entry
    // point Motor dan Mobil hadir di sini.
    // Keduanya tidak bergantung pada flag demo: menu tetap terlihat, dan yang
    // fail closed adalah penyedia lokasi di dalam alurnya.
    _ServiceItem('Motor', Icons.two_wheeler_rounded, Color(0xFF0569E8), null),
    _ServiceItem('Mobil', Icons.local_taxi_rounded, Color(0xFF0B7A75), null),
    // Stage R2.7: PPOB (pulsa/data/token/BPJS/PDAM/e-money) masuk grid Play;
    // pembayaran via saldo internal sehingga tidak melanggar kebijakan
    // pembayaran Play.
    _ServiceItem('PPOB', Icons.payments_rounded, Color(0xFF1486B8), null),
    _ServiceItem('Kartu Anggota', Icons.badge_rounded, Color(0xFFF59E0B), null),
  ];

  @override
  Widget build(BuildContext context) {
    const services = _playServices;

    // Tinggi sel sebelumnya diturunkan semata dari childAspectRatio, sehingga
    // ikut mengecil bersama lebar layar. Pada 320 dp sel menjadi lebih pendek
    // daripada isi kartu dan itulah overflow 12 px-nya.
    //
    // Sekarang tinggi sel adalah yang TERBESAR antara tinggi rasio lama dan
    // tinggi yang benar-benar dibutuhkan isi. Pada 360 dp dan 412 dp tinggi
    // rasio sudah lebih besar, jadi tampilannya tidak berubah sedikit pun;
    // yang berubah hanya lebar sempit yang memang tidak muat.
    return LayoutBuilder(
      builder: (context, constraints) {
        const crossAxisCount = 4;
        const crossAxisSpacing = 12.0;
        // Dijepit >= 0: bila grid sesaat mendapat lebar 0 (mis. halaman di
        // bawah rute yang sedang dibuka), lebar negatif membuat SizedBox label
        // melempar galat dan seluruh layar berubah menjadi "gangguan tampilan".
        final tileWidth = max(
          0.0,
          (constraints.maxWidth - crossAxisSpacing * (crossAxisCount - 1)) /
              crossAxisCount,
        );
        final ratioHeight = tileWidth / 0.66;
        final contentHeight = _serviceTileContentHeight(context);

        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: services.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: crossAxisCount,
            mainAxisSpacing: 18,
            crossAxisSpacing: crossAxisSpacing,
            mainAxisExtent: max(ratioHeight, contentHeight),
          ),
          itemBuilder: (context, index) {
            final item = services[index];
            return _FloatingServiceTile(
              index: index,
              child: _ServiceTile(
                item: item,
                // Label dibatasi lebar sel supaya tidak meluber ke kartu
                // tetangga pada layar sempit.
                maxLabelWidth: min(_serviceTileLabelWidth, tileWidth),
                onTap: _tapGoServiceActionFor(context, item),
              ),
            );
          },
        );
      },
    );
  }
}

VoidCallback? _tapGoServiceActionFor(BuildContext context, _ServiceItem item) {
  if (item.badge != null) {
    return null;
  }
  // Ojek Online diperiksa lebih dulu supaya berlaku pada kedua distribusi.
  // Sebelumnya cabang play mengembalikan null untuk label ride, sehingga
  // fiturnya tidak dapat dibuka pada build Play meski kartunya ada.
  final rideService = tapGoRideEntryServiceFor(item.label);
  if (rideService != null) {
    return () => tapGoOpenRideEntry(context, rideService);
  }
  // PPOB (Stage R2.7) berlaku pada kedua distribusi: pembelian pulsa/data/
  // token memakai saldo internal TapGo, bukan pembayaran eksternal, sehingga
  // sah pada build Play. 'Pulsa' adalah label lama.
  if (item.label == 'PPOB' || item.label == 'Pulsa') {
    return () => tapGoOpenPpobHome(context);
  }
  return switch (item.label) {
    'Kartu Anggota' => () => _openDemo(
          context,
          const BasicMemberCardScreen(),
        ),
    'Profil' => () => _openDemo(context, const ProfileDetailsScreen()),
    'Tiket Bantuan' => () => _openDemo(context, const ContactUsScreen()),
    'Hapus Akun' => () => _openDemo(
          context,
          const DeleteAccountRequestScreen(),
        ),
    _ => null,
  };
}

/// Memetakan label kartu layanan dashboard ke jenis layanan Ojek Online.
///
/// Dipakai dashboard sebagai satu-satunya sumber kebenaran pemetaan, sehingga
/// test menguji pemetaan yang sama dengan yang dipakai produksi. Label
/// 'Motor'/'Mobil' dipakai dashboard Release 2; 'TapGo Ride'/'TapGo Car' adalah
/// label distribusi direct yang tetap didukung.
RideServiceKind? tapGoRideEntryServiceFor(String label) {
  return switch (label) {
    'TapGo Ride' || 'Motor' => RideServiceKind.motorcycle,
    'TapGo Car' || 'Mobil' => RideServiceKind.car,
    _ => null,
  };
}

/// Membuka Ojek Online melalui gerbang pemulihan.
///
/// Sengaja BUKAN langsung ke layar pemesanan: gerbang bertanya ke server lebih
/// dulu, sehingga perjalanan yang masih berjalan dibuka kembali alih-alih
/// pengguna menawarkan dirinya memesan dua kali.
void tapGoOpenRideEntry(BuildContext context, RideServiceKind service) {
  Navigator.of(context).push(
    _tapGoPageRoute((_) => RideEntryScreen(service: service)),
  );
}

class _FloatingServiceTile extends StatefulWidget {
  const _FloatingServiceTile({required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  State<_FloatingServiceTile> createState() => _FloatingServiceTileState();
}

class _FloatingServiceTileState extends State<_FloatingServiceTile>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _offset;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: 2800 + (widget.index * 120)),
    );
    _offset = Tween<double>(
      begin: -2,
      end: 2,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
    if (_dashboardLiveAnimationsEnabled) {
      Future<void>.delayed(Duration(milliseconds: widget.index * 90), () {
        if (mounted) _controller.repeat(reverse: true);
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_dashboardLiveAnimationsEnabled) return widget.child;
    return AnimatedBuilder(
      animation: _offset,
      builder: (context, child) =>
          Transform.translate(offset: Offset(0, _offset.value), child: child),
      child: widget.child,
    );
  }
}

class _BottomNav extends ConsumerWidget {
  const _BottomNav({
    required this.selectedIndex,
    required this.onTabSelected,
    required this.onCenterTap,
  });

  final int selectedIndex;
  final ValueChanged<int> onTabSelected;
  final VoidCallback onCenterTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final avatarBytes = ref.watch(_accountAvatarBytesProvider).valueOrNull;
    final screenWidth = MediaQuery.sizeOf(context).width;
    final centerGap = screenWidth < 380 ? 60.0 : 74.0;
    final colorScheme = Theme.of(context).colorScheme;

    return Stack(
      children: [
        Positioned(
          left: 18,
          right: 18,
          bottom: 18,
          child: Container(
            height: _navBarHeight(context),
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              color: colorScheme.surface,
              borderRadius: BorderRadius.circular(28),
              border: Border.all(color: colorScheme.outlineVariant),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.14),
                  blurRadius: 22,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: LayoutBuilder(
              builder: (context, constraints) {
                // Lebar item nav dulu dipatok 58 dp. Pada 320 dp, empat item
                // ditambah celah tengah melampaui lebar bar dan itulah
                // overflow 30 px-nya.
                //
                // Lebar diukur dari constraint yang sebenarnya — bukan ditebak
                // dari lebar layar dikurangi inset — lalu menyusut hanya bila
                // memang tidak muat, dan tidak pernah di bawah 48 dp sehingga
                // tap target minimum tetap terpenuhi. Pada 360 dp dan 412 dp
                // hasilnya tetap 58 dp seperti sebelumnya.
                final fitItemWidth = (constraints.maxWidth - centerGap) / 4;
                final navItemWidth = fitItemWidth >= _navItemPreferredWidth
                    ? _navItemPreferredWidth
                    : max(_navItemMinWidth, fitItemWidth);

                return Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _NavItem(
                      icon: Icons.home_rounded,
                      label: 'Beranda',
                      width: navItemWidth,
                      active: selectedIndex == 0,
                      onTap: () => onTabSelected(0),
                    ),
                    _NavItem(
                      icon: Icons.receipt_rounded,
                      label: 'Aktivitas',
                      width: navItemWidth,
                      active: selectedIndex == 1,
                      onTap: () => onTabSelected(1),
                    ),
                    SizedBox(width: centerGap),
                    _NavItem(
                      icon: Icons.chat_bubble_outline_rounded,
                      label: 'Chat',
                      width: navItemWidth,
                      active: selectedIndex == 2,
                      onTap: () => onTabSelected(2),
                    ),
                    _NavItem(
                      icon: Icons.person_outline_rounded,
                      avatarBytes: avatarBytes,
                      label: 'Akun',
                      width: navItemWidth,
                      active: selectedIndex == 3,
                      onTap: () => onTabSelected(3),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 42,
          child: Center(
            child: _TapGoPressable(
              onTap: onCenterTap,
              borderRadius: BorderRadius.circular(999),
              pressedScale: 0.96,
              child: Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: _brandBlue,
                  shape: BoxShape.circle,
                  border: Border.all(color: colorScheme.surface, width: 6),
                  boxShadow: [
                    BoxShadow(
                      color: _brandBlue.withValues(alpha: 0.32),
                      blurRadius: 18,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.apps_rounded,
                  color: Colors.white,
                  size: 31,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Lebar item nav yang diinginkan, dan lantai tap target minimum.
const double _navItemPreferredWidth = 58;
const double _navItemMinWidth = 48;

/// Tinggi bar nav pada skala teks normal.
const double _navBarBaseHeight = 82;

/// Tinggi bar nav yang ikut skala teks.
///
/// Tinggi tetap 82 dp membuat isi item meluber saat pengguna memperbesar teks.
/// Bar kini tumbuh ke atas seperlunya, dan pada skala normal nilainya tetap 82
/// sehingga tampilannya tidak berubah.
double _navBarHeight(BuildContext context) {
  final scaler = MediaQuery.textScalerOf(context);
  // Ikon aktif (26 + padding 8 atas-bawah), jarak 5, indikator 3 + margin 3,
  // lalu label satu baris.
  final needed = 42 + 5 + 6 + scaler.scale(12) * 1.35 + 8;
  return max(_navBarBaseHeight, needed);
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
    this.width = _navItemPreferredWidth,
    this.avatarBytes,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;
  final double width;
  // Dipakai HANYA oleh item "Akun" — bila terisi, foto profil ditampilkan
  // menggantikan ikon generik. Item lain tidak pernah mengisi ini.
  final Uint8List? avatarBytes;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final color = active ? _brandBlue : colorScheme.onSurfaceVariant;

    return _TapGoPressable(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      pressedScale: 0.97,
      child: SizedBox(
        width: width,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOutCubic,
              padding: EdgeInsets.all(active ? 8 : 0),
              decoration: BoxDecoration(
                color: active
                    ? _brandBlue.withValues(alpha: 0.10)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(16),
              ),
              child: AnimatedScale(
                scale: active ? 1.10 : 1,
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                child: avatarBytes != null && avatarBytes!.isNotEmpty
                    ? CircleAvatar(
                        radius: 13,
                        backgroundImage: MemoryImage(avatarBytes!),
                      )
                    : Icon(icon, color: color, size: 26),
              ),
            ),
            const SizedBox(height: 5),
            AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              width: active ? 18 : 0,
              height: 3,
              margin: const EdgeInsets.only(bottom: 3),
              decoration: BoxDecoration(
                color: _brandBlue,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            AnimatedOpacity(
              opacity: active ? 1 : 0.74,
              duration: _TapGoMotion.duration(context, _TapGoMotion.quick),
              curve: _TapGoMotion.standardCurve,
              child: Text(
                label,
                maxLines: 1,
                // Jaring pengaman saat item menyusut atau teks diperbesar;
                // pada ukuran normal label tetap utuh.
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: color,
                  fontSize: 12,
                  fontWeight: active ? FontWeight.w900 : FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ActivityScreen extends ConsumerStatefulWidget {
  const ActivityScreen({super.key});

  @override
  ConsumerState<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends ConsumerState<ActivityScreen> {
  int _tabIndex = 0;

  static const _tabs = ['Semua', 'Layanan', 'Saldo'];

  @override
  Widget build(BuildContext context) {
    final feed = ref.watch(_activityFeedProvider);
    const tabs = _tabs;
    final selected = tabs[_tabIndex];
    final all = feed.valueOrNull?.items ?? const <ActivityItem>[];
    final items = selected == 'Semua'
        ? all
        : all.where((item) => item.category == selected).toList();

    return RefreshIndicator(
      // Kegagalan muat ulang ditampilkan lewat state error provider, bukan
      // dilempar ke RefreshIndicator sebagai error tak tertangani.
      onRefresh: () => ref
          .refresh(_activityFeedProvider.future)
          .then((_) {})
          .catchError((_) {}),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 176),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const _SectionHeader(
              title: 'Aktivitas',
              subtitle: 'Pembelian, perjalanan, dan transaksi saldo',
            ),
            const SizedBox(height: 16),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: List.generate(
                  tabs.length,
                  (index) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(tabs[index]),
                      selected: _tabIndex == index,
                      selectedColor: _brandBlue,
                      checkmarkColor: Colors.white,
                      labelStyle: TextStyle(
                        color: _tabIndex == index
                            ? Colors.white
                            : Theme.of(context).colorScheme.onSurface,
                        fontWeight: FontWeight.w800,
                      ),
                      onSelected: (_) => setState(() => _tabIndex = index),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (feed.isLoading && !feed.hasValue)
              const _SkeletonList(count: 5, label: 'Memuat aktivitas')
            else if (feed.hasError && !feed.hasValue)
              _RetryStatusSurface(
                icon: Icons.cloud_off_rounded,
                title: 'Data belum tersedia',
                subtitle: 'Silakan muat ulang aktivitas.',
                onRetry: () => ref.invalidate(_activityFeedProvider),
              )
            else ...[
              if ((feed.valueOrNull?.failedSources ?? 0) > 0 &&
                  items.isNotEmpty)
                const Padding(
                  padding: EdgeInsets.only(bottom: 12),
                  child: Text(
                    'Sebagian riwayat belum termuat. Tarik ke bawah untuk memuat ulang.',
                    style: TextStyle(
                      color: Color(0xFF718096),
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              if (items.isEmpty)
                const _EmptyState(
                  icon: Icons.inbox_rounded,
                  title: 'Belum ada aktivitas',
                  subtitle:
                      'Pembelian PPOB, perjalanan, dan transaksi saldo akan muncul di sini.',
                )
              else
                ...items.map((item) => _ActivityTile(item: item)),
            ],
          ],
        ),
      ),
    );
  }
}

/// Tiket bantuan terbaru untuk tab Chat. Memakai pemuat yang sama dengan layar
/// Tiket Bantuan sehingga perilaku (dan hook uji) tidak bercabang.
final _supportPreviewProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final loader = tapGoSupportTicketsLoaderForTests;
  if (loader != null) {
    return loader();
  }
  if (tapGoDisablePersistenceForTests) {
    return const [];
  }
  final session = ref.read(_demoSessionProvider);
  if (session.accessToken == null || session.accessToken!.isEmpty) {
    throw StateError('Belum ada token backend.');
  }
  _apiClient.setAccessToken(session.accessToken);
  return _apiClient.supportTickets();
});

/// Tab Chat: percakapan bantuan dengan tim TapGo (tiket dukungan). Notifikasi
/// dan pesan lain belum ada di aplikasi, jadi tidak dijanjikan di sini.
class ChatScreen extends ConsumerWidget {
  const ChatScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(_supportPreviewProvider);
    return RefreshIndicator(
      onRefresh: () =>
          ref.refresh(_supportPreviewProvider.future).then((_) {}).catchError(
                (_) {},
              ),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 176),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const _SectionHeader(
              title: 'Chat',
              subtitle: 'Percakapan bantuan dengan tim TapGo',
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () => _openDemo(context, const ContactUsScreen()),
                icon: const Icon(Icons.support_agent_rounded),
                label: const Text('Hubungi Bantuan'),
                style: FilledButton.styleFrom(
                  backgroundColor: _brandBlue,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (tickets.isLoading && !tickets.hasValue)
              const _SkeletonList(count: 3, label: 'Memuat percakapan')
            else if (tickets.hasError && !tickets.hasValue)
              _RetryStatusSurface(
                icon: Icons.cloud_off_rounded,
                title: 'Percakapan belum tersedia',
                subtitle: 'Silakan muat ulang.',
                onRetry: () => ref.invalidate(_supportPreviewProvider),
              )
            else if ((tickets.valueOrNull ?? const []).isEmpty)
              const _EmptyState(
                icon: Icons.chat_bubble_outline_rounded,
                title: 'Belum ada percakapan',
                subtitle:
                    'Ada kendala? Tekan Hubungi Bantuan dan tim TapGo akan membalas di sini.',
              )
            else
              ...tickets.valueOrNull!
                  .take(10)
                  .map((ticket) => _SupportTicketCard(ticket)),
          ],
        ),
      ),
    );
  }
}

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(_demoSessionProvider);
    final avatarBytes = ref.watch(_accountAvatarBytesProvider).valueOrNull;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 176),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _AccountHero(session: session, avatarBytes: avatarBytes),
          // _AccountHero sudah menampilkan nama, tier, dan status aktif.
          const SizedBox(height: 16),
          _AccountMenuTile(
            'Kartu Anggota',
            Icons.badge_rounded,
            () => _openDemo(context, const BasicMemberCardScreen()),
          ),
          _AccountMenuTile(
            'Profil',
            Icons.person_rounded,
            () => _openDemo(context, const ProfileDetailsScreen()),
          ),
          _AccountMenuTile(
            'Ubah Password',
            Icons.lock_rounded,
            () => _openDemo(context, const ChangePasswordScreen()),
            subtitle: 'Ganti password akun Anda',
          ),
          _AccountMenuTile(
            'Tampilan',
            Icons.palette_rounded,
            () => _openDemo(context, const ThemeSettingsScreen()),
            subtitle: 'Atur tema aplikasi',
          ),
          _AccountMenuTile(
            'Tiket Bantuan',
            Icons.volunteer_activism_rounded,
            () => _openDemo(context, const ContactUsScreen()),
          ),
          _AccountMenuTile(
            'Kebijakan Privasi',
            Icons.privacy_tip_rounded,
            () => _openDemo(
              context,
              const LegalInfoScreen(
                title: 'Kebijakan Privasi',
                content: _tapGoPrivacyPolicyContent,
              ),
            ),
          ),
          _AccountMenuTile(
            'Syarat & Ketentuan',
            Icons.gavel_rounded,
            () => _openDemo(
              context,
              const LegalInfoScreen(
                title: 'Syarat & Ketentuan',
                content: _tapGoTermsContent,
              ),
            ),
          ),
          _AccountMenuTile(
            'Hapus Akun',
            Icons.delete_outline_rounded,
            () => _openDemo(context, const DeleteAccountRequestScreen()),
          ),
          _AccountMenuTile(
            'Hubungi Kami',
            Icons.support_agent_rounded,
            () => _openDemo(context, const ContactUsScreen()),
          ),
          _AccountMenuTile(
            'Bantuan',
            Icons.help_outline_rounded,
            () => _openDemo(context, const HelpCenterScreen()),
          ),
          _AccountMenuTile(
            'Logout',
            Icons.logout_rounded,
            () => _confirmAndLogout(context, ref),
          ),
          const SizedBox(height: 12),
          const _AppVersionLabel(),
        ],
      ),
    );
  }
}

/// Versi aplikasi di kaki menu Akun: memudahkan pengguna dan tim bantuan
/// memastikan build yang terpasang. Tidak tampil bila versi tak terbaca.
class _AppVersionLabel extends StatelessWidget {
  const _AppVersionLabel();

  static Future<String?> _load() async {
    try {
      final info = await PackageInfo.fromPlatform();
      return 'TapGo versi ${info.version} (${info.buildNumber})';
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<String?>(
      future: _load(),
      builder: (context, snapshot) {
        final label = snapshot.data;
        if (label == null) {
          return const SizedBox.shrink();
        }
        return Center(
          child: Text(
            label,
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        );
      },
    );
  }
}

class ThemeSettingsScreen extends ConsumerWidget {
  const ThemeSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected = ref.watch(tapGoThemePreferenceProvider);
    return _DemoScaffold(
      title: 'Tampilan',
      subtitle: 'Atur tema aplikasi',
      child: Column(
        children: [
          for (final preference in TapGoThemePreference.values)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _ThemeOptionTile(
                preference: preference,
                selected: selected == preference,
                onSelected: () => ref
                    .read(tapGoThemePreferenceProvider.notifier)
                    .setPreference(preference),
              ),
            ),
        ],
      ),
    );
  }
}

class _ThemeOptionTile extends StatelessWidget {
  const _ThemeOptionTile({
    required this.preference,
    required this.selected,
    required this.onSelected,
  });

  final TapGoThemePreference preference;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return _TapGoPressable(
      onTap: onSelected,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        key: ValueKey('theme_option_${preference.storageValue}'),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: colorScheme.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected ? _brandBlue : colorScheme.outlineVariant,
            width: selected ? 1.4 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked_rounded
                  : Icons.radio_button_unchecked_rounded,
              color: selected ? _brandBlue : colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                preference.label,
                style: TextStyle(
                  color: colorScheme.onSurface,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                  decoration: TextDecoration.none,
                ),
              ),
            ),
            if (selected)
              const Icon(Icons.check_circle_rounded, color: _brandBlue),
          ],
        ),
      ),
    );
  }
}

class ProfileDetailsScreen extends ConsumerStatefulWidget {
  const ProfileDetailsScreen({super.key});

  @override
  ConsumerState<ProfileDetailsScreen> createState() =>
      _ProfileDetailsScreenState();
}

class _ProfileDetailsScreenState extends ConsumerState<ProfileDetailsScreen> {
  // Future di-cache sekali di initState, TIDAK dibuat ulang tiap build().
  // ProfileDetailsScreen menonton _demoSessionProvider, yang ditulis ulang
  // oleh alur seperti ubah nomor HP — kalau _load() dipanggil inline di
  // dalam build() (pola lama), setiap tulisan sesi memicu FutureBuilder
  // membuang Future lama dan memulai request baru pertengahan alur lain,
  // memperbesar jendela race pada rebuild yang tumpang tindih.
  late Future<_BasicMemberCardData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load(ref.read(_demoSessionProvider));
  }

  Future<_BasicMemberCardData> _load(DemoClientSession session) async {
    final loader = tapGoMemberIdentityLoaderForTests;
    if (loader != null) {
      return _BasicMemberCardData.fromMap(await loader());
    }
    if (tapGoDisablePersistenceForTests) {
      return _BasicMemberCardData(
        displayName: session.userName,
        phone: session.phone,
        memberId: 'TGM-TESTCARD',
        status: 'ACTIVE',
        membership: 'Basic',
        joinedAt: DateTime(2026, 7, 14),
      );
    }
    final data = await _apiClient.memberIdentity();
    return _BasicMemberCardData.fromMap(data);
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(_demoSessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Profil')),
      body: FutureBuilder<_BasicMemberCardData>(
        future: _future,
        builder: (context, snapshot) {
          final fallback = _BasicMemberCardData(
            displayName:
                session.userName.isEmpty ? 'Member TapGo' : session.userName,
            phone: session.phone,
            memberId: '-',
            status: 'ACTIVE',
            membership: 'Basic',
            joinedAt: DateTime.tryParse(session.membershipJoinedAt ?? '') ??
                DateTime.now(),
          );
          final profile = snapshot.data ?? fallback;
          final isLoading = snapshot.connectionState != ConnectionState.done;
          final hasError = snapshot.hasError;
          final statusLabel = profile.status.toUpperCase() == 'ACTIVE'
              ? 'Aktif'
              : 'Tidak aktif';
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
            children: [
              const _ProfileAvatarEditor(),
              const SizedBox(height: 16),
              if (isLoading)
                const _StatusSurface(
                  icon: Icons.sync_rounded,
                  title: 'Memuat profil',
                  subtitle: 'Data profil sedang disiapkan.',
                )
              else if (hasError)
                const _StatusSurface(
                  icon: Icons.info_outline_rounded,
                  title: 'Sebagian data belum tersedia',
                  subtitle:
                      'Profil tetap dapat digunakan dengan data akun yang aman.',
                ),
              if (isLoading || hasError) const SizedBox(height: 12),
              const _SectionLabel('Identitas'),
              const SizedBox(height: 10),
              _ProfileInfoPanel(
                children: [
                  _ProfileDetailRow(
                    label: 'Nama lengkap',
                    value: profile.displayName,
                  ),
                  _ProfileDetailRow(
                    label: 'Nomor HP',
                    value: _maskProfilePhone(
                      profile.phone.isEmpty ? session.phone : profile.phone,
                    ),
                  ),
                  _ProfileDetailRow(
                    label: 'Public Member ID',
                    value: profile.memberId.isEmpty ? '-' : profile.memberId,
                  ),
                  _ProfileDetailRow(
                    label: 'Email',
                    value: profile.email == null
                        ? 'Belum diisi'
                        : profile.emailVerified
                            ? '${profile.email} (terverifikasi)'
                            : '${profile.email} (belum diverifikasi)',
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () => _showPhoneEditSheet(context, ref, session),
                  icon: const Icon(Icons.edit_rounded, size: 18),
                  label: const Text('Ubah nomor HP'),
                ),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => const VerificationGateScreen(),
                    ),
                  ),
                  icon: Icon(
                    profile.email == null
                        ? Icons.mail_outline_rounded
                        : Icons.verified_user_outlined,
                    size: 18,
                  ),
                  label: Text(
                    profile.email == null ? 'Tambah email' : 'Kelola email',
                  ),
                ),
              ),
              const SizedBox(height: 6),
              const _SectionLabel('Keanggotaan'),
              const SizedBox(height: 10),
              _ProfileInfoPanel(
                children: [
                  const _ProfileDetailRow(label: 'Paket', value: 'Basic'),
                  _ProfileDetailRow(label: 'Status', value: statusLabel),
                  _ProfileDetailRow(
                    label: 'Tanggal bergabung',
                    value: _formatMemberDate(profile.joinedAt),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Editor foto profil untuk [ProfileDetailsScreen].
///
/// Berbeda dari [_TapGoProfileImage] (yang membaca berkas lokal sisa alur
/// registrasi membership), widget ini mengambil/mengunggah foto lewat
/// backend (`GET`/`POST /account/avatar`) sehingga foto tersimpan di server
/// dan tampil di perangkat mana pun pengguna masuk.
class _ProfileAvatarEditor extends ConsumerStatefulWidget {
  const _ProfileAvatarEditor();

  @override
  ConsumerState<_ProfileAvatarEditor> createState() =>
      _ProfileAvatarEditorState();
}

class _ProfileAvatarEditorState extends ConsumerState<_ProfileAvatarEditor> {
  static const int _maxAvatarBytes = 4 * 1024 * 1024;

  Uint8List? _bytes;
  bool _isLoading = true;
  bool _isUploading = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadAvatar());
  }

  Future<void> _loadAvatar() async {
    try {
      final bytes = await _apiClient.fetchAvatarBytes();
      if (mounted) {
        setState(() {
          _bytes = bytes;
          _isLoading = false;
        });
      }
    } catch (_) {
      // Gagal memuat foto tidak boleh menghalangi sisa halaman profil —
      // cukup tampilkan placeholder, pengguna tetap bisa mengunggah ulang.
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  String _contentTypeFor(String path) {
    return path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  }

  Future<void> _pickAndUpload() async {
    final source = await _showTapGoBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading:
                    const Icon(Icons.photo_library_rounded, color: _brandBlue),
                title: const Text('Pilih dari Galeri'),
                onTap: () =>
                    Navigator.of(sheetContext).pop(ImageSource.gallery),
              ),
              ListTile(
                leading:
                    const Icon(Icons.photo_camera_rounded, color: _brandOrange),
                title: const Text('Ambil Foto dengan Kamera'),
                onTap: () => Navigator.of(sheetContext).pop(ImageSource.camera),
              ),
              ListTile(
                leading:
                    const Icon(Icons.close_rounded, color: Color(0xFF697386)),
                title: const Text('Batal'),
                onTap: () => Navigator.of(sheetContext).pop(),
              ),
            ],
          ),
        ),
      ),
    );
    if (source == null || !mounted) {
      return;
    }

    XFile? image;
    try {
      image = await ImagePicker().pickImage(
        source: source,
        imageQuality: 82,
        maxWidth: 1024,
      );
    } catch (_) {
      if (mounted) {
        _TapGoSnackbar.error(context, 'Gagal membuka kamera/galeri.');
      }
      return;
    }
    if (image == null || !mounted) {
      return;
    }

    final bytes = await image.readAsBytes();
    if (bytes.length > _maxAvatarBytes) {
      if (mounted) {
        _TapGoSnackbar.warning(context, 'Ukuran foto maksimal 4MB.');
      }
      return;
    }

    setState(() => _isUploading = true);
    try {
      await _apiClient.uploadAvatar(
        bytes,
        contentType: _contentTypeFor(image.path),
      );
      if (mounted) {
        setState(() {
          _bytes = bytes;
          _isUploading = false;
        });
        // Ikon tab "Akun" membaca foto dari provider terpisah supaya tidak
        // menembak request sendiri — invalidasi di sini supaya ikon nav
        // ikut ter-refresh, bukan hanya foto di halaman ini.
        ref.invalidate(_accountAvatarBytesProvider);
        _TapGoSnackbar.success(context, 'Foto profil berhasil diperbarui.');
      }
    } catch (_) {
      if (mounted) {
        setState(() => _isUploading = false);
        _TapGoSnackbar.error(
            context, 'Gagal mengunggah foto profil. Coba lagi.');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Center(
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: Container(
              width: 88,
              height: 88,
              color: colorScheme.surfaceContainerHighest,
              alignment: Alignment.center,
              child: _isLoading
                  ? const _TapGoLoading()
                  : _bytes != null
                      ? Image.memory(
                          _bytes!,
                          width: 88,
                          height: 88,
                          fit: BoxFit.cover,
                        )
                      : Icon(
                          Icons.person_rounded,
                          size: 44,
                          color: colorScheme.onSurfaceVariant,
                        ),
            ),
          ),
          Positioned(
            right: -4,
            bottom: -4,
            child: Material(
              color: _brandBlue,
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: _isUploading ? null : _pickAndUpload,
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: _isUploading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.camera_alt_rounded,
                          size: 16,
                          color: Colors.white,
                        ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Bottom sheet ubah nomor HP (Stage R2.11). Nomor HP adalah identifier
/// login utama, jadi backend mewajibkan password saat ini sebelum
/// mengizinkan perubahan — pola sama dengan [ChangePasswordScreen].
Future<void> _showPhoneEditSheet(
  BuildContext context,
  WidgetRef ref,
  DemoClientSession session,
) async {
  final phoneController = TextEditingController(text: session.phone);
  final passwordController = TextEditingController();
  final formKey = GlobalKey<FormState>();
  bool obscurePassword = true;
  bool isSubmitting = false;
  String? errorMessage;

  await _showTapGoBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) => StatefulBuilder(
      builder: (sheetContext, setModalState) {
        void submit() {
          if (isSubmitting) {
            return;
          }
          if (!(formKey.currentState?.validate() ?? false)) {
            return;
          }
          setModalState(() {
            isSubmitting = true;
            errorMessage = null;
          });
          () async {
            try {
              final newPhone = await _apiClient.updatePhone(
                phone: tapGoSanitizePhoneInput(phoneController.text),
                currentPassword: passwordController.text,
              );
              // Tutup sheet SEBELUM menulis state sesi global. Menulis
              // _demoSessionProvider memicu rebuild ProfileDetailsScreen (dan
              // layar lain yang ikut menonton sesi) secara sinkron; kalau ini
              // terjadi SEBELUM sheet ditutup, rebuild itu tumpang tindih
              // dengan animasi keluar modal yang masih memegang
              // phoneController/passwordController — race inilah yang
              // sebelumnya memicu 'TextEditingController was used after
              // being disposed' lalu berujung pada crash
              // '_dependents.isEmpty' (ditemukan lewat reproduksi nyata di
              // perangkat, bukan dugaan).
              if (sheetContext.mounted) {
                Navigator.of(sheetContext).pop();
              }
              final updated = session.copyWith(phone: newPhone);
              ref.read(_demoSessionProvider.notifier).state = updated;
              unawaited(_persistentStore.saveSession(updated));
              if (context.mounted) {
                _TapGoSnackbar.success(
                    context, 'Nomor HP berhasil diperbarui.');
              }
            } on DioException catch (error) {
              final code = _authResponseDataMap(error.response?.data)?['code']
                  ?.toString();
              setModalState(() {
                isSubmitting = false;
                errorMessage = switch (code) {
                  'INVALID_CREDENTIALS' => 'Password saat ini salah.',
                  'PHONE_ALREADY_IN_USE' => 'Nomor HP sudah dipakai akun lain.',
                  _ => 'Gagal mengubah nomor HP. Silakan coba lagi.',
                };
              });
            } catch (_) {
              setModalState(() {
                isSubmitting = false;
                errorMessage = 'Gagal mengubah nomor HP. Silakan coba lagi.';
              });
            }
          }();
        }

        return Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            8,
            20,
            MediaQuery.of(sheetContext).viewInsets.bottom + 20,
          ),
          child: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Ubah Nomor HP',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 6),
                Text(
                  'Perubahan nomor HP memerlukan password saat ini untuk '
                  'keamanan akun.',
                  style: TextStyle(
                    color: Theme.of(sheetContext).colorScheme.onSurfaceVariant,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 16),
                _InputField(
                  controller: phoneController,
                  icon: Icons.phone_iphone_rounded,
                  label: 'Nomor HP baru',
                  hint: '08xxxxxxxxxx',
                  keyboardType: TextInputType.phone,
                  inputFormatters: tapGoPhoneInputFormatters,
                  validator: tapGoPhoneValidatorMessage,
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 14),
                _InputField(
                  controller: passwordController,
                  icon: Icons.lock_outline_rounded,
                  label: 'Password saat ini',
                  hint: 'Konfirmasi dengan password Anda',
                  obscureText: obscurePassword,
                  textInputAction: TextInputAction.done,
                  autofillHints: const [AutofillHints.password],
                  suffixIcon: IconButton(
                    icon: Icon(
                      obscurePassword
                          ? Icons.visibility_off_rounded
                          : Icons.visibility_rounded,
                    ),
                    onPressed: () =>
                        setModalState(() => obscurePassword = !obscurePassword),
                  ),
                  validator: (value) => (value == null || value.isEmpty)
                      ? 'Isi password saat ini.'
                      : null,
                  onFieldSubmitted: (_) => submit(),
                ),
                const SizedBox(height: 18),
                _RecoveryPrimaryButton(
                  label: 'Simpan nomor HP',
                  isLoading: isSubmitting,
                  onPressed: submit,
                ),
                if (errorMessage != null) ...[
                  const SizedBox(height: 14),
                  _RecoveryMessage(message: errorMessage!, isError: true),
                ],
              ],
            ),
          ),
        );
      },
    ),
  );
  // Ditunda satu frame: menyusul perbaikan di submit() (pop sheet dulu
  // sebelum menulis state sesi), memberi jeda satu frame tambahan sebelum
  // dispose memastikan animasi keluar modal benar-benar selesai memproses
  // widget yang masih memegang controller ini.
  WidgetsBinding.instance.addPostFrameCallback((_) {
    phoneController.dispose();
    passwordController.dispose();
  });
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      style: TextStyle(
        color: _tapGoTextPrimary(context),
        fontSize: 14,
        fontWeight: FontWeight.w900,
        decoration: TextDecoration.none,
      ),
    );
  }
}

class _ProfileInfoPanel extends StatelessWidget {
  const _ProfileInfoPanel({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      key: const ValueKey('profile_details_info_panel'),
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Column(children: children),
    );
  }
}

class _ProfileDetailRow extends StatelessWidget {
  const _ProfileDetailRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 5,
            child: Text(
              label,
              style: TextStyle(
                color: colorScheme.onSurfaceVariant,
                fontSize: 12,
                height: 1.2,
                fontWeight: FontWeight.w800,
                decoration: TextDecoration.none,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 6,
            child: Text(
              value.isEmpty ? '-' : value,
              textAlign: TextAlign.right,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: colorScheme.onSurface,
                fontSize: 13.5,
                height: 1.2,
                fontWeight: FontWeight.w900,
                decoration: TextDecoration.none,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

String _maskProfilePhone(String phone) {
  final digits = phone.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.isEmpty) return '-';
  final local = digits.startsWith('62') ? '0${digits.substring(2)}' : digits;
  if (local.length <= 6) return local;
  final prefix = local.substring(0, local.length >= 4 ? 4 : local.length);
  final suffix = local.substring(local.length - 4);
  return '$prefix••••$suffix';
}

class HelpCenterScreen extends StatelessWidget {
  const HelpCenterScreen({super.key});

  Future<void> _openWhatsApp(BuildContext context) async {
    final uri = Uri.parse('https://wa.me/6283800255588');
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (context.mounted) {
        _showInfoSnack(context, 'WhatsApp admin belum dapat dibuka');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final helpItems = [
      (
        'Cara daftar',
        'Isi nama, nomor HP, dan password untuk membuat akun Basic.',
      ),
      (
        'Membership',
        'Akun baru aktif otomatis sebagai Basic setelah registrasi.',
      ),
      (
        'FAQ singkat',
        'Jika data belum tampil, pastikan koneksi internet dan coba muat ulang.',
      ),
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('Bantuan')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const _SectionHeader(
            title: 'Pusat Bantuan TapGo',
            subtitle: 'Panduan cepat untuk member TapGo',
          ),
          const SizedBox(height: 16),
          ...helpItems.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _InfoCard(
                icon: Icons.help_outline_rounded,
                title: item.$1,
                subtitle: item.$2,
              ),
            ),
          ),
          const SizedBox(height: 8),
          _InfoCard(
            icon: Icons.support_agent_rounded,
            title: 'Hubungi Admin',
            subtitle:
                'WhatsApp: 083800255588\nEmail: support@tapgolion.id\nWebsite: tapgolion.id',
            action: FilledButton.icon(
              onPressed: () => _openWhatsApp(context),
              icon: const Icon(Icons.chat_rounded),
              label: const Text('WhatsApp Admin'),
            ),
          ),
        ],
      ),
    );
  }
}

class BasicMemberCardScreen extends ConsumerStatefulWidget {
  const BasicMemberCardScreen({super.key});

  @override
  ConsumerState<BasicMemberCardScreen> createState() =>
      _BasicMemberCardScreenState();
}

class _BasicMemberCardScreenState extends ConsumerState<BasicMemberCardScreen> {
  Future<_BasicMemberCardData>? _future;

  @override
  void initState() {
    super.initState();
    _future = _load(ref.read(_demoSessionProvider));
  }

  /// Memuat ulang kartu di tempat — pengguna tidak perlu keluar halaman.
  void _retry() {
    setState(() {
      _future = _load(ref.read(_demoSessionProvider));
    });
  }

  Future<_BasicMemberCardData> _load(DemoClientSession session) async {
    final loader = tapGoMemberIdentityLoaderForTests;
    if (loader != null) {
      return _BasicMemberCardData.fromMap(await loader());
    }
    if (tapGoDisablePersistenceForTests) {
      return _BasicMemberCardData(
        displayName: session.userName,
        phone: session.phone,
        memberId: 'TGM-TESTCARD',
        status: 'ACTIVE',
        membership: 'Basic',
        joinedAt: DateTime(2026, 7, 14),
      );
    }
    try {
      final data = await _apiClient.memberIdentity();
      return _BasicMemberCardData.fromMap(data);
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      if (status != 401 && status != 403) {
        rethrow;
      }
      // 401/403 belum berarti sesi mati: tukar refresh token dulu, lalu
      // ulangi sekali dengan token baru.
      final (result, refreshed) =
          await _apiClient.refreshSession(session.refreshToken ?? '');
      if (result != TapGoSessionRefreshResult.refreshed || refreshed == null) {
        rethrow;
      }
      _apiClient.setAccessToken(refreshed.accessToken);
      final next = session.copyWith(
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      );
      ref.read(_demoSessionProvider.notifier).state = next;
      unawaited(_persistentStore.saveSession(next));
      final data = await _apiClient.memberIdentity();
      return _BasicMemberCardData.fromMap(data);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Kartu Anggota')),
      body: FutureBuilder<_BasicMemberCardData>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: _TapGoLoading());
          }
          if (snapshot.hasError || !snapshot.hasData) {
            return ListView(
              padding: const EdgeInsets.all(20),
              children: [
                const _StatusSurface(
                  icon: Icons.badge_rounded,
                  title: 'Kartu anggota belum dapat dimuat',
                  subtitle:
                      'Pastikan koneksi internet aktif, lalu tekan Coba lagi.',
                ),
                const SizedBox(height: 16),
                Center(
                  child: FilledButton.icon(
                    key: const ValueKey('member_card_retry_button'),
                    onPressed: _retry,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('Coba lagi'),
                  ),
                ),
              ],
            );
          }
          final card = snapshot.data!;
          final isActive = card.status.toUpperCase() == 'ACTIVE';
          final tier = card.membership.toUpperCase();
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
            children: [
              // Kartu resmi mengikuti mockup Owner: navy gelap + aksen emas,
              // watermark logo, chip EMV, NFC, nama, Member ID, paket, dan
              // tanggal bergabung.
              Container(
                key: const ValueKey('basic_member_card_surface'),
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Color(0xFF0B1F3A),
                      Color(0xFF12355E),
                      Color(0xFF0B1F3A),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(24),
                  border:
                      Border.all(color: const Color(0xFFD4AF37), width: 1.2),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x55000000),
                      blurRadius: 24,
                      offset: Offset(0, 14),
                    ),
                  ],
                ),
                child: Stack(
                  children: [
                    // Watermark logo seperti pada mockup: samar di sisi kanan,
                    // tidak ikut memperbesar kartu dan tidak menutupi teks.
                    Positioned.fill(
                      child: IgnorePointer(
                        child: Align(
                          alignment: Alignment.centerRight,
                          child: Opacity(
                            opacity: 0.10,
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(20),
                              child: Image.asset(
                                'assets/images/tapgo_logo.jpeg',
                                width: 170,
                                height: 170,
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(10),
                              child: Image.asset(
                                'assets/images/tapgo_logo.jpeg',
                                width: 40,
                                height: 40,
                                fit: BoxFit.cover,
                              ),
                            ),
                            const SizedBox(width: 12),
                            const Expanded(
                              child: Text(
                                'TAPGO MEMBER CARD',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 15,
                                  letterSpacing: 1.2,
                                  fontWeight: FontWeight.w900,
                                  decoration: TextDecoration.none,
                                ),
                              ),
                            ),
                            _MemberStatusChip(
                              label: isActive ? tier : 'TIDAK AKTIF',
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),
                        Row(
                          children: [
                            const _MemberCardEmvChip(),
                            const SizedBox(width: 12),
                            const Icon(
                              Icons.nfc_rounded,
                              color: Color(0xFFD4AF37),
                              size: 28,
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Text(
                                card.displayName.toUpperCase(),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 24,
                                  height: 1.12,
                                  letterSpacing: 1.5,
                                  fontWeight: FontWeight.w900,
                                  decoration: TextDecoration.none,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),
                        const Text(
                          'MEMBER ID',
                          style: TextStyle(
                            color: Color(0xFF9FB3C8),
                            fontSize: 11,
                            letterSpacing: 1.6,
                            fontWeight: FontWeight.w700,
                            decoration: TextDecoration.none,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          card.memberId,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            letterSpacing: 2,
                            fontWeight: FontWeight.w800,
                            decoration: TextDecoration.none,
                          ),
                        ),
                        const SizedBox(height: 20),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: _MemberCardGoldField(
                                label: 'PAKET',
                                value: tier,
                              ),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: _MemberCardGoldField(
                                label: 'BERGABUNG',
                                value: _formatMemberDate(card.joinedAt)
                                    .toUpperCase(),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        const Align(
                          alignment: Alignment.centerRight,
                          child: Text(
                            'TAPGO\nMEMBERSHIP',
                            textAlign: TextAlign.right,
                            style: TextStyle(
                              color: Color(0xFFD4AF37),
                              fontSize: 13,
                              height: 1.25,
                              letterSpacing: 1.4,
                              fontWeight: FontWeight.w900,
                              decoration: TextDecoration.none,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              const _StatusSurface(
                key: ValueKey('member_card_safe_info_panel'),
                icon: Icons.info_outline_rounded,
                title: 'Informasi aman',
                subtitle:
                    'Kartu ini hanya menampilkan nama, Member ID, paket, dan tanggal bergabung.',
              ),
            ],
          );
        },
      ),
    );
  }
}

class _BasicMemberCardData {
  const _BasicMemberCardData({
    required this.displayName,
    required this.phone,
    required this.memberId,
    required this.status,
    required this.membership,
    required this.joinedAt,
    this.email,
    this.emailVerified = false,
  });

  final String displayName;
  final String phone;
  final String memberId;
  final String status;
  final String membership;
  final DateTime joinedAt;
  final String? email;
  final bool emailVerified;

  factory _BasicMemberCardData.fromMap(Map<String, dynamic> map) {
    final email = map['email']?.toString();
    return _BasicMemberCardData(
      displayName: map['displayName']?.toString() ?? 'Member TapGo',
      phone: map['phone']?.toString() ?? '',
      memberId: map['memberId']?.toString() ?? '',
      status: map['status']?.toString() ?? 'ACTIVE',
      membership: map['membership']?.toString() ?? 'Basic',
      joinedAt: DateTime.tryParse(map['joinedAt']?.toString() ?? '') ??
          DateTime.now(),
      email: (email == null || email.isEmpty) ? null : email,
      emailVerified: map['emailVerified'] == true,
    );
  }
}

/// Chip EMV emas seperti pada mockup kartu resmi: kotak membulat dengan
/// garis kontak. Digambar, bukan ikon font, supaya tidak bergantung pada
/// ketersediaan glyph di perangkat.
class _MemberCardEmvChip extends StatelessWidget {
  const _MemberCardEmvChip();

  @override
  Widget build(BuildContext context) {
    return const CustomPaint(
      key: ValueKey('member_card_emv_chip'),
      size: Size(46, 34),
      painter: _EmvChipPainter(),
    );
  }
}

class _EmvChipPainter extends CustomPainter {
  const _EmvChipPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(rect, const Radius.circular(7));
    final fill = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Color(0xFFF6D47C), Color(0xFFD4AF37), Color(0xFF9C7C1E)],
      ).createShader(rect);
    canvas.drawRRect(rrect, fill);

    final line = Paint()
      ..color = const Color(0xFF6B5310)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.3;
    final w = size.width;
    final h = size.height;
    canvas.drawLine(Offset(w * 0.35, 0), Offset(w * 0.35, h), line);
    canvas.drawLine(Offset(w * 0.65, 0), Offset(w * 0.65, h), line);
    canvas.drawLine(Offset(0, h * 0.3), Offset(w, h * 0.3), line);
    canvas.drawLine(Offset(0, h * 0.7), Offset(w, h * 0.7), line);
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(
          center: rect.center,
          width: w * 0.3,
          height: h * 0.4,
        ),
        const Radius.circular(4),
      ),
      line,
    );
  }

  @override
  bool shouldRepaint(covariant _EmvChipPainter oldDelegate) => false;
}

class _MemberCardGoldField extends StatelessWidget {
  const _MemberCardGoldField({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFF9FB3C8),
            fontSize: 11,
            letterSpacing: 1.6,
            fontWeight: FontWeight.w700,
            decoration: TextDecoration.none,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 15,
            letterSpacing: 1.2,
            fontWeight: FontWeight.w800,
            decoration: TextDecoration.none,
          ),
        ),
      ],
    );
  }
}

class _MemberStatusChip extends StatelessWidget {
  const _MemberStatusChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFFFC857),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          color: Color(0xFF06284A),
          fontSize: 12,
          fontWeight: FontWeight.w900,
          decoration: TextDecoration.none,
        ),
      ),
    );
  }
}

String _formatMemberDate(DateTime value) {
  const months = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  return '${value.day} ${months[value.month - 1]} ${value.year}';
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.action,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: _brandBlue),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: colorScheme.onSurface,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: colorScheme.onSurfaceVariant,
                    height: 1.35,
                  ),
                ),
                if (action != null) ...[const SizedBox(height: 12), action!],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Ukuran tetap kartu layanan. Dikumpulkan di satu tempat supaya tinggi sel
/// grid dihitung dari angka yang sama dengan yang dipakai merender kartunya.
const double _serviceTileIconSize = 64;
const double _serviceTileIconGap = 8;
const double _serviceTileLabelWidth = 82;
const double _serviceTileLabelFontSize = 11.2;
const double _serviceTileLabelLineHeight = 1.05;
const double _serviceTileLabelMinHeight = 32;

/// Tinggi label untuk dua baris teks pada skala teks yang sedang berlaku.
///
/// Ikut text scaler supaya kartu tetap muat saat pengguna memperbesar teks —
/// tinggi tetap 32 dp dulu membuat teks besar terpotong.
double _serviceTileLabelHeight(BuildContext context) {
  final scaled = MediaQuery.textScalerOf(context).scale(
    _serviceTileLabelFontSize,
  );
  return max(
    _serviceTileLabelMinHeight,
    scaled * _serviceTileLabelLineHeight * 2,
  );
}

double _serviceTileContentHeight(BuildContext context) {
  return _serviceTileIconSize +
      _serviceTileIconGap +
      _serviceTileLabelHeight(context);
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile({
    required this.item,
    this.onTap,
    this.maxLabelWidth = _serviceTileLabelWidth,
  });

  final _ServiceItem item;
  final VoidCallback? onTap;
  final double maxLabelWidth;

  @override
  Widget build(BuildContext context) {
    final style = _serviceIconStyle(item.label);
    final isUnavailable = item.badge != null;
    final isActionable = onTap != null && !isUnavailable;
    final content = Stack(
      clipBehavior: Clip.none,
      alignment: Alignment.topCenter,
      children: [
        Column(
          children: [
            _ServiceAssetIcon(
              label: item.label,
              icon: item.icon,
              style: _ServiceIconStyle(
                primary: item.color,
                secondary: style.secondary,
                background: style.background,
              ),
              size: _serviceTileIconSize,
            ),
            const SizedBox(height: _serviceTileIconGap),
            SizedBox(
              width: maxLabelWidth,
              height: _serviceTileLabelHeight(context),
              child: Center(
                child: Text(
                  item.label,
                  maxLines: 2,
                  softWrap: true,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.onSurface,
                    fontSize: _serviceTileLabelFontSize,
                    height: _serviceTileLabelLineHeight,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          ],
        ),
        if (isUnavailable)
          const Positioned(top: -4, right: 8, child: _ServiceSoonBadge()),
      ],
    );
    return Semantics(
      button: isActionable,
      enabled: isActionable,
      label: isUnavailable
          ? '${item.label}, segera hadir'
          : 'Buka layanan ${item.label}',
      child: ExcludeSemantics(
        child: isActionable
            ? InkWell(
                borderRadius: BorderRadius.circular(18),
                onTap: onTap,
                child: content,
              )
            : content,
      ),
    );
  }
}

class _ServiceSoonBadge extends StatelessWidget {
  const _ServiceSoonBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFFFF8A00),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white, width: 1.4),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33FF8A00),
            blurRadius: 8,
            offset: Offset(0, 3),
          ),
        ],
      ),
      child: const Text(
        'Segera',
        style: TextStyle(
          color: Colors.white,
          fontSize: 8.5,
          height: 1,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _WalletAction extends StatelessWidget {
  const _WalletAction({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return _TapScale(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        width: 58,
        height: 58,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.18),
          borderRadius: BorderRadius.circular(18),
          border:
              Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        ),
        child: Icon(icon, color: Colors.white, size: 31),
      ),
    );
  }
}

class _ServiceItem {
  const _ServiceItem(this.label, this.icon, this.color, this.badge);

  final String label;
  final IconData icon;
  final Color color;
  final String? badge;
}

class _ServiceIconStyle {
  const _ServiceIconStyle({
    required this.primary,
    required this.secondary,
    required this.background,
  });

  final Color primary;
  final Color secondary;
  final Color background;
}

class _ServiceAssetIcon extends StatelessWidget {
  const _ServiceAssetIcon({
    required this.label,
    required this.icon,
    required this.style,
    this.size = 64,
  });

  final String label;
  final IconData icon;
  final _ServiceIconStyle style;
  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: PremiumTapGoIcon.assetFor(label) != null
          ? PremiumTapGoIcon(
              label: label,
              fallbackIcon: icon,
              size: size,
              padding: size * 0.06,
            )
          : Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.center,
              children: [
                Positioned(
                  bottom: size * 0.02,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      boxShadow: [
                        BoxShadow(
                          color: style.primary.withValues(alpha: 0.18),
                          blurRadius: size * 0.22,
                          spreadRadius: size * 0.02,
                        ),
                      ],
                    ),
                    child: SizedBox(width: size * 0.62, height: size * 0.12),
                  ),
                ),
                _TapGoServiceIllustration(
                  label: label,
                  fallbackIcon: icon,
                  fallbackStyle: style,
                  size: size,
                ),
              ],
            ),
    );
  }
}

_ServiceIconStyle _serviceIconStyle(String label) {
  return switch (label) {
    // 'Motor'/'Mobil' adalah alias label yang memakai gaya ikon yang sama,
    // mengikuti pola alias yang sudah dipakai sistem ikon.
    'TapGo Ride' || 'Motor' => const _ServiceIconStyle(
        primary: Color(0xFF006AF5),
        secondary: Color(0xFF1FA2FF),
        background: Color(0xFFEAF5FF),
      ),
    'TapGo Car' || 'Mobil' => const _ServiceIconStyle(
        primary: Color(0xFF006AF5),
        secondary: Color(0xFF2BB8FF),
        background: Color(0xFFEAF3FF),
      ),
    'TapGo Food' => const _ServiceIconStyle(
        primary: Color(0xFFFF6B00),
        secondary: Color(0xFFFFA51F),
        background: Color(0xFFFFF3E7),
      ),
    'TapGo Mart' => const _ServiceIconStyle(
        primary: Color(0xFF0097A7),
        secondary: Color(0xFF13C2C2),
        background: Color(0xFFE8FAFF),
      ),
    'Jasa' || 'TapGo Jasa' || 'Toko & Jasa' => const _ServiceIconStyle(
        primary: Color(0xFF1565D8),
        secondary: Color(0xFF4D96FF),
        background: Color(0xFFEAF3FF),
      ),
    'Pulsa' || 'PPOB' || 'Tagihan' => const _ServiceIconStyle(
        primary: Color(0xFF4F46E5),
        secondary: Color(0xFF818CF8),
        background: Color(0xFFEEF2FF),
      ),
    'TapGo Bantu' || 'Support' => const _ServiceIconStyle(
        primary: Color(0xFF0877EE),
        secondary: Color(0xFF38BDF8),
        background: Color(0xFFEAF3FF),
      ),
    'BPJS' => const _ServiceIconStyle(
        primary: Color(0xFF16A34A),
        secondary: Color(0xFF86EFAC),
        background: Color(0xFFEAFBF0),
      ),
    // Warna 4 kategori PPOB berikut mengikuti ppobCategoryColor() (lihat
    // ppob_shared.dart) supaya Super Menu terasa satu bahasa visual dengan
    // grid kategori di dalam PpobHomeScreen — belum punya ilustrasi SVG
    // bermerek, jadi tier 3 (_ServiceIcon3D) dengan warna yang sama ini
    // adalah cara paling konsisten yang tersedia saat ini.
    'Paket Data' => const _ServiceIconStyle(
        primary: Color(0xFF0B7A75),
        secondary: Color(0xFF5EEAD4),
        background: Color(0xFFE6FFFB),
      ),
    'Token PLN' => const _ServiceIconStyle(
        primary: Color(0xFFF59E0B),
        secondary: Color(0xFFFCD34D),
        background: Color(0xFFFFF7E6),
      ),
    'E-Wallet' => const _ServiceIconStyle(
        primary: Color(0xFF4F46E5),
        secondary: Color(0xFF818CF8),
        background: Color(0xFFEEF2FF),
      ),
    'PDAM' => const _ServiceIconStyle(
        primary: Color(0xFF0284C7),
        secondary: Color(0xFF7DD3FC),
        background: Color(0xFFE8F6FF),
      ),
    'Membership' || 'Program Referral' || 'Reward' => const _ServiceIconStyle(
        primary: Color(0xFFF59E0B),
        secondary: Color(0xFFFFD166),
        background: Color(0xFFFFF4E4),
      ),
    'Referral' => const _ServiceIconStyle(
        primary: Color(0xFF006AF5),
        secondary: Color(0xFF7DD3FC),
        background: Color(0xFFEAF5FF),
      ),
    'Kelas Online' => const _ServiceIconStyle(
        primary: Color(0xFF4F46E5),
        secondary: Color(0xFFA5B4FC),
        background: Color(0xFFEEF2FF),
      ),
    'Webinar' => const _ServiceIconStyle(
        primary: Color(0xFF7C3AED),
        secondary: Color(0xFFC084FC),
        background: Color(0xFFF5F3FF),
      ),
    'Event' => const _ServiceIconStyle(
        primary: Color(0xFFEA580C),
        secondary: Color(0xFFFFA51F),
        background: Color(0xFFFFF3E7),
      ),
    _ => const _ServiceIconStyle(
        primary: Color(0xFF334155),
        secondary: Color(0xFFCBD5E1),
        background: Color(0xFFF1F5F9),
      ),
  };
}

class _ServiceIcon3D extends StatelessWidget {
  const _ServiceIcon3D({
    required this.icon,
    required this.style,
    this.size = 64,
  });

  final IconData icon;
  final _ServiceIconStyle style;
  final double size;

  @override
  Widget build(BuildContext context) {
    final radius = size * 0.32;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: style.background,
        borderRadius: BorderRadius.circular(radius),
        boxShadow: [
          BoxShadow(
            color: style.primary.withValues(alpha: 0.20),
            blurRadius: size * 0.25,
            offset: Offset(0, size * 0.12),
          ),
          const BoxShadow(
            color: Color(0xFFFFFFFF),
            blurRadius: 1,
            offset: Offset(0, -1),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned(
            right: -size * 0.18,
            top: -size * 0.20,
            child: Container(
              width: size * 0.62,
              height: size * 0.62,
              decoration: BoxDecoration(
                color: style.secondary.withValues(alpha: 0.55),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Positioned(
            left: size * 0.10,
            bottom: size * 0.08,
            child: Container(
              width: size * 0.36,
              height: size * 0.16,
              decoration: BoxDecoration(
                color: style.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(size),
              ),
            ),
          ),
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Colors.white.withValues(alpha: 0.82),
                    style.background.withValues(alpha: 0.15),
                    style.primary.withValues(alpha: 0.10),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
            ),
          ),
          Center(
            child: Container(
              width: size * 0.62,
              height: size * 0.62,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [style.primary, style.secondary],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(size * 0.22),
                boxShadow: [
                  BoxShadow(
                    color: style.primary.withValues(alpha: 0.30),
                    blurRadius: size * 0.16,
                    offset: Offset(0, size * 0.08),
                  ),
                ],
              ),
              child: Icon(icon, color: Colors.white, size: size * 0.34),
            ),
          ),
          Positioned(
            left: size * 0.18,
            top: size * 0.13,
            child: Container(
              width: size * 0.18,
              height: size * 0.07,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.70),
                borderRadius: BorderRadius.circular(size),
                border: Border.all(
                    color: Theme.of(context).colorScheme.outlineVariant),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
