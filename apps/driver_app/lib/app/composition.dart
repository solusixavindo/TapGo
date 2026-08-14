part of '../main.dart';

@visibleForTesting
Widget buildTestableDriverApp({
  required DriverRepository repository,
  DriverLocationPort? locationPort,
  DriverScenario scenario = DriverScenario.homeOffline,
  ThemeMode themeMode = ThemeMode.light,
}) {
  return ProviderScope(
    overrides: [
      driverRepositoryProvider.overrideWithValue(repository),
      locationPortProvider
          .overrideWithValue(locationPort ?? NoDriverLocationPort()),
      initialScenarioProvider.overrideWithValue(scenario),
      testThemeModeProvider.overrideWithValue(themeMode),
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
final locationPortProvider =
    Provider<DriverLocationPort>((_) => NoDriverLocationPort());
final initialScenarioProvider =
    Provider<DriverScenario>((_) => _initialScenarioFromUri());
final testThemeModeProvider = Provider<ThemeMode?>((_) => null);
final driverControllerProvider =
    StateNotifierProvider<DriverController, DriverState>((ref) {
  return DriverController(
    repository: ref.watch(driverRepositoryProvider),
    locationPort: ref.watch(locationPortProvider),
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
