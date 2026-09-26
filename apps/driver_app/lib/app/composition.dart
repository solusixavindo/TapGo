part of '../main.dart';

@visibleForTesting
Widget buildTestableDriverApp({
  required DriverRepository repository,
  DriverLocationPort? locationPort,
  DriverPushPlatform? pushPlatform,
  DriverScenario scenario = DriverScenario.homeOffline,
  ThemeMode themeMode = ThemeMode.light,
  // Splash bergantung pada SharedPreferences (kanal platform) dan jeda
  // waktu nyata — keduanya tidak cocok untuk widget test yang mengharapkan
  // DriverShell tampil seketika. Test yang secara eksplisit ingin menguji
  // SplashScreen/OnboardingScreen memakainya langsung sebagai widget,
  // bukan lewat helper ini.
  bool skipSplash = true,
}) {
  return ProviderScope(
    overrides: [
      driverRepositoryProvider.overrideWithValue(repository),
      locationPortProvider
          .overrideWithValue(locationPort ?? NoDriverLocationPort()),
      pushPlatformProvider.overrideWithValue(pushPlatform),
      initialScenarioProvider.overrideWithValue(scenario),
      testThemeModeProvider.overrideWithValue(themeMode),
      testSkipSplashProvider.overrideWithValue(skipSplash),
    ],
    child: const TapGoDriverApp(),
  );
}

final driverRepositoryProvider = Provider<DriverRepository>(
  (_) => kDriverDemoMode
      ? DemoDriverRepository()
      : ApiDriverRepository(
          baseUrl: kApiBaseUrl,
          storage: kIsWeb ? MemorySessionStore() : SecureSessionStore(),
        ),
);
final locationPortProvider = Provider<DriverLocationPort>((ref) {
  // Mode demo tidak pernah menyentuh GPS/network asli — konsisten dengan
  // prinsip zero-network demo yang sudah diuji di tempat lain.
  if (kDriverDemoMode) return NoDriverLocationPort();
  return GeolocatorDriverLocationPort(ref.watch(driverRepositoryProvider));
});
final pushPlatformProvider = Provider<DriverPushPlatform?>(
  (_) => kDriverDemoMode || kIsWeb ? null : FirebaseDriverPushPlatform(),
);
final initialScenarioProvider =
    Provider<DriverScenario>((_) => _initialScenarioFromUri());
final testThemeModeProvider = Provider<ThemeMode?>((_) => null);
final testSkipSplashProvider = Provider<bool>((_) => false);
final driverControllerProvider =
    StateNotifierProvider<DriverController, DriverState>((ref) {
  return DriverController(
    repository: ref.watch(driverRepositoryProvider),
    locationPort: ref.watch(locationPortProvider),
    pushPlatform: ref.watch(pushPlatformProvider),
    initialScenario: ref.watch(initialScenarioProvider),
  );
});

DriverScenario _initialScenarioFromUri() {
  if (!kDriverDemoMode) return DriverScenario.login;
  return _scenarioByKey(Uri.base.queryParameters['scenario']) ??
      DriverScenario.login;
}

DriverScenario? _scenarioByKey(String? key) {
  switch (key) {
    case 'login':
      return DriverScenario.login;
    case 'profileRequired':
      return DriverScenario.profileRequired;
    case 'pending':
      return DriverScenario.pending;
    case 'suspended':
      return DriverScenario.suspended;
    case 'rejected':
      return DriverScenario.rejected;
    case 'accountInactive':
      return DriverScenario.accountInactive;
    case 'homeOffline':
      return DriverScenario.homeOffline;
    case 'homeOnline':
      return DriverScenario.homeOnline;
    case 'offerEmpty':
      return DriverScenario.offerEmpty;
    case 'offerAvailable':
      return DriverScenario.offerAvailable;
    case 'toPickup':
      return DriverScenario.toPickup;
    case 'arrived':
      return DriverScenario.arrived;
    case 'inTrip':
      return DriverScenario.inTrip;
    case 'completed':
      return DriverScenario.completed;
    case 'cancelled':
      return DriverScenario.cancelled;
    case 'networkError':
      return DriverScenario.networkError;
    case 'sessionExpired':
      return DriverScenario.sessionExpired;
    default:
      return null;
  }
}
