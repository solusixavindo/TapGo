part of '../main.dart';

void _openDemo(BuildContext context, Widget screen) {
  Navigator.of(context).push(
    _tapGoPageRoute((_) => screen),
  );
}

class _TapGoMotion {
  const _TapGoMotion._();

  static const fast = Duration(milliseconds: 120);
  static const quick = Duration(milliseconds: 160);
  static const standard = Duration(milliseconds: 220);
  static const page = Duration(milliseconds: 280);
  static const standardCurve = Curves.easeOutCubic;
  static const exitCurve = Curves.easeInCubic;

  static bool reduce(BuildContext context) =>
      MediaQuery.maybeOf(context)?.disableAnimations ?? false;

  static Duration duration(BuildContext context, Duration value) =>
      reduce(context) ? Duration.zero : value;
}

class _TapGoReveal extends StatefulWidget {
  const _TapGoReveal({
    required this.order,
    required this.child,
  });

  final int order;
  final Widget child;

  @override
  State<_TapGoReveal> createState() => _TapGoRevealState();
}

class _TapGoRevealState extends State<_TapGoReveal> {
  bool _visible = false;

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(Duration(milliseconds: widget.order * 44), () {
      if (mounted) {
        setState(() => _visible = true);
      }
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
        offset: _visible || reduced ? Offset.zero : const Offset(0, 0.1),
        duration: _TapGoMotion.duration(context, _TapGoMotion.page),
        curve: _TapGoMotion.standardCurve,
        child: widget.child,
      ),
    );
  }
}

class _TapGoFadeSwitcher extends StatelessWidget {
  const _TapGoFadeSwitcher({
    required this.valueKey,
    required this.child,
  });

  final Object valueKey;
  final Widget child;

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
      child: KeyedSubtree(
        key: ValueKey(valueKey),
        child: child,
      ),
    );
  }
}

enum _TapGoFeedbackType { success, error, warning, info }

class _TapGoSnackbar {
  const _TapGoSnackbar._();

  static void success(BuildContext context, String message) {
    show(context, message, type: _TapGoFeedbackType.success);
  }

  static void error(BuildContext context, String message) {
    show(context, message, type: _TapGoFeedbackType.error);
  }

  static void warning(BuildContext context, String message) {
    show(context, message, type: _TapGoFeedbackType.warning);
  }

  static void info(BuildContext context, String message) {
    show(context, message, type: _TapGoFeedbackType.info);
  }

  static void show(
    BuildContext context,
    String message, {
    _TapGoFeedbackType type = _TapGoFeedbackType.info,
  }) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) {
      return;
    }
    showWithMessenger(messenger, message, type: type);
  }

  static void showWithMessenger(
    ScaffoldMessengerState messenger,
    String message, {
    _TapGoFeedbackType type = _TapGoFeedbackType.info,
  }) {
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 3),
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 18),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        backgroundColor: _feedbackBackground(type),
        content: Row(
          children: [
            Icon(_feedbackIcon(type), color: Colors.white, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                message,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  height: 1.25,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static Color _feedbackBackground(_TapGoFeedbackType type) {
    switch (type) {
      case _TapGoFeedbackType.success:
        return const Color(0xFF00A86B);
      case _TapGoFeedbackType.error:
        return const Color(0xFFC62828);
      case _TapGoFeedbackType.warning:
        return const Color(0xFFB7791F);
      case _TapGoFeedbackType.info:
        return _brandBlue;
    }
  }

  static IconData _feedbackIcon(_TapGoFeedbackType type) {
    switch (type) {
      case _TapGoFeedbackType.success:
        return Icons.check_circle_rounded;
      case _TapGoFeedbackType.error:
        return Icons.error_rounded;
      case _TapGoFeedbackType.warning:
        return Icons.info_rounded;
      case _TapGoFeedbackType.info:
        return Icons.info_rounded;
    }
  }
}

class _TapGoStateEntrance extends StatelessWidget {
  const _TapGoStateEntrance({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final reduced = _TapGoMotion.reduce(context);
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: reduced ? 1 : 0, end: 1),
      duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
      curve: _TapGoMotion.standardCurve,
      builder: (context, value, child) => Opacity(
        opacity: value,
        child: Transform.scale(
          scale: reduced ? 1 : 0.98 + (value * 0.02),
          child: child,
        ),
      ),
      child: child,
    );
  }
}

class _TapGoLoading extends StatelessWidget {
  const _TapGoLoading({
    this.size = 22,
    this.strokeWidth = 2.4,
    this.color = _brandBlue,
  });

  final double size;
  final double strokeWidth;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CircularProgressIndicator(
        strokeWidth: strokeWidth,
        valueColor: AlwaysStoppedAnimation<Color>(color),
      ),
    );
  }
}

PageRoute<T> _tapGoPageRoute<T>(WidgetBuilder builder) {
  return PageRouteBuilder<T>(
    pageBuilder: (context, animation, secondaryAnimation) => builder(context),
    transitionDuration: _TapGoMotion.page,
    reverseTransitionDuration: _TapGoMotion.standard,
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      if (_TapGoMotion.reduce(context)) {
        return child;
      }
      final curved = CurvedAnimation(
        parent: animation,
        curve: _TapGoMotion.standardCurve,
        reverseCurve: _TapGoMotion.exitCurve,
      );
      return FadeTransition(
        opacity: curved,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0, 0.025),
            end: Offset.zero,
          ).animate(curved),
          child: child,
        ),
      );
    },
  );
}

Future<T?> _showTapGoDialog<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool barrierDismissible = true,
}) {
  return showGeneralDialog<T>(
    context: context,
    barrierDismissible: barrierDismissible,
    barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
    barrierColor: Colors.black54,
    transitionDuration: _TapGoMotion.duration(context, _TapGoMotion.standard),
    pageBuilder: (dialogContext, animation, secondaryAnimation) {
      return Theme(
        data: Theme.of(context),
        child: Builder(builder: builder),
      );
    },
    transitionBuilder: (context, animation, secondaryAnimation, child) {
      if (_TapGoMotion.reduce(context)) {
        return child;
      }
      final curved = CurvedAnimation(
        parent: animation,
        curve: _TapGoMotion.standardCurve,
        reverseCurve: _TapGoMotion.exitCurve,
      );
      return FadeTransition(
        opacity: curved,
        child: ScaleTransition(
          scale: Tween<double>(begin: 0.98, end: 1).animate(curved),
          child: child,
        ),
      );
    },
  );
}

Future<T?> _showTapGoBottomSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  bool isScrollControlled = false,
  bool showDragHandle = false,
  bool enableDrag = true,
  Color? backgroundColor,
  ShapeBorder? shape,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: isScrollControlled,
    showDragHandle: showDragHandle,
    enableDrag: enableDrag,
    useSafeArea: true,
    backgroundColor: backgroundColor,
    shape: shape,
    sheetAnimationStyle: AnimationStyle(
      duration: _TapGoMotion.duration(context, _TapGoMotion.page),
      reverseDuration: _TapGoMotion.duration(context, _TapGoMotion.standard),
    ),
    builder: builder,
  );
}

Widget _roleDashboardForContext(BuildContext context) {
  final session = ProviderScope.containerOf(context, listen: false)
      .read(_demoSessionProvider);
  if (session.isSuperAdmin) {
    return const SuperAdminDashboardScreen();
  }
  if (session.role == 'ADMIN') {
    return const AdminDashboardScreen();
  }
  return const TapGoDashboard();
}

void _safeBack(BuildContext context, {Widget? fallback}) {
  final navigator = Navigator.of(context);
  if (navigator.canPop()) {
    navigator.pop();
    return;
  }

  navigator.pushReplacement(
    _tapGoPageRoute((_) => fallback ?? _roleDashboardForContext(context)),
  );
}

Future<void> _confirmAndLogout(BuildContext context, WidgetRef ref) async {
  final confirmed = await _showTapGoDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: const Text('Logout'),
      content: const Text('Apakah Anda yakin ingin keluar dari akun ini?'),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Batal'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          style: FilledButton.styleFrom(
            backgroundColor: _brandBlue,
            foregroundColor: Colors.white,
          ),
          child: const Text('Logout'),
        ),
      ],
    ),
  );

  if (confirmed != true || !context.mounted) {
    return;
  }

  _apiClient.setAccessToken(null);
  await _persistentStore.clearSession();
  ref.read(_demoSessionProvider.notifier).state = DemoClientSession.initial();
  ref.read(_isAuthenticatedProvider.notifier).state = false;

  if (!context.mounted) {
    return;
  }
  Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
    _tapGoPageRoute((_) => const AuthScreen()),
    (_) => false,
  );
}

class _TapGoPressable extends StatefulWidget {
  const _TapGoPressable({
    required this.child,
    required this.onTap,
    required this.borderRadius,
    this.pressedScale = 0.98,
  });

  final Widget child;
  final VoidCallback onTap;
  final BorderRadius borderRadius;
  final double pressedScale;

  @override
  State<_TapGoPressable> createState() => _TapGoPressableState();
}

class _TapGoPressableState extends State<_TapGoPressable> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (_pressed == value || !mounted) {
      return;
    }
    setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final reduced = _TapGoMotion.reduce(context);
    return AnimatedScale(
      scale: !reduced && _pressed ? widget.pressedScale : 1,
      duration: _TapGoMotion.duration(context, _TapGoMotion.fast),
      curve: _TapGoMotion.standardCurve,
      child: Material(
        color: Colors.transparent,
        borderRadius: widget.borderRadius,
        child: InkWell(
          borderRadius: widget.borderRadius,
          onTap: widget.onTap,
          onTapDown: (_) => _setPressed(true),
          onTapCancel: () => _setPressed(false),
          onTapUp: (_) => _setPressed(false),
          child: widget.child,
        ),
      ),
    );
  }
}

class _UploadDocumentField extends StatelessWidget {
  const _UploadDocumentField({
    required this.label,
    required this.emptyButtonLabel,
    required this.filledButtonLabel,
    required this.document,
    required this.onTap,
  });

  final String label;
  final String emptyButtonLabel;
  final String filledButtonLabel;
  final _PickedDemoDocument? document;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final uploaded = document != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OutlinedButton.icon(
          onPressed: onTap,
          icon: Icon(uploaded ? Icons.cached_rounded : Icons.upload_rounded),
          label: Text(uploaded ? filledButtonLabel : emptyButtonLabel),
          style: OutlinedButton.styleFrom(
            foregroundColor: uploaded ? const Color(0xFF00A86B) : _brandBlue,
            side: BorderSide(
              color: uploaded ? const Color(0xFF00A86B) : _brandBlue,
            ),
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          ),
        ),
        AnimatedSwitcher(
          duration: _TapGoMotion.duration(context, _TapGoMotion.standard),
          switchInCurve: _TapGoMotion.standardCurve,
          switchOutCurve: _TapGoMotion.exitCurve,
          child: uploaded
              ? _DocumentPreview(label: label, document: document!)
              : const SizedBox.shrink(),
        ),
      ],
    );
  }
}

class _DocumentPreview extends StatelessWidget {
  const _DocumentPreview({required this.label, required this.document});

  final String label;
  final _PickedDemoDocument document;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: ValueKey(document.fileName),
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEAF0F6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              height: 78,
              width: double.infinity,
              child: document.path == null
                  ? Container(
                      color: const Color(0xFFEAF7FF),
                      alignment: Alignment.center,
                      child: const Icon(
                        Icons.image_rounded,
                        color: _brandBlue,
                        size: 32,
                      ),
                    )
                  : Image.file(
                      File(document.path!),
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                        color: const Color(0xFFEAF7FF),
                        alignment: Alignment.center,
                        child: const Icon(
                          Icons.image_rounded,
                          color: _brandBlue,
                          size: 32,
                        ),
                      ),
                    ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            document.statusLabel,
            style: const TextStyle(
              color: Color(0xFF00A86B),
              fontSize: 11,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            document.fileName.isEmpty ? label : document.fileName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(0xFF718096),
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _DemoScaffold extends StatelessWidget {
  const _DemoScaffold({
    required this.title,
    required this.subtitle,
    required this.child,
    this.showBackButton = true,
  });

  final String title;
  final String subtitle;
  final Widget child;
  final bool showBackButton;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (showBackButton) ...[
                    IconButton.filledTonal(
                      onPressed: () => _safeBack(context),
                      icon: const Icon(Icons.arrow_back_rounded),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: TextStyle(
                            color: colorScheme.onSurface,
                            fontSize: 24,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          subtitle,
                          style: TextStyle(
                            color: colorScheme.onSurfaceVariant,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              child,
            ],
          ),
        ),
      ),
    );
  }
}

class _ProductionStatusTile extends ConsumerWidget {
  const _ProductionStatusTile({required this.state});

  final AsyncValue<_TapGoProductionSnapshot> state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (state.isLoading) {
      return const _StatusSurface(
        icon: Icons.sync_rounded,
        title: 'Memuat data TapGo',
        subtitle: 'Menyiapkan data TapGo...',
      );
    }

    if (state.hasError) {
      return _RetryStatusSurface(
        icon: Icons.cloud_off_rounded,
        title: 'Data belum tersedia',
        subtitle: 'Koneksi data belum berhasil dimuat.',
        onRetry: () => ref.invalidate(_productionSnapshotProvider),
      );
    }

    return _StatusSurface(
      icon: Icons.cloud_done_rounded,
      title: 'Data TapGo aktif',
      subtitle: tapGoIsPlayDistribution
          ? 'Akun Basic tersinkron.'
          : 'Membership, referral, dan wallet tersinkron.',
    );
  }
}

class _RetryStatusSurface extends StatelessWidget {
  const _RetryStatusSurface({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onRetry,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return _TapGoStateEntrance(
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: colorScheme.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: colorScheme.outlineVariant),
        ),
        child: Row(
          children: [
            Icon(icon, color: _brandBlue, size: 26),
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
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    style: TextStyle(
                      color: colorScheme.onSurfaceVariant,
                      fontSize: 12,
                      height: 1.3,
                    ),
                  ),
                ],
              ),
            ),
            TextButton(
              onPressed: onRetry,
              child: const Text('Muat Ulang'),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusSurface extends StatelessWidget {
  const _StatusSurface({
    required this.icon,
    required this.title,
    required this.subtitle,
    super.key,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return _TapGoStateEntrance(
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: colorScheme.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: colorScheme.outlineVariant),
        ),
        child: Row(
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
                  Text(
                    subtitle,
                    style: TextStyle(
                      color: colorScheme.onSurfaceVariant,
                      fontSize: 12,
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

class _DemoMenuTile extends StatelessWidget {
  const _DemoMenuTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: _TapGoPressable(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: colorScheme.surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: colorScheme.outlineVariant),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                PremiumTapGoIcon.assetFor(title) != null
                    ? PremiumTapGoIcon(
                        label: title,
                        fallbackIcon: icon,
                        size: 48,
                        padding: 2,
                      )
                    : Container(
                        width: 48,
                        height: 48,
                        decoration: BoxDecoration(
                          color: const Color(0xFFEAF7FF),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Icon(icon, color: _brandBlue),
                      ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          color: colorScheme.onSurface,
                          fontWeight: FontWeight.w900,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        subtitle,
                        style: TextStyle(
                          color: colorScheme.onSurfaceVariant,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded,
                    color: Color(0xFF718096)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
