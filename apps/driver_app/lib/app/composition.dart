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
  (ref) => kDriverDemoMode || kIsWeb
      ? null
      : FirebaseDriverPushPlatform(
          tone: () => ref.read(driverAlertToneProvider),
        ),
);
final initialScenarioProvider =
    Provider<DriverScenario>((_) => _initialScenarioFromUri());
final testThemeModeProvider = Provider<ThemeMode?>((_) => null);
final testSkipSplashProvider = Provider<bool>((_) => false);

/// Preferensi tema pilihan driver sendiri (Terang/Gelap/Ikuti sistem),
/// tersimpan lewat SharedPreferences. `null` berarti ikuti sistem — nilai
/// bawaan sebelum driver pernah memilih apa pun, dan pilihan eksplisit untuk
/// kembali mengikuti sistem.
final driverThemePreferenceProvider =
    StateNotifierProvider<DriverThemePreferenceController, ThemeMode?>((ref) {
  return DriverThemePreferenceController();
});

class DriverThemePreferenceController extends StateNotifier<ThemeMode?> {
  DriverThemePreferenceController() : super(null) {
    // Mode demo/test tidak pernah menyentuh SharedPreferences sungguhan —
    // testThemeModeProvider selalu menang di atasnya (lihat TapGoDriverApp),
    // jadi tidak membaca preferensi di sini pun tidak mengubah apa yang
    // tampil di widget test.
    if (!kDriverDemoMode) unawaited(_restore());
  }

  static const _prefsKey = 'tapgo_driver_theme_mode';

  Future<void> _restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_prefsKey);
      if (!mounted) return;
      state = switch (raw) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => null,
      };
    } catch (_) {
      // Preferensi tersimpan tidak terbaca — tetap ikuti tema sistem,
      // bukan kondisi yang boleh menghentikan aplikasi.
    }
  }

  /// `null` = ikuti sistem.
  Future<void> setThemeMode(ThemeMode? mode) async {
    state = mode;
    try {
      final prefs = await SharedPreferences.getInstance();
      if (mode == null) {
        await prefs.remove(_prefsKey);
      } else {
        await prefs.setString(_prefsKey, mode == ThemeMode.dark ? 'dark' : 'light');
      }
    } catch (_) {
      // Tetap berlaku untuk sesi berjalan ini walau gagal disimpan permanen.
    }
  }
}
final driverControllerProvider =
    StateNotifierProvider<DriverController, DriverState>((ref) {
  return DriverController(
    repository: ref.watch(driverRepositoryProvider),
    locationPort: ref.watch(locationPortProvider),
    pushPlatform: ref.watch(pushPlatformProvider),
    alertTone: () => ref.read(driverAlertToneProvider),
    alertToneReady: () => ref.read(driverAlertToneProvider.notifier).ready,
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

/// Bunyi peringatan pilihan driver (Akun > Notifikasi), tersimpan lewat
/// SharedPreferences. Berlaku langsung saat aplikasi terbuka, dan dikirim ke
/// server (lihat DriverController) supaya notifikasi saat aplikasi tertutup
/// memakai channel bunyi yang sama.
final driverAlertToneProvider =
    StateNotifierProvider<DriverAlertToneController, DriverAlertTone>((ref) {
  return DriverAlertToneController();
});

class DriverAlertToneController extends StateNotifier<DriverAlertTone> {
  DriverAlertToneController() : super(DriverAlertTone.tapgo) {
    _ready = kDriverDemoMode ? Future<void>.value() : _restore();
  }

  static const _prefsKey = 'tapgo_driver_alert_tone';

  late final Future<void> _ready;

  /// Selesai setelah pilihan tersimpan terbaca, supaya pendaftaran token saat
  /// aplikasi baru dibuka tidak mengirim bunyi bawaan menimpa pilihan driver.
  Future<void> get ready => _ready;

  Future<void> _restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_prefsKey);
      if (!mounted) return;
      state = DriverAlertTone.fromKey(raw);
    } catch (_) {
      // Tidak terbaca: tetap bunyi bawaan.
    }
  }

  Future<void> select(DriverAlertTone tone) async {
    state = tone;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefsKey, tone.key);
    } catch (_) {
      // Tetap berlaku untuk sesi ini walau gagal disimpan permanen.
    }
  }
}
