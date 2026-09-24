part of '../main.dart';

/// Komponen kehalusan tampilan yang dipakai lintas layar: skeleton loading,
/// animasi radar pencarian driver, indikator langkah perjalanan, dan haptic.
/// Warna dan font tidak diubah: semuanya memakai palet dan tema yang sudah ada.

/// Animasi berulang (shimmer, radar) tidak dijalankan saat `flutter test`:
/// pumpAndSettle tidak boleh menggantung pada animasi tanpa akhir. Uji yang
/// memang ingin memeriksa animasi menyalakannya lewat
/// [tapGoForceLoopAnimationsForTests]. Pengguna dengan "hapus animasi" aktif
/// di pengaturan sistem juga tidak mendapat animasi berulang.
final bool _tapGoRunningUnderTest =
    Platform.environment['FLUTTER_TEST'] == 'true';

@visibleForTesting
bool tapGoForceLoopAnimationsForTests = false;

bool _tapGoLoopAnimationsAllowed(BuildContext context) =>
    (tapGoForceLoopAnimationsForTests || !_tapGoRunningUnderTest) &&
    !_TapGoMotion.reduce(context);

/// Umpan balik getar. Kegagalan platform tidak boleh mengganggu alur.
class _TapGoHaptic {
  const _TapGoHaptic._();

  static void tap() => _run(HapticFeedback.selectionClick);
  static void light() => _run(HapticFeedback.lightImpact);
  static void success() => _run(HapticFeedback.mediumImpact);
  static void warning() => _run(HapticFeedback.heavyImpact);

  static void _run(Future<void> Function() call) {
    try {
      unawaited(call());
    } catch (_) {}
  }
}

/// Kotak abu berkilau sebagai pengganti spinner saat daftar/kartu dimuat.
class _TapGoSkeleton extends StatefulWidget {
  const _TapGoSkeleton({this.width, this.height = 14, this.radius = 8});

  final double? width;
  final double height;
  final double radius;

  @override
  State<_TapGoSkeleton> createState() => _TapGoSkeletonState();
}

class _TapGoSkeletonState extends State<_TapGoSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1300),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_tapGoLoopAnimationsAllowed(context)) {
      if (!_controller.isAnimating) {
        _controller.repeat();
      }
    } else {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).colorScheme.outlineVariant;
    final highlight = Theme.of(context).colorScheme.surface;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final t = _controller.value;
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.radius),
            gradient: LinearGradient(
              begin: Alignment(-1.5 + 3 * t, 0),
              end: Alignment(-0.5 + 3 * t, 0),
              colors: [
                base.withValues(alpha: 0.55),
                highlight.withValues(alpha: 0.9),
                base.withValues(alpha: 0.55),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Baris skeleton berbentuk sama dengan kartu aktivitas/riwayat.
class _SkeletonTile extends StatelessWidget {
  const _SkeletonTile();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: const Row(
        children: [
          _TapGoSkeleton(width: 46, height: 46, radius: 15),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _TapGoSkeleton(width: 150, height: 14),
                SizedBox(height: 8),
                _TapGoSkeleton(height: 11),
                SizedBox(height: 8),
                _TapGoSkeleton(width: 110, height: 10),
              ],
            ),
          ),
          SizedBox(width: 12),
          _TapGoSkeleton(width: 56, height: 14),
        ],
      ),
    );
  }
}

/// Daftar skeleton dengan label aksesibilitas "Memuat".
class _SkeletonList extends StatelessWidget {
  const _SkeletonList({this.count = 4, this.label = 'Memuat'});

  final int count;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      liveRegion: true,
      child: ExcludeSemantics(
        child: Column(
          children: List.generate(count, (_) => const _SkeletonTile()),
        ),
      ),
    );
  }
}

/// Cincin radar berdenyut di sekitar ikon kendaraan saat mencari driver.
class _RadarPulse extends StatefulWidget {
  const _RadarPulse({required this.icon});

  final IconData icon;
  static const double size = 132;

  @override
  State<_RadarPulse> createState() => _RadarPulseState();
}

class _RadarPulseState extends State<_RadarPulse>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2400),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_tapGoLoopAnimationsAllowed(context)) {
      if (!_controller.isAnimating) {
        _controller.repeat();
      }
    } else {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final core = _RadarPulse.size * 0.42;
    return ExcludeSemantics(
      child: SizedBox(
        width: _RadarPulse.size,
        height: _RadarPulse.size,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            return Stack(
              alignment: Alignment.center,
              children: [
                for (var i = 0; i < 3; i++)
                  _ring((_controller.value + i / 3) % 1),
                Container(
                  width: core,
                  height: core,
                  decoration: const BoxDecoration(
                    color: _brandBlue,
                    shape: BoxShape.circle,
                  ),
                  child:
                      Icon(widget.icon, color: Colors.white, size: core * 0.55),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _ring(double t) {
    final core = _RadarPulse.size * 0.42;
    final diameter = core + (_RadarPulse.size - core) * t;
    return Container(
      width: diameter,
      height: diameter,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: _brandBlue.withValues(alpha: 0.30 * (1 - t)),
          width: 2,
        ),
      ),
    );
  }
}

/// Indikator langkah perjalanan: Cari driver → Dijemput → Perjalanan → Selesai.
/// Tidak ditampilkan untuk perjalanan batal atau status tak dikenal.
class _RideProgressStepper extends StatelessWidget {
  const _RideProgressStepper({required this.phase});

  final RideUiPhase phase;

  static const labels = ['Cari driver', 'Dijemput', 'Perjalanan', 'Selesai'];

  /// Indeks langkah aktif, atau null bila stepper tidak relevan.
  static int? indexFor(RideUiPhase phase) => switch (phase) {
        RideUiPhase.created || RideUiPhase.searching => 0,
        RideUiPhase.assigned || RideUiPhase.arrived => 1,
        RideUiPhase.inTrip => 2,
        RideUiPhase.completed => 3,
        _ => null,
      };

  @override
  Widget build(BuildContext context) {
    final current = indexFor(phase);
    if (current == null) {
      return const SizedBox.shrink();
    }
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      label: 'Langkah ${current + 1} dari ${labels.length}: ${labels[current]}',
      child: ExcludeSemantics(
        child: Row(
          children: [
            for (var i = 0; i < labels.length; i++) ...[
              Expanded(
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                            child: _line(i == 0 ? null : i <= current, scheme)),
                        _dot(i, current, scheme),
                        Expanded(
                          child: _line(
                            i == labels.length - 1 ? null : i < current,
                            scheme,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      labels[i],
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight:
                            i == current ? FontWeight.w900 : FontWeight.w600,
                        color: i <= current
                            ? scheme.onSurface
                            : scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _dot(int index, int current, ColorScheme scheme) {
    final done =
        index < current || (index == current && phase == RideUiPhase.completed);
    final active = index == current && !done;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      width: active ? 22 : 18,
      height: active ? 22 : 18,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: done || active ? _brandBlue : Colors.transparent,
        border: Border.all(
          color: done || active ? _brandBlue : scheme.outlineVariant,
          width: 2,
        ),
        boxShadow: active
            ? [
                BoxShadow(
                  color: _brandBlue.withValues(alpha: 0.35),
                  blurRadius: 8,
                ),
              ]
            : null,
      ),
      child: done
          ? const Icon(Icons.check_rounded, size: 12, color: Colors.white)
          : null,
    );
  }

  Widget _line(bool? filled, ColorScheme scheme) {
    return Container(
      height: 2,
      color: filled == null
          ? Colors.transparent
          : (filled ? _brandBlue : scheme.outlineVariant),
    );
  }
}

/// Pintu uji untuk widget pribadi.
@visibleForTesting
class SkeletonForTests extends StatelessWidget {
  const SkeletonForTests({super.key, this.count = 3});

  final int count;

  @override
  Widget build(BuildContext context) => _SkeletonList(count: count);
}
