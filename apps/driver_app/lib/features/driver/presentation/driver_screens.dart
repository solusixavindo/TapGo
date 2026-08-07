part of '../../../main.dart';

/// Brand mark resmi TapGo untuk aplikasi driver.
///
/// Aset lokal, bukan jaringan: tidak ada satu pun permintaan eksternal untuk
/// merender logo. Berkasnya adalah salinan byte-identik dari
/// google-play-assets/TapGo_Logo_512x512.png.
const String driverBrandLogoAsset = 'assets/images/tapgo_logo_512.png';

class DriverShell extends ConsumerWidget {
  const DriverShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(driverControllerProvider);
    final controller = ref.read(driverControllerProvider.notifier);
    return Scaffold(
      appBar: AppBar(
        title: const Text('TapGo Driver'),
        actions: [
          if (state.isAuthenticated)
            IconButton(
              tooltip: 'Logout',
              onPressed: state.isBusy ? null : controller.logout,
              icon: const Icon(Icons.logout_rounded),
            ),
        ],
      ),
      body: SafeArea(
        child: Stack(
          children: [
            DriverOverlay(
              child: Padding(
                padding:
                    EdgeInsets.only(bottom: state.isAuthenticated ? 24 : 0),
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 220),
                  child: _bodyFor(state),
                ),
              ),
            ),
            if (kDriverDemoMode)
              const Positioned(top: 0, left: 0, right: 0, child: DemoBanner()),
          ],
        ),
      ),
      bottomNavigationBar: state.isAuthenticated
          ? NavigationBar(
              selectedIndex: 0,
              destinations: const [
                NavigationDestination(
                  icon: Icon(Icons.route_rounded),
                  label: 'Perjalanan',
                ),
                NavigationDestination(
                  icon: Icon(Icons.person_rounded),
                  label: 'Akun',
                ),
              ],
            )
          : null,
    );
  }

  Widget _bodyFor(DriverState state) {
    switch (state.status) {
      case DriverWorkspaceStatus.loading:
        return const LoadingScreen(key: ValueKey('loading'));
      case DriverWorkspaceStatus.unauthenticated:
        return const LoginScreen(key: ValueKey('login'));
      case DriverWorkspaceStatus.profileRequired:
        return CapabilityScreen(
          key: const ValueKey('profile-required'),
          title: 'Profil driver diperlukan',
          message:
              state.message ?? 'Akun ini belum memiliki profil driver aktif.',
          icon: Icons.badge_rounded,
        );
      case DriverWorkspaceStatus.pending:
        return CapabilityScreen(
          key: const ValueKey('pending'),
          title: 'Akun driver belum aktif',
          message: state.message ?? 'Pengajuan driver sedang ditinjau.',
          icon: Icons.hourglass_top_rounded,
        );
      case DriverWorkspaceStatus.suspended:
      case DriverWorkspaceStatus.rejected:
        return CapabilityScreen(
          key: const ValueKey('suspended'),
          title: 'Akses driver dihentikan',
          message: state.message ?? 'Akun driver belum dapat digunakan.',
          icon: Icons.block_rounded,
        );
      case DriverWorkspaceStatus.accountInactive:
        return CapabilityScreen(
          key: const ValueKey('account-inactive'),
          title: 'Akun tidak aktif',
          message: state.message ?? 'Hubungi dukungan TapGo.',
          icon: Icons.lock_rounded,
        );
      case DriverWorkspaceStatus.sessionExpired:
        return CapabilityScreen(
          key: const ValueKey('session-expired'),
          title: 'Sesi berakhir',
          message: state.message ?? 'Silakan login kembali.',
          icon: Icons.lock_clock_rounded,
          showLoginAction: true,
        );
      case DriverWorkspaceStatus.networkError:
        return CapabilityScreen(
          key: const ValueKey('network-error'),
          title: 'Koneksi belum stabil',
          message: state.message ?? 'Coba muat ulang beberapa saat lagi.',
          icon: Icons.wifi_off_rounded,
          showRetry: true,
        );
      case DriverWorkspaceStatus.active:
        return const DriverHomeScreen(key: ValueKey('home'));
    }
  }
}

class DemoBanner extends StatelessWidget {
  const DemoBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Demo data tidak terhubung backend atau provider',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        color: const Color(0xFFFFC857),
        child: const Text(
          'DEMO DATA — tidak terhubung backend/provider',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Color(0xFF061A2F),
            fontWeight: FontWeight.w800,
            fontSize: 12,
          ),
        ),
      ),
    );
  }
}

class LoadingScreen extends StatelessWidget {
  const LoadingScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return const Center(child: CircularProgressIndicator());
  }
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phone =
      TextEditingController(text: kDriverDemoMode ? '080000000000' : '');
  final _password =
      TextEditingController(text: kDriverDemoMode ? 'driver-demo' : '');

  /// Password tersembunyi secara default; hanya pengguna yang membukanya.
  bool _obscurePassword = true;

  @override
  void dispose() {
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(driverControllerProvider);
    final controller = ref.read(driverControllerProvider.notifier);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, kDriverDemoMode ? 56 : 28, 20, 20),
      children: [
        const _BrandHeader(
          title: 'TapGo Driver',
          subtitle: 'Masuk untuk mengelola perjalanan dengan akses '
              'mitra yang terverifikasi.',
        ),
        const SizedBox(height: 24),
        TextField(
          key: const ValueKey('driver-phone-input'),
          controller: _phone,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
          decoration: const InputDecoration(
            labelText: 'Nomor HP',
            hintText: '08xxxxxxxxxx',
            // Leading icon memberi jangkar visual pada field identitas.
            prefixIcon: Icon(Icons.smartphone_rounded),
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 14),
        TextField(
          key: const ValueKey('driver-password-input'),
          controller: _password,
          obscureText: _obscurePassword,
          autofillHints: const [AutofillHints.password],
          decoration: InputDecoration(
            labelText: 'Password',
            prefixIcon: const Icon(Icons.lock_rounded),
            suffixIcon: IconButton(
              key: const ValueKey('driver-password-visibility'),
              // 48 dp memenuhi ukuran target sentuh minimum.
              constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
              tooltip: _obscurePassword
                  ? 'Tampilkan password'
                  : 'Sembunyikan password',
              onPressed: () =>
                  setState(() => _obscurePassword = !_obscurePassword),
              icon: Icon(
                _obscurePassword
                    ? Icons.visibility_rounded
                    : Icons.visibility_off_rounded,
              ),
            ),
            border: const OutlineInputBorder(),
          ),
          onSubmitted: (_) => controller.login(_phone.text, _password.text),
        ),
        if (state.message != null) ...[
          const SizedBox(height: 12),
          ErrorNotice(message: state.message!),
        ],
        const SizedBox(height: 20),
        FilledButton(
          key: const ValueKey('driver-login-button'),
          // Kontras tinggi: gold TapGo dengan teks navy. Disabled state tetap
          // memakai warna eksplisit supaya labelnya tidak memudar menjadi
          // nyaris tak terbaca saat permintaan sedang berjalan.
          style: FilledButton.styleFrom(
            backgroundColor: const Color(0xFFFFC857),
            foregroundColor: const Color(0xFF061A2F),
            disabledBackgroundColor: const Color(0xFFE0AE3F),
            disabledForegroundColor: const Color(0xFF061A2F),
            minimumSize: const Size.fromHeight(52),
            textStyle: const TextStyle(
              // fontFamily disebut eksplisit: TextStyle pada styleFrom tidak
              // selalu mewarisi keluarga font tema, dan tanpa ini label dapat
              // jatuh ke font bawaan.
              fontFamily: 'Roboto',
              fontSize: 16,
              fontWeight: FontWeight.w900,
            ),
          ),
          onPressed: state.isBusy
              ? null
              : () => controller.login(_phone.text, _password.text),
          child: state.isBusy
              // Label tetap terbaca saat loading; spinner mendampinginya,
              // bukan menggantikannya.
              ? const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Color(0xFF061A2F),
                      ),
                    ),
                    SizedBox(width: 12),
                    Flexible(
                      child: Text(
                        'Masuk sebagai Driver',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                )
              : const Text('Masuk sebagai Driver'),
        ),
        if (kDriverDemoMode) const DemoScenarioSelector(),
      ],
    );
  }
}

class DriverHomeScreen extends ConsumerWidget {
  const DriverHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(driverControllerProvider);
    final controller = ref.read(driverControllerProvider.notifier);
    final topPadding = kDriverDemoMode ? 52.0 : 20.0;
    return RefreshIndicator(
      onRefresh: controller.refreshWorkspace,
      child: ListView(
        padding: EdgeInsets.fromLTRB(16, topPadding, 16, 120),
        children: [
          _DriverStatusCard(state: state),
          const SizedBox(height: 16),
          if (state.message != null) ...[
            ErrorNotice(message: state.message!),
            const SizedBox(height: 12),
          ],
          if (state.activeRide != null)
            ActiveRideCard(ride: state.activeRide!)
          else ...[
            AvailabilityCard(state: state),
            const SizedBox(height: 16),
            _OfferSection(state: state),
          ],
          if (kDriverDemoMode) const DemoScenarioSelector(),
        ],
      ),
    );
  }
}

class _BrandHeader extends StatelessWidget {
  const _BrandHeader({required this.title, required this.subtitle});
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF061A2F), Color(0xFF0877E8)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Brand mark resmi TapGo dari asset lokal. Sebelumnya di sini ada
          // Icons.local_taxi_rounded — ikon generik Material yang bukan logo
          // TapGo dan memberi kesan prototype.
          Semantics(
            label: 'Logo TapGo',
            image: true,
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Image.asset(
                driverBrandLogoAsset,
                width: 56,
                height: 56,
                // Rasio asli 1:1 dipertahankan; tanpa ini logo dapat
                // teregang bila kotak induknya berubah.
                fit: BoxFit.contain,
                filterQuality: FilterQuality.high,
                excludeFromSemantics: true,
              ),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            title,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
          ),
          const SizedBox(height: 8),
          Text(subtitle, style: const TextStyle(color: Colors.white70)),
        ],
      ),
    );
  }
}

class _DriverStatusCard extends ConsumerWidget {
  const _DriverStatusCard({required this.state});
  final DriverState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final name = state.session?.driverName ?? 'Driver TapGo';
    final status = switch (state.availability) {
      DriverAvailability.online => 'Online',
      DriverAvailability.busy => 'Dalam Perjalanan',
      DriverAvailability.offline => 'Offline',
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                        colors: [Color(0xFF00D4FF), Color(0xFF0877E8)]),
                  ),
                  child: const Icon(Icons.person_rounded, color: Colors.white),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 4),
                      Text('Status: $status'),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            StatusPill(
              label: status,
              active: state.availability != DriverAvailability.offline,
            ),
          ],
        ),
      ),
    );
  }
}

class AvailabilityCard extends ConsumerWidget {
  const AvailabilityCard({required this.state, super.key});
  final DriverState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(driverControllerProvider.notifier);
    final isOnline = state.availability == DriverAvailability.online;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Ketersediaan', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
              isOnline
                  ? 'Anda siap menerima perjalanan baru.'
                  : 'Aktifkan Online saat siap menerima perjalanan.',
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              key: const ValueKey('availability-toggle'),
              onPressed: state.isBusy
                  ? null
                  : () => controller.setAvailability(
                        isOnline
                            ? DriverAvailability.offline
                            : DriverAvailability.online,
                      ),
              icon: Icon(isOnline
                  ? Icons.pause_circle_rounded
                  : Icons.play_circle_rounded),
              label: Text(isOnline ? 'Ubah ke Offline' : 'Online Sekarang'),
            ),
          ],
        ),
      ),
    );
  }
}

class _OfferSection extends StatelessWidget {
  const _OfferSection({required this.state});
  final DriverState state;

  @override
  Widget build(BuildContext context) {
    if (state.offers.isEmpty) {
      return const EmptyStateCard(
        key: ValueKey('offer-empty'),
        icon: Icons.inbox_rounded,
        title: 'Belum ada tawaran',
        message:
            'Tawaran perjalanan akan muncul saat tersedia untuk kendaraan Anda.',
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Tawaran Perjalanan',
            style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        for (final offer in state.offers) OfferTile(ride: offer),
      ],
    );
  }
}

class OfferTile extends ConsumerWidget {
  const OfferTile({required this.ride, super.key});
  final DriverRide ride;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(driverControllerProvider.notifier);
    return Card(
      child: InkWell(
        key: ValueKey('offer-${ride.reference}'),
        borderRadius: BorderRadius.circular(24),
        onTap: () => controller.selectOffer(ride),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              const Icon(Icons.two_wheeler_rounded,
                  size: 36, color: Color(0xFF0877E8)),
              const SizedBox(width: 14),
              Expanded(child: _RideSummary(ride: ride)),
              const Icon(Icons.chevron_right_rounded),
            ],
          ),
        ),
      ),
    );
  }
}

class _RideSummary extends StatelessWidget {
  const _RideSummary({required this.ride});
  final DriverRide ride;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(_serviceLabel(ride.serviceType),
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text('${ride.pickupAddress} ke ${ride.dropoffAddress}', maxLines: 3),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (ride.distanceMeters != null)
              InfoChip(label: _distance(ride.distanceMeters!)),
            if (ride.durationSeconds != null)
              InfoChip(label: _duration(ride.durationSeconds!)),
            if (ride.totalFare != null)
              InfoChip(label: _rupiah(ride.totalFare!)),
          ],
        ),
      ],
    );
  }
}

class ActiveRideCard extends ConsumerWidget {
  const ActiveRideCard({required this.ride, super.key});
  final DriverRide ride;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(driverControllerProvider);
    final controller = ref.read(driverControllerProvider.notifier);
    final action = _nextAction(ride.status);
    return Card(
      key: const ValueKey('active-ride-card'),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 12,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text('Perjalanan Aktif',
                    style: Theme.of(context).textTheme.titleLarge),
                StatusPill(
                  label: _statusLabel(ride.status),
                  active: !ride.isTerminal,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(ride.reference,
                style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 16),
            _TimelineStep(
              icon: Icons.my_location_rounded,
              title: 'Jemput',
              value: ride.pickupAddress,
            ),
            const SizedBox(height: 12),
            _TimelineStep(
              icon: Icons.flag_rounded,
              title: 'Tujuan',
              value: ride.dropoffAddress,
            ),
            const SizedBox(height: 16),
            _RideSummary(ride: ride),
            const SizedBox(height: 20),
            if (!ride.isTerminal && action != null)
              FilledButton(
                key: const ValueKey('trip-primary-action'),
                onPressed: state.isBusy ? null : controller.advanceRide,
                child: Text(_actionLabel(action)),
              ),
            if (!ride.isTerminal) ...[
              const SizedBox(height: 10),
              OutlinedButton(
                key: const ValueKey('trip-cancel-action'),
                onPressed: state.isBusy ? null : controller.cancelRide,
                child: const Text('Batalkan Perjalanan'),
              ),
            ],
            if (ride.isTerminal)
              const EmptyStateCard(
                key: ValueKey('terminal-ride-state'),
                icon: Icons.check_circle_rounded,
                title: 'Perjalanan selesai',
                message:
                    'Status perjalanan sudah final. Muat ulang untuk melihat tawaran berikutnya.',
              ),
          ],
        ),
      ),
    );
  }
}

class OfferDetailSheet extends ConsumerWidget {
  const OfferDetailSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(driverControllerProvider);
    final ride = state.selectedOffer;
    if (ride == null) return const SizedBox.shrink();
    final controller = ref.read(driverControllerProvider.notifier);
    return DraggableScrollableSheet(
      initialChildSize: 0.86,
      maxChildSize: 0.96,
      minChildSize: 0.55,
      builder: (context, scrollController) {
        return Material(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          clipBehavior: Clip.antiAlias,
          child: ListView(
            controller: scrollController,
            padding: const EdgeInsets.all(20),
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 5,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.outlineVariant,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text('Detail Tawaran',
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              _RideSummary(ride: ride),
              const SizedBox(height: 20),
              _TimelineStep(
                icon: Icons.my_location_rounded,
                title: 'Lokasi Jemput',
                value: ride.pickupAddress,
              ),
              const SizedBox(height: 12),
              _TimelineStep(
                icon: Icons.flag_rounded,
                title: 'Tujuan',
                value: ride.dropoffAddress,
              ),
              const SizedBox(height: 20),
              FilledButton(
                key: const ValueKey('accept-offer-button'),
                onPressed:
                    state.isBusy || ride.status != RideStatus.searchingDriver
                        ? null
                        : controller.acceptSelectedOffer,
                child: const Text('Terima Perjalanan'),
              ),
              const SizedBox(height: 10),
              OutlinedButton(
                key: const ValueKey('reject-offer-button'),
                onPressed: state.isBusy ? null : controller.rejectSelectedOffer,
                child: const Text('Tolak'),
              ),
              const SizedBox(height: 24),
            ],
          ),
        );
      },
    );
  }
}

class _TimelineStep extends StatelessWidget {
  const _TimelineStep(
      {required this.icon, required this.title, required this.value});
  final IconData icon;
  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 48,
          height: 48,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color:
                  Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(icon, color: Theme.of(context).colorScheme.primary),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(value),
            ],
          ),
        ),
      ],
    );
  }
}

class CapabilityScreen extends ConsumerWidget {
  const CapabilityScreen({
    required this.title,
    required this.message,
    required this.icon,
    this.showRetry = false,
    this.showLoginAction = false,
    super.key,
  });

  final String title;
  final String message;
  final IconData icon;
  final bool showRetry;
  final bool showLoginAction;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(driverControllerProvider.notifier);
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, kDriverDemoMode ? 72 : 32, 20, 20),
      children: [
        EmptyStateCard(icon: icon, title: title, message: message),
        const SizedBox(height: 16),
        if (showRetry)
          FilledButton(
            key: const ValueKey('retry-button'),
            onPressed: controller.refreshWorkspace,
            child: const Text('Coba Lagi'),
          ),
        if (showLoginAction)
          FilledButton(
            key: const ValueKey('back-to-login-button'),
            onPressed: controller.logout,
            child: const Text('Login Kembali'),
          ),
        if (kDriverDemoMode) const DemoScenarioSelector(),
      ],
    );
  }
}

class EmptyStateCard extends StatelessWidget {
  const EmptyStateCard({
    required this.icon,
    required this.title,
    required this.message,
    super.key,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          children: [
            Icon(icon, size: 48, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 14),
            Text(title,
                style: Theme.of(context).textTheme.titleLarge,
                textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}

class ErrorNotice extends StatelessWidget {
  const ErrorNotice({required this.message, super.key});
  final String message;
  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.errorContainer,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          message,
          style:
              TextStyle(color: Theme.of(context).colorScheme.onErrorContainer),
        ),
      ),
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill({required this.label, required this.active, super.key});
  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: active
            ? const Color(0xFFDCFCE7)
            : Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: active
              ? const Color(0xFF166534)
              : Theme.of(context).colorScheme.onSurfaceVariant,
          fontWeight: FontWeight.w800,
          fontSize: 12,
        ),
      ),
    );
  }
}

class InfoChip extends StatelessWidget {
  const InfoChip({required this.label, super.key});
  final String label;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(label,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
    );
  }
}

class DemoScenarioSelector extends ConsumerWidget {
  const DemoScenarioSelector({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!kDriverDemoMode) return const SizedBox.shrink();
    final state = ref.watch(driverControllerProvider);
    final controller = ref.read(driverControllerProvider.notifier);
    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: DropdownButtonFormField<DriverScenario>(
        key: const ValueKey('demo-scenario-selector'),
        initialValue: state.demoScenario,
        isExpanded: true,
        decoration: const InputDecoration(
          labelText: 'Scenario demo',
          border: OutlineInputBorder(),
        ),
        items: [
          for (final scenario in DriverScenario.values)
            DropdownMenuItem(
                value: scenario, child: Text(_scenarioLabel(scenario))),
        ],
        onChanged: (value) {
          if (value != null) controller.demoScenario(value);
        },
      ),
    );
  }
}

String _scenarioLabel(DriverScenario value) {
  switch (value) {
    case DriverScenario.login:
      return 'Login';
    case DriverScenario.profileRequired:
      return 'Profile required';
    case DriverScenario.pending:
      return 'Pending';
    case DriverScenario.suspended:
      return 'Suspended';
    case DriverScenario.rejected:
      return 'Rejected';
    case DriverScenario.accountInactive:
      return 'Account inactive';
    case DriverScenario.homeOffline:
      return 'Home offline';
    case DriverScenario.homeOnline:
      return 'Home online';
    case DriverScenario.offerEmpty:
      return 'Offer empty';
    case DriverScenario.offerAvailable:
      return 'Offer tersedia';
    case DriverScenario.toPickup:
      return 'Menuju jemput';
    case DriverScenario.arrived:
      return 'Arrived';
    case DriverScenario.inTrip:
      return 'In trip';
    case DriverScenario.completed:
      return 'Completed';
    case DriverScenario.cancelled:
      return 'Cancelled';
    case DriverScenario.networkError:
      return 'Network error';
    case DriverScenario.sessionExpired:
      return 'Session expired';
  }
}

String _serviceLabel(String type) =>
    type == 'CAR' ? 'Ojek Mobil' : 'Ojek Motor';
String _distance(int meters) =>
    meters >= 1000 ? '${(meters / 1000).toStringAsFixed(1)} km' : '$meters m';
String _duration(int seconds) => '${(seconds / 60).ceil()} menit';
String _rupiah(int amount) {
  final raw = amount.toString();
  final buffer = StringBuffer();
  for (var i = 0; i < raw.length; i += 1) {
    final left = raw.length - i;
    buffer.write(raw[i]);
    if (left > 1 && left % 3 == 1) buffer.write('.');
  }
  return 'Rp$buffer';
}

String _statusLabel(RideStatus status) {
  switch (status) {
    case RideStatus.searchingDriver:
      return 'Mencari Driver';
    case RideStatus.driverAssigned:
      return 'Driver Ditugaskan';
    case RideStatus.driverToPickup:
      return 'Menuju Jemput';
    case RideStatus.driverArrived:
      return 'Tiba di Jemput';
    case RideStatus.inTrip:
      return 'Dalam Perjalanan';
    case RideStatus.completed:
      return 'Selesai';
    case RideStatus.cancelledByPassenger:
    case RideStatus.cancelledByDriver:
    case RideStatus.cancelledBySystem:
      return 'Dibatalkan';
    case RideStatus.expired:
      return 'Kedaluwarsa';
    case RideStatus.noDriver:
      return 'Tidak Ada Driver';
    case RideStatus.paymentFailed:
      return 'Pembayaran Gagal';
    case RideStatus.unknown:
      return 'Status Tidak Dikenal';
  }
}

String _actionLabel(_TripAction action) {
  switch (action) {
    case _TripAction.pickup:
      return 'Mulai Menuju Jemput';
    case _TripAction.arrived:
      return 'Saya Sudah Tiba';
    case _TripAction.start:
      return 'Mulai Perjalanan';
    case _TripAction.complete:
      return 'Selesaikan Perjalanan';
  }
}

class DriverOverlay extends ConsumerWidget {
  const DriverOverlay({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selected =
        ref.watch(driverControllerProvider.select((s) => s.selectedOffer));
    return Stack(
      children: [
        child,
        if (selected != null) const OfferDetailSheet(),
      ],
    );
  }
}
