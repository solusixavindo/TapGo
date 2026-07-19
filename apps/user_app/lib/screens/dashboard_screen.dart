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
              const _DashboardEntrance(order: 1, child: _SearchRow()),
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
              _DashboardEntrance(
                order: 3,
                child: _WalletCard(session: session, state: production),
              ),
              const SizedBox(height: 16),
              _DashboardEntrance(
                order: 4,
                child: _MarketingPlanCard(
                  session: session,
                  isLoading: production.isLoading,
                ),
              ),
              const SizedBox(height: 22),
              const _DashboardEntrance(order: 5, child: _ServiceGrid()),
              const SizedBox(height: 24),
              const _DashboardEntrance(order: 6, child: _ContentCards()),
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
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: child,
      ),
      child: KeyedSubtree(
        key: ValueKey(stateKey),
        child: child,
      ),
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
            colors: [
              Color(0xFFE7EEF8),
              Color(0xFFF8FBFF),
              Color(0xFFE7EEF8),
            ],
          ),
        ),
      ),
    );
  }
}

class _DashboardValueSwitcher extends StatelessWidget {
  const _DashboardValueSwitcher({
    required this.value,
    required this.style,
  });

  final String value;
  final TextStyle style;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
      switchInCurve: _TapGoMotion.standardCurve,
      switchOutCurve: _TapGoMotion.exitCurve,
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: child,
      ),
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
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
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
                  style: const TextStyle(
                    color: Color(0xFF718096),
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                ),
              ),
              TextButton(
                onPressed: onRetry,
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: const Size(0, 32),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Muat Ulang'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InlineStatePill extends StatelessWidget {
  const _InlineStatePill({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
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
                  style: const TextStyle(
                    color: Color(0xFF718096),
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
              child: _TapGoProfileImage(
                imagePath: session.selfieImagePath,
                width: 50,
                height: 50,
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
                    session.isFounderChairman
                        ? 'Founder Chairman'
                        : session.isFounderPlatinum
                            ? 'Founder Platinum'
                            : session.activePackageName,
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
            badge: '2',
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
    this.badge,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final String? badge;

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
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.16),
                  shape: BoxShape.circle,
                  border:
                      Border.all(color: Colors.white.withValues(alpha: 0.20)),
                ),
                child: Icon(icon, color: Colors.white, size: 23),
              ),
              if (badge != null)
                Positioned(
                  right: -2,
                  top: -3,
                  child: _PulseBadge(label: badge!),
                ),
            ],
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

class _SearchRow extends StatefulWidget {
  const _SearchRow();

  @override
  State<_SearchRow> createState() => _SearchRowState();
}

class _SearchRowState extends State<_SearchRow> {
  static const _placeholders = [
    'Cari layanan TapGo',
    'Cari Membership',
    'Cari Referral',
    'Cari Reward',
    'Cari PPOB',
    'Cari BPJS',
    'Cari Withdraw',
  ];

  int _placeholderIndex = 0;
  Timer? _placeholderTimer;

  @override
  void initState() {
    super.initState();
    _placeholderTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!mounted) return;
      setState(() {
        _placeholderIndex = (_placeholderIndex + 1) % _placeholders.length;
      });
    });
  }

  @override
  void dispose() {
    _placeholderTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.82),
      borderRadius: BorderRadius.circular(26),
      child: InkWell(
        onTap: () => _showSearchMenu(context),
        borderRadius: BorderRadius.circular(26),
        child: Container(
          height: 58,
          padding: const EdgeInsets.only(left: 18, right: 6),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: Colors.white.withValues(alpha: 0.86)),
            gradient: LinearGradient(
              colors: [
                Colors.white.withValues(alpha: 0.96),
                const Color(0xFFF4F9FF).withValues(alpha: 0.88),
              ],
            ),
            boxShadow: [
              BoxShadow(
                color: _brandBlue.withValues(alpha: 0.10),
                blurRadius: 22,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Row(
            children: [
              Expanded(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 360),
                  transitionBuilder: (child, animation) => FadeTransition(
                    opacity: animation,
                    child: SlideTransition(
                      position: Tween<Offset>(
                        begin: const Offset(0, 0.25),
                        end: Offset.zero,
                      ).animate(animation),
                      child: child,
                    ),
                  ),
                  child: Text(
                    _placeholders[_placeholderIndex],
                    key: ValueKey(_placeholders[_placeholderIndex]),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF7A8699),
                      fontSize: 15,
                    ),
                  ),
                ),
              ),
              const _SearchPulseIcon(),
            ],
          ),
        ),
      ),
    );
  }
}

class _SearchPulseIcon extends StatelessWidget {
  const _SearchPulseIcon();

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.96, end: 1.04),
      duration: const Duration(milliseconds: 850),
      curve: Curves.easeOutBack,
      builder: (context, scale, child) =>
          Transform.scale(scale: scale, child: child),
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF0B5FC7), Color(0xFF06284A)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(18),
          boxShadow: [
            BoxShadow(
              color: _brandBlue.withValues(alpha: 0.22),
              blurRadius: 14,
              offset: const Offset(0, 7),
            ),
          ],
        ),
        child: const Icon(Icons.search_rounded, color: Colors.white),
      ),
    );
  }
}

void _showSoon(BuildContext context) {
  _TapGoSnackbar.info(context, 'Layanan belum dapat dibuka saat ini');
}

void _showInfoSnack(BuildContext context, String message) {
  _TapGoSnackbar.info(context, message);
}

void _showSearchMenu(BuildContext context) {
  const items = [
    _ServiceItem(
        'TapGo Ride', Icons.two_wheeler_rounded, Color(0xFF006AF5), null),
    _ServiceItem(
        'TapGo Car', Icons.local_taxi_rounded, Color(0xFF006AF5), null),
    _ServiceItem(
        'TapGo Food', Icons.restaurant_menu_rounded, Color(0xFFFF6B00), null),
    _ServiceItem(
        'TapGo Mart', Icons.storefront_rounded, Color(0xFF0097A7), null),
    _ServiceItem(
        'Membership', Icons.workspace_premium_rounded, Color(0xFFF59E0B), null),
    _ServiceItem('Referral', Icons.hub_rounded, Color(0xFF006AF5), null),
    _ServiceItem('Reward', Icons.emoji_events_rounded, Color(0xFFF59E0B), null),
  ];

  _showTapGoBottomSheet<void>(
    context: context,
    showDragHandle: true,
    backgroundColor: const Color(0xFFF4F8FB),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
    ),
    builder: (context) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Cari cepat',
                style: TextStyle(
                  color: Color(0xFF0A2A43),
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 14),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: items.length,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 4,
                  mainAxisSpacing: 14,
                  crossAxisSpacing: 8,
                  childAspectRatio: 0.70,
                ),
                itemBuilder: (context, index) {
                  final item = items[index];
                  return InkWell(
                    borderRadius: BorderRadius.circular(18),
                    onTap: () {
                      Navigator.of(context).pop();
                      _showInfoSnack(
                        context,
                        '${item.label} belum dapat dibuka saat ini',
                      );
                    },
                    child: _SearchServiceTile(item: item),
                  );
                },
              ),
            ],
          ),
        ),
      );
    },
  );
}

class _SearchServiceTile extends StatelessWidget {
  const _SearchServiceTile({required this.item});

  final _ServiceItem item;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _ServiceAssetIcon(
          label: item.label,
          icon: item.icon,
          style: _serviceIconStyle(item.label),
          size: 56,
        ),
        const SizedBox(height: 8),
        SizedBox(
          width: 76,
          height: 17,
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              item.label,
              maxLines: 1,
              softWrap: false,
              style: const TextStyle(
                color: Color(0xFF263241),
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
      ],
    );
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
    return SizedBox(
      height: 238,
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
              Positioned(
                right: -30,
                top: -34,
                child: Container(
                  width: 142,
                  height: 142,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color:
                        Colors.white.withValues(alpha: hasImage ? 0.08 : 0.10),
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
          ),
          child: Icon(icon, color: accent, size: 34),
        ),
      ),
    );
  }
}

class _HeroMiniIcon extends StatelessWidget {
  const _HeroMiniIcon({
    required this.icon,
    required this.color,
  });

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
          : () => _openDemo(context, const DemoWalletScreen()),
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
              right: -32,
              top: -36,
              child: Container(
                width: 136,
                height: 136,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white.withValues(alpha: 0.08),
                ),
              ),
            ),
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
                            const Text(
                              'TapGoPay',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 15,
                                fontWeight: FontWeight.w800,
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
                                      value: 'Gagal memuat saldo',
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
                                fontWeight: FontWeight.w800),
                          ),
                        ),
                      ],
                    ),
                  ),
                  _WalletAction(
                    icon: Icons.add_rounded,
                    onTap: () => _showInfoSnack(
                      context,
                      'Top up belum dapat diproses saat ini',
                    ),
                  ),
                  const SizedBox(width: 12),
                  _WalletAction(
                    icon: Icons.near_me_rounded,
                    onTap: () => _showInfoSnack(
                      context,
                      'Transfer belum dapat diproses saat ini',
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

class _MarketingPlanCard extends StatelessWidget {
  const _MarketingPlanCard({
    required this.session,
    required this.isLoading,
  });

  final DemoClientSession session;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final packageColor = _packagePrimary(session.activePackageName);
    final premiumPackage =
        session.activePackageName.toLowerCase().contains('platinum');
    final titleColor = premiumPackage ? Colors.white : const Color(0xFF0A2A43);
    final mutedColor =
        premiumPackage ? const Color(0xDDEAF7FF) : const Color(0xFF718096);
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFFF2B8), Color(0xFFFFB000), Color(0xFFFFFFFF)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: packageColor.withValues(alpha: 0.20),
            blurRadius: 22,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      padding: const EdgeInsets.all(1.4),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(23),
        child: Stack(
          children: [
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: _packageGradient(session.activePackageName),
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
                      _ServiceAssetIcon(
                        label: 'Reward',
                        icon: Icons.workspace_premium_rounded,
                        style: _serviceIconStyle('Membership'),
                        size: 52,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Paket aktif: ${session.activePackageName}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: titleColor,
                                fontSize: 17,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              'Kode ${session.referralCode} | Level aktif ${session.activeLevel}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: mutedColor,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: _MiniMetric(
                          label: 'Wallet',
                          value: _formatCompactRupiah(session.walletBalance),
                          animatedValue: session.walletBalance,
                          formatter: _formatCompactRupiah,
                          isLoading: isLoading,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _MiniMetric(
                          label: 'Bonus hari ini',
                          value: _formatCompactRupiah(session.todayBonus),
                          animatedValue: session.todayBonus,
                          formatter: _formatCompactRupiah,
                          isLoading: isLoading,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: _MiniMetric(
                          label: 'Referral Saya',
                          value: '${session.directSponsor} direct',
                          animatedValue: session.directSponsor,
                          formatter: (value) => '$value direct',
                          isLoading: isLoading,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _MiniMetric(
                          label: 'Downline Saya',
                          value: '${session.downline} user',
                          animatedValue: session.downline,
                          formatter: (value) => '$value user',
                          isLoading: isLoading,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Referral Saya adalah jumlah orang yang memakai kode referral Anda.',
                    style: TextStyle(
                      color: mutedColor,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () =>
                          _openDemo(context, const MembershipPackagesScreen()),
                      icon: const Icon(Icons.workspace_premium_rounded),
                      label: const FittedBox(child: Text('Membership')),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: _brandBlue,
                        backgroundColor: Colors.white.withValues(alpha: 0.72),
                        side: const BorderSide(color: _brandBlue),
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
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 3600),
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
      animation: _controller,
      builder: (context, child) {
        final dx = -1.4 + (_controller.value * 2.8);
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

Color _packagePrimary(String packageName) {
  final name = packageName.toLowerCase();
  if (name.contains('platinum')) return const Color(0xFF06284A);
  if (name.contains('gold')) return const Color(0xFFFFB000);
  if (name.contains('silver')) return const Color(0xFF94A3B8);
  return const Color(0xFFF59E0B);
}

List<Color> _packageGradient(String packageName) {
  final name = packageName.toLowerCase();
  if (name.contains('platinum')) {
    return const [Color(0xFF06172A), Color(0xFF0B4EA2), Color(0xFFFFB000)];
  }
  if (name.contains('gold')) {
    return const [Color(0xFFFFF7D6), Color(0xFFFFC94A)];
  }
  if (name.contains('silver')) {
    return const [Color(0xFFF8FAFC), Color(0xFFCBD5E1)];
  }
  return const [Color(0xFFFFFBEB), Color(0xFFFFE8A3)];
}

class _ServiceGrid extends StatelessWidget {
  const _ServiceGrid();

  static const services = [
    _ServiceItem('TapGo Ride', Icons.two_wheeler_rounded, Color(0xFF0569E8),
        'Diskon 5000'),
    _ServiceItem(
        'TapGo Car', Icons.local_taxi_rounded, Color(0xFF0B7A75), null),
    _ServiceItem(
        'TapGo Food', Icons.restaurant_menu_rounded, Color(0xFFE85D04), null),
    _ServiceItem(
        'TapGo Mart', Icons.storefront_rounded, Color(0xFF0088A6), null),
    _ServiceItem(
        'Jasa', Icons.home_repair_service_rounded, Color(0xFFD97706), null),
    _ServiceItem('Pulsa', Icons.phone_iphone_rounded, Color(0xFF1486B8), null),
    _ServiceItem('TapGo Bantu', Icons.volunteer_activism_rounded,
        Color(0xFF0569E8), 'Baru'),
    _ServiceItem('Lainnya', Icons.grid_view_rounded, Color(0xFF697386), null),
  ];

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: services.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        mainAxisSpacing: 18,
        crossAxisSpacing: 12,
        childAspectRatio: 0.66,
      ),
      itemBuilder: (context, index) => _FloatingServiceTile(
        index: index,
        child: _ServiceTile(item: services[index]),
      ),
    );
  }
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
    _offset = Tween<double>(begin: -2, end: 2).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
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
      builder: (context, child) => Transform.translate(
        offset: Offset(0, _offset.value),
        child: child,
      ),
      child: widget.child,
    );
  }
}

class _ContentCards extends StatelessWidget {
  const _ContentCards();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Container(
            height: 192,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(22),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Kelas Online Spesial 🔥',
                  style: TextStyle(
                    color: _brandBlue,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Akan dimulai pada',
                  style: TextStyle(color: Colors.grey.shade600),
                ),
                const Spacer(),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFF3434),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Text(
                    '02:06:03',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                      fontSize: 18,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Container(
            height: 192,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(22),
              gradient: const LinearGradient(
                colors: [Color(0xFF06284A), Color(0xFF0B5FC7)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              boxShadow: [
                BoxShadow(
                  color: _brandBlue.withValues(alpha: 0.18),
                  blurRadius: 18,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'PPOB & Benefit',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Saldo, transaksi, dan reward dalam satu dashboard.',
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Color(0xDDEAF7FF),
                    fontSize: 12,
                    height: 1.3,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const Spacer(),
                Align(
                  alignment: Alignment.bottomRight,
                  child: _ServiceAssetIcon(
                    label: 'PPOB',
                    icon: Icons.receipt_long_rounded,
                    style: _serviceIconStyle('PPOB'),
                    size: 54,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _BottomNav extends StatelessWidget {
  const _BottomNav({
    required this.selectedIndex,
    required this.onTabSelected,
    required this.onCenterTap,
  });

  final int selectedIndex;
  final ValueChanged<int> onTabSelected;
  final VoidCallback onCenterTap;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned(
          left: 18,
          right: 18,
          bottom: 18,
          child: Container(
            height: 82,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(28),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x22000000),
                  blurRadius: 22,
                  offset: Offset(0, 10),
                ),
              ],
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _NavItem(
                  icon: Icons.home_rounded,
                  label: 'Beranda',
                  active: selectedIndex == 0,
                  onTap: () => onTabSelected(0),
                ),
                _NavItem(
                  icon: Icons.receipt_rounded,
                  label: 'Aktivitas',
                  active: selectedIndex == 1,
                  onTap: () => onTabSelected(1),
                ),
                const SizedBox(width: 74),
                _NavItem(
                  icon: Icons.chat_bubble_outline_rounded,
                  label: 'Chat',
                  badge: '2',
                  active: selectedIndex == 2,
                  onTap: () => onTabSelected(2),
                ),
                _NavItem(
                  icon: Icons.person_outline_rounded,
                  label: 'Akun',
                  active: selectedIndex == 3,
                  onTap: () => onTabSelected(3),
                ),
              ],
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
                  border: Border.all(color: Colors.white, width: 6),
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

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
    this.badge,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    final color = active ? _brandBlue : const Color(0xFF4B5563);

    return _TapGoPressable(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      pressedScale: 0.97,
      child: SizedBox(
        width: 58,
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
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Icon(icon, color: color, size: 26),
                    if (badge != null)
                      Positioned(
                        right: -8,
                        top: -8,
                        child: _PulseBadge(label: badge!),
                      ),
                  ],
                ),
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

  static const _tabs = ['Semua', 'Bonus', 'Referral', 'Layanan', 'Withdraw'];

  @override
  Widget build(BuildContext context) {
    final production = ref.watch(_productionSnapshotProvider);
    final session = ref.watch(_demoSessionProvider);
    final sourceItems = session.transactions
        .map(
          (transaction) => _ActivityItem(
            _activityCategoryFromTitle(transaction.title),
            _activityIconFromTitle(transaction.title),
            transaction.title,
            transaction.description,
            transaction.amount == 0
                ? null
                : '${transaction.amount > 0 ? '+' : '-'}${formatRupiah(transaction.amount.abs())}',
            transaction.status,
            'Terbaru',
          ),
        )
        .toList(growable: false);
    final selected = _tabs[_tabIndex];
    final items = selected == 'Semua'
        ? sourceItems
        : sourceItems.where((item) => item.category == selected).toList();

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 176),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionHeader(
            title: 'Aktivitas',
            subtitle: 'Bonus, referral, layanan, dan withdraw',
          ),
          const SizedBox(height: 16),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: List.generate(
                _tabs.length,
                (index) => Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(_tabs[index]),
                    selected: _tabIndex == index,
                    selectedColor: _brandBlue,
                    labelStyle: TextStyle(
                      color: _tabIndex == index
                          ? Colors.white
                          : const Color(0xFF263241),
                      fontWeight: FontWeight.w800,
                    ),
                    onSelected: (_) => setState(() => _tabIndex = index),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (production.isLoading)
            const _StatusSurface(
              icon: Icons.sync_rounded,
              title: 'Memuat aktivitas',
              subtitle: 'Mengambil histori transaksi TapGo...',
            )
          else if (production.hasError)
            _RetryStatusSurface(
              icon: Icons.cloud_off_rounded,
              title: 'Data belum tersedia',
              subtitle: 'Silakan muat ulang aktivitas.',
              onRetry: () => ref.invalidate(_productionSnapshotProvider),
            )
          else if (items.isEmpty)
            const _EmptyState(
              icon: Icons.inbox_rounded,
              title: 'Belum ada transaksi',
              subtitle: 'Aktivitas akan muncul setelah ada transaksi.',
            )
          else
            ...items.map((item) => _ActivityTile(item: item)),
        ],
      ),
    );
  }
}

String _activityCategoryFromTitle(String title) {
  final lower = title.toLowerCase();
  if (lower.contains('bonus') || lower.contains('reward')) {
    return 'Bonus';
  }
  if (lower.contains('referral') || lower.contains('sponsor')) {
    return 'Referral';
  }
  if (lower.contains('withdraw')) {
    return 'Withdraw';
  }
  return 'Layanan';
}

IconData _activityIconFromTitle(String title) {
  final lower = title.toLowerCase();
  if (lower.contains('level')) {
    return Icons.layers_rounded;
  }
  if (lower.contains('reward')) {
    return Icons.emoji_events_rounded;
  }
  if (lower.contains('withdraw')) {
    return Icons.account_balance_rounded;
  }
  if (lower.contains('ppob') || lower.contains('saldo')) {
    return Icons.receipt_long_rounded;
  }
  return Icons.payments_rounded;
}

class ChatScreen extends StatelessWidget {
  const ChatScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(20, 12, 20, 176),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SectionHeader(
            title: 'Chat',
            subtitle: 'Pesan sponsor, downline, CS, dan notifikasi',
          ),
          SizedBox(height: 16),
          _SearchBox(hint: 'Cari chat atau notifikasi...'),
          SizedBox(height: 16),
          _EmptyState(
            icon: Icons.chat_bubble_outline_rounded,
            title: 'Belum ada pesan',
            subtitle: 'Pesan dan notifikasi real akan muncul di sini.',
          ),
        ],
      ),
    );
  }
}

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(_demoSessionProvider);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 176),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _AccountHero(session: session),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _StatCard(
                  label: 'Wallet',
                  value: _formatCompactRupiah(session.walletBalance),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _StatCard(
                  label: 'PPOB',
                  value: _formatCompactRupiah(session.ppobBalance),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _StatCard(
                  label: 'Sponsor',
                  value: '${session.directSponsor}',
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _StatCard(
                  label: 'Level aktif',
                  value: '${session.activeLevel}',
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _AccountMenuTile('Membership Saya', Icons.workspace_premium_rounded,
              () => _openDemo(context, const MembershipScreen())),
          _AccountMenuTile('Jaringan Saya', Icons.account_tree_rounded,
              () => _openDemo(context, const ReferralTreeScreen())),
          _AccountMenuTile(
              'Wallet & Withdraw',
              Icons.account_balance_wallet_rounded,
              () => _openDemo(context, const DemoWalletScreen())),
          _AccountMenuTile('Riwayat Komisi', Icons.receipt_long_rounded,
              () => _openDemo(context, const CommissionHistoryScreen())),
          _AccountMenuTile('Reward', Icons.emoji_events_rounded,
              () => _openDemo(context, const RewardScreen())),
          if (session.isAdmin)
            _AccountMenuTile(
              session.isSuperAdmin
                  ? 'Super Admin Dashboard'
                  : 'Admin Dashboard',
              Icons.business_center_rounded,
              () => _openDemo(
                context,
                session.isSuperAdmin
                    ? const SuperAdminDashboardScreen()
                    : const AdminDashboardScreen(),
              ),
            ),
          _AccountMenuTile(
              'KYC',
              Icons.verified_user_rounded,
              () =>
                  _openDemo(context, const FeatureDetailScreen(title: 'KYC'))),
          _AccountMenuTile('Rekening Bank', Icons.account_balance_rounded,
              () => _openDemo(context, const BankAccountScreen())),
          _AccountMenuTile(
              'Kebijakan Privasi',
              Icons.privacy_tip_rounded,
              () => _openDemo(
                  context,
                  const LegalInfoScreen(
                    title: 'Kebijakan Privasi',
                    content: _privacyPolicyContent,
                  ))),
          _AccountMenuTile(
              'Syarat & Ketentuan',
              Icons.gavel_rounded,
              () => _openDemo(
                  context,
                  const LegalInfoScreen(
                    title: 'Syarat & Ketentuan',
                    content: _termsContent,
                  ))),
          _AccountMenuTile('Hapus Akun', Icons.delete_outline_rounded,
              () => _openDemo(context, const DeleteAccountRequestScreen())),
          _AccountMenuTile('Hubungi Kami', Icons.support_agent_rounded,
              () => _openDemo(context, const ContactUsScreen())),
          _AccountMenuTile('Bantuan', Icons.help_outline_rounded,
              () => _openDemo(context, const HelpCenterScreen())),
          _AccountMenuTile('Pengaturan', Icons.settings_rounded,
              () => _openDemo(context, const SettingsScreen())),
          _AccountMenuTile(
            'Logout',
            Icons.logout_rounded,
            () => _confirmAndLogout(context, ref),
          ),
        ],
      ),
    );
  }
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
    const helpItems = [
      (
        'Cara daftar',
        'Isi nama, nomor HP, password, lalu gunakan kode referral jika ada.'
      ),
      (
        'Kode referral',
        'Bagikan kode referral Anda agar downline dan bonus tercatat otomatis.'
      ),
      (
        'Upgrade membership',
        'Pilih paket Silver, Gold, atau Platinum lalu selesaikan invoice.'
      ),
      (
        'Saldo TapGoPay',
        'Saldo berasal dari bonus registrasi, sponsor, komisi, dan reward real.'
      ),
      (
        'Ajukan withdraw',
        'Lengkapi rekening bank lalu ajukan penarikan dari halaman Wallet.'
      ),
      (
        'FAQ singkat',
        'Jika data belum tampil, pastikan koneksi internet dan coba muat ulang.'
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

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(_demoSessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Pengaturan')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _InfoCard(
            icon: Icons.person_rounded,
            title: 'Profil Saya',
            subtitle: session.userName,
          ),
          const SizedBox(height: 10),
          _InfoCard(
            icon: Icons.phone_android_rounded,
            title: 'Nomor HP',
            subtitle: session.phone,
          ),
          const SizedBox(height: 10),
          _SettingsTile(
            icon: Icons.lock_rounded,
            title: 'Keamanan akun',
            onTap: () => _showSoon(context),
          ),
          _SettingsTile(
            icon: Icons.password_rounded,
            title: 'Ubah password',
            onTap: () => _showSoon(context),
          ),
          _SettingsTile(
            icon: Icons.language_rounded,
            title: 'Bahasa',
            subtitle: 'Indonesia',
            onTap: () => _showSoon(context),
          ),
          _SettingsTile(
            icon: Icons.dark_mode_rounded,
            title: 'Tema aplikasi',
            subtitle: 'Ikuti pengaturan sistem',
            onTap: () => _showSoon(context),
          ),
          _SettingsTile(
            icon: Icons.notifications_rounded,
            title: 'Notifikasi',
            onTap: () => _showSoon(context),
          ),
          _SettingsTile(
            icon: Icons.delete_outline_rounded,
            title: 'Hapus akun',
            onTap: () => _openDemo(context, const DeleteAccountRequestScreen()),
          ),
          _SettingsTile(
            icon: Icons.info_outline_rounded,
            title: 'Tentang TapGo',
            subtitle: 'PT. TapGo Lion Indonesia',
            onTap: () => _showInfoSnack(context, 'TapGo Membership'),
          ),
          const _SettingsTile(
            icon: Icons.verified_rounded,
            title: 'Versi aplikasi',
            subtitle: '1.0.3',
          ),
          _SettingsTile(
            icon: Icons.logout_rounded,
            title: 'Logout',
            onTap: () => _confirmAndLogout(context, ref),
          ),
        ],
      ),
    );
  }
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
                if (action != null) ...[
                  const SizedBox(height: 12),
                  action!,
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4),
      leading: Icon(icon, color: _brandBlue),
      title: Text(
        title,
        style: const TextStyle(fontWeight: FontWeight.w800),
      ),
      subtitle: subtitle == null ? null : Text(subtitle!),
      trailing: onTap == null ? null : const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    );
  }
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile({required this.item});

  final _ServiceItem item;

  @override
  Widget build(BuildContext context) {
    final style = _serviceIconStyle(item.label);
    return Stack(
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
              size: 68,
            ),
            const SizedBox(height: 9),
            SizedBox(
              width: 82,
              height: 32,
              child: Center(
                child: Text(
                  item.label,
                  maxLines: 2,
                  softWrap: true,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Color(0xFF263241),
                    fontSize: 11.2,
                    height: 1.05,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          ],
        ),
        if (item.badge != null)
          Positioned(
            top: -8,
            child: _FloatingServiceBadge(label: item.badge!),
          ),
      ],
    );
  }
}

class _FloatingServiceBadge extends StatefulWidget {
  const _FloatingServiceBadge({required this.label});

  final String label;

  @override
  State<_FloatingServiceBadge> createState() => _FloatingServiceBadgeState();
}

class _FloatingServiceBadgeState extends State<_FloatingServiceBadge>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _scale;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1900),
    );
    _scale = Tween<double>(begin: 1, end: 1.08).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
    if (_dashboardLiveAnimationsEnabled) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ScaleTransition(
      scale: _scale,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFFFF3B30), Color(0xFFFFB000)],
          ),
          borderRadius: BorderRadius.circular(12),
          boxShadow: const [
            BoxShadow(
              color: Color(0x55FF3B30),
              blurRadius: 14,
              offset: Offset(0, 6),
            ),
          ],
        ),
        child: Text(
          widget.label,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 10,
            fontWeight: FontWeight.w900,
          ),
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
        ),
        child: Icon(icon, color: Colors.white, size: 31),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 18,
      height: 18,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        color: Color(0xFFFF3434),
        shape: BoxShape.circle,
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 10,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _PulseBadge extends StatelessWidget {
  const _PulseBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.95, end: 1.05),
      duration: const Duration(milliseconds: 650),
      curve: Curves.easeOutBack,
      builder: (context, scale, child) =>
          Transform.scale(scale: scale, child: child),
      child: _Badge(label: label),
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
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Colors.white.withValues(alpha: 0.98),
            style.background.withValues(alpha: 0.92),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(size * 0.31),
        border: Border.all(color: Colors.white.withValues(alpha: 0.85)),
        boxShadow: [
          BoxShadow(
            color: style.primary.withValues(alpha: 0.26),
            blurRadius: size * 0.24,
            offset: Offset(0, size * 0.12),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned(
            left: size * 0.14,
            top: size * 0.10,
            child: Container(
              width: size * 0.36,
              height: size * 0.10,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.76),
                borderRadius: BorderRadius.circular(size),
              ),
            ),
          ),
          Positioned(
            right: -size * 0.14,
            bottom: -size * 0.16,
            child: Container(
              width: size * 0.52,
              height: size * 0.52,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: style.primary.withValues(alpha: 0.10),
              ),
            ),
          ),
          Padding(
            padding: EdgeInsets.all(size * 0.03),
            child: _TapGoServiceIllustration(
              label: label,
              fallbackIcon: icon,
              fallbackStyle: style,
              size: size,
            ),
          ),
        ],
      ),
    );
  }
}

_ServiceIconStyle _serviceIconStyle(String label) {
  return switch (label) {
    'TapGo Ride' => const _ServiceIconStyle(
        primary: Color(0xFF006AF5),
        secondary: Color(0xFF1FA2FF),
        background: Color(0xFFEAF5FF),
      ),
    'TapGo Car' => const _ServiceIconStyle(
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
    'Membership' || 'Marketing Plan' || 'Reward' => const _ServiceIconStyle(
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
              child: Icon(
                icon,
                color: Colors.white,
                size: size * 0.34,
              ),
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
              ),
            ),
          ),
        ],
      ),
    );
  }
}
